"""업데이트 패치노트.

운영진 사이트와 기수 포털이 보는 내용이 달라 audience 로 나눈다.
'새로 접속한 시점' 기준으로 띄우는데, 접속 기록 테이블은 따로 없으므로
계정 행의 patch_seen_at(모달을 닫은 시각)을 기준선으로 쓴다.
쓰기는 개발자(adminyhk) 전용.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import (
    DEVELOPER_USERNAME, get_current_member, get_db, require_staff,
    resolve_current_user_row,
)
from app.models import GenerationAccount, PatchNote, User

router = APIRouter(prefix="/patch-notes", tags=["patch-notes"])


class PatchNoteIn(BaseModel):
    audience: str = Field(pattern="^(staff|member|all)$")
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=20000)


class PatchNoteOut(BaseModel):
    id: int
    audience: str
    title: str
    body: str
    published_at: object
    created_by: str | None = None

    model_config = {"from_attributes": True}


async def _require_developer(db: AsyncSession, user: dict) -> User:
    row = await resolve_current_user_row(db, user)
    if not (row and row.cohort_id is None and row.username == DEVELOPER_USERNAME):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="개발자 전용 기능입니다")
    return row


async def _unseen(db: AsyncSession, seen_at, audience: str) -> list[PatchNote]:
    """audience 에 해당하고 seen_at 이후에 올라온 노트. 최신이 위."""
    q = select(PatchNote).where(PatchNote.audience.in_((audience, "all")))
    if seen_at is not None:
        q = q.where(PatchNote.published_at > seen_at)
    rows = (await db.execute(q.order_by(PatchNote.published_at.desc()))).scalars().all()
    return list(rows)


# ── 운영진 ────────────────────────────────────────────────────────────────
@router.get("/unseen", response_model=list[PatchNoteOut])
async def staff_unseen(
    user: dict = Depends(require_staff),
    db: AsyncSession = Depends(get_db),
):
    row = await resolve_current_user_row(db, user)
    if row is None:
        return []
    if row.patch_seen_at is None:
        # 처음 보는 계정에 과거 노트를 전부 쏟아붓지 않는다 — 지금을 기준선으로 잡는다
        row.patch_seen_at = datetime.now(timezone.utc)
        await db.commit()
        return []
    return await _unseen(db, row.patch_seen_at, "staff")


@router.post("/seen", status_code=status.HTTP_204_NO_CONTENT)
async def staff_seen(
    user: dict = Depends(require_staff),
    db: AsyncSession = Depends(get_db),
):
    row = await resolve_current_user_row(db, user)
    if row is not None:
        row.patch_seen_at = datetime.now(timezone.utc)
        await db.commit()


# ── 기수원 ────────────────────────────────────────────────────────────────
async def _member_account(db: AsyncSession, member: dict) -> GenerationAccount | None:
    return (await db.execute(
        select(GenerationAccount).where(GenerationAccount.member_id == member["member_id"])
    )).scalar_one_or_none()


@router.get("/member/unseen", response_model=list[PatchNoteOut])
async def member_unseen(
    member: dict = Depends(get_current_member),
    db: AsyncSession = Depends(get_db),
):
    acc = await _member_account(db, member)
    if acc is None:
        return []
    if acc.patch_seen_at is None:
        acc.patch_seen_at = datetime.now(timezone.utc)
        await db.commit()
        return []
    return await _unseen(db, acc.patch_seen_at, "member")


@router.post("/member/seen", status_code=status.HTTP_204_NO_CONTENT)
async def member_seen(
    member: dict = Depends(get_current_member),
    db: AsyncSession = Depends(get_db),
):
    acc = await _member_account(db, member)
    if acc is not None:
        acc.patch_seen_at = datetime.now(timezone.utc)
        await db.commit()


# ── 개발자 전용 작성/관리 ──────────────────────────────────────────────────
@router.get("", response_model=list[PatchNoteOut])
async def list_all(
    user: dict = Depends(require_staff),
    db: AsyncSession = Depends(get_db),
):
    await _require_developer(db, user)
    rows = (await db.execute(
        select(PatchNote).order_by(PatchNote.published_at.desc()).limit(100)
    )).scalars().all()
    return list(rows)


@router.post("", response_model=PatchNoteOut, status_code=status.HTTP_201_CREATED)
async def create(
    body: PatchNoteIn,
    user: dict = Depends(require_staff),
    db: AsyncSession = Depends(get_db),
):
    dev = await _require_developer(db, user)
    note = PatchNote(
        audience=body.audience,
        title=body.title.strip(),
        body=body.body.strip(),
        created_by=dev.username,
    )
    db.add(note)
    await db.commit()
    await db.refresh(note)
    return note


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete(
    note_id: int,
    user: dict = Depends(require_staff),
    db: AsyncSession = Depends(get_db),
):
    await _require_developer(db, user)
    note = await db.get(PatchNote, note_id)
    if note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="없는 패치노트입니다")
    await db.delete(note)
    await db.commit()
