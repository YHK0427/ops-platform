"""기수(Cohort) 공간 관리 — 슈퍼관리자(전 기수 총괄) 전용.

기수 생성/목록/활성전환/아카이브 + 각 기수의 운영진(User) 시딩.
일반 운영진/기수원은 이 라우터에 접근하지 못한다(require_superadmin).
"""
import logging
from datetime import datetime, timezone

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import record_audit
from app.deps import get_db, require_superadmin
from app.models import Cohort, User

logger = logging.getLogger("cohorts")

router = APIRouter(prefix="/cohorts", tags=["cohorts"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class CohortResponse(BaseModel):
    id: int
    number: int
    name: str
    is_current: bool
    is_active: bool
    created_at: datetime
    archived_at: datetime | None = None

    model_config = {"from_attributes": True}


class CohortCreate(BaseModel):
    number: int = Field(ge=1, le=999)
    name: str | None = Field(default=None, max_length=50)  # 없으면 "{number}기"


class CohortUpdate(BaseModel):
    name: str | None = Field(None, max_length=50)
    is_active: bool | None = None
    is_current: bool | None = None  # 활성 기수 토글 (여러 기수 동시 활성 허용)
    archived: bool | None = None  # True면 archived_at 설정 + 비활성


class StaffSeed(BaseModel):
    username: str = Field(max_length=50)
    password: str = Field(min_length=6, max_length=128)
    display_name: str = Field(max_length=50)
    # 기수 운영진은 manager/viewer만. admin은 전 기수 총괄 슈퍼관리자 1개뿐(기수별 admin 없음).
    role: str = Field(default="manager", pattern=r"^(manager|viewer)$")
    department: str | None = None


class SeedStaffRequest(BaseModel):
    staff: list[StaffSeed] = Field(min_length=1)


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("", response_model=list[CohortResponse])
async def list_cohorts(
    _: dict = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Cohort).order_by(Cohort.number.desc()))
    return result.scalars().all()


@router.post("", response_model=CohortResponse, status_code=status.HTTP_201_CREATED)
async def create_cohort(
    body: CohortCreate,
    user: dict = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    """새 기수 공간 생성 (빈 공간). is_current는 별도 전환 전까지 false."""
    existing = await db.execute(select(Cohort).where(Cohort.number == body.number))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"{body.number}기가 이미 존재합니다")

    cohort = Cohort(
        number=body.number,
        name=body.name or f"{body.number}기",
        is_current=False,
        is_active=True,
    )
    db.add(cohort)
    await db.commit()
    await db.refresh(cohort)
    record_audit(user, "기수 공간 생성", f"{cohort.number}기 (id={cohort.id})")
    return cohort


@router.patch("/{cohort_id}/set-current", response_model=CohortResponse)
async def set_current_cohort(
    cohort_id: int,
    user: dict = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    """기수를 활성(current)으로 표시. 여러 기수 동시 활성 허용(다른 기수 끄지 않음)."""
    cohort = await db.get(Cohort, cohort_id)
    if not cohort:
        raise HTTPException(status_code=404, detail="기수를 찾을 수 없습니다")
    cohort.is_current = True
    await db.commit()
    await db.refresh(cohort)
    record_audit(user, "기수 활성 표시", f"{cohort.number}기 (id={cohort.id})")
    return cohort


@router.patch("/{cohort_id}", response_model=CohortResponse)
async def update_cohort(
    cohort_id: int,
    body: CohortUpdate,
    user: dict = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    """기수 이름 변경 / 아카이브."""
    cohort = await db.get(Cohort, cohort_id)
    if not cohort:
        raise HTTPException(status_code=404, detail="기수를 찾을 수 없습니다")
    if body.name is not None:
        cohort.name = body.name
    if body.archived is not None:
        if body.archived:
            cohort.archived_at = datetime.now(timezone.utc)
            cohort.is_active = False
            cohort.is_current = False
        else:
            cohort.archived_at = None
            cohort.is_active = True
    if body.is_active is not None:
        cohort.is_active = body.is_active
    if body.is_current is not None:
        cohort.is_current = body.is_current
    await db.commit()
    await db.refresh(cohort)
    record_audit(user, "기수 설정 변경", f"{cohort.number}기 (id={cohort.id})")
    return cohort


@router.post("/{cohort_id}/seed-staff")
async def seed_staff(
    cohort_id: int,
    body: SeedStaffRequest,
    user: dict = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    """해당 기수의 운영진(User) 계정 일괄 생성. username은 전역 unique."""
    cohort = await db.get(Cohort, cohort_id)
    if not cohort:
        raise HTTPException(status_code=404, detail="기수를 찾을 수 없습니다")

    usernames = [s.username for s in body.staff]
    dup = await db.execute(select(User.username).where(User.username.in_(usernames)))
    taken = {row[0] for row in dup.all()}
    if taken:
        raise HTTPException(status_code=409, detail=f"이미 사용 중인 아이디: {', '.join(sorted(taken))}")

    created = 0
    for s in body.staff:
        db.add(User(
            cohort_id=cohort_id,
            username=s.username,
            password_hash=bcrypt.hashpw(s.password.encode(), bcrypt.gensalt()).decode(),
            display_name=s.display_name,
            role=s.role,
            department=s.department,
            is_active=True,
        ))
        created += 1
    await db.commit()
    record_audit(user, "기수 운영진 시딩", f"{cohort.number}기 생성={created}")
    return {"created": created}
