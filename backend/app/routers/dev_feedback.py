import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.deps import get_current_cohort_id, get_db, require_staff, resolve_current_user_row
from app.models import DevFeedback, DevFeedbackReply

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
    reply: str
    created_at: object

    model_config = {"from_attributes": True}


class DevFeedbackResponse(BaseModel):
    id: int
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


async def _replies_by_feedback_id(db: AsyncSession, feedback_ids: list[int]) -> dict[int, list[DevFeedbackReply]]:
    if not feedback_ids:
        return {}
    rows = (await db.execute(
        select(DevFeedbackReply)
        .where(DevFeedbackReply.feedback_id.in_(feedback_ids))
        .order_by(DevFeedbackReply.created_at)
    )).scalars().all()
    grouped: dict[int, list[DevFeedbackReply]] = {fid: [] for fid in feedback_ids}
    for r in rows:
        grouped[r.feedback_id].append(r)
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
            id=e.id, reporter_display_name=e.reporter_display_name,
            message=e.message, created_at=e.created_at,
            replies=replies_by_id.get(e.id, []),
        )
        for e in entries
    ]


@router.post("/{feedback_id}/reply", response_model=DevFeedbackResponse)
async def reply_dev_feedback(
    feedback_id: int,
    body: DevFeedbackReplyCreate,
    user: dict = Depends(require_staff),
    db: AsyncSession = Depends(get_db),
):
    """개발자 본인만 답변 작성 가능. 진행상황 업데이트처럼 여러 번 남길 수 있다."""
    if not await _is_developer(db, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="개발자만 답변할 수 있습니다")

    entry = await db.get(DevFeedback, feedback_id)
    if not entry:
        raise HTTPException(status_code=404, detail="요청을 찾을 수 없습니다")

    reply_row = DevFeedbackReply(
        feedback_id=feedback_id, author_username=user["username"], reply=body.reply.strip(),
    )
    db.add(reply_row)
    await db.commit()
    logger.audit(f"🛠️ 개발자 답변 — #{feedback_id}: {reply_row.reply[:80]}")

    replies = (await _replies_by_feedback_id(db, [feedback_id])).get(feedback_id, [])
    return DevFeedbackResponse(
        id=entry.id, reporter_display_name=entry.reporter_display_name,
        message=entry.message, created_at=entry.created_at, replies=replies,
    )
