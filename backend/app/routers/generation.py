import logging

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_cohort_id, get_db, require_admin
from app.models import Cohort, GenerationAccount, Member
from app.audit import record_audit

logger = logging.getLogger("generation")

router = APIRouter(prefix="/generation", tags=["generation"])


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _cohort_default_password(db: AsyncSession, cohort_id: int) -> str:
    """기수 기본 비밀번호: univpt{기수번호} (예: univpt34)."""
    cohort = await db.get(Cohort, cohort_id)
    return f"univpt{cohort.number}" if cohort else "univpt"


def _seed_username(name: str, cohort_number: int) -> str:
    """기수 계정 username — 전역 unique 보장 위해 기수번호 suffix (예: 홍길동34)."""
    return f"{name}{cohort_number}"


async def _get_account_in_cohort(
    account_id: int, cohort_id: int, db: AsyncSession
) -> GenerationAccount:
    """계정을 조회하되 현재 기수 소속인지 검증 (타 기수 계정이면 404)."""
    account = await db.get(GenerationAccount, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="계정을 찾을 수 없습니다")
    member = await db.get(Member, account.member_id)
    if not member or member.cohort_id != cohort_id:
        raise HTTPException(status_code=404, detail="계정을 찾을 수 없습니다")
    return account


# ── Schemas ──────────────────────────────────────────────────────────────────

class GenAccountResponse(BaseModel):
    id: int
    member_id: int
    username: str
    is_active: bool

    model_config = {"from_attributes": True}


class BulkCreateRequest(BaseModel):
    # None이면 기수 기본 비번(univpt{기수번호}) 사용
    password: str | None = Field(default=None, min_length=4, max_length=128)


class GenAccountUpdate(BaseModel):
    username: str | None = Field(None, max_length=50)
    password: str | None = Field(None, min_length=4, max_length=128)
    is_active: bool | None = None


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/accounts", response_model=list[GenAccountResponse])
async def list_accounts(
    _: dict = Depends(require_admin),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(GenerationAccount)
        .join(Member, Member.id == GenerationAccount.member_id)
        .where(Member.cohort_id == cohort_id)
        .order_by(GenerationAccount.username)
    )
    return result.scalars().all()


@router.post("/accounts/bulk-create")
async def bulk_create_accounts(
    body: BulkCreateRequest = BulkCreateRequest(),
    user: dict = Depends(require_admin),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """현재 기수 활성 멤버 전원에 대해 계정 일괄 생성"""
    cohort = await db.get(Cohort, cohort_id)
    if not cohort:
        raise HTTPException(status_code=404, detail="기수를 찾을 수 없습니다")
    password = body.password or f"univpt{cohort.number}"

    members = (await db.execute(
        select(Member).where(Member.is_active == True, Member.cohort_id == cohort_id)
    )).scalars().all()
    # 현재 기수 멤버 중 이미 계정 있는 member_id
    existing = {
        row[0] for row in (await db.execute(
            select(GenerationAccount.member_id)
            .join(Member, Member.id == GenerationAccount.member_id)
            .where(Member.cohort_id == cohort_id)
        )).all()
    }

    created = 0
    for member in members:
        if member.id in existing:
            continue
        password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
        db.add(GenerationAccount(
            member_id=member.id,
            username=_seed_username(member.name, cohort.number),
            password_hash=password_hash,
            is_active=True,
        ))
        created += 1

    await db.commit()
    record_audit(user, "기수 계정 일괄 생성", f"기수={cohort.number} 생성={created} 건너뜀={len(members) - created}")
    return {"created": created, "skipped": len(members) - created}


@router.delete("/accounts/bulk-delete")
async def bulk_delete_accounts(
    user: dict = Depends(require_admin),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """현재 기수 계정 전체 삭제"""
    accounts = (await db.execute(
        select(GenerationAccount)
        .join(Member, Member.id == GenerationAccount.member_id)
        .where(Member.cohort_id == cohort_id)
    )).scalars().all()
    for account in accounts:
        await db.delete(account)
    await db.commit()
    record_audit(user, "기수 계정 전체 삭제", f"기수id={cohort_id} 삭제={len(accounts)}")
    return {"deleted": len(accounts)}


@router.post("/accounts/bulk-reset-password")
async def bulk_reset_password(
    body: BulkCreateRequest = BulkCreateRequest(),
    user: dict = Depends(require_admin),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """현재 기수 계정 전체 비밀번호 일괄 변경"""
    password = body.password or await _cohort_default_password(db, cohort_id)
    accounts = (await db.execute(
        select(GenerationAccount)
        .join(Member, Member.id == GenerationAccount.member_id)
        .where(Member.cohort_id == cohort_id)
    )).scalars().all()
    for account in accounts:
        account.password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    await db.commit()
    record_audit(user, "기수 계정 비밀번호 일괄 초기화", f"기수id={cohort_id} 대상={len(accounts)}")
    return {"updated": len(accounts)}


@router.patch("/accounts/{account_id}", response_model=GenAccountResponse)
async def update_account(
    account_id: int,
    body: GenAccountUpdate,
    user: dict = Depends(require_admin),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    account = await _get_account_in_cohort(account_id, cohort_id, db)

    if body.username is not None:
        existing = await db.execute(
            select(GenerationAccount).where(GenerationAccount.username == body.username, GenerationAccount.id != account_id)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="이미 사용 중인 아이디입니다")
        account.username = body.username
    if body.password is not None:
        account.password_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    if body.is_active is not None:
        account.is_active = body.is_active

    await db.commit()
    await db.refresh(account)
    changed = [k for k, v in {"아이디": body.username, "비번": body.password, "활성": body.is_active}.items() if v is not None]
    record_audit(user, "기수 계정 수정", f"id={account_id} username={account.username} 변경={','.join(changed)}")
    return account


@router.post("/accounts/{account_id}/reset-password")
async def reset_password(
    account_id: int,
    user: dict = Depends(require_admin),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    account = await _get_account_in_cohort(account_id, cohort_id, db)
    password = await _cohort_default_password(db, cohort_id)
    account.password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    await db.commit()
    record_audit(user, "기수 계정 비밀번호 초기화", f"id={account_id} username={account.username}")
    return {"status": "ok"}


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    account_id: int,
    user: dict = Depends(require_admin),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    account = await _get_account_in_cohort(account_id, cohort_id, db)
    uname = account.username
    await db.delete(account)
    await db.commit()
    record_audit(user, "기수 계정 삭제", f"id={account_id} username={uname}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
