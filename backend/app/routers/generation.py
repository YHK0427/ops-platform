import logging

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, require_admin
from app.models import GenerationAccount, Member

logger = logging.getLogger("generation")

router = APIRouter(prefix="/generation", tags=["generation"])

DEFAULT_PASSWORD = "univpt33"


# ── Schemas ──────────────────────────────────────────────────────────────────

class GenAccountResponse(BaseModel):
    id: int
    member_id: int
    username: str
    is_active: bool

    model_config = {"from_attributes": True}


class BulkCreateRequest(BaseModel):
    password: str = Field(default=DEFAULT_PASSWORD, min_length=4, max_length=128)


class GenAccountUpdate(BaseModel):
    username: str | None = Field(None, max_length=50)
    password: str | None = Field(None, min_length=4, max_length=128)
    is_active: bool | None = None


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/accounts", response_model=list[GenAccountResponse])
async def list_accounts(
    _: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(GenerationAccount).order_by(GenerationAccount.username))
    return result.scalars().all()


@router.post("/accounts/bulk-create")
async def bulk_create_accounts(
    body: BulkCreateRequest = BulkCreateRequest(),
    _: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """활성 멤버 전원에 대해 계정 일괄 생성"""
    members = (await db.execute(select(Member).where(Member.is_active == True))).scalars().all()
    existing = {row[0] for row in (await db.execute(select(GenerationAccount.member_id))).all()}

    created = 0
    for member in members:
        if member.id in existing:
            continue
        password_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
        db.add(GenerationAccount(
            member_id=member.id,
            username=member.name,
            password_hash=password_hash,
            is_active=True,
        ))
        created += 1

    await db.commit()
    logger.audit(f"gen_bulk_create created={created}")
    return {"created": created, "skipped": len(members) - created}


@router.delete("/accounts/bulk-delete")
async def bulk_delete_accounts(
    _: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """기수 계정 전체 삭제"""
    from sqlalchemy import delete
    result = await db.execute(delete(GenerationAccount))
    await db.commit()
    deleted = result.rowcount
    logger.audit(f"gen_bulk_delete deleted={deleted}")
    return {"deleted": deleted}


@router.post("/accounts/bulk-reset-password")
async def bulk_reset_password(
    body: BulkCreateRequest = BulkCreateRequest(),
    _: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """기수 계정 전체 비밀번호 일괄 변경"""
    accounts = (await db.execute(select(GenerationAccount))).scalars().all()
    for account in accounts:
        account.password_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    await db.commit()
    logger.audit(f"gen_bulk_reset_password count={len(accounts)}")
    return {"updated": len(accounts)}


@router.patch("/accounts/{account_id}", response_model=GenAccountResponse)
async def update_account(
    account_id: int,
    body: GenAccountUpdate,
    _: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    account = await db.get(GenerationAccount, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="계정을 찾을 수 없습니다")

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
    return account


@router.post("/accounts/{account_id}/reset-password")
async def reset_password(
    account_id: int,
    _: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    account = await db.get(GenerationAccount, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="계정을 찾을 수 없습니다")
    account.password_hash = bcrypt.hashpw(DEFAULT_PASSWORD.encode(), bcrypt.gensalt()).decode()
    await db.commit()
    return {"status": "ok"}


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    account_id: int,
    _: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    account = await db.get(GenerationAccount, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="계정을 찾을 수 없습니다")
    await db.delete(account)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
