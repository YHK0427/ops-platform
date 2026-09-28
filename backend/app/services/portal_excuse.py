"""기수 포털 사유서 — 판정 규칙과 출결 반영.

마감(KST 21:59:59 = UTC 12:59:59): 사전 = 세션 전날, 사후 = 세션 다음날.
사후 마감이 지나면 제출 불가(classify 가 None).
"""
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

CATEGORY_STATUS = {"ABSENT": "ABSENT", "LATE": "LATE_UNDER10", "EARLY_LEAVE": "EARLY_LEAVE"}
CATEGORY_LABEL = {"ABSENT": "결석", "LATE": "지각", "EARLY_LEAVE": "조퇴"}
_REVIEW_LABEL = {"PENDING": "승인 대기", "APPROVED": "승인", "REJECTED": "반려"}
_KST = timezone(timedelta(hours=9))


_SIGNATURES = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF8", "image/gif"),
)


def sniff_type(data: bytes) -> str | None:
    """파일 앞 바이트로 형식 판별. 브라우저가 보낸 content-type 은 믿지 않는다(위장 SVG/HTML 차단)."""
    for sig, ctype in _SIGNATURES:
        if data.startswith(sig):
            return ctype
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _deadline(d: date, offset_days: int) -> datetime:
    return datetime.combine(d + timedelta(days=offset_days), time(12, 59, 59), tzinfo=timezone.utc)


def edit_deadline(target_date: date, excuse_type: str) -> datetime:
    return _deadline(target_date, -1 if excuse_type == "PRE" else 1)


def classify(target_date: date, now: datetime) -> str | None:
    if now <= _deadline(target_date, -1):
        return "PRE"
    if now <= _deadline(target_date, 1):
        return "POST"
    return None


def desired_status(
    category: str, reason_kind: str, review: str | None, current: str,
    applied: str | None = None,
) -> str | None:
    """반영 후 출결 상태. None 이면 현재 값을 그대로 둔다.

    "우리 값"은 미처리/출석, 그리고 이 사유서가 실제로 써넣었던 값(applied)뿐이다.
    현재 값이 우연히 사유서 유형과 같다고 우리 값으로 치면, 운영진이 찍은 결석을
    기수원이 지각으로 수정해 낮출 수 있다.
    """
    target = "EXCUSED" if reason_kind == "RECOGNIZED" and review == "APPROVED" else CATEGORY_STATUS[category]
    ours = {"PENDING", "PRESENT"}
    if applied:
        ours.add(applied)
    if current not in ours or current == target:
        return None
    return target


def build_excuse_text(
    *, category: str, excuse_type: str, reason_kind: str, review: str | None,
    created_at: datetime, reason: str,
) -> str:
    kind = f"인정사유({_REVIEW_LABEL[review]})" if reason_kind == "RECOGNIZED" else "일반사유"
    head = f"[포털] {CATEGORY_LABEL[category]} · {'사전' if excuse_type == 'PRE' else '사후'} · {kind}"
    sub = f"제출 {created_at.astimezone(_KST).strftime('%Y-%m-%d %H:%M')}"
    return f"{head}\n{sub}\n---\n{reason}"


async def _session_for(db: AsyncSession, sub):
    from app.models import Session as SessionModel
    if sub.session_id:
        return await db.get(SessionModel, sub.session_id)
    return (await db.execute(
        select(SessionModel).where(
            SessionModel.cohort_id == sub.cohort_id,
            SessionModel.date == sub.target_date,
        ).order_by(SessionModel.id).limit(1)
    )).scalar_one_or_none()


async def _attendance(db: AsyncSession, session_id: int, member_id: int):
    from app.models import Attendance
    return (await db.execute(
        select(Attendance).where(
            Attendance.session_id == session_id, Attendance.member_id == member_id,
        )
    )).scalar_one_or_none()


def write_attendance(att, sub) -> None:
    """제출 1건을 출결 1행에 쓴다. 운영진이 바꾼 사전/사후 구분과 출결은 보존한다."""
    ours_before = (att.excuse_text or "").startswith("[포털]")
    if not ours_before or att.excuse_type == sub.excuse_type:
        att.excuse_type = sub.excuse_type
    att.excuse_text = build_excuse_text(
        category=sub.category, excuse_type=sub.excuse_type, reason_kind=sub.reason_kind,
        review=sub.review, created_at=sub.created_at, reason=sub.reason,
    )
    new = desired_status(sub.category, sub.reason_kind, sub.review, att.status, sub.applied_status)
    if new:
        att.status = new
        sub.applied_status = new


async def apply_submission(db: AsyncSession, sub) -> None:
    session = await _session_for(db, sub)
    if session is None:
        return
    sub.session_id = session.id
    if session.status == "FINALIZED":
        return
    att = await _attendance(db, session.id, sub.member_id)
    if att is not None:
        write_attendance(att, sub)


async def apply_all_for_session(db: AsyncSession, session) -> int:
    from app.models import ExcuseSubmission
    subs = (await db.execute(
        select(ExcuseSubmission).where(
            ExcuseSubmission.cohort_id == session.cohort_id,
            ExcuseSubmission.target_date == session.date,
            ExcuseSubmission.session_id.is_(None),
        )
    )).scalars().all()
    for sub in subs:
        sub.session_id = session.id
        sub.applied_status = None  # 새 출결표 — 이전(삭제된) 세션에 써넣은 기록은 무의미
        att = await _attendance(db, session.id, sub.member_id)
        if att is not None:
            write_attendance(att, sub)
    return len(subs)


async def detach_submission(db: AsyncSession, sub) -> None:
    if not sub.session_id:
        return
    session = await _session_for(db, sub)
    if session is None or session.status == "FINALIZED":
        return
    att = await _attendance(db, session.id, sub.member_id)
    if att is not None and (att.excuse_text or "").startswith("[포털]"):
        att.excuse_type = None
        att.excuse_text = None
