import logging
import os
import uuid

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.deps import (
    DEVELOPER_USERNAME, get_current_cohort_id, get_db, require_staff,
    resolve_current_user_row,
)
from app.models import DevFeedback, DevFeedbackImage, DevFeedbackReply, PushSubscription, User
from app.services.portal_excuse import sniff_type

logger = logging.getLogger("dev_feedback")

router = APIRouter(prefix="/dev-feedback", tags=["dev-feedback"])

# 개발자 판별은 deps.DEVELOPER_USERNAME / require_developer 로 일원화했다.
# 같은 규칙이 여러 파일에 복사돼 있으면 한 곳만 고치고 나머지를 놓친다.


async def _is_developer(db: AsyncSession, user: dict) -> bool:
    row = await resolve_current_user_row(db, user)
    return bool(row and row.cohort_id is None and row.username == DEVELOPER_USERNAME)


# 첨부 이미지 — 사유서 증빙과 같은 규칙(형식은 바이트로 판별, 비공개 저장)
_IMG_DIR = "/app/files/uploads/devfb"
_IMG_MAX_BYTES = 10 * 1024 * 1024
_IMG_MAX_COUNT = 5  # 글(요청 본문 또는 답글) 하나당
_IMG_EXT = {"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp"}


class DevFeedbackImageOut(BaseModel):
    id: int


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
    images: list[DevFeedbackImageOut] = []

    model_config = {"from_attributes": True}


class DevFeedbackResponse(BaseModel):
    id: int
    reporter_username: str = ""
    reporter_display_name: str
    message: str
    created_at: object
    images: list[DevFeedbackImageOut] = []
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


async def _images_by_owner(db: AsyncSession, feedback_ids: list[int]) -> dict[tuple[int, int | None], list[DevFeedbackImageOut]]:
    """(feedback_id, reply_id) → 이미지 목록. reply_id None = 요청 본문."""
    if not feedback_ids:
        return {}
    rows = (await db.execute(
        select(DevFeedbackImage).where(DevFeedbackImage.feedback_id.in_(feedback_ids)).order_by(DevFeedbackImage.id)
    )).scalars().all()
    out: dict[tuple[int, int | None], list[DevFeedbackImageOut]] = {}
    for im in rows:
        out.setdefault((im.feedback_id, im.reply_id), []).append(DevFeedbackImageOut(id=im.id))
    return out


async def _replies_by_feedback_id(db: AsyncSession, feedback_ids: list[int]) -> dict[int, list[DevFeedbackReplyOut]]:
    if not feedback_ids:
        return {}
    images = await _images_by_owner(db, feedback_ids)
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
            images=images.get((r.feedback_id, r.id), []),
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

    ids = [e.id for e in entries]
    replies_by_id = await _replies_by_feedback_id(db, ids)
    images = await _images_by_owner(db, ids)
    return [
        DevFeedbackResponse(
            id=e.id, reporter_username=e.reporter_username,
            reporter_display_name=e.reporter_display_name,
            message=e.message, created_at=e.created_at,
            images=images.get((e.id, None), []),
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
    images = await _images_by_owner(db, [feedback_id])
    return DevFeedbackResponse(
        id=entry.id, reporter_username=entry.reporter_username,
        reporter_display_name=entry.reporter_display_name,
        message=entry.message, created_at=entry.created_at,
        images=images.get((feedback_id, None), []), replies=replies,
    )


async def _readable_entry(db: AsyncSession, user: dict, cohort_id: int, feedback_id: int) -> DevFeedback:
    """읽기 범위와 같은 규칙 — 개발자는 전 기수, 나머지는 본인 기수 요청만."""
    entry = await db.get(DevFeedback, feedback_id)
    if not entry:
        raise HTTPException(status_code=404, detail="요청을 찾을 수 없습니다")
    if entry.cohort_id != cohort_id and not await _is_developer(db, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="다른 기수의 요청입니다")
    return entry


@router.post("/{feedback_id}/images", response_model=DevFeedbackImageOut, status_code=201)
async def upload_dev_feedback_image(
    feedback_id: int,
    file: UploadFile = File(...),
    reply_id: int | None = Query(None),
    user: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """요청 본문(reply_id 없음) 또는 답글에 이미지 첨부 — 그 글을 쓴 본인만."""
    entry = await _readable_entry(db, user, cohort_id, feedback_id)
    if reply_id is None:
        if entry.reporter_username != user["username"]:
            raise HTTPException(status_code=403, detail="본인이 쓴 글에만 이미지를 붙일 수 있어요")
    else:
        rep = await db.get(DevFeedbackReply, reply_id)
        if rep is None or rep.feedback_id != feedback_id:
            raise HTTPException(status_code=404, detail="글을 찾을 수 없습니다")
        if rep.author_username != user["username"]:
            raise HTTPException(status_code=403, detail="본인이 쓴 글에만 이미지를 붙일 수 있어요")
    owner = (DevFeedbackImage.reply_id == reply_id) if reply_id is not None else DevFeedbackImage.reply_id.is_(None)
    count = (await db.execute(
        select(func.count()).select_from(DevFeedbackImage)
        .where(DevFeedbackImage.feedback_id == feedback_id, owner)
    )).scalar_one()
    if count >= _IMG_MAX_COUNT:
        raise HTTPException(status_code=422, detail=f"이미지는 글 하나에 {_IMG_MAX_COUNT}장까지 올릴 수 있어요")
    data = await file.read(_IMG_MAX_BYTES + 1)
    if len(data) > _IMG_MAX_BYTES:
        raise HTTPException(status_code=413, detail="이미지는 10MB 이하만 가능해요")
    ctype = sniff_type(data)
    if ctype is None:
        raise HTTPException(status_code=400, detail="이미지 파일(png/jpg/webp/gif)만 올릴 수 있어요")
    os.makedirs(_IMG_DIR, exist_ok=True)
    stored = uuid.uuid4().hex + _IMG_EXT[ctype]
    with open(os.path.join(_IMG_DIR, stored), "wb") as f:
        f.write(data)
    img = DevFeedbackImage(feedback_id=feedback_id, reply_id=reply_id, uploader_username=user["username"],
                           stored_name=stored, content_type=ctype, size=len(data))
    db.add(img)
    await db.commit()
    return DevFeedbackImageOut(id=img.id)


@router.get("/images/{image_id}")
async def get_dev_feedback_image(
    image_id: int,
    user: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    img = await db.get(DevFeedbackImage, image_id)
    if img is None:
        raise HTTPException(status_code=404, detail="이미지를 찾을 수 없습니다")
    await _readable_entry(db, user, cohort_id, img.feedback_id)
    path = os.path.join(_IMG_DIR, img.stored_name)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="이미지를 찾을 수 없습니다")
    return FileResponse(path, media_type=img.content_type, headers={
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
    })
