"""발표 성장 리포트 — 평가 라운드/배정/응답 API"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.constants.eval_questions import (
    DOMAINS,
    DOMAIN_LABELS,
    EVAL_QUESTIONS,
    QUESTION_BY_KEY,
    QUESTIONS_BY_DOMAIN,
    VALID_QUESTION_KEYS,
)
from app.deps import get_current_member, get_current_user, get_db, require_admin_or_chairman, require_staff
from app.models import (
    Attendance,
    EvalAssignment,
    EvalResponse,
    EvalRound,
    Member,
    Session,
    User,
)
from app.services.eval_analysis import (
    compute_avg_question_scores,
    compute_combined_domain_scores,
    compute_domain_scores,
    compute_question_scores,
    determine_stage,
    determine_type,
)

logger = logging.getLogger("evaluation")

router = APIRouter(prefix="/evaluations", tags=["evaluations"])


# ── Schemas ──────────────────────────────────────────────────────────────────


class RoundCreateRequest(BaseModel):
    session_id: int | None = None
    round_type: str = Field(..., pattern="^(INITIAL|FINAL|COMBINED)$")
    title: str = Field(..., min_length=1, max_length=100)
    compare_to_round_id: int | None = None


class RoundUpdateRequest(BaseModel):
    is_open: bool | None = None
    results_open: bool | None = None
    title: str | None = Field(None, min_length=1, max_length=100)
    compare_to_round_id: int | None = None
    hidden_member_ids: list[int] | None = None


class RoundResponse(BaseModel):
    id: int
    session_id: int | None = None
    round_type: str
    title: str
    is_open: bool
    results_open: bool
    compare_to_round_id: int | None = None
    hidden_member_ids: list[int] | None = None
    created_at: datetime | None = None
    closed_at: datetime | None = None

    model_config = {"from_attributes": True}


class RoundListResponse(RoundResponse):
    total_assignments: int = 0
    submitted_count: int = 0


class RoundDetailResponse(RoundResponse):
    self_total: int = 0
    self_submitted: int = 0
    audience_total: int = 0
    audience_submitted: int = 0


class BulkAssignmentItem(BaseModel):
    evaluator_user_id: int
    presenter_member_id: int


class BulkAssignmentRequest(BaseModel):
    assignments: list[BulkAssignmentItem]


class AssignmentResponse(BaseModel):
    id: int
    round_id: int
    evaluator_user_id: int | None = None
    presenter_member_id: int
    eval_type: str
    submitted_at: datetime | None = None
    presenter_name: str | None = None
    evaluator_display_name: str | None = None

    model_config = {"from_attributes": True}


class ScoreSubmitRequest(BaseModel):
    scores: dict[str, int]
    # FINAL 라운드 자기평가에서 입력하는 성장 회고 서술형 (선택)
    growth_reflection: str | None = None


class AudienceSubmitRequest(BaseModel):
    presenter_member_id: int
    scores: dict[str, int]


class MyAssignmentResponse(BaseModel):
    id: int
    round_id: int
    presenter_member_id: int
    presenter_name: str | None = None
    submitted: bool = False
    responses: dict[str, int] = {}

    model_config = {"from_attributes": True}


class DomainScores(BaseModel):
    PLANNING: float | None = None
    DESIGN: float | None = None
    SPEECH: float | None = None


class MemberResultSummary(BaseModel):
    member_id: int
    member_name: str
    self_scores: dict[str, float | None]
    audience_scores: dict[str, float | None]
    combined_scores: dict[str, float | None]


class MemberResultDetail(BaseModel):
    member_id: int
    member_name: str
    self_scores_by_question: dict[str, int | float | None]
    self_scores_by_domain: dict[str, float | None]
    audience_scores_by_question: dict[str, float | None]
    audience_scores_by_domain: dict[str, float | None]
    combined_scores_by_domain: dict[str, float | None]
    stage: str | None = None
    type: str | None = None
    growth_reflection: str | None = None
    round_type: str | None = None
    # 후기(FINAL) + compare_to 설정 시에만 채워지는 초기 결과(재귀 1단계, growth_reflection 제외)
    initial: "MemberResultDetail | None" = None


MemberResultDetail.model_rebuild()


class GrowthReflectionEntry(BaseModel):
    member_id: int
    member_name: str
    growth_reflection: str
    submitted_at: datetime | None = None


class PendingSelfEval(BaseModel):
    round_id: int
    round_title: str
    session_title: str | None = None
    submitted: bool = False
    is_open: bool = False
    results_open: bool = False


class SelfEvalForm(BaseModel):
    questions: list[dict]
    responses: dict[str, int]
    round_type: str
    growth_reflection: str | None = None


# ── Helpers ──────────────────────────────────────────────────────────────────


def _validate_scores(scores: dict[str, int]) -> None:
    """점수 유효성 검증: 9개 문항, 각 1-5점."""
    if set(scores.keys()) != VALID_QUESTION_KEYS:
        missing = VALID_QUESTION_KEYS - set(scores.keys())
        extra = set(scores.keys()) - VALID_QUESTION_KEYS
        parts = []
        if missing:
            parts.append(f"누락: {', '.join(sorted(missing))}")
        if extra:
            parts.append(f"잘못된 키: {', '.join(sorted(extra))}")
        raise HTTPException(
            status_code=400,
            detail=f"평가 문항이 올바르지 않습니다. {'; '.join(parts)}",
        )
    for key, val in scores.items():
        if not isinstance(val, int) or val < 1 or val > 5:
            raise HTTPException(
                status_code=400,
                detail=f"점수는 1~5 사이 정수여야 합니다 (문항: {key}, 입력: {val})",
            )


async def _get_round_or_404(db: AsyncSession, round_id: int) -> EvalRound:
    r = await db.get(EvalRound, round_id)
    if not r:
        raise HTTPException(status_code=404, detail="평가 라운드를 찾을 수 없습니다")
    return r


async def _get_user_by_username(db: AsyncSession, username: str) -> User:
    result = await db.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    return user


async def _build_member_result(
    db: AsyncSession,
    round_id: int,
    member_id: int,
    member_name: str,
    include_comparison: bool = True,
) -> MemberResultDetail:
    """단일 멤버의 상세 결과 구성.

    include_comparison=True이고 라운드가 FINAL + compare_to_round_id가 있으면,
    비교 대상 초기 라운드의 결과를 `initial`로 임베드한다(재귀 1단계).
    """
    round_ = await db.get(EvalRound, round_id)
    round_type = round_.round_type if round_ else None

    # 자기평가 배정 (성장 회고 서술형 포함)
    self_assign_q = await db.execute(
        select(EvalAssignment).where(
            EvalAssignment.round_id == round_id,
            EvalAssignment.presenter_member_id == member_id,
            EvalAssignment.eval_type == "SELF",
            EvalAssignment.submitted_at.isnot(None),
        )
    )
    self_assignment = self_assign_q.scalar_one_or_none()
    growth_reflection = self_assignment.growth_reflection if self_assignment else None

    # 자기평가 응답
    self_q = await db.execute(
        select(EvalResponse)
        .join(EvalAssignment)
        .where(
            EvalAssignment.round_id == round_id,
            EvalAssignment.presenter_member_id == member_id,
            EvalAssignment.eval_type == "SELF",
            EvalAssignment.submitted_at.isnot(None),
        )
    )
    self_responses = self_q.scalars().all()

    # 청중평가 응답 (복수 평가자)
    audience_assignments_q = await db.execute(
        select(EvalAssignment)
        .options(selectinload(EvalAssignment.responses))
        .where(
            EvalAssignment.round_id == round_id,
            EvalAssignment.presenter_member_id == member_id,
            EvalAssignment.eval_type == "AUDIENCE",
            EvalAssignment.submitted_at.isnot(None),
        )
    )
    audience_assignments = audience_assignments_q.scalars().all()

    # 문항별/도메인별 점수
    self_by_question = compute_question_scores(self_responses) if self_responses else {}
    self_by_domain = compute_domain_scores(self_responses) if self_responses else {d: None for d in DOMAINS}

    if audience_assignments:
        all_audience_responses = [a.responses for a in audience_assignments]
        audience_by_question = compute_avg_question_scores(all_audience_responses)
        # 도메인 평균: 전체 응답 flatten
        flat_audience = []
        for resps in all_audience_responses:
            flat_audience.extend(resps)
        audience_by_domain = compute_domain_scores(flat_audience)
    else:
        audience_by_question = {}
        audience_by_domain = {d: None for d in DOMAINS}

    combined_by_domain = compute_combined_domain_scores(self_by_domain, audience_by_domain)

    # 종합 점수 → 단계, 유형
    valid_combined = [v for v in combined_by_domain.values() if v is not None]
    overall = sum(valid_combined) / len(valid_combined) if valid_combined else None
    stage = determine_stage(overall) if overall is not None else None
    ptype = determine_type(combined_by_domain) if overall is not None else None

    # 후기 라운드면 초기 결과 비교 임베드 (재귀 1단계, 비교는 더 내려가지 않음)
    initial: MemberResultDetail | None = None
    if (
        include_comparison
        and round_ is not None
        and round_.round_type == "FINAL"
        and round_.compare_to_round_id is not None
    ):
        candidate = await _build_member_result(
            db,
            round_.compare_to_round_id,
            member_id,
            member_name,
            include_comparison=False,
        )
        # 비교 라운드에 해당 멤버 데이터가 전혀 없으면 비교 생략
        if any(v is not None for v in candidate.combined_scores_by_domain.values()):
            initial = candidate

    return MemberResultDetail(
        member_id=member_id,
        member_name=member_name,
        self_scores_by_question=self_by_question,
        self_scores_by_domain=self_by_domain,
        audience_scores_by_question=audience_by_question,
        audience_scores_by_domain=audience_by_domain,
        combined_scores_by_domain=combined_by_domain,
        stage=stage,
        type=ptype,
        growth_reflection=growth_reflection,
        round_type=round_type,
        initial=initial,
    )


# ══════════════════════════════════════════════════════════════════════════════
# Admin endpoints
# ══════════════════════════════════════════════════════════════════════════════


@router.post("/rounds", response_model=RoundResponse, status_code=201)
async def create_round(
    body: RoundCreateRequest,
    _: dict = Depends(require_admin_or_chairman),
    db: AsyncSession = Depends(get_db),
):
    """평가 라운드 생성 + 활성 멤버 전원에 SELF 배정 자동 생성."""
    # 세션 존재 확인 (session_id가 있을 때만)
    if body.session_id is not None:
        session = await db.get(Session, body.session_id)
        if not session:
            raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")

        # 중복 방지 (session_id + round_type unique)
        existing = await db.execute(
            select(EvalRound).where(
                EvalRound.session_id == body.session_id,
                EvalRound.round_type == body.round_type,
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=409,
                detail=f"이 세션에 이미 {body.round_type} 라운드가 존재합니다",
            )

    round_ = EvalRound(
        session_id=body.session_id,
        round_type=body.round_type,
        title=body.title,
        compare_to_round_id=body.compare_to_round_id,
    )
    db.add(round_)
    await db.flush()  # round_.id 확보

    # 활성 멤버 전원에 SELF 배정 생성
    members_q = await db.execute(select(Member).where(Member.is_active == True))
    members = members_q.scalars().all()

    for member in members:
        db.add(
            EvalAssignment(
                round_id=round_.id,
                evaluator_user_id=None,
                presenter_member_id=member.id,
                eval_type="SELF",
            )
        )

    # 가장 최근 라운드의 AUDIENCE 배정 자동 복사
    audience_copied = 0
    prev_round_q = await db.execute(
        select(EvalRound)
        .where(EvalRound.id != round_.id)
        .order_by(EvalRound.id.desc())
        .limit(1)
    )
    prev_round = prev_round_q.scalar_one_or_none()

    if prev_round:
        prev_q = await db.execute(
            select(EvalAssignment).where(
                EvalAssignment.round_id == prev_round.id,
                EvalAssignment.eval_type == "AUDIENCE",
            )
        )
        active_member_ids = {m.id for m in members}
        for pa in prev_q.scalars().all():
            if pa.presenter_member_id not in active_member_ids:
                continue
            db.add(
                EvalAssignment(
                    round_id=round_.id,
                    evaluator_user_id=pa.evaluator_user_id,
                    presenter_member_id=pa.presenter_member_id,
                    eval_type="AUDIENCE",
                )
            )
            audience_copied += 1

    await db.commit()
    await db.refresh(round_)
    logger.audit(  # type: ignore[attr-defined]
        f"eval_round_create id={round_.id} session={body.session_id} "
        f"type={body.round_type} self_assignments={len(members)} "
        f"audience_copied={audience_copied}"
    )
    return round_


@router.patch("/rounds/{round_id}", response_model=RoundResponse)
async def update_round(
    round_id: int,
    body: RoundUpdateRequest,
    _: dict = Depends(require_admin_or_chairman),
    db: AsyncSession = Depends(get_db),
):
    """평가 라운드 설정 변경 (열기/닫기, 결과 공개, 제목)."""
    round_ = await _get_round_or_404(db, round_id)

    if body.title is not None:
        round_.title = body.title
    if body.compare_to_round_id is not None:
        round_.compare_to_round_id = body.compare_to_round_id
    if body.hidden_member_ids is not None:
        # 빈 배열이면 전원 공개로 초기화
        round_.hidden_member_ids = body.hidden_member_ids or None
    if body.results_open is not None:
        round_.results_open = body.results_open
    if body.is_open is not None:
        if round_.is_open and not body.is_open:
            # 닫기
            round_.closed_at = datetime.now(timezone.utc)
        round_.is_open = body.is_open

    await db.commit()
    await db.refresh(round_)
    logger.audit(  # type: ignore[attr-defined]
        f"eval_round_update id={round_id} is_open={round_.is_open} results_open={round_.results_open}"
    )
    return round_


@router.delete("/rounds/{round_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_round(
    round_id: int,
    _: dict = Depends(require_admin_or_chairman),
    db: AsyncSession = Depends(get_db),
):
    """평가 라운드 삭제 (cascade: 배정, 응답 모두 삭제)."""
    round_ = await _get_round_or_404(db, round_id)
    await db.delete(round_)
    await db.commit()
    logger.audit(f"eval_round_delete id={round_id}")  # type: ignore[attr-defined]
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/rounds/{round_id}/auto-assign")
async def auto_assign_audience(
    round_id: int,
    _: dict = Depends(require_admin_or_chairman),
    db: AsyncSession = Depends(get_db),
):
    """활성 운영진 유저를 활성 멤버에 라운드로빈 배분하여 AUDIENCE 배정 생성.
    세션 연결 + 분반이 있으면 같은 분반끼리 배정."""
    round_ = await _get_round_or_404(db, round_id)

    # 활성 ops 유저
    users_q = await db.execute(
        select(User).where(User.is_active == True).order_by(User.id)
    )
    users = users_q.scalars().all()
    if not users:
        raise HTTPException(status_code=400, detail="활성 운영진 유저가 없습니다")

    # 활성 멤버
    members_q = await db.execute(
        select(Member).where(Member.is_active == True).order_by(Member.id)
    )
    members = members_q.scalars().all()
    if not members:
        raise HTTPException(status_code=400, detail="활성 멤버가 없습니다")

    # 기존 AUDIENCE 배정 조회 (중복 방지)
    existing_q = await db.execute(
        select(EvalAssignment.evaluator_user_id, EvalAssignment.presenter_member_id).where(
            EvalAssignment.round_id == round_id,
            EvalAssignment.eval_type == "AUDIENCE",
        )
    )
    existing_pairs = {(r[0], r[1]) for r in existing_q.all()}

    def _add_assignment(uid: int, mid: int) -> int:
        if (uid, mid) in existing_pairs:
            return 0
        db.add(EvalAssignment(
            round_id=round_id, evaluator_user_id=uid,
            presenter_member_id=mid, eval_type="AUDIENCE",
        ))
        return 1

    created = 0

    # 분반 로직: 세션 연결 + has_groups일 때
    session = await db.get(Session, round_.session_id) if round_.session_id else None
    cfg = (session.config or {}) if session else {}

    if session and cfg.get("has_groups"):
        # 멤버를 분반별로 분리
        att_result = await db.execute(
            select(Attendance).where(Attendance.session_id == session.id)
        )
        member_group: dict[int, int | None] = {}
        for att in att_result.scalars():
            member_group[att.member_id] = att.group_num

        group_members: dict[int | None, list] = {1: [], 2: [], None: []}
        for m in members:
            gn = member_group.get(m.id)
            group_members.setdefault(gn, []).append(m)

        # 운영진을 분반별로 분리
        staff_groups_cfg = cfg.get("staff_groups", {})
        user_group: dict[int, int | None] = {}
        for gk in ("1", "2"):
            for uid in staff_groups_cfg.get(gk, []):
                user_group[uid] = int(gk)

        group_users: dict[int | None, list] = {1: [], 2: [], None: []}
        for u in users:
            gn = user_group.get(u.id)
            group_users.setdefault(gn, []).append(u)

        # 각 분반별 라운드로빈
        for gnum in (1, 2):
            g_users = group_users.get(gnum, [])
            g_members = group_members.get(gnum, [])
            if not g_users or not g_members:
                continue
            for idx, m in enumerate(g_members):
                created += _add_assignment(g_users[idx % len(g_users)].id, m.id)

        # 미배정 멤버 → 미배정 운영진 + 전체 운영진 풀
        ungrouped_members = group_members.get(None, [])
        ungrouped_users = group_users.get(None, []) or users
        for idx, m in enumerate(ungrouped_members):
            created += _add_assignment(ungrouped_users[idx % len(ungrouped_users)].id, m.id)
    else:
        # 기존 로직: 전체 라운드로빈
        for idx, member in enumerate(members):
            user = users[idx % len(users)]
            created += _add_assignment(user.id, member.id)

    await db.commit()
    logger.audit(  # type: ignore[attr-defined]
        f"eval_auto_assign round={round_id} created={created}"
    )
    return {"created": created}


@router.post("/rounds/{round_id}/copy-assignments/{source_round_id}")
async def copy_audience_assignments(
    round_id: int,
    source_round_id: int,
    _: dict = Depends(require_admin_or_chairman),
    db: AsyncSession = Depends(get_db),
):
    """다른 라운드의 AUDIENCE 배정을 현재 라운드로 복사 (기존 배정 유지, 중복 스킵)."""
    await _get_round_or_404(db, round_id)
    await _get_round_or_404(db, source_round_id)

    # 소스 라운드의 AUDIENCE 배정 조회
    source_q = await db.execute(
        select(EvalAssignment).where(
            EvalAssignment.round_id == source_round_id,
            EvalAssignment.eval_type == "AUDIENCE",
        )
    )
    source_assignments = source_q.scalars().all()
    if not source_assignments:
        raise HTTPException(status_code=400, detail="소스 라운드에 청중평가 배정이 없습니다")

    # 현재 라운드의 기존 AUDIENCE 배정 (중복 방지)
    existing_q = await db.execute(
        select(EvalAssignment.evaluator_user_id, EvalAssignment.presenter_member_id).where(
            EvalAssignment.round_id == round_id,
            EvalAssignment.eval_type == "AUDIENCE",
        )
    )
    existing_pairs = {(r[0], r[1]) for r in existing_q.all()}

    # 활성 멤버만 복사
    active_members_q = await db.execute(
        select(Member.id).where(Member.is_active == True)
    )
    active_member_ids = {r[0] for r in active_members_q.all()}

    created = 0
    skipped = 0
    for sa in source_assignments:
        if sa.presenter_member_id not in active_member_ids:
            skipped += 1
            continue
        pair = (sa.evaluator_user_id, sa.presenter_member_id)
        if pair in existing_pairs:
            skipped += 1
            continue
        db.add(
            EvalAssignment(
                round_id=round_id,
                evaluator_user_id=sa.evaluator_user_id,
                presenter_member_id=sa.presenter_member_id,
                eval_type="AUDIENCE",
            )
        )
        created += 1

    await db.commit()
    logger.audit(  # type: ignore[attr-defined]
        f"eval_copy_assignments target={round_id} source={source_round_id} "
        f"created={created} skipped={skipped}"
    )
    return {"created": created, "skipped": skipped}


@router.post("/rounds/{round_id}/assignments/bulk")
async def bulk_add_assignments(
    round_id: int,
    body: BulkAssignmentRequest,
    _: dict = Depends(require_admin_or_chairman),
    db: AsyncSession = Depends(get_db),
):
    """AUDIENCE 배정 수동 추가 (중복 스킵)."""
    await _get_round_or_404(db, round_id)

    # 기존 배정 조회
    existing_q = await db.execute(
        select(EvalAssignment.evaluator_user_id, EvalAssignment.presenter_member_id).where(
            EvalAssignment.round_id == round_id,
            EvalAssignment.eval_type == "AUDIENCE",
        )
    )
    existing_pairs = {(r[0], r[1]) for r in existing_q.all()}

    created = 0
    skipped = 0
    for item in body.assignments:
        pair = (item.evaluator_user_id, item.presenter_member_id)
        if pair in existing_pairs:
            skipped += 1
            continue
        db.add(
            EvalAssignment(
                round_id=round_id,
                evaluator_user_id=item.evaluator_user_id,
                presenter_member_id=item.presenter_member_id,
                eval_type="AUDIENCE",
            )
        )
        existing_pairs.add(pair)
        created += 1

    await db.commit()
    logger.audit(  # type: ignore[attr-defined]
        f"eval_bulk_assign round={round_id} created={created} skipped={skipped}"
    )
    return {"created": created, "skipped": skipped}


@router.delete(
    "/rounds/{round_id}/assignments/{assignment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_assignment(
    round_id: int,
    assignment_id: int,
    _: dict = Depends(require_admin_or_chairman),
    db: AsyncSession = Depends(get_db),
):
    """단일 배정 삭제."""
    assignment = await db.get(EvalAssignment, assignment_id)
    if not assignment or assignment.round_id != round_id:
        raise HTTPException(status_code=404, detail="배정을 찾을 수 없습니다")
    if assignment.submitted_at is not None:
        raise HTTPException(status_code=409, detail="제출된 평가는 삭제할 수 없습니다.")
    await db.delete(assignment)
    await db.commit()
    logger.audit(  # type: ignore[attr-defined]
        f"eval_assignment_delete round={round_id} assignment={assignment_id}"
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class ReplaceAudienceRequest(BaseModel):
    assignments: list[BulkAssignmentItem]


@router.put("/rounds/{round_id}/audience-assignments")
async def replace_audience_assignments(
    round_id: int,
    body: ReplaceAudienceRequest,
    _: dict = Depends(require_admin_or_chairman),
    db: AsyncSession = Depends(get_db),
):
    """AUDIENCE 배정 diff 교체 — 제출 완료된 배정은 보호."""
    await _get_round_or_404(db, round_id)

    # 1) 기존 AUDIENCE 배정 조회
    existing_q = await db.execute(
        select(EvalAssignment).where(
            EvalAssignment.round_id == round_id,
            EvalAssignment.eval_type == "AUDIENCE",
        )
    )
    existing_map: dict[tuple[int, int], EvalAssignment] = {
        (a.evaluator_user_id, a.presenter_member_id): a
        for a in existing_q.scalars().all()
    }

    # 2) 요청에서 desired 집합 구성 (중복 제거)
    desired: set[tuple[int, int]] = set()
    for item in body.assignments:
        desired.add((item.evaluator_user_id, item.presenter_member_id))

    # 3) diff 계산
    to_remove = set(existing_map.keys()) - desired
    to_add = desired - set(existing_map.keys())

    # 4) 제출된 배정 삭제 시도 → 409 거부
    locked = []
    for pair in to_remove:
        a = existing_map[pair]
        if a.submitted_at is not None:
            locked.append({
                "evaluator_user_id": pair[0],
                "presenter_member_id": pair[1],
                "submitted_at": a.submitted_at.isoformat(),
            })
    if locked:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "제출된 평가가 포함되어 있어 변경할 수 없습니다.",
                "locked_assignments": locked,
            },
        )

    # 5) 미제출 배정 삭제 (응답 포함)
    remove_ids = [existing_map[pair].id for pair in to_remove]
    if remove_ids:
        await db.execute(
            delete(EvalResponse).where(EvalResponse.assignment_id.in_(remove_ids))
        )
        await db.execute(
            delete(EvalAssignment).where(EvalAssignment.id.in_(remove_ids))
        )

    # 6) 새 배정 추가
    for pair in to_add:
        db.add(EvalAssignment(
            round_id=round_id,
            evaluator_user_id=pair[0],
            presenter_member_id=pair[1],
            eval_type="AUDIENCE",
        ))

    await db.commit()
    kept = len(existing_map) - len(to_remove)
    logger.audit(  # type: ignore[attr-defined]
        f"eval_replace_audience round={round_id} deleted={len(to_remove)} created={len(to_add)} kept={kept}"
    )
    return {"deleted": len(to_remove), "created": len(to_add), "kept": kept}


# ══════════════════════════════════════════════════════════════════════════════
# Ops user endpoints (get_current_user)
# ══════════════════════════════════════════════════════════════════════════════


@router.get("/rounds", response_model=list[RoundListResponse])
async def list_rounds(
    _: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """평가 라운드 목록 (기본 통계 포함)."""
    rounds_q = await db.execute(
        select(EvalRound).order_by(EvalRound.created_at.desc())
    )
    rounds = rounds_q.scalars().all()

    results = []
    for r in rounds:
        # 통계
        stats_q = await db.execute(
            select(
                func.count(EvalAssignment.id),
                func.count(EvalAssignment.submitted_at),
            ).where(EvalAssignment.round_id == r.id)
        )
        total, submitted = stats_q.one()
        results.append(
            RoundListResponse(
                id=r.id,
                session_id=r.session_id,
                round_type=r.round_type,
                title=r.title,
                is_open=r.is_open,
                results_open=r.results_open,
                created_at=r.created_at,
                closed_at=r.closed_at,
                total_assignments=total,
                submitted_count=submitted,
            )
        )
    return results


@router.get("/rounds/{round_id}", response_model=RoundDetailResponse)
async def get_round_detail(
    round_id: int,
    _: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """평가 라운드 상세 (타입별 제출 통계)."""
    round_ = await _get_round_or_404(db, round_id)

    # SELF 통계
    self_stats_q = await db.execute(
        select(
            func.count(EvalAssignment.id),
            func.count(EvalAssignment.submitted_at),
        ).where(
            EvalAssignment.round_id == round_id,
            EvalAssignment.eval_type == "SELF",
        )
    )
    self_total, self_submitted = self_stats_q.one()

    # AUDIENCE 통계
    aud_stats_q = await db.execute(
        select(
            func.count(EvalAssignment.id),
            func.count(EvalAssignment.submitted_at),
        ).where(
            EvalAssignment.round_id == round_id,
            EvalAssignment.eval_type == "AUDIENCE",
        )
    )
    aud_total, aud_submitted = aud_stats_q.one()

    return RoundDetailResponse(
        id=round_.id,
        session_id=round_.session_id,
        round_type=round_.round_type,
        title=round_.title,
        is_open=round_.is_open,
        results_open=round_.results_open,
        created_at=round_.created_at,
        closed_at=round_.closed_at,
        self_total=self_total,
        self_submitted=self_submitted,
        audience_total=aud_total,
        audience_submitted=aud_submitted,
    )


@router.get("/rounds/{round_id}/assignments", response_model=list[AssignmentResponse])
async def list_assignments(
    round_id: int,
    _: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """라운드의 모든 배정 조회 (멤버명, 평가자명 포함)."""
    await _get_round_or_404(db, round_id)

    q = await db.execute(
        select(EvalAssignment)
        .options(
            selectinload(EvalAssignment.presenter),
            selectinload(EvalAssignment.evaluator),
        )
        .where(EvalAssignment.round_id == round_id)
        .order_by(EvalAssignment.eval_type, EvalAssignment.id)
    )
    assignments = q.scalars().all()

    return [
        AssignmentResponse(
            id=a.id,
            round_id=a.round_id,
            evaluator_user_id=a.evaluator_user_id,
            presenter_member_id=a.presenter_member_id,
            eval_type=a.eval_type,
            submitted_at=a.submitted_at,
            presenter_name=a.presenter.name if a.presenter else None,
            evaluator_display_name=a.evaluator.display_name if a.evaluator else None,
        )
        for a in assignments
    ]


@router.get("/rounds/{round_id}/my-assignments", response_model=list[MyAssignmentResponse])
async def my_assignments(
    round_id: int,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """내가 배정된 AUDIENCE 평가 목록."""
    await _get_round_or_404(db, round_id)

    # username → User.id
    db_user = await _get_user_by_username(db, user["username"])

    q = await db.execute(
        select(EvalAssignment)
        .options(
            selectinload(EvalAssignment.presenter),
            selectinload(EvalAssignment.responses),
        )
        .where(
            EvalAssignment.round_id == round_id,
            EvalAssignment.evaluator_user_id == db_user.id,
            EvalAssignment.eval_type == "AUDIENCE",
        )
        .order_by(EvalAssignment.id)
    )
    assignments = q.scalars().all()

    return [
        MyAssignmentResponse(
            id=a.id,
            round_id=a.round_id,
            presenter_member_id=a.presenter_member_id,
            presenter_name=a.presenter.name if a.presenter else None,
            submitted=a.submitted_at is not None,
            responses={r.question_key: r.score for r in a.responses},
        )
        for a in assignments
    ]


@router.post("/rounds/{round_id}/audience-submit")
async def audience_submit(
    round_id: int,
    body: AudienceSubmitRequest,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """청중 평가 제출 (upsert)."""
    round_ = await _get_round_or_404(db, round_id)

    if not round_.is_open:
        raise HTTPException(status_code=400, detail="평가가 마감되었습니다")

    _validate_scores(body.scores)

    db_user = await _get_user_by_username(db, user["username"])

    # 배정 확인
    assign_q = await db.execute(
        select(EvalAssignment).where(
            EvalAssignment.round_id == round_id,
            EvalAssignment.evaluator_user_id == db_user.id,
            EvalAssignment.presenter_member_id == body.presenter_member_id,
            EvalAssignment.eval_type == "AUDIENCE",
        )
    )
    assignment = assign_q.scalar_one_or_none()
    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="해당 발표자에 대한 평가 배정을 찾을 수 없습니다",
        )

    # 기존 응답 삭제 후 새로 입력
    await db.execute(
        delete(EvalResponse).where(EvalResponse.assignment_id == assignment.id)
    )
    for key, score in body.scores.items():
        db.add(
            EvalResponse(
                assignment_id=assignment.id,
                question_key=key,
                score=score,
            )
        )
    assignment.submitted_at = datetime.now(timezone.utc)

    await db.commit()
    logger.info(
        f"audience_submit round={round_id} evaluator={db_user.id} presenter={body.presenter_member_id}"
    )
    return {"status": "ok"}


@router.get("/rounds/{round_id}/results", response_model=list[MemberResultSummary])
async def get_round_results(
    round_id: int,
    _: dict = Depends(require_staff),
    db: AsyncSession = Depends(get_db),
):
    """라운드 전체 결과 (멤버별 도메인 점수)."""
    round_ = await _get_round_or_404(db, round_id)

    # 배정된 모든 멤버
    members_q = await db.execute(
        select(Member.id, Member.name)
        .join(EvalAssignment, EvalAssignment.presenter_member_id == Member.id)
        .where(EvalAssignment.round_id == round_id)
        .distinct()
        .order_by(Member.name)
    )
    member_rows = members_q.all()

    results = []
    for mid, mname in member_rows:
        # 자기평가 응답
        self_q = await db.execute(
            select(EvalResponse)
            .join(EvalAssignment)
            .where(
                EvalAssignment.round_id == round_id,
                EvalAssignment.presenter_member_id == mid,
                EvalAssignment.eval_type == "SELF",
                EvalAssignment.submitted_at.isnot(None),
            )
        )
        self_responses = self_q.scalars().all()

        # 청중평가 응답
        aud_q = await db.execute(
            select(EvalResponse)
            .join(EvalAssignment)
            .where(
                EvalAssignment.round_id == round_id,
                EvalAssignment.presenter_member_id == mid,
                EvalAssignment.eval_type == "AUDIENCE",
                EvalAssignment.submitted_at.isnot(None),
            )
        )
        aud_responses = aud_q.scalars().all()

        self_domain = compute_domain_scores(self_responses) if self_responses else {d: None for d in DOMAINS}
        aud_domain = compute_domain_scores(aud_responses) if aud_responses else {d: None for d in DOMAINS}
        combined = compute_combined_domain_scores(self_domain, aud_domain)

        results.append(
            MemberResultSummary(
                member_id=mid,
                member_name=mname,
                self_scores=self_domain,
                audience_scores=aud_domain,
                combined_scores=combined,
            )
        )

    return results


@router.get(
    "/rounds/{round_id}/reflections",
    response_model=list[GrowthReflectionEntry],
)
async def get_round_reflections(
    round_id: int,
    _: dict = Depends(require_staff),
    db: AsyncSession = Depends(get_db),
):
    """라운드의 자기평가 성장 회고 서술형 응답 모음 (제출 + 비어있지 않음만)."""
    await _get_round_or_404(db, round_id)
    q = await db.execute(
        select(EvalAssignment, Member)
        .join(Member, Member.id == EvalAssignment.presenter_member_id)
        .where(
            EvalAssignment.round_id == round_id,
            EvalAssignment.eval_type == "SELF",
            EvalAssignment.submitted_at.isnot(None),
            EvalAssignment.growth_reflection.isnot(None),
        )
        .order_by(Member.name)
    )
    return [
        GrowthReflectionEntry(
            member_id=m.id,
            member_name=m.name,
            growth_reflection=a.growth_reflection,
            submitted_at=a.submitted_at,
        )
        for a, m in q.all()
        if a.growth_reflection and a.growth_reflection.strip()
    ]


@router.get("/rounds/{round_id}/results/{member_id}", response_model=MemberResultDetail)
async def get_member_result(
    round_id: int,
    member_id: int,
    _: dict = Depends(require_staff),
    db: AsyncSession = Depends(get_db),
):
    """단일 멤버 상세 결과 (운영진 조회용)."""
    await _get_round_or_404(db, round_id)

    member = await db.get(Member, member_id)
    if not member:
        raise HTTPException(status_code=404, detail="멤버를 찾을 수 없습니다")

    return await _build_member_result(db, round_id, member.id, member.name)


# ══════════════════════════════════════════════════════════════════════════════
# Member endpoints (get_current_member — 기수 계정)
# ══════════════════════════════════════════════════════════════════════════════


@router.get("/member/pending", response_model=list[PendingSelfEval])
async def member_pending_evals(
    member: dict = Depends(get_current_member),
    db: AsyncSession = Depends(get_db),
):
    """내 자기평가 목록 (열린 라운드 + 결과 공개 라운드)."""
    q = await db.execute(
        select(EvalAssignment, EvalRound, Session)
        .join(EvalRound, EvalAssignment.round_id == EvalRound.id)
        .outerjoin(Session, EvalRound.session_id == Session.id)
        .where(
            EvalAssignment.presenter_member_id == member["member_id"],
            EvalAssignment.eval_type == "SELF",
            or_(EvalRound.is_open == True, EvalRound.results_open == True),
        )
        .order_by(EvalRound.created_at.desc())
    )
    rows = q.all()

    return [
        PendingSelfEval(
            round_id=r.id,
            round_title=r.title,
            session_title=s.title if s else None,
            submitted=a.submitted_at is not None,
            is_open=r.is_open,
            # 결과 비공개 대상(결석자 등)에게는 결과 공개 버튼 숨김
            results_open=r.results_open and member["member_id"] not in (r.hidden_member_ids or []),
        )
        for a, r, s in rows
    ]


@router.get("/member/round/{round_id}", response_model=SelfEvalForm)
async def member_self_eval_form(
    round_id: int,
    member: dict = Depends(get_current_member),
    db: AsyncSession = Depends(get_db),
):
    """자기평가 폼 (질문 + 기존 응답)."""
    round_ = await _get_round_or_404(db, round_id)

    # SELF 배정 확인
    assign_q = await db.execute(
        select(EvalAssignment)
        .options(selectinload(EvalAssignment.responses))
        .where(
            EvalAssignment.round_id == round_id,
            EvalAssignment.presenter_member_id == member["member_id"],
            EvalAssignment.eval_type == "SELF",
        )
    )
    assignment = assign_q.scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=404, detail="자기평가 배정을 찾을 수 없습니다")

    # 질문 목록 (self_text 사용)
    questions = [
        {
            "key": q["key"],
            "domain": q["domain"],
            "label": q["label"],
            "text": q["self_text"],
            "order": q["order"],
        }
        for q in EVAL_QUESTIONS
    ]

    existing_responses = {r.question_key: r.score for r in assignment.responses}

    return SelfEvalForm(
        questions=questions,
        responses=existing_responses,
        round_type=round_.round_type,
        growth_reflection=assignment.growth_reflection,
    )


@router.post("/member/round/{round_id}/submit")
async def member_self_eval_submit(
    round_id: int,
    body: ScoreSubmitRequest,
    member: dict = Depends(get_current_member),
    db: AsyncSession = Depends(get_db),
):
    """자기평가 제출."""
    round_ = await _get_round_or_404(db, round_id)

    if not round_.is_open:
        raise HTTPException(status_code=400, detail="평가가 마감되었습니다")

    _validate_scores(body.scores)

    # FINAL 라운드에 한해 성장 회고 서술형 필수 입력 검증
    reflection_text: str | None = None
    if round_.round_type == "FINAL":
        reflection_text = (body.growth_reflection or "").strip()
        if not reflection_text:
            raise HTTPException(
                status_code=400,
                detail="성장 회고 응답은 필수입니다. 서술형 답변을 입력해 주세요.",
            )

    # SELF 배정 확인
    assign_q = await db.execute(
        select(EvalAssignment).where(
            EvalAssignment.round_id == round_id,
            EvalAssignment.presenter_member_id == member["member_id"],
            EvalAssignment.eval_type == "SELF",
        )
    )
    assignment = assign_q.scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=404, detail="자기평가 배정을 찾을 수 없습니다")

    # upsert: 기존 삭제 후 새로 입력
    await db.execute(
        delete(EvalResponse).where(EvalResponse.assignment_id == assignment.id)
    )
    for key, score in body.scores.items():
        db.add(
            EvalResponse(
                assignment_id=assignment.id,
                question_key=key,
                score=score,
            )
        )
    assignment.submitted_at = datetime.now(timezone.utc)

    if round_.round_type == "FINAL":
        assignment.growth_reflection = reflection_text

    await db.commit()
    logger.info(f"self_eval_submit round={round_id} member={member['member_id']}")
    return {"status": "ok"}


@router.get("/member/round/{round_id}/result", response_model=MemberResultDetail)
async def member_self_result(
    round_id: int,
    member: dict = Depends(get_current_member),
    db: AsyncSession = Depends(get_db),
):
    """본인 결과 조회 (results_open == True 일 때만)."""
    round_ = await _get_round_or_404(db, round_id)

    if not round_.results_open:
        raise HTTPException(status_code=403, detail="아직 결과가 공개되지 않았습니다")

    # 결과 비공개 대상(당일 결석자 등)은 공개돼도 본인 결과 접근 차단
    if member["member_id"] in (round_.hidden_member_ids or []):
        raise HTTPException(status_code=403, detail="아직 결과가 공개되지 않았습니다")

    member_obj = await db.get(Member, member["member_id"])
    if not member_obj:
        raise HTTPException(status_code=404, detail="멤버를 찾을 수 없습니다")

    return await _build_member_result(db, round_id, member_obj.id, member_obj.name)
