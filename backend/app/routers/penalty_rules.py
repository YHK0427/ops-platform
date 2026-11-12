"""벌점·상점 규칙 — 조회는 운영진 전원, 수정은 admin 또는 총무부·학술부(manager)."""
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_cohort_id, get_current_user, get_db, resolve_current_user_row
from app.models import Cohort
from app.services.penalty_rules import DEFAULT_RULES, PenaltyRules, parse_rules, rules_signature

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/penalty-rules", tags=["penalty-rules"])

EDITOR_DEPARTMENTS = ("총무부", "학술부")


async def _can_edit(db: AsyncSession, user: dict) -> bool:
    if user["role"] == "admin":
        return True
    if user["role"] != "manager":
        return False
    row = await resolve_current_user_row(db, user)
    return bool(row and row.department in EDITOR_DEPARTMENTS)


def _out(cohort: Cohort, can_edit: bool) -> dict:
    rules = parse_rules(cohort.penalty_rules)
    return {
        "rules": rules.model_dump(),
        "defaults": DEFAULT_RULES.model_dump(),
        "signature": rules_signature(rules),
        "is_default": rules == DEFAULT_RULES,
        "can_edit": can_edit,
        "editor_departments": list(EDITOR_DEPARTMENTS),
    }


async def _cohort(db: AsyncSession, cohort_id: int, lock: bool = False) -> Cohort:
    cohort = await db.get(Cohort, cohort_id, with_for_update=lock)
    if not cohort:
        raise HTTPException(status_code=404, detail="기수를 찾을 수 없습니다")
    return cohort


@router.get("")
async def get_penalty_rules(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
):
    return _out(await _cohort(db, cohort_id), await _can_edit(db, user))


class RulesUpdate(BaseModel):
    rules: PenaltyRules
    base_signature: str  # 화면이 불러온 규칙의 서명 — 그사이 다른 사람이 고쳤으면 409


@router.put("")
async def update_penalty_rules(
    body: RulesUpdate,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
):
    if not await _can_edit(db, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="벌점 규칙은 관리자 또는 총무부·학술부 운영진만 바꿀 수 있습니다")
    cohort = await _cohort(db, cohort_id, lock=True)  # 동시 저장 둘 다 서명 검사를 통과하지 않게
    before = parse_rules(cohort.penalty_rules)
    if rules_signature(before) != body.base_signature:
        raise HTTPException(status_code=409, detail="그사이 다른 운영진이 규칙을 바꿨습니다. 새로고침한 뒤 다시 수정해주세요.")
    # 기본값과 같으면 NULL — 나중에 기본값이 바뀌면 따라가게
    cohort.penalty_rules = None if body.rules == DEFAULT_RULES else body.rules.model_dump()
    await db.commit()
    changed = sorted(k for k, v in body.rules.model_dump().items() if before.model_dump()[k] != v)
    logger.audit(f"⚖️ 벌점 규칙 변경 — {cohort.name} ({', '.join(changed) or '변경 없음'}) by {user['username']}")
    return _out(cohort, True)
