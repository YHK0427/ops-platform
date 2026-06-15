import asyncio
import json
import logging
import os
import random
import shutil
import uuid
from datetime import datetime, time, timedelta, timezone

from fastapi import APIRouter, Body, Depends, File, HTTPException, Request, UploadFile, status

logger = logging.getLogger(__name__)
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.deps import get_current_cohort_id, get_current_user, get_db, require_staff
from app.models import (
    Assignment,
    Attendance,
    Ledger,
    Member,
    Session as SessionModel,
    Team,
    TeamMember,
    User,
)
from app.schemas.attendance import AttendanceForceUpdate, AttendanceUpdate
from app.schemas.session import (
    FeedbackRandomAssignRequest,
    FeedbackTargetUpdate,
    MeritItemResponse,
    SessionConfigUpdate,
    SessionCreate,
    SessionFinalizeRequest,
    SessionFinalizeResponse,
    SessionResponse,
    SessionBasicResponse,
    SessionStatsResponse,
    SessionStatusUpdate,
    SettlementPreviewResponse,
    StagedMeritCreate,
)
from app.schemas.team import TeamCreateRequest, TeamGenerateRequest, TeamResponse
from app.schemas.attendance import AttendanceResponse, GroupAssignment, GroupGenerateRequest
from app.services.team_builder import TeamBuilder
from app.services.group_builder import build_groups

router = APIRouter(prefix="/sessions", tags=["sessions"])

# 상태 머신 전환 허용 맵 (FINALIZED는 /finalize 엔드포인트 전용)
_ALLOWED_TRANSITIONS: dict[str, str] = {
    "SETUP": "PREP",
    "PREP": "OPS",
    "OPS": "POST",
    "POST": "SETTLEMENT",
}


async def _get_session_or_404(
    session_id: int, db: AsyncSession, cohort_id: int | None = None
) -> SessionModel:
    result = await db.get(SessionModel, session_id)
    if not result:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    # 기수 격리: cohort_id 가 주어지면 다른 기수의 세션은 없는 것으로 취급
    if cohort_id is not None and result.cohort_id != cohort_id:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    return result


@router.get("", response_model=list[SessionBasicResponse])
async def list_sessions(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """세션 목록 (현재 기수만)"""
    result = await db.execute(
        select(SessionModel)
        .where(SessionModel.cohort_id == cohort_id)
        .order_by(SessionModel.week_num)
    )
    return result.scalars().all()


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_session(
    body: SessionCreate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """세션 생성 + 현재 기수 활성 멤버 attendance 자동 생성"""
    try:
        # week_num 중복 체크는 현재 기수 내로 한정
        existing = await db.execute(
            select(SessionModel).where(
                SessionModel.week_num == body.week_num,
                SessionModel.cohort_id == cohort_id,
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400, detail=f"week_num {body.week_num}은 이미 존재합니다")

        config_data = body.config.model_dump() if body.config else {
            "has_ppt_email": True, "has_ppt": True, "has_review": True, "has_feedback": True, "is_holiday": False
        }

        session = SessionModel(
            week_num=body.week_num,
            title=body.title,
            date=body.date,
            type=body.type,
            config=config_data,
            status="PREP",
            cohort_id=cohort_id,
        )
        db.add(session)
        await db.flush()

        # 🔴 전역 멤버 스캔 — 현재 기수의 활성 멤버만 (타 기수 멤버 누출 방지)
        members_result = await db.execute(
            select(Member).where(
                Member.is_active == True,
                Member.cohort_id == cohort_id,
            )
        )
        members = members_result.scalars().all()
        cfg = config_data or {}
        for member in members:
            attendance = Attendance(
                session_id=session.id,
                member_id=member.id,
                status="PENDING",
            )
            db.add(attendance)

            # INDIVIDUAL 세션: 생성 시 바로 과제 생성 (PREP 상태이므로)
            if body.type == "INDIVIDUAL":
                if cfg.get("has_ppt_email", True):
                    db.add(Assignment(
                        session_id=session.id,
                        member_id=member.id,
                        type="PPT_EMAIL",
                        status="PENDING",
                    ))
                if cfg.get("has_ppt", True):
                    db.add(Assignment(
                        session_id=session.id,
                        member_id=member.id,
                        type="PPT",
                        status="PENDING",
                    ))
                if cfg.get("has_review", True):
                    db.add(Assignment(
                        session_id=session.id,
                        member_id=member.id,
                        type="REVIEW",
                        status="PENDING",
                    ))
                if cfg.get("has_feedback", True):
                    db.add(Assignment(
                        session_id=session.id,
                        member_id=member.id,
                        type="FEEDBACK",
                        status="PENDING",
                    ))

        await db.commit()

        # Google Drive 폴더 생성: 메인 + videos/ + ppt/ (실패해도 세션 생성은 유지)
        try:
            import asyncio
            from app.services.crawler_video import create_drive_folder
            folder_name = f"{body.week_num}주차_{body.title}"
            folder_id = await asyncio.to_thread(create_drive_folder, folder_name)
            video_folder_id = await asyncio.to_thread(create_drive_folder, "videos", folder_id)
            ppt_folder_id = await asyncio.to_thread(create_drive_folder, "ppt", folder_id)
            session.config = {
                **(session.config or {}),
                "drive_folder_id": folder_id,
                "drive_video_folder_id": video_folder_id,
                "drive_ppt_folder_id": ppt_folder_id,
            }
            from sqlalchemy.orm.attributes import flag_modified
            flag_modified(session, "config")
            await db.commit()
            logger.info(f"Drive folders created: {folder_name} (main={folder_id}, videos={video_folder_id}, ppt={ppt_folder_id})")
        except Exception as e:
            logger.warning(f"Drive folder creation failed (non-fatal): {e}")

        # 서버 영상 저장 폴더 생성
        video_dir = f"/app/files/video/session_{session.id}"
        os.makedirs(video_dir, exist_ok=True)

        logger.audit(f"📅 세션 생성 — {session.week_num}주차 {session.title} ({session.type})")
        return {"id": session.id, "week_num": session.week_num, "status": "created"}

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        logger.error(f"Failed to create session: {e}", exc_info=True)
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """세션 상세 조회 (Teams/Attendance Eager Loading)"""
    stmt = (
        select(SessionModel)
        .where(SessionModel.id == session_id, SessionModel.cohort_id == cohort_id)
        .options(
            selectinload(SessionModel.teams).selectinload(Team.members).selectinload(TeamMember.member),
            selectinload(SessionModel.teams).selectinload(Team.assignments),
            selectinload(SessionModel.attendances),
            selectinload(SessionModel.assignments)
        )
    )
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()
    
    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    return session


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """세션 삭제 — 연결된 장부 항목도 효과 역전 후 함께 삭제"""
    session = await _get_session_or_404(session_id, db, cohort_id)

    # 장부 항목 효과 역전 후 삭제
    ledger_result = await db.execute(
        select(Ledger).where(Ledger.session_id == session_id)
    )
    for entry in ledger_result.scalars().all():
        member = await db.get(Member, entry.member_id)
        if member:
            if entry.amount_krw != 0:
                member.current_deposit -= entry.amount_krw
            if entry.score_delta > 0:
                member.total_plus_score = max(0, member.total_plus_score - entry.score_delta)
            elif entry.score_delta < 0:
                member.total_minus_score = min(0, member.total_minus_score - entry.score_delta)
            if entry.score_delta != 0:
                member.net_score = member.total_plus_score + member.total_minus_score
        await db.delete(entry)

    # TeamHistory 삭제
    from app.models import TeamHistory
    th_result = await db.execute(
        select(TeamHistory).where(TeamHistory.session_id == session_id)
    )
    for th in th_result.scalars().all():
        await db.delete(th)

    await db.delete(session)
    await db.commit()
    logger.audit(f"🗑️ 세션 삭제 — {session.week_num}주차 {session.title}")


@router.patch("/{session_id}/config")
async def update_session_config(
    session_id: int,
    body: SessionConfigUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """세션 config 업데이트 (기한 등)"""
    session = await _get_session_or_404(session_id, db, cohort_id)
    if session.status == "FINALIZED":
        raise HTTPException(status_code=400, detail="Cannot modify finalized session")

    # Merge new config with existing
    current_config = session.config or {}
    current_config.update(body.config)
    session.config = current_config
    # Force SQLAlchemy to detect JSONB change
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(session, "config")

    await db.commit()
    await db.refresh(session)
    return {
        "id": session.id,
        "week_num": session.week_num,
        "title": session.title,
        "date": session.date,
        "type": session.type,
        "config": session.config,
        "status": session.status,
        "finalized_at": session.finalized_at,
        "created_at": session.created_at,
    }


@router.patch("/{session_id}/status", response_model=SessionResponse)
async def update_session_status(
    session_id: int,
    body: SessionStatusUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """상태 머신 전환"""
    session = await _get_session_or_404(session_id, db, cohort_id)
    current = session.status
    target = body.status

    if current == "FINALIZED":
        raise HTTPException(status_code=400, detail="FINALIZED 상태에서는 상태 변경이 불가합니다")

    if target == "FINALIZED":
        raise HTTPException(
            status_code=400,
            detail="FINALIZED 전환은 POST /sessions/{id}/finalize 엔드포인트를 사용하세요",
        )

    allowed_next = _ALLOWED_TRANSITIONS.get(current)
    if allowed_next != target:
        raise HTTPException(
            status_code=400,
            detail=f"허용되지 않은 상태 전환입니다: {current} → {target} (허용: {current} → {allowed_next})",
        )

    session.status = target

    # INDIVIDUAL 세션: SETUP→PREP 전환 시 멤버별 Assignment 자동 생성
    if current == "SETUP" and target == "PREP" and session.type == "INDIVIDUAL":
        cfg = session.config or {}
        # 🔴 전역 멤버 스캔 — 현재 기수의 활성 멤버만 (타 기수 멤버 누출 방지)
        members_result = await db.execute(
            select(Member).where(
                Member.is_active == True,
                Member.cohort_id == cohort_id,
            )
        )
        active_members = members_result.scalars().all()
        for member in active_members:
            if cfg.get("has_ppt_email", True):
                db.add(Assignment(
                    session_id=session_id,
                    member_id=member.id,
                    type="PPT_EMAIL",
                    status="PENDING",
                ))
            # PPT 게시판 과제
            if cfg.get("has_ppt", True):
                db.add(Assignment(
                    session_id=session_id,
                    member_id=member.id,
                    type="PPT",
                    status="PENDING",
                ))
            if cfg.get("has_review", True):
                db.add(Assignment(
                    session_id=session_id,
                    member_id=member.id,
                    type="REVIEW",
                    status="PENDING",
                ))
            if cfg.get("has_feedback", True):
                db.add(Assignment(
                    session_id=session_id,
                    member_id=member.id,
                    type="FEEDBACK",
                    status="PENDING",
                ))

    # POST→SETTLEMENT 전환 시: 크롤러 스캔 후에도 PENDING 상태로 남은 과제 = 미제출 → MISSING 처리
    if target == "SETTLEMENT":
        # 결석/공결 멤버 조회
        absent_stmt = select(Attendance.member_id).where(
            Attendance.session_id == session_id,
            Attendance.status.in_(("ABSENT", "EXCUSED")),
        )
        absent_result = await db.execute(absent_stmt)
        absent_ids = {row[0] for row in absent_result.all()}

        # 공결 멤버만 별도 조회 (PPT_EMAIL EXEMPT용)
        excused_stmt = select(Attendance.member_id).where(
            Attendance.session_id == session_id,
            Attendance.status == "EXCUSED",
        )
        excused_result = await db.execute(excused_stmt)
        excused_ids = {row[0] for row in excused_result.all()}

        if absent_ids:
            # REVIEW: ABSENT + EXCUSED → EXEMPT
            await db.execute(
                update(Assignment)
                .where(
                    Assignment.session_id == session_id,
                    Assignment.status == "PENDING",
                    Assignment.type == "REVIEW",
                    Assignment.member_id.in_(absent_ids),
                )
                .values(status="EXEMPT")
            )
            # FEEDBACK: ABSENT + EXCUSED → EXEMPT (결석자는 피드백 작성 불가)
            await db.execute(
                update(Assignment)
                .where(
                    Assignment.session_id == session_id,
                    Assignment.status == "PENDING",
                    Assignment.type == "FEEDBACK",
                    Assignment.member_id.in_(absent_ids),
                )
                .values(status="EXEMPT")
            )

        if excused_ids:
            # PPT_EMAIL (INDIVIDUAL): EXCUSED만 → EXEMPT (ABSENT은 제출 의무)
            await db.execute(
                update(Assignment)
                .where(
                    Assignment.session_id == session_id,
                    Assignment.status == "PENDING",
                    Assignment.type == "PPT_EMAIL",
                    Assignment.member_id.in_(excused_ids),
                )
                .values(status="EXEMPT")
            )
            # PPT_EMAIL (TEAM): 팀원 전원이 공결인 경우만 EXEMPT
            team_ppt_result = await db.execute(
                select(Assignment).where(
                    Assignment.session_id == session_id,
                    Assignment.type == "PPT_EMAIL",
                    Assignment.team_id.isnot(None),
                    Assignment.status == "PENDING",
                )
            )
            for team_ppt in team_ppt_result.scalars().all():
                tm_result = await db.execute(
                    select(TeamMember.member_id).where(TeamMember.team_id == team_ppt.team_id)
                )
                team_member_ids = {row[0] for row in tm_result.all()}
                if team_member_ids and team_member_ids.issubset(excused_ids):
                    team_ppt.status = "EXEMPT"

            # PPT (게시판): EXCUSED만 → EXEMPT (ABSENT은 제출 의무)
            await db.execute(
                update(Assignment)
                .where(
                    Assignment.session_id == session_id,
                    Assignment.status == "PENDING",
                    Assignment.type == "PPT",
                    Assignment.member_id.in_(excused_ids),
                )
                .values(status="EXEMPT")
            )

        # 나머지 PENDING → MISSING
        await db.execute(
            update(Assignment)
            .where(Assignment.session_id == session_id, Assignment.status == "PENDING")
            .values(status="MISSING")
        )

    await db.commit()
    STATUS_KR = {
        "SETUP": "세팅", "PREP": "출석", "OPS": "과제 준비",
        "POST": "과제 검사", "SETTLEMENT": "정산", "FINALIZED": "마감",
    }
    logger.audit(f"🔄 세션 상태 변경 — #{session_id}: {STATUS_KR.get(current, current)} → {STATUS_KR.get(target, target)}")

    # Eager-load relationships to avoid MissingGreenlet error during response serialization
    stmt = (
        select(SessionModel)
        .where(SessionModel.id == session_id)
        .options(
            selectinload(SessionModel.teams).selectinload(Team.members).selectinload(TeamMember.member),
            selectinload(SessionModel.teams).selectinload(Team.assignments),
            selectinload(SessionModel.attendances),
            selectinload(SessionModel.assignments),
        )
    )
    result = await db.execute(stmt)
    return result.scalar_one()


@router.get("/{session_id}/stats", response_model=SessionStatsResponse)
async def get_session_stats(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """세션 통계 (출석률, 과제 제출 현황)"""
    await _get_session_or_404(session_id, db, cohort_id)

    # 1. Attendance Stats
    att_result = await db.execute(
        select(Attendance.status, func.count(Attendance.id).label("count"))
        .where(Attendance.session_id == session_id)
        .group_by(Attendance.status)
    )
    att_counts = {row.status: row.count for row in att_result.all()}
    
    att_total = sum(att_counts.values())
    # PENDING은 아직 입력 전 — 처리된 레코드 기준으로 출석률 계산
    pending_count = att_counts.get("PENDING", 0)
    processed_total = att_total - pending_count
    att_present = processed_total - att_counts.get("ABSENT", 0)

    attendance_rate = (att_present / processed_total * 100.0) if processed_total > 0 else 0.0

    # 2. Assignment Stats (PPT vs Homework)
    ass_result = await db.execute(
        select(Assignment.type, Assignment.status, func.count(Assignment.id).label("count"))
        .where(Assignment.session_id == session_id)
        .group_by(Assignment.type, Assignment.status)
    )
    ass_rows = ass_result.all()

    ppt_total = 0
    ppt_submitted = 0
    ppt_email_total = 0
    ppt_email_submitted = 0
    hw_total = 0
    hw_submitted = 0

    for r in ass_rows:
        atype, astatus, count = r.type, r.status, r.count
        is_submitted = astatus in ("PASS", "LATE")

        if atype == "PPT":
            ppt_total += count
            if is_submitted:
                ppt_submitted += count
        elif atype == "PPT_EMAIL":
            ppt_email_total += count
            if is_submitted:
                ppt_email_submitted += count
        elif atype in ("REVIEW", "FEEDBACK", "HOMEWORK"):
            hw_total += count
            if is_submitted:
                hw_submitted += count

    return SessionStatsResponse(
        attendance_rate=round(attendance_rate, 1),
        attendance_present=att_present,
        attendance_total=att_total,
        ppt_submitted=ppt_submitted,
        ppt_total=ppt_total,
        ppt_email_submitted=ppt_email_submitted,
        ppt_email_total=ppt_email_total,
        homework_submitted=hw_submitted,
        homework_total=hw_total,
    )


# ── Attendance ────────────────────────────────────────────────────────────────

@router.get("/{session_id}/attendance")
async def get_session_attendance(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """세션 출결 목록"""
    await _get_session_or_404(session_id, db, cohort_id)
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
            "note": a.note,
            "updated_at": a.updated_at,
        }
        for a in attendances
    ]


@router.patch("/{session_id}/attendance/{member_id}")
async def update_attendance(
    session_id: int,
    member_id: int,
    body: AttendanceUpdate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """출결 정보 수정 (열람자 이상 가능)"""
    session = await _get_session_or_404(session_id, db, cohort_id)

    # 마감 검증 (KST 21:59:59 = UTC 12:59:59)
    # PRE 마감: 세션 전날 21:59:59 KST
    # POST 마감: 세션 다음날 21:59:59 KST
    if body.excuse_type is not None:
        now_utc = datetime.now(timezone.utc)
        pre_deadline = datetime.combine(
            session.date - timedelta(days=1),
            time(12, 59, 59),
            tzinfo=timezone.utc,
        )
        post_deadline = datetime.combine(
            session.date + timedelta(days=1),
            time(12, 59, 59),
            tzinfo=timezone.utc,
        )
        if body.excuse_type == "PRE" and now_utc > pre_deadline:
            raise HTTPException(
                status_code=422,
                detail="사전사유서 마감 시간이 지났습니다 (세션 전날 21:59)",
            )
        if body.excuse_type == "POST" and now_utc > post_deadline:
            raise HTTPException(
                status_code=422,
                detail="사후사유서 마감 시간이 지났습니다 (세션 다음날 21:59)",
            )

    result = await db.execute(
        select(Attendance).where(
            Attendance.session_id == session_id,
            Attendance.member_id == member_id,
        )
    )
    attendance = result.scalar_one_or_none()
    if not attendance:
        # 혹시 없으면 생성 (방어 코드)
        attendance = Attendance(session_id=session_id, member_id=member_id)
        db.add(attendance)

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(attendance, field, value)
    
    await db.commit()
    # 빈번한 이벤트라 info 로그만 남김 (Telegram 스팸 방지). 강제 변경은 아래 엔드포인트에서 audit.
    logger.info(f"attendance_updated session={session_id} member={member_id} fields={list(update_data.keys())}")
    return attendance


@router.patch("/{session_id}/attendance/{member_id}/force")
async def force_update_attendance(
    session_id: int,
    member_id: int,
    body: AttendanceForceUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """출결 강제 수정 (FINALIZED 상태에서도 가능, Ledger 자동 생성)"""
    session = await _get_session_or_404(session_id, db, cohort_id)
    
    result = await db.execute(
        select(Attendance).where(
            Attendance.session_id == session_id,
            Attendance.member_id == member_id,
        )
    )
    attendance = result.scalar_one_or_none()
    if not attendance:
        raise HTTPException(status_code=404, detail="Attendance record not found")

    member = await db.get(Member, member_id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    # 변경 전 상태 기록 (로깅용)
    old_status = attendance.status
    old_excuse = attendance.excuse_type

    # 업데이트
    update_data = body.model_dump(exclude_unset=True, exclude={"reason"})
    for field, value in update_data.items():
        setattr(attendance, field, value)

    # Ledger 생성 (ADJUSTMENT)
    # 점수/금액 변동은 여기서 계산하지 않음 (PenaltyEngine이 담당하거나 관리자가 직접 입력해야 함)
    # 하지만 이 엔드포인트는 "출결 정보"만 바꾸는 것임. 
    # 점수 변동을 반영하려면 settlement를 다시 돌리거나, 
    # 별도로 ledger를 넣어야 하는데, spec에는 "변경 전후 차이를 ledger ADJUSTMENT 타입으로 자동 기록"이라고 되어 있음.
    # 출결 상태 변경만으로는 점수가 얼마나 바뀌는지 여기서 알기 어려움 (PenaltyEngine 의존).
    # 따라서 여기서는 "사유"를 적은 0원짜리 기록을 남기고, 실제 점수 조정은 별도로 하거나,
    # 혹은 이 API가 점수 변동까지 처리해야 한다면 PenaltyEngine을 호출해야 함.
    # Phase 04에서는 "기록"에 초점을 맞춤. 점수 자동 재계산은 복잡하므로 로그성 Ledger만 남김.
    
    description = f"출결 강제 변경: {old_status}->{body.status or old_status} / {old_excuse}->{body.excuse_type or old_excuse} (사유: {body.reason})"
    
    ledger = Ledger(
        session_id=session_id,
        member_id=member_id,
        type="ADJUSTMENT",
        amount_krw=0,   # 관리자가 필요하면 별도 입력
        score_delta=0,  # 관리자가 필요하면 별도 입력
        description=description,
        created_by="admin", # created_by 컬럼이 models.py에 있음 ("system" default)
        deposit_after=member.current_deposit, # 현재 스냅샷
    )
    db.add(ledger)

    await db.commit()
    logger.audit(f"⚡ 출석 강제변경 — {member.name}: {old_status} → {body.status or old_status} [{body.reason}]")
    return attendance


@router.delete("/{session_id}/excuses")
async def clear_excuses(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """세션의 모든 사유서 데이터(excuse_type, excuse_text) 초기화"""
    await _get_session_or_404(session_id, db, cohort_id)

    result = await db.execute(
        select(Attendance).where(
            Attendance.session_id == session_id,
            Attendance.excuse_type.isnot(None),
        )
    )
    attendances = result.scalars().all()
    cleared = 0
    for att in attendances:
        att.excuse_type = None
        att.excuse_text = None
        cleared += 1

    await db.commit()
    return {"cleared": cleared}


# ── Team Building ─────────────────────────────────────────────────────────────

@router.post("/{session_id}/teams/generate", response_model=list[TeamResponse])
async def generate_teams(
    session_id: int,
    body: TeamGenerateRequest,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """팀빌딩 시뮬레이션 (Snake Draft)"""
    session = await _get_session_or_404(session_id, db, cohort_id)
    if session.type == "INDIVIDUAL":
        raise HTTPException(status_code=400, detail="INDIVIDUAL 세션에는 팀빌딩 불가")

    # 🔴 전역 멤버 스캔 — 현재 기수의 활성 멤버만 (타 기수 멤버 누출 방지)
    members_result = await db.execute(
        select(Member).where(
            Member.is_active == True,
            Member.cohort_id == cohort_id,
        )
    )
    members = members_result.scalars().all()

    # 빌더 실행
    builder = TeamBuilder(members)
    teams_list = builder.build_teams(body.num_teams)

    # 응답 포맷 변환 (임시 ID는 0)
    response = []
    for i, team_members in enumerate(teams_list):
        response.append(
            TeamResponse(
                id=0,
                session_id=session_id,
                name=f"{i+1}조",
                created_at=datetime.now(),
                members=team_members,
            )
        )
    return response


@router.patch("/{session_id}/teams", status_code=status.HTTP_204_NO_CONTENT)
async def confirm_teams(
    session_id: int,
    body: TeamCreateRequest,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """팀 확정 (DB 저장) + Assignments 자동 생성 + PREP 전환"""
    session = await _get_session_or_404(session_id, db, cohort_id)
    if session.status not in ("SETUP", "PREP"):
        raise HTTPException(status_code=400, detail="SETUP 또는 PREP 상태에서만 팀 수정 가능")

    is_reconfirm = session.status == "PREP"
    if session.type == "INDIVIDUAL":
        raise HTTPException(status_code=400, detail="INDIVIDUAL 세션에는 팀빌딩 불가")

    # 주의: 출결 레코드는 삭제하지 않음
    from sqlalchemy import delete, select as sa_select
    if is_reconfirm:
        # PREP 재편집: PPT 과제(팀 단위)만 삭제, 개인 과제는 유지
        await db.execute(
            delete(Assignment).where(
                Assignment.session_id == session_id,
                Assignment.team_id.isnot(None),
            )
        )
    else:
        # SETUP 최초 확정: 모든 과제 삭제
        await db.execute(delete(Assignment).where(Assignment.session_id == session_id))

    # 기존 팀 삭제 (cascade로 team_members도 삭제됨)
    await db.execute(delete(Team).where(Team.session_id == session_id))
    
    # 3. 새 팀 생성
    for team_data in body.teams:
        team = Team(
            session_id=session_id,
            name=team_data.name,
        )
        db.add(team)
        await db.flush()  # team.id 확보

        for tm in team_data.members:
            db.add(TeamMember(
                team_id=team.id,
                member_id=tm.member_id,
            ))
            
        # 팀별 PPT_EMAIL 과제 1개 생성
        if session.config.get("has_ppt_email", True):
            ppt_email = Assignment(
                session_id=session_id,
                team_id=team.id,
                member_id=None, # 팀 과제
                type="PPT_EMAIL",
                status="PENDING",
            )
            db.add(ppt_email)

    # 4. 개인별 Assignments 생성 (REVIEW, FEEDBACK, HOMEWORK)
    # 활성 멤버 전체? 아니면 팀에 속한 멤버만? -> 팀빌딩은 전원 참여가 원칙.
    # 여기서는 "팀에 배정된 멤버들"에 대해서 만듦.
    
    all_assigned_member_ids = set()
    for t in body.teams:
        for m in t.members:
            all_assigned_member_ids.add(m.member_id)
            
    if is_reconfirm:
        # PREP 재편집: 이미 존재하는 개인 과제는 유지, 새 멤버만 생성
        existing_result = await db.execute(
            sa_select(Assignment.member_id, Assignment.type).where(
                Assignment.session_id == session_id,
                Assignment.member_id.isnot(None),
            )
        )
        existing_pairs = {(row.member_id, row.type) for row in existing_result}

        for mid in all_assigned_member_ids:
            if session.config.get("has_ppt", True) and (mid, "PPT") not in existing_pairs:
                db.add(Assignment(session_id=session_id, member_id=mid, type="PPT", status="PENDING"))
            if session.config.get("has_review", True) and (mid, "REVIEW") not in existing_pairs:
                db.add(Assignment(session_id=session_id, member_id=mid, type="REVIEW", status="PENDING"))
            if session.config.get("has_feedback", True) and (mid, "FEEDBACK") not in existing_pairs:
                db.add(Assignment(session_id=session_id, member_id=mid, type="FEEDBACK", status="PENDING", target_count=1))
    else:
        # SETUP 최초 확정: 전원 개인 과제 생성
        for mid in all_assigned_member_ids:
            if session.config.get("has_ppt", True):
                db.add(Assignment(session_id=session_id, member_id=mid, type="PPT", status="PENDING"))
            if session.config.get("has_review", True):
                db.add(Assignment(session_id=session_id, member_id=mid, type="REVIEW", status="PENDING"))
            if session.config.get("has_feedback", True):
                db.add(Assignment(session_id=session_id, member_id=mid, type="FEEDBACK", status="PENDING", target_count=1))

        # SETUP에서만 상태 전환
        session.status = "PREP"

    await db.commit()
    logger.audit(f"teams_confirmed session={session_id} teams={len(body.teams)} members={len(all_assigned_member_ids)}")


# ─── 분반 (Groups) ─────────────────────────────────────────────────

async def _guard_group_session(session: SessionModel):
    """분반 엔드포인트 공통 가드"""
    if session.type != "INDIVIDUAL":
        raise HTTPException(status_code=400, detail="분반은 개인(INDIVIDUAL) 세션에서만 사용 가능합니다")
    cfg = session.config or {}
    if not cfg.get("has_groups"):
        raise HTTPException(status_code=400, detail="이 세션은 분반이 활성화되어 있지 않습니다")
    if session.status not in ("SETUP", "PREP"):
        raise HTTPException(status_code=400, detail="분반 수정은 SETUP/PREP 상태에서만 가능합니다")


@router.post("/{session_id}/groups/generate")
async def generate_groups(
    session_id: int,
    body: GroupGenerateRequest,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """분반 자동 생성 (저장 안 함, 미리보기)"""
    session = await _get_session_or_404(session_id, db, cohort_id)
    await _guard_group_session(session)

    # 🔴 전역 멤버 스캔 — 현재 기수의 활성 멤버만 (타 기수 멤버 누출 방지)
    result = await db.execute(
        select(Member).where(
            Member.is_active == True,
            Member.cohort_id == cohort_id,
        )
    )
    members = result.scalars().all()

    groups = build_groups(members, method=body.method)
    # member 이름 포함해서 반환
    member_map = {m.id: m.name for m in members}
    return {
        "groups": {
            str(k): [{"id": mid, "name": member_map.get(mid, "?")} for mid in ids]
            for k, ids in groups.items()
        }
    }


@router.get("/{session_id}/groups")
async def get_groups(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """현재 분반 현황 조회"""
    session = await _get_session_or_404(session_id, db, cohort_id)

    att_result = await db.execute(
        select(Attendance, Member.name)
        .join(Member, Attendance.member_id == Member.id)
        .where(Attendance.session_id == session_id)
    )
    rows = att_result.all()

    groups: dict[str, list[dict]] = {"1": [], "2": [], "unassigned": []}
    for att, name in rows:
        entry = {"member_id": att.member_id, "name": name, "group_num": att.group_num}
        if att.group_num == 1:
            groups["1"].append(entry)
        elif att.group_num == 2:
            groups["2"].append(entry)
        else:
            groups["unassigned"].append(entry)

    # staff_groups: config에 저장된 운영진 분반 배정
    cfg = session.config or {}
    staff_groups_raw = cfg.get("staff_groups", {})

    # users 목록 조회 (운영진 배정용) — 현재 기수 소속 운영진만 (타 기수 운영진 누출 방지)
    users_result = await db.execute(
        select(User)
        .where(User.is_active == True, User.cohort_id == cohort_id)
        .order_by(User.id)
    )
    all_users = [
        {"id": u.id, "display_name": u.display_name, "department": u.department, "role": u.role}
        for u in users_result.scalars().all()
    ]

    # staff_groups에 이름 붙여서 반환
    user_name_map = {u["id"]: u["display_name"] for u in all_users}
    staff_groups: dict[str, list[dict]] = {"1": [], "2": [], "unassigned": []}
    assigned_staff_ids: set[int] = set()
    for gk in ("1", "2"):
        for uid in staff_groups_raw.get(gk, []):
            staff_groups[gk].append({"user_id": uid, "display_name": user_name_map.get(uid, f"ID:{uid}")})
            assigned_staff_ids.add(uid)
    for u in all_users:
        if u["id"] not in assigned_staff_ids:
            staff_groups["unassigned"].append({"user_id": u["id"], "display_name": u["display_name"]})

    return {"groups": groups, "staff_groups": staff_groups, "users": all_users}


@router.patch("/{session_id}/groups")
async def save_groups(
    session_id: int,
    body: GroupAssignment,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """분반 저장 (벌크 업데이트)"""
    session = await _get_session_or_404(session_id, db, cohort_id)
    await _guard_group_session(session)

    # 검증: 중복 없는지
    all_ids: list[int] = []
    for group_key, member_ids in body.groups.items():
        if group_key not in ("1", "2"):
            raise HTTPException(status_code=400, detail=f"잘못된 분반 키: {group_key} (1 또는 2만 허용)")
        for mid in member_ids:
            if mid in all_ids:
                raise HTTPException(status_code=400, detail=f"중복된 멤버 ID: {mid}")
            all_ids.append(mid)

    # 해당 세션 attendance 조회
    att_result = await db.execute(
        select(Attendance).where(Attendance.session_id == session_id)
    )
    att_map = {a.member_id: a for a in att_result.scalars().all()}

    # 검증: 모든 ID가 해당 세션에 존재하는지
    invalid = set(all_ids) - set(att_map.keys())
    if invalid:
        raise HTTPException(status_code=400, detail=f"이 세션에 없는 멤버 ID: {sorted(invalid)}")

    # 전체 초기화 후 배정
    for att in att_map.values():
        att.group_num = None

    for group_key, member_ids in body.groups.items():
        group_num = int(group_key)
        for mid in member_ids:
            att_map[mid].group_num = group_num

    # staff_groups를 config에 저장
    if body.staff_groups is not None:
        cfg = dict(session.config or {})
        cfg["staff_groups"] = body.staff_groups
        session.config = cfg

    await db.commit()
    logger.audit(f"groups_saved session={session_id} g1={len(body.groups.get('1', []))} g2={len(body.groups.get('2', []))}")
    return {"status": "ok", "groups": {k: len(v) for k, v in body.groups.items()}}


@router.delete("/{session_id}/groups")
async def clear_groups(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """분반 초기화 (전체 NULL)"""
    session = await _get_session_or_404(session_id, db, cohort_id)
    await _guard_group_session(session)

    await db.execute(
        update(Attendance)
        .where(Attendance.session_id == session_id)
        .values(group_num=None)
    )
    await db.commit()
    logger.audit(f"groups_cleared session={session_id}")
    return {"status": "ok"}


@router.patch("/{session_id}/assignments/{member_id}/feedback-targets")
async def set_feedback_targets(
    session_id: int,
    member_id: int,
    body: FeedbackTargetUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """피드백 대상 멤버 지정 (보통 1명, 결석 시 2명)"""
    session = await _get_session_or_404(session_id, db, cohort_id)
    if session.status == "FINALIZED":
        raise HTTPException(status_code=400, detail="FINALIZED 세션은 수정 불가합니다")

    # Validate target_member_ids exist as active members (현재 기수로 제한)
    if body.target_member_ids:
        valid_ids_result = await db.execute(
            select(Member.id).where(
                Member.id.in_(body.target_member_ids),
                Member.is_active == True,
                Member.cohort_id == cohort_id,
            )
        )
        valid_ids = {row[0] for row in valid_ids_result.fetchall()}
        invalid = set(body.target_member_ids) - valid_ids
        if invalid:
            raise HTTPException(status_code=400, detail=f"존재하지 않는 멤버 ID: {sorted(invalid)}")

    stmt = select(Assignment).where(
        Assignment.session_id == session_id,
        Assignment.member_id == member_id,
        Assignment.type == "FEEDBACK",
    )
    result = await db.execute(stmt)
    assignment = result.scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=404, detail="FEEDBACK assignment not found")

    assignment.target_member_ids = body.target_member_ids
    assignment.target_count = len(body.target_member_ids)
    await db.commit()
    logger.audit(f"feedback_targets session={session_id} member={member_id} targets={body.target_member_ids}")
    return {"member_id": member_id, "target_member_ids": body.target_member_ids}


@router.post("/{session_id}/feedback-random-assign")
async def feedback_random_assign(
    session_id: int,
    body: FeedbackRandomAssignRequest,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """피드백 대상 랜덤 일괄 배정 (본인은 크롤러가 자동 포함)"""
    session = await _get_session_or_404(session_id, db, cohort_id)
    if session.status == "FINALIZED":
        raise HTTPException(status_code=400, detail="FINALIZED 세션은 수정 불가합니다")

    # 발표자 목록 (config에 저장된 것 또는 출석 멤버 기본값)
    presenter_ids: list[int] = session.config.get("feedback_presenters", []) if session.config else []

    # 결석/공결 멤버
    att_stmt = select(Attendance).where(Attendance.session_id == session_id)
    att_result = await db.execute(att_stmt)
    attendances = att_result.scalars().all()

    absent_ids = {a.member_id for a in attendances if a.status in ("ABSENT", "EXCUSED")}
    member_group_map = {a.member_id: a.group_num for a in attendances}
    session_has_groups = bool((session.config or {}).get("has_groups"))

    if not presenter_ids:
        presenter_ids = [a.member_id for a in attendances if a.member_id not in absent_ids]

    # FEEDBACK assignments
    fb_stmt = select(Assignment).where(
        Assignment.session_id == session_id,
        Assignment.type == "FEEDBACK",
    )
    fb_result = await db.execute(fb_stmt)
    fb_assignments = fb_result.scalars().all()

    if not fb_assignments:
        raise HTTPException(status_code=400, detail="FEEDBACK assignment가 없습니다")

    if len(presenter_ids) < 2:
        raise HTTPException(status_code=400, detail="발표자가 2명 이상이어야 랜덤 배정이 가능합니다")

    # 균등 분배를 위한 카운터
    assign_count: dict[int, int] = {pid: 0 for pid in presenter_ids}
    result_map: list[dict] = []

    # 랜덤 순서로 처리 (선착 편향 방지)
    shuffled_assignments = list(fb_assignments)
    random.shuffle(shuffled_assignments)

    for assignment in shuffled_assignments:
        writer_id = assignment.member_id
        is_absent = writer_id in absent_ids
        extra_count = body.extra_count_absent if is_absent else body.extra_count_normal

        # 본인 제외 발표자 중 가장 적게 배정된 순으로
        candidates = [pid for pid in presenter_ids if pid != writer_id]
        random.shuffle(candidates)
        writer_group = member_group_map.get(writer_id)
        if session_has_groups and writer_group:
            # 교차 분반 우선: 다른 분반 → 같은 분반, 그 안에서 균등 분배
            candidates.sort(key=lambda pid: (
                0 if member_group_map.get(pid) != writer_group else 1,
                assign_count.get(pid, 0),
            ))
        else:
            candidates.sort(key=lambda pid: assign_count.get(pid, 0))

        picked = candidates[:extra_count]
        for pid in picked:
            assign_count[pid] = assign_count.get(pid, 0) + 1

        assignment.target_member_ids = picked
        assignment.target_count = len(picked)
        result_map.append({"member_id": writer_id, "target_member_ids": picked})

    await db.commit()
    logger.audit(f"feedback_random_assign session={session_id} count={len(result_map)}")
    return {"assigned": len(result_map), "details": result_map}


# ── Settlement & Finalize ─────────────────────────────────────────────────────

@router.get("/{session_id}/settlement-preview", response_model=SettlementPreviewResponse)
async def get_settlement_preview(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """정산 프리뷰 (페널티 엔진 결과만 조회, DB 저장 X)"""
    # 세션이 cohort 검증됨 → 이하 staged_merits member_id 조회는 cohort-verified config 기반
    session = await _get_session_or_404(session_id, db, cohort_id)
    
    from app.services.penalty_engine import PenaltyEngine
    from app.services.streak_checker import check_attendance_streaks

    engine = PenaltyEngine(session, db)
    penalties = await engine.calculate_all()

    response_items = []
    for p in penalties:
        response_items.append({
            "type": p.type,
            "member_id": p.member.id,
            "member_name": p.member.name,
            "score_delta": p.score_delta,
            "deposit_delta": p.deposit_delta,
            "description": p.description,
        })

    # 스트릭 merit 항목 조회
    streak_result = await check_attendance_streaks(db, session_id)
    merits: list[dict] = []
    for item in streak_result["merit_items"]:
        merits.append({
            "member_id": item["member_id"],
            "member_name": item["member_name"],
            "score_delta": item["score_delta"],
            "description": item["description"],
            "source": "streak",
        })

    # 수동 staged merits (session config)
    staged_merits = (session.config or {}).get("staged_merits", [])
    if staged_merits:
        # member_id -> name 매핑 조회
        staged_member_ids = {sm["member_id"] for sm in staged_merits}
        stmt_members = select(Member).where(Member.id.in_(staged_member_ids))
        result_members = await db.execute(stmt_members)
        member_name_map = {m.id: m.name for m in result_members.scalars().all()}

        for sm in staged_merits:
            merits.append({
                "member_id": sm["member_id"],
                "member_name": member_name_map.get(sm["member_id"], f"ID:{sm['member_id']}"),
                "score_delta": sm["score_delta"],
                "description": sm["reason"],
                "source": "manual",
            })

    return SettlementPreviewResponse(
        session_id=session.id,
        penalties=response_items,
        merits=merits,
    )


@router.post("/{session_id}/staged-merits", status_code=status.HTTP_201_CREATED)
async def add_staged_merits(
    session_id: int,
    body: StagedMeritCreate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """수동 상점을 session config에 staging"""
    session = await _get_session_or_404(session_id, db, cohort_id)
    if session.status == "FINALIZED":
        raise HTTPException(status_code=400, detail="FINALIZED 세션에는 상점을 추가할 수 없습니다")

    from sqlalchemy.orm.attributes import flag_modified

    config = session.config or {}
    staged = config.get("staged_merits", [])

    for mid in body.member_ids:
        staged.append({
            "member_id": mid,
            "score_delta": body.score_delta,
            "reason": body.reason,
        })

    config["staged_merits"] = staged
    session.config = config
    flag_modified(session, "config")

    await db.commit()
    return {"staged_count": len(staged)}


@router.delete("/{session_id}/staged-merits/{index}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_staged_merit(
    session_id: int,
    index: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """수동 staged 상점 삭제 (인덱스)"""
    session = await _get_session_or_404(session_id, db, cohort_id)
    if session.status == "FINALIZED":
        raise HTTPException(status_code=400, detail="FINALIZED 세션은 수정할 수 없습니다")

    from sqlalchemy.orm.attributes import flag_modified

    config = session.config or {}
    staged = config.get("staged_merits", [])

    if index < 0 or index >= len(staged):
        raise HTTPException(status_code=404, detail="해당 인덱스의 staged merit이 없습니다")

    staged.pop(index)
    config["staged_merits"] = staged
    session.config = config
    flag_modified(session, "config")

    await db.commit()


@router.post("/{session_id}/finalize", response_model=SessionFinalizeResponse)
async def finalize_session_api(
    session_id: int,
    body: SessionFinalizeRequest,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """세션 마감 (Finalize) - 페널티 확정 및 정산 처리"""
    from app.services.finalize import finalize_session, SessionAlreadyFinalizedError

    # 기수 격리: 다른 기수의 세션을 마감하지 못하도록 사전 검증
    await _get_session_or_404(session_id, db, cohort_id)

    # Pydantic 모델 -> Dict 변환
    overrides_dict = [o.model_dump() for o in body.overrides]
    
    try:
        await finalize_session(session_id, db, overrides_dict, body.skip_merit_indices)
        await db.commit() # 트랜잭션 확정
        # 세션 정보 조회 — 라벨 구성 + finalized_at
        updated_session = await db.get(SessionModel, session_id)
        label = f"{updated_session.week_num}주차 {updated_session.title}" if updated_session else f"#{session_id}"
        logger.audit(f"🔒 세션 마감 — {label}")
        
        return SessionFinalizeResponse(
            status="ok",
            finalized_at=updated_session.finalized_at
        )
        
    except SessionAlreadyFinalizedError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Finalize failed", exc_info=True)
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Finalize failed: {str(e)}")


# ── PPT Download ──────────────────────────────────────────────────────────────

@router.get("/{session_id}/ppt/{member_id}/download")
async def download_member_ppt(
    session_id: int,
    member_id: int,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """멤버의 PPT 파일을 구글 드라이브에서 다운로드하여 반환"""
    import asyncio
    from fastapi.responses import Response
    from app.services.crawler_video import download_drive_file_bytes

    session = await _get_session_or_404(session_id, db, cohort_id)

    # Assignment 조회 (INDIVIDUAL or TEAM)
    assignment = None
    if session.type == "TEAM":
        # member → team → team assignment
        tm_result = await db.execute(
            select(TeamMember.team_id)
            .join(Team)
            .where(Team.session_id == session_id, TeamMember.member_id == member_id)
        )
        team_id = tm_result.scalar_one_or_none()
        if team_id:
            result = await db.execute(
                select(Assignment).where(
                    Assignment.session_id == session_id,
                    Assignment.type == "PPT_EMAIL",
                    Assignment.team_id == team_id,
                )
            )
            assignment = result.scalar_one_or_none()
    else:
        result = await db.execute(
            select(Assignment).where(
                Assignment.session_id == session_id,
                Assignment.type == "PPT_EMAIL",
                Assignment.member_id == member_id,
            )
        )
        assignment = result.scalar_one_or_none()

    if not assignment:
        raise HTTPException(status_code=404, detail="PPT_EMAIL assignment not found")

    drive_file_id = (assignment.raw_data or {}).get("drive_file_id")
    if not drive_file_id:
        raise HTTPException(status_code=404, detail="드라이브에 업로드된 PPT 파일이 없습니다")

    try:
        file_bytes, filename = await asyncio.to_thread(download_drive_file_bytes, drive_file_id)
    except Exception as e:
        logger.error(f"PPT 다운로드 실패: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=f"드라이브 다운로드 실패: {e}")

    return Response(
        content=file_bytes,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{session_id}/ppt/download-all")
async def download_all_ppt(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """모든 PPT를 ZIP으로 묶어서 다운로드"""
    import asyncio
    import io
    import zipfile
    from fastapi.responses import Response
    from app.services.crawler_video import download_drive_file_bytes

    session = await _get_session_or_404(session_id, db, cohort_id)

    # 해당 세션의 모든 PPT_EMAIL Assignment (drive_file_id 있는 것)
    result = await db.execute(
        select(Assignment).where(
            Assignment.session_id == session_id,
            Assignment.type == "PPT_EMAIL",
        )
    )
    assignments = result.scalars().all()

    files_to_zip: list[tuple[str, bytes]] = []
    for a in assignments:
        drive_file_id = (a.raw_data or {}).get("drive_file_id")
        if not drive_file_id:
            continue
        try:
            file_bytes, filename = await asyncio.to_thread(download_drive_file_bytes, drive_file_id)
            files_to_zip.append((filename, file_bytes))
        except Exception as e:
            logger.warning(f"ZIP용 PPT 다운로드 실패 (assignment={a.id}): {e}")

    if not files_to_zip:
        raise HTTPException(status_code=404, detail="다운로드할 PPT 파일이 없습니다")

    # ZIP 생성
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        seen_names: set[str] = set()
        for filename, content in files_to_zip:
            # 중복 파일명 처리
            unique_name = filename
            counter = 1
            while unique_name in seen_names:
                name_part, ext = (filename.rsplit(".", 1) + [""])[:2]
                unique_name = f"{name_part}_{counter}.{ext}" if ext else f"{name_part}_{counter}"
                counter += 1
            seen_names.add(unique_name)
            zf.writestr(unique_name, content)

    zip_filename = f"{session.week_num}주차_{session.title}_PPT.zip"
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_filename}"'},
    )


# ── 발표 순서 ─────────────────────────────────────────────────────────────────


@router.patch("/{session_id}/presenter-order")
async def update_presenter_order(
    session_id: int,
    body: list[dict],
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """발표 순서 일괄 저장 — [{member_id, presenter_order}]"""
    # 세션이 현재 기수 소속인지 검증 (자식 Attendance를 session_id로 수정하므로)
    await _get_session_or_404(session_id, db, cohort_id)
    for item in body:
        await db.execute(
            update(Attendance)
            .where(Attendance.session_id == session_id, Attendance.member_id == item["member_id"])
            .values(presenter_order=item["presenter_order"])
        )
    await db.commit()
    return {"status": "ok", "updated": len(body)}


@router.patch("/{session_id}/team-order")
async def update_team_order(
    session_id: int,
    body: list[dict],
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """팀 발표 순서 일괄 저장 — [{team_id, presenter_order}]"""
    # 세션이 현재 기수 소속인지 검증 (자식 Team을 session_id로 수정하므로)
    await _get_session_or_404(session_id, db, cohort_id)
    for item in body:
        await db.execute(
            update(Team)
            .where(Team.session_id == session_id, Team.id == item["team_id"])
            .values(presenter_order=item["presenter_order"])
        )
    await db.commit()
    return {"status": "ok", "updated": len(body)}


# ── 클라이언트 업로드 진단 로그 (브라우저→R2 직접 PUT 실패는 서버를 안 거치므로
#    프론트가 각 단계 결과를 여기로 보고 → 서버 로그/텔레그램으로 원인 파악) ──────
# 인증 없음: 토큰 만료(401) 상황에서도 진단을 받아야 하기 때문. 정보성이라 부작용 없음.


@router.post("/{session_id}/videos/{member_id}/upload-diag")
async def upload_diag(
    session_id: int,
    member_id: int,
    request: Request,
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
):
    """프론트엔드 업로드 단계별 진단 보고 수신 (presign/r2_put/finalize 등)."""
    m = await db.get(Member, member_id)
    name = m.name if m else f"#{member_id}"
    ip = get_real_ip(request) if "get_real_ip" in globals() else (request.client.host if request.client else "?")

    stage = str(body.get("stage", "?"))
    ok = bool(body.get("ok", False))
    status_code = body.get("status")
    message = body.get("message")
    size_mb = body.get("size_mb")
    elapsed_ms = body.get("elapsed_ms")
    presign_age_ms = body.get("presign_age_ms")
    ua = body.get("ua")
    filename = body.get("filename")

    line = (
        f"📡 업로드진단 [{stage}] {'OK' if ok else '실패'} — {name} "
        f"session={session_id} member={member_id} status={status_code} "
        f"size={size_mb}MB elapsed={elapsed_ms}ms presign_age={presign_age_ms}ms "
        f"file={filename} ip={ip} msg={message} ua={ua}"
    )
    if ok:
        logger.info(line)
    else:
        # 실패는 WARNING → 텔레그램 alert 채널로도 즉시 전송
        logger.warning(line)
    return {"ok": True}


# ── R2 직접 업로드 (Cloudflare Tunnel 100MB 제한 우회) ────────────────────────
# 흐름: 클라 → 서버에서 presigned URL 요청 → R2로 직접 PUT → 서버에 finalize 알림
#       → ARQ worker가 R2에서 로컬로 pull + R2 오브젝트 삭제


@router.post("/{session_id}/videos/{member_id}/r2/presign")
async def r2_presign_upload(
    session_id: int,
    member_id: int,
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """R2 업로드용 presigned URL 발급 (15분 유효)"""
    from app.services import r2 as r2_svc
    if not r2_svc.is_configured():
        raise HTTPException(status_code=501, detail="R2가 설정되지 않았습니다 (서버 env 확인)")

    # 세션이 현재 기수 소속인지 검증
    await _get_session_or_404(session_id, db, cohort_id)

    member = await db.get(Member, member_id)
    if not member or member.cohort_id != cohort_id:
        raise HTTPException(status_code=404, detail="멤버를 찾을 수 없습니다")

    filename = body.get("filename") or "video.mp4"
    content_type = body.get("content_type") or "application/octet-stream"
    size = int(body.get("size", 0))

    # R2 오브젝트 키: 중복 방지용 uuid 포함. pull 시 삭제되므로 길게 유지 X
    key = f"uploads/session_{session_id}/{member_id}/{uuid.uuid4().hex}_{filename}"

    upload_url = r2_svc.presign_put(key, expires_in=900, content_type=content_type)

    size_mb = round(size / (1024 * 1024), 1) if size else 0
    logger.audit(f"🎬 영상 업로드 시작 — {member.name} ({size_mb}MB)")
    return {
        "upload_url": upload_url,
        "key": key,
        "method": "PUT",
        "content_type": content_type,
        "expires_in": 900,
    }


@router.post("/{session_id}/videos/{member_id}/r2/finalize")
async def r2_finalize_upload(
    session_id: int,
    member_id: int,
    request: Request,
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """R2 업로드 완료 알림 → ARQ worker에 pull/삭제 태스크 큐잉"""
    from app.services import r2 as r2_svc
    if not r2_svc.is_configured():
        raise HTTPException(status_code=501, detail="R2가 설정되지 않았습니다")

    # 세션이 현재 기수 소속인지 검증
    await _get_session_or_404(session_id, db, cohort_id)

    member = await db.get(Member, member_id)
    if not member or member.cohort_id != cohort_id:
        raise HTTPException(status_code=404, detail="멤버를 찾을 수 없습니다")

    key = body.get("key")
    filename = body.get("filename") or "video.mp4"
    if not key:
        raise HTTPException(status_code=400, detail="key 필요")

    # R2에 실제로 존재하는지 확인 (auth 우회 방지)
    try:
        meta = await r2_svc.head(key)
        r2_size = int(meta.get("ContentLength", 0))
    except Exception as e:
        logger.error(f"r2_finalize_head_failed key={key} err={e}")
        raise HTTPException(status_code=404, detail="R2에 업로드된 오브젝트가 없습니다")

    # ARQ에 pull 태스크 큐잉
    pool = getattr(request.app.state, "arq_pool", None)
    if not pool:
        raise HTTPException(status_code=503, detail="ARQ pool not initialized")

    job = await pool.enqueue_job(
        "task_r2_pull_to_disk",
        session_id=session_id,
        member_id=member_id,
        r2_key=key,
        filename=filename,
    )
    size_mb = round(r2_size / (1024 * 1024), 1) if r2_size else 0
    logger.audit(f"📦 R2 업로드 완료 — {member.name} ({size_mb}MB)")

    return {
        "status": "queued",
        "job_id": job.job_id if job else None,
        "size": r2_size,
    }


# ── R2 Multipart Upload (Background Fetch storage quota 회피) ────────────────
# 청크 크기 20MB × N개 → 각 청크별 presigned PUT URL 일괄 발급 → 클라가 BG Fetch 로 전체 업로드
# 완료 시 SW 가 part ETag 수집 → /complete 호출 → 서버가 R2 complete + ARQ pull 큐잉


@router.post("/{session_id}/videos/{member_id}/r2/multipart/init")
async def r2_multipart_init(
    session_id: int,
    member_id: int,
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """멀티파트 업로드 시작 + 모든 part presigned URL 일괄 발급"""
    from app.services import r2 as r2_svc
    if not r2_svc.is_configured():
        raise HTTPException(status_code=501, detail="R2가 설정되지 않았습니다 (서버 env 확인)")

    # 세션이 현재 기수 소속인지 검증
    await _get_session_or_404(session_id, db, cohort_id)

    member = await db.get(Member, member_id)
    if not member or member.cohort_id != cohort_id:
        raise HTTPException(status_code=404, detail="멤버를 찾을 수 없습니다")

    filename = body.get("filename") or "video.mp4"
    content_type = body.get("content_type") or "application/octet-stream"
    size = int(body.get("size", 0))
    chunk_size = int(body.get("chunk_size", 20 * 1024 * 1024))

    if size <= 0:
        raise HTTPException(status_code=400, detail="size 가 0 이하입니다")
    # R2/S3 multipart 제약: part 최소 5MB (마지막 제외), 최대 10000개
    if chunk_size < 5 * 1024 * 1024:
        chunk_size = 5 * 1024 * 1024
    num_parts = (size + chunk_size - 1) // chunk_size
    if num_parts > 10000:
        raise HTTPException(status_code=400, detail="청크 개수 초과 (최대 10000)")

    key = f"uploads/session_{session_id}/{member_id}/{uuid.uuid4().hex}_{filename}"
    upload_id = await r2_svc.create_multipart(key, content_type)

    # 청크 개수만큼 presigned URL 일괄 생성 (6시간 유효 — 느린 모바일 업로드 대비)
    part_urls = [
        {"partNumber": i + 1, "url": r2_svc.presign_part(key, upload_id, i + 1, expires_in=6 * 3600)}
        for i in range(num_parts)
    ]

    size_mb = round(size / (1024 * 1024), 1)
    logger.audit(f"🎬 멀티파트 업로드 시작 — {member.name} ({size_mb}MB, {num_parts}개 청크)")

    return {
        "key": key,
        "uploadId": upload_id,
        "chunkSize": chunk_size,
        "numParts": num_parts,
        "partUrls": part_urls,
        "method": "PUT",
        "contentType": content_type,
    }


@router.post("/{session_id}/videos/{member_id}/r2/multipart/complete")
async def r2_multipart_complete(
    session_id: int,
    member_id: int,
    request: Request,
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """멀티파트 업로드 완료 → R2 오브젝트 결합 → ARQ pull 태스크 큐잉"""
    from app.services import r2 as r2_svc
    if not r2_svc.is_configured():
        raise HTTPException(status_code=501, detail="R2가 설정되지 않았습니다")

    # 세션이 현재 기수 소속인지 검증
    await _get_session_or_404(session_id, db, cohort_id)

    member = await db.get(Member, member_id)
    if not member or member.cohort_id != cohort_id:
        raise HTTPException(status_code=404, detail="멤버를 찾을 수 없습니다")

    key = body.get("key")
    upload_id = body.get("uploadId")
    filename = body.get("filename") or "video.mp4"
    parts = body.get("parts") or []
    if not key or not upload_id or not parts:
        raise HTTPException(status_code=400, detail="key / uploadId / parts 모두 필요")

    # parts 정규화 — SW 에서 온 { PartNumber, ETag } 리스트
    norm_parts = []
    for p in parts:
        pn = p.get("PartNumber") or p.get("partNumber")
        et = p.get("ETag") or p.get("etag")
        if pn is None or not et:
            raise HTTPException(status_code=400, detail="parts 원소에 PartNumber/ETag 필수")
        norm_parts.append({"PartNumber": int(pn), "ETag": et})

    # R2 complete 호출
    try:
        await r2_svc.complete_multipart(key, upload_id, norm_parts)
    except Exception as e:
        logger.error(f"r2_multipart_complete_failed key={key} upload_id={upload_id} err={e}")
        # R2 측 cleanup 시도
        try:
            await r2_svc.abort_multipart(key, upload_id)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"multipart complete 실패: {e}")

    # 실제 오브젝트 크기 확인
    try:
        meta = await r2_svc.head(key)
        r2_size = int(meta.get("ContentLength", 0))
    except Exception as e:
        logger.error(f"r2_multipart_head_failed key={key} err={e}")
        raise HTTPException(status_code=500, detail="multipart 완료되었으나 오브젝트 조회 실패")

    # ARQ pull 태스크 큐잉 (기존 r2/finalize 와 동일 태스크 사용)
    pool = getattr(request.app.state, "arq_pool", None)
    if not pool:
        raise HTTPException(status_code=503, detail="ARQ pool not initialized")

    job = await pool.enqueue_job(
        "task_r2_pull_to_disk",
        session_id=session_id,
        member_id=member_id,
        r2_key=key,
        filename=filename,
    )
    size_mb = round(r2_size / (1024 * 1024), 1) if r2_size else 0
    logger.audit(f"📦 R2 멀티파트 업로드 완료 — {member.name} ({size_mb}MB, {len(norm_parts)}청크)")

    return {
        "status": "queued",
        "job_id": job.job_id if job else None,
        "size": r2_size,
    }


@router.post("/{session_id}/videos/{member_id}/r2/multipart/abort")
async def r2_multipart_abort(
    session_id: int,
    member_id: int,
    body: dict = Body(...),
    _: str = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """멀티파트 업로드 중단 — R2 측 미완료 파트 정리"""
    from app.services import r2 as r2_svc
    if not r2_svc.is_configured():
        raise HTTPException(status_code=501, detail="R2가 설정되지 않았습니다")

    key = body.get("key")
    upload_id = body.get("uploadId")
    if not key or not upload_id:
        raise HTTPException(status_code=400, detail="key / uploadId 필요")

    await r2_svc.abort_multipart(key, upload_id)
    return {"status": "aborted"}


# ── 영상 직접 업로드 ──────────────────────────────────────────────────────────


VIDEO_DIR = "/app/files/video"


@router.post("/{session_id}/videos/{member_id}")
async def upload_video(
    request: Request,
    session_id: int,
    member_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """발표자별 영상 업로드 (교체 가능)

    동시 업로드 안정성:
    - 파일 쓰기는 스레드 풀에 위임 (이벤트 루프 블록 방지)
    - .tmp 파일에 쓰고 성공 시 rename → 중단 시 불완전 파일 안 남음
    """
    # 세션이 현재 기수 소속인지 검증
    await _get_session_or_404(session_id, db, cohort_id)

    member = await db.get(Member, member_id)
    if not member or member.cohort_id != cohort_id:
        raise HTTPException(status_code=404, detail="멤버를 찾을 수 없습니다")

    session_dir = os.path.join(VIDEO_DIR, f"session_{session_id}")
    await asyncio.to_thread(os.makedirs, session_dir, exist_ok=True)

    # 기존 파일 삭제 (교체)
    def _remove_existing():
        for existing in os.listdir(session_dir):
            if existing.startswith(f"{member_id}_"):
                try:
                    os.remove(os.path.join(session_dir, existing))
                except OSError:
                    pass
    await asyncio.to_thread(_remove_existing)

    # 저장 — 임시 파일에 쓰고 성공 시 rename
    safe_name = file.filename or "video.mp4"
    save_name = f"{member_id}_{safe_name}"
    save_path = os.path.join(session_dir, save_name)
    tmp_path = save_path + ".tmp"

    size = 0
    try:
        with open(tmp_path, "wb") as f:
            while chunk := await file.read(4 * 1024 * 1024):  # 4MB chunks
                await asyncio.to_thread(f.write, chunk)
                size += len(chunk)
        await asyncio.to_thread(os.replace, tmp_path, save_path)
    except Exception as e:
        # 실패 시 임시 파일 정리
        try:
            await asyncio.to_thread(os.remove, tmp_path)
        except OSError:
            pass
        logger.error(f"video_upload_failed session={session_id} member={member_id} err={e}")
        raise HTTPException(status_code=500, detail=f"업로드 실패: {e}")

    size_mb = round(size / (1024 * 1024), 1)
    logger.audit(f"video_uploaded session={session_id} member={member_id} file={save_name} size={size_mb}MB")

    # 큰 파일이면 압축 태스크 큐잉 (네이버 업로드 전 용량 축소)
    from app.services.video_compress import COMPRESS_THRESHOLD_MB
    if size_mb > COMPRESS_THRESHOLD_MB:
        pool = getattr(request.app.state, "arq_pool", None)
        if pool:
            await pool.enqueue_job(
                "task_compress_video",
                session_id=session_id,
                member_id=member_id,
                path=save_path,
            )
            logger.info(f"compress_queued session={session_id} member={member_id} size={size_mb}MB")

    return {
        "member_id": member_id,
        "member_name": member.name,
        "filename": safe_name,
        "size_mb": size_mb,
        "path": save_path,
    }


# ── 청크 업로드 (Cloudflare 100MB 제한 우회) ────────────────────────────
# 전략: 최종 파일을 init 단계에서 sparse 파일로 미리 할당 →
#       각 청크는 자신의 offset에 직접 쓰기 (재조립 불필요)


@router.post("/{session_id}/videos/{member_id}/chunks/init")
async def init_chunk_upload(
    session_id: int,
    member_id: int,
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """청크 업로드 세션 초기화 → upload_id 반환. 최종 파일을 sparse로 미리 할당."""
    # 세션이 현재 기수 소속인지 검증
    await _get_session_or_404(session_id, db, cohort_id)

    member = await db.get(Member, member_id)
    if not member or member.cohort_id != cohort_id:
        raise HTTPException(status_code=404, detail="멤버를 찾을 수 없습니다")

    filename = body.get("filename") or "video.mp4"
    total_size = int(body.get("total_size", 0))
    total_chunks = int(body.get("total_chunks", 1))
    chunk_size = int(body.get("chunk_size", 0))
    if total_size <= 0 or total_chunks <= 0 or chunk_size <= 0:
        raise HTTPException(status_code=400, detail="total_size / total_chunks / chunk_size 필요")

    upload_id = uuid.uuid4().hex
    session_dir = os.path.join(VIDEO_DIR, f"session_{session_id}")
    chunks_dir = os.path.join(session_dir, ".chunks", upload_id)
    await asyncio.to_thread(os.makedirs, chunks_dir, exist_ok=True)

    # 기존 해당 멤버 파일/부분 파일 삭제
    def _cleanup_existing():
        if not os.path.isdir(session_dir):
            return
        for existing in os.listdir(session_dir):
            full = os.path.join(session_dir, existing)
            if os.path.isfile(full) and existing.startswith(f"{member_id}_"):
                try:
                    os.remove(full)
                except OSError:
                    pass
    await asyncio.to_thread(_cleanup_existing)

    # 최종 파일명을 .partial 로 미리 할당 (sparse — 실제 디스크 쓰기 X)
    save_name = f"{member_id}_{filename}"
    target_path = os.path.join(session_dir, save_name + ".partial")

    def _allocate():
        with open(target_path, "wb") as f:
            f.truncate(total_size)
    await asyncio.to_thread(_allocate)

    meta = {
        "filename": filename,
        "total_size": total_size,
        "total_chunks": total_chunks,
        "chunk_size": chunk_size,
        "target_path": target_path,
        "member_id": member_id,
    }
    meta_path = os.path.join(chunks_dir, "meta.json")

    def _write_meta():
        with open(meta_path, "w") as f:
            f.write(json.dumps(meta))
    await asyncio.to_thread(_write_meta)

    return {"upload_id": upload_id, "chunks_total": total_chunks}


@router.post("/{session_id}/videos/{member_id}/chunk/{upload_id}/{chunk_idx}")
async def upload_chunk(
    session_id: int,
    member_id: int,
    upload_id: str,
    chunk_idx: int,
    request: Request,
    _: str = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """raw binary body를 .partial 파일의 해당 offset에 직접 기록.
    청크 파일 별도 저장 X → 재조립 불필요, disk I/O 절반."""
    chunks_dir = os.path.join(VIDEO_DIR, f"session_{session_id}", ".chunks", upload_id)
    meta_path = os.path.join(chunks_dir, "meta.json")
    if not os.path.isfile(meta_path):
        raise HTTPException(status_code=404, detail="업로드 세션 없음 (만료되었거나 취소됨)")

    def _read_meta():
        with open(meta_path) as f:
            return json.loads(f.read())
    meta = await asyncio.to_thread(_read_meta)

    target_path = meta["target_path"]
    chunk_size = meta["chunk_size"]
    offset = chunk_idx * chunk_size

    def _open_rw_seek():
        f = open(target_path, "r+b")
        f.seek(offset)
        return f

    size = 0
    try:
        f = await asyncio.to_thread(_open_rw_seek)
        try:
            async for data in request.stream():
                if data:
                    await asyncio.to_thread(f.write, data)
                    size += len(data)
        finally:
            await asyncio.to_thread(f.close)
    except Exception as e:
        logger.error(f"chunk_upload_failed session={session_id} member={member_id} upload={upload_id} idx={chunk_idx} err={e}")
        raise HTTPException(status_code=500, detail=f"청크 저장 실패: {e}")

    # 수신 확인용 마커 파일 (크기 0)
    mark_path = os.path.join(chunks_dir, f"recv_{chunk_idx:05d}")

    def _touch():
        open(mark_path, "w").close()
    await asyncio.to_thread(_touch)

    logger.audit(f"chunk_received session={session_id} member={member_id} idx={chunk_idx} size={size}")
    return {"received": chunk_idx, "size": size}


@router.post("/{session_id}/videos/{member_id}/chunks/{upload_id}/complete")
async def complete_chunk_upload(
    request: Request,
    session_id: int,
    member_id: int,
    upload_id: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """모든 청크 수신 완료 후 .partial → 최종 파일 rename. 재조립 없음."""
    # 세션이 현재 기수 소속인지 검증
    await _get_session_or_404(session_id, db, cohort_id)

    member = await db.get(Member, member_id)
    if not member or member.cohort_id != cohort_id:
        raise HTTPException(status_code=404, detail="멤버를 찾을 수 없습니다")

    session_dir = os.path.join(VIDEO_DIR, f"session_{session_id}")
    chunks_dir = os.path.join(session_dir, ".chunks", upload_id)
    meta_path = os.path.join(chunks_dir, "meta.json")
    if not os.path.isfile(meta_path):
        raise HTTPException(status_code=404, detail="업로드 세션 없음")

    def _read_meta():
        with open(meta_path) as f:
            return json.loads(f.read())
    meta = await asyncio.to_thread(_read_meta)
    total = meta["total_chunks"]
    target_path = meta["target_path"]

    def _verify():
        for i in range(total):
            if not os.path.isfile(os.path.join(chunks_dir, f"recv_{i:05d}")):
                return i
        return -1
    missing = await asyncio.to_thread(_verify)
    if missing >= 0:
        raise HTTPException(status_code=400, detail=f"청크 {missing} 누락 — 재업로드 필요")

    # .partial → 최종 파일명 rename (거의 즉시 완료)
    final_path = target_path[:-len(".partial")] if target_path.endswith(".partial") else target_path

    try:
        await asyncio.to_thread(os.replace, target_path, final_path)
        await asyncio.to_thread(shutil.rmtree, chunks_dir, ignore_errors=True)
    except Exception as e:
        logger.error(f"chunk_finalize_failed session={session_id} member={member_id} err={e}")
        raise HTTPException(status_code=500, detail=f"파일 확정 실패: {e}")

    size = await asyncio.to_thread(os.path.getsize, final_path)
    size_mb = round(size / (1024 * 1024), 1)
    filename = meta.get("filename") or "video.mp4"
    save_name = f"{member_id}_{filename}"
    logger.audit(f"video_uploaded_chunked session={session_id} member={member_id} file={save_name} size={size_mb}MB chunks={total}")

    # 큰 파일이면 압축 태스크 큐잉 (네이버 업로드 전 용량 축소)
    from app.services.video_compress import COMPRESS_THRESHOLD_MB
    if size_mb > COMPRESS_THRESHOLD_MB:
        pool = getattr(request.app.state, "arq_pool", None)
        if pool:
            await pool.enqueue_job(
                "task_compress_video",
                session_id=session_id,
                member_id=member_id,
                path=final_path,
            )
            logger.info(f"compress_queued session={session_id} member={member_id} size={size_mb}MB")

    return {
        "member_id": member_id,
        "member_name": member.name,
        "filename": filename,
        "size_mb": size_mb,
        "path": final_path,
    }


@router.delete("/{session_id}/videos/{member_id}/chunks/{upload_id}", status_code=204)
async def abort_chunk_upload(
    session_id: int,
    member_id: int,
    upload_id: str,
    _: str = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """업로드 중단 — 청크 디렉토리 + .partial 파일 정리"""
    session_dir = os.path.join(VIDEO_DIR, f"session_{session_id}")
    chunks_dir = os.path.join(session_dir, ".chunks", upload_id)
    meta_path = os.path.join(chunks_dir, "meta.json")

    # .partial 파일도 정리
    if os.path.isfile(meta_path):
        try:
            def _read_meta():
                with open(meta_path) as f:
                    return json.loads(f.read())
            meta = await asyncio.to_thread(_read_meta)
            target_path = meta.get("target_path")
            if target_path and os.path.isfile(target_path):
                await asyncio.to_thread(os.remove, target_path)
        except Exception:
            pass

    await asyncio.to_thread(shutil.rmtree, chunks_dir, ignore_errors=True)
    return None


@router.get("/{session_id}/videos")
async def list_videos(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """세션에 업로드된 영상 목록"""
    # 세션이 현재 기수 소속인지 검증
    await _get_session_or_404(session_id, db, cohort_id)

    session_dir = os.path.join(VIDEO_DIR, f"session_{session_id}")
    if not os.path.isdir(session_dir):
        return []

    # member_id → name 매핑 (현재 기수 멤버만)
    members_result = await db.execute(
        select(Member).where(Member.cohort_id == cohort_id)
    )
    name_map = {m.id: m.name for m in members_result.scalars().all()}

    videos = []
    for fname in sorted(os.listdir(session_dir)):
        # 진행 중/중간 파일 모두 제외 — .partial(청크 업로드 진행중), .tmp(R2 pull 진행중), 숨김(.chunks 등)
        if fname.endswith(".partial") or fname.endswith(".tmp") or fname.startswith("."):
            continue
        fpath = os.path.join(session_dir, fname)
        if not os.path.isfile(fpath):
            continue
        parts = fname.split("_", 1)
        if len(parts) < 2:
            continue
        try:
            mid = int(parts[0])
        except ValueError:
            continue
        size_mb = round(os.path.getsize(fpath) / (1024 * 1024), 1)
        # 압축 진행 중이면 {path}.compressed.tmp 가 존재
        is_compressing = os.path.isfile(fpath + ".compressed.tmp")
        videos.append({
            "member_id": mid,
            "member_name": name_map.get(mid, f"#{mid}"),
            "filename": parts[1],
            "size_mb": size_mb,
            "is_compressing": is_compressing,
        })

    return videos


@router.delete("/{session_id}/videos/{member_id}", status_code=204)
async def delete_video(
    session_id: int,
    member_id: int,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """발표자별 영상 삭제"""
    # 세션이 현재 기수 소속인지 검증 (파일 삭제 전 권한 격리)
    await _get_session_or_404(session_id, db, cohort_id)

    session_dir = os.path.join(VIDEO_DIR, f"session_{session_id}")
    if not os.path.isdir(session_dir):
        return

    for fname in os.listdir(session_dir):
        if fname.startswith(f"{member_id}_"):
            os.remove(os.path.join(session_dir, fname))
            logger.audit(f"video_deleted session={session_id} member={member_id}")
            return

