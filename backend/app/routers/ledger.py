from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.database import AsyncSessionLocal
from app.deps import get_db, get_current_user
from app.models import Ledger, Member, Session
from app.schemas.ledger import LedgerResponse, LedgerType, MeritRequest, TransactionRequest, LedgerUpdate

router = APIRouter(prefix="/ledger", tags=["ledger"])

@router.get("", response_model=list[LedgerResponse])
async def get_ledger_entries(
    member_id: Optional[int] = None,
    type: Optional[LedgerType] = None,
    session_id: Optional[int] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """
    원장(Ledger) 조회
    """
    stmt = (
        select(Ledger, Session.title, Session.date)
        .outerjoin(Session, Ledger.session_id == Session.id)
        .order_by(desc(Ledger.created_at))
    )

    if member_id:
        stmt = stmt.where(Ledger.member_id == member_id)
    if type:
        stmt = stmt.where(Ledger.type == type)
    if session_id:
        stmt = stmt.where(Ledger.session_id == session_id)

    stmt = stmt.offset((page - 1) * limit).limit(limit)
    result = await db.execute(stmt)
    rows = result.all()

    entries = []
    for ledger, s_title, s_date in rows:
        resp = LedgerResponse.model_validate(ledger)
        resp.session_title = s_title
        resp.session_date = str(s_date) if s_date else None
        entries.append(resp)
    return entries

@router.post("/merit", response_model=list[LedgerResponse])
async def give_merit(
    req: MeritRequest,
    db: AsyncSession = Depends(get_db),
    created_by: str = Depends(get_current_user),
):
    """
    상점(Merit) 부여 (다수 멤버 가능)
    - total_plus_score 증가
    - deposit 변동 없음
    """
    created_entries = []
    
    members_to_update = []
    
    for mid in req.member_ids:
        member = await db.get(Member, mid)
        if not member:
            raise HTTPException(status_code=404, detail=f"Member ID {mid} not found")
        members_to_update.append(member)
        
    for member in members_to_update:
        # 1. Update Score
        member.total_plus_score += req.score_delta
        member.net_score = member.total_plus_score + member.total_minus_score

        # 2. Create Ledger
        entry = Ledger(
            member_id=member.id,
            type=LedgerType.MERIT,
            amount_krw=0,
            score_delta=req.score_delta,
            description=req.reason,
            deposit_after=member.current_deposit,
            created_by=created_by,
            session_id=req.session_id,
        )
        db.add(entry)
        created_entries.append(entry)
        
    await db.commit()
    
    # Refresh to get IDs
    for entry in created_entries:
        await db.refresh(entry)
        
    return created_entries

@router.post("/transaction", response_model=LedgerResponse)
async def create_transaction(
    req: TransactionRequest,
    db: AsyncSession = Depends(get_db),
    created_by: str = Depends(get_current_user),
):
    """
    수동 입출금/벌금 처리
    - deposit 변동
    - score_delta=0 (필요 시 별도 처리지만 여기선 0 가정)
    """
    if req.type == LedgerType.MERIT:
        raise HTTPException(status_code=400, detail="Use /merit endpoint for merits")
        
    member = await db.get(Member, req.member_id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
        
    if member.current_deposit + req.amount_krw < 0 and req.type not in (LedgerType.FINE, LedgerType.MILESTONE_FINE):
        raise HTTPException(status_code=400, detail="잔여 디파짓이 부족합니다")

    # 1. Update Deposit
    member.current_deposit += req.amount_krw

    # 2. Update Score (if provided)
    if req.score_delta > 0:
        member.total_plus_score += req.score_delta
    elif req.score_delta < 0:
        member.total_minus_score += req.score_delta
    if req.score_delta != 0:
        member.net_score = member.total_plus_score + member.total_minus_score

    # 3. Create Ledger
    entry = Ledger(
        member_id=req.member_id,
        type=req.type,
        amount_krw=req.amount_krw,
        score_delta=req.score_delta,
        description=req.description,
        deposit_after=member.current_deposit,
        created_by=created_by
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)

    return entry

@router.patch("/{ledger_id}", response_model=LedgerResponse)
async def update_ledger_entry(
    ledger_id: int,
    req: LedgerUpdate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """
    원장 항목 수정 (type, amount_krw, score_delta, description 모두 수정 가능)
    - amount_krw 변경 시: 멤버의 current_deposit에 delta 적용
    - score_delta 변경 시: 멤버의 total_plus_score/total_minus_score에 delta 적용
    """
    entry = await db.get(Ledger, ledger_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Ledger entry not found")

    member = await db.get(Member, entry.member_id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    # amount_krw 변경
    if req.amount_krw is not None and req.amount_krw != entry.amount_krw:
        delta = req.amount_krw - entry.amount_krw
        member.current_deposit += delta
        entry.deposit_after = member.current_deposit
        entry.amount_krw = req.amount_krw

    # score_delta 변경
    if req.score_delta is not None and req.score_delta != entry.score_delta:
        old_score = entry.score_delta
        new_score = req.score_delta

        # 기존 점수 효과 제거
        if old_score > 0:
            member.total_plus_score = max(0, member.total_plus_score - old_score)
        elif old_score < 0:
            member.total_minus_score = min(0, member.total_minus_score - old_score)

        # 새 점수 효과 추가
        if new_score > 0:
            member.total_plus_score += new_score
        elif new_score < 0:
            member.total_minus_score += new_score

        member.net_score = member.total_plus_score + member.total_minus_score
        entry.score_delta = new_score

    # type 변경
    if req.type is not None:
        entry.type = req.type

    # description 변경
    if req.description is not None:
        entry.description = req.description

    await db.commit()
    await db.refresh(entry)
    return entry


@router.delete("/{ledger_id}", status_code=204)
async def delete_ledger_entry(
    ledger_id: int,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """
    원장 항목 삭제 — amount_krw·score_delta 효과 역전 후 행 삭제
    """
    entry = await db.get(Ledger, ledger_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Ledger entry not found")

    member = await db.get(Member, entry.member_id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    # 잔액 효과 역전
    if entry.amount_krw != 0:
        member.current_deposit -= entry.amount_krw

    # 점수 효과 역전
    if entry.score_delta > 0:
        member.total_plus_score = max(0, member.total_plus_score - entry.score_delta)
    elif entry.score_delta < 0:
        member.total_minus_score = min(0, member.total_minus_score - entry.score_delta)

    if entry.score_delta != 0:
        member.net_score = member.total_plus_score + member.total_minus_score

    await db.delete(entry)
    await db.commit()
