"""기수별 벌점·상점 규칙 — 정산(벌점 엔진·누적벌점 벌금·연속 출석 상점)과 화면 표시 기준.

cohorts.penalty_rules(JSONB)에 저장. 비어 있거나 일부 키가 없으면 아래 기본값.
숫자는 모두 양수로 저장하고, 쓰는 쪽에서 차감(-)으로 붙인다.
바꾸면 다음 정산부터 적용된다 — 이미 마감된 장부는 다시 계산하지 않는다.
"""
import hashlib
import logging
import json

from pydantic import BaseModel, Field, model_validator
from sqlalchemy.ext.asyncio import AsyncSession


class Pair(BaseModel):
    score: int = Field(ge=0, le=50)        # 벌점 (양수로 저장)
    deposit: int = Field(ge=0, le=100_000)  # 디파짓 차감액(원)


def _p(score: int, deposit: int) -> Pair:
    return Pair(score=score, deposit=deposit)


class AttendanceRow(BaseModel):
    """사유서 종류별 — PRE: 사전, POST: 사후, NONE: 사유서 없음"""
    PRE: Pair
    POST: Pair
    NONE: Pair


class PenaltyRules(BaseModel):
    LATE_UNDER10: AttendanceRow = AttendanceRow(PRE=_p(1, 2000), POST=_p(1, 3000), NONE=_p(1, 4000))
    LATE_OVER10: AttendanceRow = AttendanceRow(PRE=_p(2, 2000), POST=_p(2, 3000), NONE=_p(2, 4000))
    EARLY_LEAVE: AttendanceRow = AttendanceRow(PRE=_p(2, 2000), POST=_p(2, 3000), NONE=_p(2, 4000))
    ABSENT: AttendanceRow = AttendanceRow(PRE=_p(4, 4000), POST=_p(4, 6000), NONE=_p(4, 8000))
    ppt_email_late: Pair = _p(1, 1000)
    ppt_email_missing: Pair = _p(2, 3000)
    homework_missing: Pair = _p(1, 1000)       # 과제·리뷰·피드백 중 하나라도 미제출
    milestone_every: int = Field(10, ge=1, le=100)       # 누적벌점 N점마다
    milestone_fine: int = Field(5000, ge=0, le=100_000)  # 추가 벌금(원)
    streak_count: int = Field(4, ge=1, le=20)   # 연속 출석 N회마다
    streak_score: int = Field(2, ge=0, le=20)   # 상점
    eviction_limit: int = Field(14, ge=1, le=100)  # 순점수가 -N 아래로 내려가면 퇴출 대상
    warn_from: int = Field(9, ge=1, le=100)        # 순점수 -N 이하부터 퇴출 경고
    low_deposit: int = Field(10_000, ge=0, le=1_000_000)  # 디파짓 이 금액 미만이면 충전 요망

    @model_validator(mode="after")
    def _check(self):
        if self.warn_from > self.eviction_limit:
            raise ValueError("퇴출 경고 시작 점수는 퇴출 기준보다 클 수 없습니다")
        return self

    def attendance(self, status: str, excuse_type: str | None) -> Pair | None:
        row: AttendanceRow | None = getattr(self, status, None) if status in ATTENDANCE_STATUSES else None
        if row is None:
            return None
        return getattr(row, excuse_type if excuse_type in ("PRE", "POST") else "NONE")


ATTENDANCE_STATUSES = ("LATE_UNDER10", "LATE_OVER10", "EARLY_LEAVE", "ABSENT")
DEFAULT_RULES = PenaltyRules()


def parse_rules(raw: dict | None) -> PenaltyRules:
    """저장값 → 규칙. 빠진 키는 기본값. 저장값이 깨져 있으면 기본값(정산이 멈추지 않게)."""
    if not raw:
        return DEFAULT_RULES
    try:
        return PenaltyRules.model_validate(raw)
    except ValueError as e:
        logging.getLogger("app").warning(f"벌점 규칙 저장값이 깨져 기본값으로 계산합니다: {e}")
        return DEFAULT_RULES


def rules_signature(rules: PenaltyRules) -> str:
    """규칙 서명 — 정산 미리보기와 마감, 규칙 화면과 저장이 같은 규칙을 보고 있는지 확인."""
    return hashlib.sha1(json.dumps(rules.model_dump(), sort_keys=True).encode()).hexdigest()[:16]


async def get_rules(db: AsyncSession, cohort_id: int | None) -> PenaltyRules:
    if cohort_id is None:
        return DEFAULT_RULES
    from app.models import Cohort
    cohort = await db.get(Cohort, cohort_id)
    return parse_rules(cohort.penalty_rules if cohort else None)


if __name__ == "__main__":
    r = PenaltyRules()
    assert r.attendance("ABSENT", None) == _p(4, 8000)
    assert r.attendance("LATE_UNDER10", "POST") == _p(1, 3000)
    assert r.attendance("LATE_UNDER10", "weird") == _p(1, 4000)
    assert r.attendance("PRESENT", None) is None and r.attendance("PENDING", None) is None
    assert parse_rules({"eviction_limit": 20}).eviction_limit == 20 and parse_rules({"eviction_limit": 20}).streak_count == 4
    assert parse_rules({"warn_from": 30}) == DEFAULT_RULES  # 경고 > 퇴출 → 깨진 값 → 기본값
    assert rules_signature(r) == rules_signature(PenaltyRules.model_validate(r.model_dump()))
    print("penalty_rules OK")
