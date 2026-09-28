"""기수 포털 사유서 — 판정 규칙과 출결 반영.

마감(KST 21:59:59 = UTC 12:59:59): 사전 = 세션 전날, 사후 = 세션 다음날.
사후 마감이 지나면 제출 불가(classify 가 None).
"""
from datetime import date, datetime, time, timedelta, timezone

CATEGORY_STATUS = {"ABSENT": "ABSENT", "LATE": "LATE_UNDER10", "EARLY_LEAVE": "EARLY_LEAVE"}
CATEGORY_LABEL = {"ABSENT": "결석", "LATE": "지각", "EARLY_LEAVE": "조퇴"}
_REVIEW_LABEL = {"PENDING": "승인 대기", "APPROVED": "승인", "REJECTED": "반려"}
_KST = timezone(timedelta(hours=9))


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
    prev_category: str | None = None,
) -> str | None:
    """반영 후 출결 상태. None 이면 현재 값을 그대로 둔다(운영진이 직접 찍은 값 보호)."""
    target = "EXCUSED" if reason_kind == "RECOGNIZED" and review == "APPROVED" else CATEGORY_STATUS[category]
    ours = {"PENDING", "PRESENT", CATEGORY_STATUS[category]}
    if prev_category:
        ours.add(CATEGORY_STATUS[prev_category])
    if reason_kind == "RECOGNIZED":
        ours.add("EXCUSED")
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
