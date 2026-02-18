from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db
from app.models import Attendance, Member, Session as SessionModel
from app.schemas.session import SessionCreate, SessionResponse, SessionStatusUpdate

router = APIRouter(prefix="/sessions", tags=["sessions"])

# 상태 머신 전환 허용 맵
_ALLOWED_TRANSITIONS: dict[str, str] = {
    "SETUP": "PREP",
    "PREP": "OPS",
    "OPS": "POST",
    "POST": "SETTLEMENT",
    "SETTLEMENT": "FINALIZED",
}


async def _get_session_or_404(session_id: int, db: AsyncSession) -> SessionModel:
    result = await db.get(SessionModel, session_id)
    if not result:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    return result


@router.get("", response_model=list[SessionResponse])
async def list_sessions(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """세션 목록"""
    result = await db.execute(select(SessionModel).order_by(SessionModel.week_num))
    return result.scalars().all()


@router.post("", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def create_session(
    body: SessionCreate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """세션 생성 + 전체 활성 멤버 attendance 자동 생성"""
    # 중복 week_num 체크
    existing = await db.execute(
        select(SessionModel).where(SessionModel.week_num == body.week_num)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"week_num {body.week_num}은 이미 존재합니다")

    config_data = body.config.model_dump() if body.config else {
        "has_ppt": True, "has_review": True, "has_feedback": True, "is_holiday": False
    }

    session = SessionModel(
        week_num=body.week_num,
        title=body.title,
        date=body.date,
        type=body.type,
        config=config_data,
        status="SETUP",
    )
    db.add(session)
    await db.flush()  # session.id 확보

    # 전체 활성 멤버에 대해 attendance 레코드 자동 생성
    members_result = await db.execute(
        select(Member).where(Member.is_active == True)
    )
    members = members_result.scalars().all()
    for member in members:
        attendance = Attendance(
            session_id=session.id,
            member_id=member.id,
            status="PENDING",
        )
        db.add(attendance)

    await db.commit()
    await db.refresh(session)
    return session


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """세션 상세 조회"""
    return await _get_session_or_404(session_id, db)


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """세션 삭제 — SETUP 상태에서만 허용"""
    session = await _get_session_or_404(session_id, db)
    if session.status != "SETUP":
        raise HTTPException(
            status_code=400,
            detail=f"SETUP 상태에서만 삭제 가능합니다 (현재: {session.status})",
        )
    await db.delete(session)
    await db.commit()


@router.patch("/{session_id}/status", response_model=SessionResponse)
async def update_session_status(
    session_id: int,
    body: SessionStatusUpdate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """상태 머신 전환 — SETUP→PREP→OPS→POST→SETTLEMENT→FINALIZED 순서만 허용"""
    session = await _get_session_or_404(session_id, db)
    current = session.status
    target = body.status

    # FINALIZED에서 역행 불가
    if current == "FINALIZED":
        raise HTTPException(status_code=400, detail="FINALIZED 상태에서는 상태 변경이 불가합니다")

    # 허용된 전환인지 확인
    allowed_next = _ALLOWED_TRANSITIONS.get(current)
    if allowed_next != target:
        raise HTTPException(
            status_code=400,
            detail=f"허용되지 않은 상태 전환입니다: {current} → {target} (허용: {current} → {allowed_next})",
        )

    session.status = target
    if target == "FINALIZED":
        session.finalized_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(session)
    return session


# ── attendance 기본 조회 (Phase 03 범위) ──────────────────────────────────────

@router.get("/{session_id}/attendance")
async def get_session_attendance(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """세션 출결 목록"""
    await _get_session_or_404(session_id, db)
    result = await db.execute(
        select(Attendance)
        .where(Attendance.session_id == session_id)
        .order_by(Attendance.member_id)
    )
    attendances = result.scalars().all()
    return [
        {
            "id": a.id,
            "session_id": a.session_id,
            "member_id": a.member_id,
            "status": a.status,
            "excuse_type": a.excuse_type,
            "excuse_text": a.excuse_text,
            "updated_at": a.updated_at,
        }
        for a in attendances
    ]
