from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.database import AsyncSessionLocal
from app.deps import get_db, get_current_user
from app.models import Ledger, Member
from app.schemas.ledger import LedgerResponse, LedgerType, MeritRequest, TransactionRequest

router = APIRouter(prefix="/ledger", tags=["ledger"])

@router.get("", response_model=list[LedgerResponse])
async def get_ledger_entries(
    member_id: Optional[int] = None,
    type: Optional[LedgerType] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """
    원장(Ledger) 조회
    """
    stmt = select(Ledger).order_by(desc(Ledger.created_at))
    
    if member_id:
        stmt = stmt.where(Ledger.member_id == member_id)
    if type:
        stmt = stmt.where(Ledger.type == type)
        
    stmt = stmt.offset((page - 1) * limit).limit(limit)
    result = await db.execute(stmt)
    entries = result.scalars().all()
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
    # 2. Create Ledger
    entry = Ledger(
        member_id=req.member_id,
        type=req.type,
        amount_krw=req.amount_krw,
        score_delta=0,
        description=req.description,
        deposit_after=member.current_deposit,
        created_by=created_by
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    
    return entry
