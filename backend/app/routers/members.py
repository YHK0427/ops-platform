from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db
from app.models import Attendance, Ledger, Member, Session as SessionModel
from app.schemas.member import MemberCreate, MemberResponse, MemberUpdate

router = APIRouter(prefix="/members", tags=["members"])


# ── 헬퍼 ──────────────────────────────────────────────────────────────────────

async def _get_member_or_404(member_id: int, db: AsyncSession) -> Member:
    result = await db.get(Member, member_id)
    if not result:
        raise HTTPException(status_code=404, detail="멤버를 찾을 수 없습니다")
    return result


# ── 엔드포인트 ────────────────────────────────────────────────────────────────

@router.get("/me")
async def get_me(current_user: str = Depends(get_current_user)):
    """현재 로그인 사용자 정보 (단일 어드민 시스템)"""
    return {"username": current_user, "role": "admin"}


@router.get("", response_model=list[MemberResponse])
async def list_members(
    include_inactive: bool = Query(False),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """활성 멤버 목록 (기본). ?include_inactive=true 시 전체."""
    stmt = select(Member)
    if not include_inactive:
        stmt = stmt.where(Member.is_active == True)
    stmt = stmt.order_by(Member.id).offset((page - 1) * limit).limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("", response_model=MemberResponse, status_code=status.HTTP_201_CREATED)
async def create_member(
    body: MemberCreate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """멤버 생성"""
    member = Member(
        name=body.name,
        name_initial=body.name_initial,
        email=body.email,
        tags=body.tags,
    )
    db.add(member)
    await db.commit()
    await db.refresh(member)
    return member


@router.get("/streak-candidates", response_model=list[MemberResponse])
async def streak_candidates(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """4회 연속 출석 조건 충족 대상자"""
    from app.services.streak_checker import check_attendance_streaks
    
    candidates = await check_attendance_streaks(db)
    # candidates는 dict list이므로 MemberResponse로 변환 필요하지만
    # MemberResponse는 ORM/Dict 모두 호환 가능 (from_attributes=True)
    # 하지만 check_attendance_streaks가 dict를 리턴하므로,
    # Pydantic이 dict를 받아서 처리.
    return candidates


@router.get("/{member_id}", response_model=MemberResponse)
async def get_member(
    member_id: int,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """멤버 상세 조회"""
    return await _get_member_or_404(member_id, db)


@router.patch("/{member_id}", response_model=MemberResponse)
async def update_member(
    member_id: int,
    body: MemberUpdate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """멤버 정보 수정"""
    member = await _get_member_or_404(member_id, db)
    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(member, field, value)
    # 재활성화 시 deactivated_at 초기화
    if update_data.get("is_active") is True:
        member.deactivated_at = None
    await db.commit()
    await db.refresh(member)
    return member


@router.delete("/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_member(
    member_id: int,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """Soft delete + DEPOSIT_REFUND ledger 자동 생성"""
    member = await _get_member_or_404(member_id, db)
    if not member.is_active:
        raise HTTPException(status_code=400, detail="이미 비활성화된 멤버입니다")

    refund_amount = member.current_deposit

    # Soft delete
    member.is_active = False
    member.deactivated_at = datetime.now(timezone.utc)

    # DEPOSIT_REFUND ledger 자동 생성
    if refund_amount > 0:
        ledger = Ledger(
            member_id=member.id,
            type="DEPOSIT_REFUND",
            amount_krw=refund_amount,
            score_delta=0,
            description=f"멤버 비활성화 잔여 디파짓 환불 ({member.name})",
            created_by="system",
            deposit_after=0,
        )
        db.add(ledger)

    member.current_deposit = 0
    await db.commit()


@router.get("/{member_id}/ledger")
async def get_member_ledger(
    member_id: int,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """멤버 원장 조회 (페이지네이션)"""
    await _get_member_or_404(member_id, db)
    offset = (page - 1) * limit
    result = await db.execute(
        select(Ledger)
        .where(Ledger.member_id == member_id)
        .order_by(Ledger.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    entries = result.scalars().all()
    return entries
