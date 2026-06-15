from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_cohort_id, get_current_member, get_current_user, get_db, require_staff
from app.models import Attendance, Cohort, Ledger, Member, Session as SessionModel, User
from app.schemas.member import MemberCreate, MemberResponse, MemberUpdate

import logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/members", tags=["members"])


# ── 헬퍼 ──────────────────────────────────────────────────────────────────────

async def _get_member_or_404(member_id: int, db: AsyncSession, cohort_id: int | None = None) -> Member:
    result = await db.get(Member, member_id)
    if not result or (cohort_id is not None and result.cohort_id != cohort_id):
        raise HTTPException(status_code=404, detail="멤버를 찾을 수 없습니다")
    return result


# ── 엔드포인트 ────────────────────────────────────────────────────────────────

@router.get("/me")
async def get_me(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """현재 로그인 사용자 정보 (+ 소속 기수 / 슈퍼관리자 여부)"""
    result = await db.execute(
        select(User).where(User.username == current_user["username"])
    )
    user = result.scalar_one_or_none()
    if not user:
        return {
            "username": current_user["username"], "role": current_user["role"],
            "display_name": current_user["username"], "department": None,
            "cohort_id": None, "cohort_number": None, "cohort_name": None, "is_superadmin": False,
        }
    cohort = await db.get(Cohort, user.cohort_id) if user.cohort_id else None
    return {
        "username": user.username,
        "role": user.role,
        "display_name": user.display_name,
        "department": user.department,
        "cohort_id": user.cohort_id,
        "cohort_number": cohort.number if cohort else None,
        "cohort_name": cohort.name if cohort else None,
        # 슈퍼관리자 = cohort_id 없는 admin (전 기수 총괄)
        "is_superadmin": user.cohort_id is None and user.role == "admin",
    }


# ── 기수(멤버) 본인 전용 ─────────────────────────────────────────────────────
# 주의: literal 경로는 반드시 "/{member_id}" 보다 먼저 등록 (라우트 매칭 순서)

@router.get("/my-summary")
async def my_summary(
    member: dict = Depends(get_current_member),
    db: AsyncSession = Depends(get_db),
):
    """로그인한 기수 본인의 점수·디파짓 요약."""
    m = await db.get(Member, member["member_id"])
    if not m:
        raise HTTPException(status_code=404, detail="멤버를 찾을 수 없습니다")
    return {
        "name": m.name,
        "current_deposit": m.current_deposit,
        "total_plus_score": m.total_plus_score,
        "total_minus_score": m.total_minus_score,
        "net_score": m.net_score,
    }


@router.get("/my-ledger")
async def my_ledger(
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=300),
    member: dict = Depends(get_current_member),
    db: AsyncSession = Depends(get_db),
):
    """로그인한 기수 본인의 장부(거래/상벌점) 내역. 타 멤버 데이터 접근 불가."""
    offset = (page - 1) * limit
    result = await db.execute(
        select(Ledger, SessionModel.title)
        .outerjoin(SessionModel, Ledger.session_id == SessionModel.id)
        .where(Ledger.member_id == member["member_id"])
        .order_by(Ledger.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    return [
        {
            "id": l.id,
            "member_id": l.member_id,
            "session_id": l.session_id,
            "session_title": title,
            "type": l.type,
            "amount_krw": l.amount_krw,
            "score_delta": l.score_delta,
            "description": l.description,
            "created_at": l.created_at,
            "deposit_after": l.deposit_after,
            "is_paid": l.is_paid,
        }
        for l, title in result.all()
    ]


@router.get("", response_model=list[MemberResponse])
async def list_members(
    include_inactive: bool = Query(False),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """현재 기수 활성 멤버 목록 (기본). ?include_inactive=true 시 전체."""
    stmt = select(Member).where(Member.cohort_id == cohort_id)
    if not include_inactive:
        stmt = stmt.where(Member.is_active == True)
    stmt = stmt.order_by(Member.id).offset((page - 1) * limit).limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("", response_model=MemberResponse, status_code=status.HTTP_201_CREATED)
async def create_member(
    body: MemberCreate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """멤버 생성 (현재 기수에 귀속)"""
    member = Member(
        cohort_id=cohort_id,
        name=body.name,
        name_initial=body.name_initial,
        email=body.email,
        tags=body.tags,
    )
    db.add(member)
    await db.commit()
    await db.refresh(member)
    logger.audit(f"👤 멤버 추가 — {member.name}")
    return member


@router.get("/{member_id}", response_model=MemberResponse)
async def get_member(
    member_id: int,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """멤버 상세 조회"""
    return await _get_member_or_404(member_id, db, cohort_id)


@router.patch("/{member_id}", response_model=MemberResponse)
async def update_member(
    member_id: int,
    body: MemberUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """멤버 정보 수정"""
    member = await _get_member_or_404(member_id, db, cohort_id)
    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(member, field, value)
    # 재활성화 시 deactivated_at 초기화
    if update_data.get("is_active") is True:
        member.deactivated_at = None
    await db.commit()
    await db.refresh(member)
    logger.audit(f"✏️ 멤버 수정 — {member.name} ({', '.join(update_data.keys())})")
    return member


@router.delete("/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_member(
    member_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """Soft delete + 잔여 디포짓 금고 몰수 (DEPOSIT_FORFEIT)"""
    member = await _get_member_or_404(member_id, db, cohort_id)
    if not member.is_active:
        raise HTTPException(status_code=400, detail="이미 비활성화된 멤버입니다")

    forfeit_amount = member.current_deposit

    # Soft delete
    member.is_active = False
    member.deactivated_at = datetime.now(timezone.utc)

    # 잔여 디포짓 → 금고 몰수
    if forfeit_amount > 0:
        ledger = Ledger(
            member_id=member.id,
            type="DEPOSIT_FORFEIT",
            amount_krw=-forfeit_amount,
            score_delta=0,
            description=f"이탈 — 잔여 디포짓 금고 귀속 ({member.name})",
            created_by="system",
            deposit_after=0,
        )
        db.add(ledger)

    member.current_deposit = 0
    await db.commit()
    logger.audit(f"🚪 멤버 이탈 — {member.name} (디파짓 몰수 {forfeit_amount:,}원)")


@router.post("/{member_id}/graduate", status_code=status.HTTP_200_OK)
async def graduate_member(
    member_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """수료 처리 — 디포짓 환급 후 비활성화"""
    member = await _get_member_or_404(member_id, db, cohort_id)
    if not member.is_active:
        raise HTTPException(status_code=400, detail="이미 비활성화된 멤버입니다")

    refund_amount = member.current_deposit

    # 비활성화
    member.is_active = False
    member.deactivated_at = datetime.now(timezone.utc)

    # 디포짓 환급
    if refund_amount > 0:
        ledger = Ledger(
            member_id=member.id,
            type="DEPOSIT_REFUND",
            amount_krw=-refund_amount,
            score_delta=0,
            description=f"수료 — 디포짓 환급 ({member.name})",
            created_by="system",
            deposit_after=0,
        )
        db.add(ledger)

    member.current_deposit = 0
    await db.commit()
    logger.audit(f"🎓 멤버 수료 — {member.name} (환급 {refund_amount:,}원)")
    return {"id": member.id, "name": member.name, "refund_amount": refund_amount}


@router.get("/{member_id}/ledger")
async def get_member_ledger(
    member_id: int,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """멤버 원장 조회 (페이지네이션)"""
    await _get_member_or_404(member_id, db, cohort_id)
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
