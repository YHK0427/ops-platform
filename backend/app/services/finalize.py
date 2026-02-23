from datetime import datetime, timezone
from itertools import combinations
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Ledger, Member, Session, Team, TeamHistory
from app.services.penalty_engine import PenaltyEngine


class SessionAlreadyFinalizedError(Exception):
    pass


async def finalize_session(
    session_id: int,
    db: AsyncSession,
    overrides: Optional[list[dict[str, Any]]] = None,
):
    """
    세션 마감 처리 (Finalize)
    Spec B-6 순서 엄수: BeforeSnapshot -> ScoreUpdate -> Milestone -> DepositUpdate -> Ledger
    """
    # 1. 세션 조회 (Lock with For Update?)
    # 일단 조회 후 상태 체크
    stmt = select(Session).options(
        selectinload(Session.teams).selectinload(Team.members),
        # selectinload(Session.attendances), # PenaltyEngine에서 따로 조회함
    ).where(Session.id == session_id)
    
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()
    
    if not session:
        raise ValueError("Session not found")
        
    if session.status == "FINALIZED":
        raise SessionAlreadyFinalizedError("Session is already finalized")

    # overrides 맵 변환 (member_id -> skip_types set)
    override_map = {}
    if overrides:
        for o in overrides:
            override_map[o["member_id"]] = set(o.get("skip_types", []))

    engine = PenaltyEngine(session, db)
    penalties = await engine.calculate_all()

    # 트랜잭션 내에서 처리
    # (Caller인 API 레벨에서 commit하거나 여기서 commit)
    # 여기서는 로직만 수행하고 caller가 commit하는 것이 일반적이지만,
    # 명시적으로 begin을 쓸 수도 있음. FastAPI Depends(get_db)는 자동 commit 안함.
    # 따라서 여기서 로직 수행 후 caller가 commit.

    active_members = {p.member.id: p.member for p in penalties} # 페널티 대상자만?
    # 아니면 전체 멤버? -> PenaltyEngine은 전체 멤버를 대상으로 함.
    
    # 처리 시각
    now = datetime.now(timezone.utc)

    for p in penalties:
        # Override 체크
        member_id = p.member.id
        if member_id in override_map and p.type in override_map[member_id]:
            continue

        # [Spec B-6 준수]
        
        # ① Before Snapshot
        before_minus = p.member.total_minus_score
        
        # ② 점수 업데이트 (Score Update)
        if p.score_delta < 0:
            p.member.total_minus_score += p.score_delta
        elif p.score_delta > 0:
            p.member.total_plus_score += p.score_delta
        p.member.net_score = p.member.total_plus_score + p.member.total_minus_score
            
        # ③ 마일스톤 체크 (Milestone Check) - Update 후 비교
        milestone = engine.check_milestone_after_update(before_minus, p.member.total_minus_score)
        if milestone:
            # 마일스톤 벌금 적용 (Deposit 차감)
            # p.member.current_deposit += milestone.deposit_delta (보통 음수)
            # 하지만 여기서 바로 반영? Spec: "p.member.current_deposit += milestone.deposit_delta"
            # 그리고 Ledger 기록
            p.member.current_deposit += milestone.deposit_delta
            
            db.add(Ledger(
                member_id=member_id,
                session_id=session_id,
                type="MILESTONE_FINE",
                amount_krw=milestone.deposit_delta, # -5000
                score_delta=0,
                deposit_after=p.member.current_deposit,
                description=milestone.description,
                created_at=now
            ))
            
        # ④ 디파짓 차감 (Deposit Update) - 본 페널티
        before_deposit = p.member.current_deposit # Ledger 기록용? 스냅샷은 차감 후여야 함
        p.member.current_deposit += p.deposit_delta
        
        # ⑤ Ledger 기록 (Ledger) - 차감 후 잔액 스냅샷
        if p.score_delta != 0 or p.deposit_delta != 0:
            db.add(Ledger(
                member_id=member_id,
                session_id=session_id,
                type="FINE", # 또는 PENALTY
                amount_krw=p.deposit_delta,
                score_delta=p.score_delta,
                deposit_after=p.member.current_deposit,
                description=p.description, # "LATE_UNDER10/..."
                created_at=now
            ))

    # Team History 기록 (TEAM 세션인 경우)
    if session.type == "TEAM" and session.teams:
        for team in session.teams:
            # 팀 멤버들 간의 조합 (nC2)
            member_ids = sorted([m.id for m in team.members])
            for a_id, b_id in combinations(member_ids, 2):
                # a_id < b_id (sorted 했으므로 자동 만족)
                # 이미 존재하는지 체크? -> UniqueConstraint 있음.
                # 하지만 session_id가 PK가 아니므로, (session_id, a, b) 조합은 유니크해야 함.
                # DB Level에서 에러 날 수 있으니 체크하거나 ignore insert?
                # Finalize는 한 번만 수행되므로 중복될 리 없음 (SessionAlreadyFinalized 체크함)
                
                history = TeamHistory(
                    session_id=session_id,
                    member_a_id=a_id,
                    member_b_id=b_id
                )
                db.add(history)

    # 세션 상태 업데이트
    session.status = "FINALIZED"
    session.finalized_at = now
    
    # Caller가 commit 수행
