"""웹 푸시 발송 헬퍼 (표준 VAPID / pywebpush).

pywebpush는 동기(requests)라 워커에서 asyncio.to_thread로 호출한다.
대상(target) 해석 → 구독 id 수집은 라우터에서, 실제 전송은 워커에서.
"""
import json
import logging

from pywebpush import WebPushException, webpush
from sqlalchemy import select

from app.config import settings
from app.models import Member, PushSubscription, User

logger = logging.getLogger("push")


def send_webpush(endpoint: str, p256dh: str, auth: str, payload: dict) -> str:
    """단일 구독에 발송. 반환: 'ok' | 'expired'(404/410, 삭제대상) | 'error'."""
    if not settings.VAPID_PRIVATE_KEY:
        logger.warning("VAPID_PRIVATE_KEY 미설정 — 푸시 스킵")
        return "error"
    try:
        webpush(
            subscription_info={"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}},
            data=json.dumps(payload, ensure_ascii=False),
            vapid_private_key=settings.VAPID_PRIVATE_KEY,
            vapid_claims={"sub": settings.VAPID_SUBJECT},
            ttl=86400,
        )
        return "ok"
    except WebPushException as e:
        code = getattr(e.response, "status_code", None)
        if code in (404, 410):
            return "expired"
        logger.warning("push 실패 code=%s endpoint=%s", code, endpoint[:60])
        return "error"
    except Exception as e:  # noqa: BLE001
        logger.warning("push 예외: %s", e)
        return "error"


async def resolve_subscription_ids(
    db, cohort_id: int, target: str, member_ids: list[int] | None = None
) -> list[int]:
    """대상(target)에 해당하는 push_subscription id 목록 (현재 기수 스코프)."""
    conds = []
    member_target = PushSubscription.member_id.in_(
        select(Member.id).where(Member.is_active == True, Member.cohort_id == cohort_id)  # noqa: E712
    )
    staff_target = PushSubscription.user_id.in_(
        select(User.id).where(User.is_active == True, User.cohort_id == cohort_id)  # noqa: E712
    )
    if target == "members":
        conds.append(member_target)
    elif target == "staff":
        conds.append(staff_target)
    elif target == "all":
        conds.append(member_target | staff_target)
    elif target == "select":
        ids = member_ids or []
        if not ids:
            return []
        # 선택 멤버가 현재 기수 소속인지 보장
        valid = (await db.execute(
            select(Member.id).where(Member.id.in_(ids), Member.cohort_id == cohort_id)
        )).scalars().all()
        conds.append(PushSubscription.member_id.in_(list(valid)))
    else:
        return []
    rows = await db.execute(select(PushSubscription.id).where(*conds))
    return [r[0] for r in rows.all()]
