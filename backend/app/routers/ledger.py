from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, desc, func, case
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.database import AsyncSessionLocal
from app.deps import get_db, get_current_user, require_staff
from app.models import Attendance, Ledger, Member, Session, TreasuryExpense
from app.schemas.ledger import LedgerResponse, LedgerType, MeritRequest, TransactionRequest, LedgerUpdate, MilestonePaidUpdate, TreasuryExpenseCreate, PenaltyRequest

import logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ledger", tags=["ledger"])

@router.get("", response_model=list[LedgerResponse])
async def get_ledger_entries(
    member_id: Optional[int] = None,
    type: Optional[LedgerType] = None,
    session_id: Optional[int] = None,
    search: Optional[str] = None,
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
        .outerjoin(Member, Ledger.member_id == Member.id)
        .order_by(desc(Ledger.created_at))
    )

    if member_id:
        stmt = stmt.where(Ledger.member_id == member_id)
    if type:
        stmt = stmt.where(Ledger.type == type)
    if session_id:
        stmt = stmt.where(Ledger.session_id == session_id)
    if search:
        pattern = f"%{search}%"
        stmt = stmt.where(
            Ledger.description.ilike(pattern) | Member.name.ilike(pattern)
        )

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
    current_user: dict = Depends(require_staff),
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
            created_by=current_user["username"],
            session_id=req.session_id,
        )
        db.add(entry)
        created_entries.append(entry)
        
    await db.commit()

    # Refresh to get IDs
    for entry in created_entries:
        await db.refresh(entry)

    for entry in created_entries:
        logger.audit(f"merit member_id={entry.member_id} score=+{req.score_delta} reason={req.reason} by={current_user['username']}")

    return created_entries

@router.post("/penalty", response_model=LedgerResponse)
async def give_penalty(
    req: PenaltyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_staff),
):
    """
    수동 벌점 부여 (무임승차 등)
    - total_minus_score 감소
    - 마일스톤 체크 (-10, -20, -30 돌파 시 MILESTONE_FINE 자동 생성)
    - deposit 변동은 deposit_delta로 별도 지정
    """
    member = await db.get(Member, req.member_id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    # 1. Score update
    before_minus = member.total_minus_score
    member.total_minus_score += req.score_delta  # score_delta is negative
    member.net_score = member.total_plus_score + member.total_minus_score

    # 2. Deposit update (if any)
    if req.deposit_delta != 0:
        member.current_deposit += req.deposit_delta

    # 3. Create penalty ledger entry
    entry = Ledger(
        member_id=req.member_id,
        type="FINE",
        amount_krw=req.deposit_delta,
        score_delta=req.score_delta,
        description=req.description,
        deposit_after=member.current_deposit,
        created_by=current_user["username"],
    )
    db.add(entry)

    # 4. Milestone check
    from app.services.penalty_engine import check_milestone_fines
    milestones = check_milestone_fines(before_minus, member.total_minus_score)
    for ms in milestones:
        db.add(Ledger(
            member_id=req.member_id,
            type="MILESTONE_FINE",
            amount_krw=ms["deposit_delta"],
            score_delta=0,
            deposit_after=member.current_deposit,
            description=ms["description"],
            created_by="system",
            is_paid=False,
        ))

    await db.commit()
    await db.refresh(entry)
    logger.audit(f"penalty member_id={req.member_id} score={req.score_delta} deposit={req.deposit_delta} desc={req.description} by={current_user['username']}")
    return entry

@router.post("/transaction", response_model=LedgerResponse)
async def create_transaction(
    req: TransactionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_staff),
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
        
    no_deposit_types = (LedgerType.FINE, LedgerType.MILESTONE_FINE, LedgerType.DEPOSIT_FORFEIT)
    if member.current_deposit + req.amount_krw < 0 and req.type not in no_deposit_types:
        raise HTTPException(status_code=400, detail="잔여 디파짓이 부족합니다")

    # 1. Update Deposit (MILESTONE_FINE/DEPOSIT_FORFEIT은 디포짓 차감 안 함)
    if req.type not in (LedgerType.MILESTONE_FINE, LedgerType.DEPOSIT_FORFEIT):
        member.current_deposit += req.amount_krw

    # 2. Update Score (if provided)
    before_minus = member.total_minus_score
    if req.score_delta > 0:
        member.total_plus_score += req.score_delta
    elif req.score_delta < 0:
        member.total_minus_score += req.score_delta
    if req.score_delta != 0:
        member.net_score = member.total_plus_score + member.total_minus_score

    # Milestone check for negative score changes
    if req.score_delta < 0:
        from app.services.penalty_engine import check_milestone_fines
        milestones = check_milestone_fines(before_minus, member.total_minus_score)
        for ms in milestones:
            db.add(Ledger(
                member_id=req.member_id,
                type="MILESTONE_FINE",
                amount_krw=ms["deposit_delta"],
                score_delta=0,
                deposit_after=member.current_deposit,
                description=ms["description"],
                created_by="system",
                is_paid=False,
            ))

    # 3. Create Ledger
    entry = Ledger(
        member_id=req.member_id,
        type=req.type,
        amount_krw=req.amount_krw,
        score_delta=req.score_delta,
        description=req.description,
        deposit_after=member.current_deposit,
        created_by=current_user["username"],
        is_paid=False if req.type == LedgerType.MILESTONE_FINE else None,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    logger.audit(f"transaction member_id={req.member_id} type={req.type} amount={req.amount_krw} by={current_user['username']}")

    return entry

@router.patch("/{ledger_id}", response_model=LedgerResponse)
async def update_ledger_entry(
    ledger_id: int,
    req: LedgerUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
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

    # amount_krw 변경 (MILESTONE_FINE/DEPOSIT_FORFEIT은 디포짓 반영 안 함)
    if req.amount_krw is not None and req.amount_krw != entry.amount_krw:
        if entry.type not in ("MILESTONE_FINE", "DEPOSIT_FORFEIT"):
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
    logger.audit(f"ledger_updated id={ledger_id} by=staff")
    return entry


@router.delete("/{ledger_id}", status_code=204)
async def delete_ledger_entry(
    ledger_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
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

    # 잔액 효과 역전 (MILESTONE_FINE/DEPOSIT_FORFEIT은 디포짓 차감 안 했으므로 역전도 스킵)
    skip_deposit_types = ("MILESTONE_FINE", "DEPOSIT_FORFEIT")
    if entry.amount_krw != 0 and entry.type not in skip_deposit_types:
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
    logger.audit(f"ledger_deleted id={ledger_id} type={entry.type} member_id={entry.member_id}")


@router.get("/treasury")
async def get_treasury(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """금고 현황 — 벌금 수입 요약 + 세션별/멤버별 집계 + 미납 마일스톤 + 몰수 디포짓"""

    fine_types = ("FINE", "MILESTONE_FINE")
    treasury_types = ("FINE", "MILESTONE_FINE", "DEPOSIT_FORFEIT")

    # 1. 전체 요약
    summary_stmt = select(
        func.coalesce(func.sum(
            case((Ledger.type == "FINE", func.abs(Ledger.amount_krw)), else_=0)
        ), 0).label("total_fine"),
        func.coalesce(func.sum(
            case((Ledger.type == "MILESTONE_FINE", func.abs(Ledger.amount_krw)), else_=0)
        ), 0).label("total_milestone"),
        func.coalesce(func.sum(
            case(
                (
                    (Ledger.type == "MILESTONE_FINE") & (Ledger.is_paid == True),
                    func.abs(Ledger.amount_krw),
                ),
                else_=0,
            )
        ), 0).label("milestone_paid"),
        func.coalesce(func.sum(
            case(
                (
                    (Ledger.type == "MILESTONE_FINE") & ((Ledger.is_paid == False) | (Ledger.is_paid == None)),
                    func.abs(Ledger.amount_krw),
                ),
                else_=0,
            )
        ), 0).label("milestone_unpaid"),
        func.coalesce(func.sum(
            case((Ledger.type == "DEPOSIT_FORFEIT", func.abs(Ledger.amount_krw)), else_=0)
        ), 0).label("total_forfeit"),
    ).where(Ledger.type.in_(treasury_types))

    summary_row = (await db.execute(summary_stmt)).one()

    # 2. 세션별 집계
    session_stmt = (
        select(
            Ledger.session_id,
            Session.title,
            Session.date,
            func.coalesce(func.sum(
                case((Ledger.type == "FINE", func.abs(Ledger.amount_krw)), else_=0)
            ), 0).label("fine_total"),
            func.coalesce(func.sum(
                case((Ledger.type == "MILESTONE_FINE", func.abs(Ledger.amount_krw)), else_=0)
            ), 0).label("milestone_total"),
            func.coalesce(func.sum(
                case(
                    (
                        (Ledger.type == "MILESTONE_FINE") & ((Ledger.is_paid == False) | (Ledger.is_paid == None)),
                        func.abs(Ledger.amount_krw),
                    ),
                    else_=0,
                )
            ), 0).label("milestone_unpaid"),
        )
        .join(Session, Ledger.session_id == Session.id, isouter=True)
        .where(Ledger.type.in_(fine_types), Ledger.session_id != None)
        .group_by(Ledger.session_id, Session.title, Session.date)
        .order_by(desc(Session.date))
    )
    session_rows = (await db.execute(session_stmt)).all()

    # 3. 멤버별 집계
    member_stmt = (
        select(
            Ledger.member_id,
            Member.name,
            func.coalesce(func.sum(
                case((Ledger.type == "FINE", func.abs(Ledger.amount_krw)), else_=0)
            ), 0).label("fine_total"),
            func.coalesce(func.sum(
                case((Ledger.type == "MILESTONE_FINE", func.abs(Ledger.amount_krw)), else_=0)
            ), 0).label("milestone_total"),
            func.coalesce(func.sum(
                case(
                    (
                        (Ledger.type == "MILESTONE_FINE") & (Ledger.is_paid == True),
                        func.abs(Ledger.amount_krw),
                    ),
                    else_=0,
                )
            ), 0).label("milestone_paid"),
            func.coalesce(func.sum(
                case(
                    (
                        (Ledger.type == "MILESTONE_FINE") & ((Ledger.is_paid == False) | (Ledger.is_paid == None)),
                        func.abs(Ledger.amount_krw),
                    ),
                    else_=0,
                )
            ), 0).label("milestone_unpaid"),
        )
        .join(Member, Ledger.member_id == Member.id)
        .where(Ledger.type.in_(fine_types))
        .group_by(Ledger.member_id, Member.name)
        .order_by(Member.name)
    )
    member_rows = (await db.execute(member_stmt)).all()

    # 4. 미납 마일스톤 목록
    unpaid_stmt = (
        select(Ledger, Member.name.label("member_name"), Session.title.label("session_title"))
        .join(Member, Ledger.member_id == Member.id)
        .join(Session, Ledger.session_id == Session.id, isouter=True)
        .where(
            Ledger.type == "MILESTONE_FINE",
            (Ledger.is_paid == False) | (Ledger.is_paid == None),
        )
        .order_by(desc(Ledger.created_at))
    )
    unpaid_rows = (await db.execute(unpaid_stmt)).all()

    # 5. 활성 멤버 디포짓 현황
    deposit_stmt = select(
        func.coalesce(func.sum(Member.current_deposit), 0).label("total_deposits"),
        func.count(Member.id).label("active_count"),
    ).where(Member.is_active == True)
    deposit_row = (await db.execute(deposit_stmt)).one()

    # 6. 금고 지출 내역
    expense_stmt = (
        select(TreasuryExpense)
        .order_by(desc(TreasuryExpense.created_at))
    )
    expense_rows = (await db.execute(expense_stmt)).scalars().all()
    total_expenses = sum(e.amount_krw for e in expense_rows)

    # 7. 전체 금고 내역 (FINE + MILESTONE_FINE + DEPOSIT_FORFEIT)
    all_stmt = (
        select(Ledger, Member.name.label("member_name"), Session.title.label("session_title"))
        .join(Member, Ledger.member_id == Member.id)
        .join(Session, Ledger.session_id == Session.id, isouter=True)
        .where(Ledger.type.in_(treasury_types))
        .order_by(desc(Ledger.created_at))
    )
    all_rows = (await db.execute(all_stmt)).all()

    return {
        "summary": {
            "total_fine_collected": summary_row.total_fine,
            "total_milestone_fine": summary_row.total_milestone,
            "milestone_paid": summary_row.milestone_paid,
            "milestone_unpaid": summary_row.milestone_unpaid,
            "total_forfeit": summary_row.total_forfeit,
            "total_expenses": total_expenses,
        },
        "by_session": [
            {
                "session_id": r.session_id,
                "title": r.title,
                "date": str(r.date) if r.date else None,
                "fine_total": r.fine_total,
                "milestone_total": r.milestone_total,
                "milestone_unpaid": r.milestone_unpaid,
            }
            for r in session_rows
        ],
        "by_member": [
            {
                "member_id": r.member_id,
                "name": r.name,
                "fine_total": r.fine_total,
                "milestone_total": r.milestone_total,
                "milestone_paid": r.milestone_paid,
                "milestone_unpaid": r.milestone_unpaid,
            }
            for r in member_rows
        ],
        "unpaid_milestones": [
            {
                "id": r.Ledger.id,
                "member_id": r.Ledger.member_id,
                "member_name": r.member_name,
                "session_title": r.session_title,
                "amount_krw": r.Ledger.amount_krw,
                "description": r.Ledger.description,
                "created_at": r.Ledger.created_at.isoformat() if r.Ledger.created_at else None,
                "is_paid": r.Ledger.is_paid or False,
            }
            for r in unpaid_rows
        ],
        "deposit_summary": {
            "total_deposits": deposit_row.total_deposits,
            "active_members": deposit_row.active_count,
        },
        "expenses": [
            {
                "id": e.id,
                "amount_krw": e.amount_krw,
                "description": e.description,
                "created_by": e.created_by,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in expense_rows
        ],
        "all_entries": [
            {
                "id": r.Ledger.id,
                "member_id": r.Ledger.member_id,
                "member_name": r.member_name,
                "session_title": r.session_title,
                "type": r.Ledger.type,
                "amount_krw": r.Ledger.amount_krw,
                "description": r.Ledger.description,
                "created_at": r.Ledger.created_at.isoformat() if r.Ledger.created_at else None,
                "is_paid": r.Ledger.is_paid,
            }
            for r in all_rows
        ],
    }


@router.get("/report")
async def get_report_data(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """현황 리포트용 — 세션×멤버 매트릭스 + 세션 외 항목"""
    from collections import defaultdict

    # 1. 세션 목록 (날짜순)
    sessions_result = await db.execute(
        select(Session).order_by(Session.date.asc())
    )
    sessions = sessions_result.scalars().all()

    # 2. 활성 멤버
    members_result = await db.execute(
        select(Member).where(Member.is_active == True).order_by(Member.name)
    )
    members = members_result.scalars().all()
    member_ids = [m.id for m in members]

    # 3. 전체 장부 (활성 멤버만)
    ledger_result = await db.execute(
        select(Ledger)
        .where(Ledger.member_id.in_(member_ids))
        .order_by(Ledger.created_at.asc())
    )
    all_entries = ledger_result.scalars().all()

    # 3.5. 출석 데이터
    attendance_result = await db.execute(
        select(Attendance)
        .where(Attendance.member_id.in_(member_ids))
    )
    all_attendances = attendance_result.scalars().all()
    # attendance_map[member_id][session_id] = status
    attendance_map: dict[int, dict[int, str]] = defaultdict(dict)
    for att in all_attendances:
        attendance_map[att.member_id][att.session_id] = att.status

    # 4. 멤버별 + 세션별 그룹핑
    # matrix[member_id][session_id] = [entries]
    matrix: dict[int, dict[int, list]] = defaultdict(lambda: defaultdict(list))
    no_session: dict[int, list] = defaultdict(list)  # 세션 없는 항목 (수동)

    for entry in all_entries:
        item = {
            "id": entry.id,
            "type": entry.type,
            "score_delta": entry.score_delta,
            "amount_krw": entry.amount_krw,
            "description": entry.description,
            "created_at": entry.created_at.isoformat() if entry.created_at else None,
        }
        if entry.session_id:
            matrix[entry.member_id][entry.session_id].append(item)
        else:
            no_session[entry.member_id].append(item)

    return {
        "sessions": [
            {
                "id": s.id,
                "week_num": s.week_num,
                "title": s.title,
                "date": str(s.date) if s.date else None,
            }
            for s in sessions
        ],
        "members": [
            {
                "id": m.id,
                "name": m.name,
                "total_plus_score": m.total_plus_score,
                "total_minus_score": m.total_minus_score,
                "net_score": m.net_score,
                "current_deposit": m.current_deposit,
                "by_session": {
                    str(sid): entries
                    for sid, entries in matrix.get(m.id, {}).items()
                },
                "no_session": no_session.get(m.id, []),
                "attendance": {
                    str(sid): status
                    for sid, status in attendance_map.get(m.id, {}).items()
                },
            }
            for m in members
        ],
    }


@router.patch("/{ledger_id}/paid")
async def toggle_milestone_paid(
    ledger_id: int,
    req: MilestonePaidUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
):
    """마일스톤 벌금 납부 상태 토글"""
    entry = await db.get(Ledger, ledger_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Ledger entry not found")
    if entry.type != "MILESTONE_FINE":
        raise HTTPException(status_code=400, detail="납부 상태는 누적벌점 벌금만 변경 가능합니다")

    entry.is_paid = req.is_paid
    await db.commit()
    return {"id": entry.id, "is_paid": entry.is_paid}


@router.post("/treasury/expense", status_code=201)
async def create_treasury_expense(
    req: TreasuryExpenseCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(require_staff),
):
    """금고 지출 기록"""
    expense = TreasuryExpense(
        amount_krw=req.amount_krw,
        description=req.description,
        created_by=current_user["username"],
    )
    db.add(expense)
    await db.commit()
    await db.refresh(expense)
    logger.audit(f"treasury_expense amount={req.amount_krw} desc={req.description} by={current_user['username']}")
    return {
        "id": expense.id,
        "amount_krw": expense.amount_krw,
        "description": expense.description,
        "created_at": expense.created_at.isoformat() if expense.created_at else None,
    }


@router.delete("/treasury/expense/{expense_id}", status_code=204)
async def delete_treasury_expense(
    expense_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
):
    """금고 지출 삭제"""
    expense = await db.get(TreasuryExpense, expense_id)
    if not expense:
        raise HTTPException(status_code=404, detail="지출 내역을 찾을 수 없습니다")
    await db.delete(expense)
    await db.commit()
    logger.audit(f"treasury_expense_deleted id={expense_id}")
