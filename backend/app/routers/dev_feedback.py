import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.deps import get_current_cohort_id, get_db, require_staff, resolve_current_user_row
from app.models import DevFeedback, DevFeedbackReply, PushSubscription, User

logger = logging.getLogger("dev_feedback")

router = APIRouter(prefix="/dev-feedback", tags=["dev-feedback"])

# 실제 개발자 계정 — 이 사람만 답변을 남길 수 있다. 이 기능 전용으로 딱 한 명이라
# 별도 역할 체계 없이 username으로 직접 체크한다.
# 주의: 기수 분리로 username이 기수마다 중복될 수 있으므로, 반드시 DB 조회한 User row의
# cohort_id IS NULL(슈퍼관리자만 가능)까지 같이 확인해야 한다 — username만 보면 어떤
# 기수 매니저가 우연히 같은 아이디를 쓰면 개발자 권한을 그대로 얻어간다.
DEVELOPER_USERNAME = "adminyhk"


async def _is_developer(db: AsyncSession, user: dict) -> bool:
    row = await resolve_current_user_row(db, user)
    return bool(row and row.cohort_id is None and row.username == DEVELOPER_USERNAME)


class DevFeedbackCreate(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


class DevFeedbackReplyCreate(BaseModel):
    reply: str = Field(min_length=1, max_length=2000)


class DevFeedbackReplyOut(BaseModel):
    id: int
    author_username: str
    author_display_name: str | None = None
    is_developer: bool = False
    reply: str
    created_at: object

    model_config = {"from_attributes": True}


class DevFeedbackResponse(BaseModel):
    id: int
    reporter_username: str = ""
    reporter_display_name: str
    message: str
    created_at: object
    replies: list[DevFeedbackReplyOut] = []

    model_config = {"from_attributes": True}


async def _notify_telegram(text: str) -> None:
    """에러 알림과 같은 채널로 개발자에게 실시간 알림. 실패해도 요청은 성공 처리."""
    if not settings.TELEGRAM_BOT_TOKEN or not settings.TELEGRAM_ALERT_CHAT_ID:
        return
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/sendMessage",
                json={
                    "chat_id": settings.TELEGRAM_ALERT_CHAT_ID,
                    "text": text,
                    "parse_mode": "Markdown",
                },
            )
    except Exception:
        logger.warning("dev_feedback telegram notify failed", exc_info=True)


@router.post("", response_model=DevFeedbackResponse, status_code=201)
async def create_dev_feedback(
    body: DevFeedbackCreate,
    user: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """운영자(관리자/매니저)가 개발자에게 수정 요청/건의사항을 보낸다."""
    reporter = await resolve_current_user_row(db, user)
    display_name = reporter.display_name if reporter else user["username"]

    entry = DevFeedback(
        cohort_id=cohort_id,
        reporter_username=user["username"],
        reporter_display_name=display_name,
        message=body.message.strip(),
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)

    await _notify_telegram(
        f"🛠️ *개발자 수정 요청*\n"
        f"👤 {display_name} ({user['username']})\n\n"
        f"{entry.message}"
    )
    logger.audit(f"🛠️ 개발자 요청 — {display_name}: {entry.message[:80]}")
    return DevFeedbackResponse(
        id=entry.id, reporter_display_name=entry.reporter_display_name,
        message=entry.message, created_at=entry.created_at, replies=[],
    )


async def _replies_by_feedback_id(db: AsyncSession, feedback_ids: list[int]) -> dict[int, list[DevFeedbackReplyOut]]:
    if not feedback_ids:
        return {}
    rows = (await db.execute(
        select(DevFeedbackReply)
        .where(DevFeedbackReply.feedback_id.in_(feedback_ids))
        .order_by(DevFeedbackReply.created_at)
    )).scalars().all()
    grouped: dict[int, list[DevFeedbackReplyOut]] = {fid: [] for fid in feedback_ids}
    for r in rows:
        grouped[r.feedback_id].append(DevFeedbackReplyOut(
            id=r.id,
            author_username=r.author_username,
            # 과거 행은 표시명이 없다 — 그때는 개발자만 썼으므로 그렇게 보여준다
            author_display_name=r.author_display_name or ("개발자" if r.author_username == DEVELOPER_USERNAME else r.author_username),
            is_developer=(r.author_username == DEVELOPER_USERNAME),
            reply=r.reply,
            created_at=r.created_at,
        ))
    return grouped


@router.get("", response_model=list[DevFeedbackResponse])
async def list_dev_feedback(
    user: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """최근 요청 내역. 개발자 본인은 전 기수를 보고, 나머지는 같은 기수 운영진끼리만 공유(중복 신고 방지용)."""
    query = select(DevFeedback).order_by(DevFeedback.created_at.desc()).limit(100)
    if not await _is_developer(db, user):
        query = query.where(DevFeedback.cohort_id == cohort_id).limit(50)
    entries = (await db.execute(query)).scalars().all()

    replies_by_id = await _replies_by_feedback_id(db, [e.id for e in entries])
    return [
        DevFeedbackResponse(
            id=e.id, reporter_username=e.reporter_username,
            reporter_display_name=e.reporter_display_name,
            message=e.message, created_at=e.created_at,
            replies=replies_by_id.get(e.id, []),
        )
        for e in entries
    ]


async def _notify_thread(
    request: Request, db: AsyncSession, entry: DevFeedback,
    author_username: str, author_label: str, text: str,
) -> None:
    """스레드에 새 글이 달리면 나머지 참여자에게 웹푸시.
    참여자 = 요청자 + 기존 작성자들. 본인은 제외하고, 개발자는 텔레그램으로 따로 받는다."""
    prior = (await db.execute(
        select(DevFeedbackReply.author_username).where(DevFeedbackReply.feedback_id == entry.id)
    )).scalars().all()
    targets = {entry.reporter_username, *prior} - {author_username, DEVELOPER_USERNAME}
    if not targets:
        return
    # username은 기수 간 중복될 수 있어 이 요청의 기수로 반드시 좁힌다
    sub_ids = [r[0] for r in (await db.execute(
        select(PushSubscription.id).where(
            PushSubscription.user_id.in_(
                select(User.id).where(
                    User.username.in_(targets), User.cohort_id == entry.cohort_id,
                )
            )
        )
    )).all()]
    if not sub_ids:
        return
    pool = getattr(request.app.state, "arq_pool", None)
    if pool:
        await pool.enqueue_job("task_send_push", payload={
            "title": "개발자 요청에 새 글",
            "body": f"{author_label}: {text[:60]}",
            "url": "/dev-feedback",
            "tag": f"devfb-{entry.id}",
        }, subscription_ids=sub_ids)


@router.post("/{feedback_id}/reply", response_model=DevFeedbackResponse)
async def reply_dev_feedback(
    feedback_id: int,
    body: DevFeedbackReplyCreate,
    request: Request,
    user: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """스레드에 글 추가. 개발자는 전 기수, 나머지 운영진은 본인 기수 요청에만 쓸 수 있다
    (읽기 범위와 같은 규칙 — 요청자도 이 경로로 되묻는다)."""
    entry = await db.get(DevFeedback, feedback_id)
    if not entry:
        raise HTTPException(status_code=404, detail="요청을 찾을 수 없습니다")

    is_dev = await _is_developer(db, user)
    if not is_dev and entry.cohort_id != cohort_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="다른 기수의 요청입니다")

    urow = await resolve_current_user_row(db, user)
    label = "개발자" if is_dev else (urow.display_name if urow else user["username"])
    text = body.reply.strip()

    reply_row = DevFeedbackReply(
        feedback_id=feedback_id, author_username=user["username"],
        author_display_name=label, reply=text,
    )
    db.add(reply_row)
    await db.commit()
    logger.audit(f"🛠️ 개발자창구 답글 — #{feedback_id} by {user['username']}: {text[:80]}")

    # 개발자가 아닌 사람이 쓰면 개발자에게 텔레그램(기존 알림 경로 재사용)
    if not is_dev:
        await _notify_telegram(f"💬 *요청 #{feedback_id} 새 글* — {label}\n{text[:300]}")
    await _notify_thread(request, db, entry, user["username"], label, text)

    replies = (await _replies_by_feedback_id(db, [feedback_id])).get(feedback_id, [])
    return DevFeedbackResponse(
        id=entry.id, reporter_username=entry.reporter_username,
        reporter_display_name=entry.reporter_display_name,
        message=entry.message, created_at=entry.created_at, replies=replies,
    )
