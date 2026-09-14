import logging

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.deps import get_current_cohort_id, get_db, require_staff, resolve_current_user_row
from app.models import DevFeedback

logger = logging.getLogger("dev_feedback")

router = APIRouter(prefix="/dev-feedback", tags=["dev-feedback"])


class DevFeedbackCreate(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


class DevFeedbackResponse(BaseModel):
    id: int
    reporter_display_name: str
    message: str
    created_at: object

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
    return entry


@router.get("", response_model=list[DevFeedbackResponse])
async def list_dev_feedback(
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """최근 요청 내역 (같은 기수 운영진끼리 공유 — 중복 신고 방지용)."""
    result = await db.execute(
        select(DevFeedback)
        .where(DevFeedback.cohort_id == cohort_id)
        .order_by(DevFeedback.created_at.desc())
        .limit(50)
    )
    return result.scalars().all()
