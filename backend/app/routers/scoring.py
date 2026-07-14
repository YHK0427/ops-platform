"""심사·점수 집계 — 공개 링크(무로그인) 채점 폼 + 운영진 실시간 집계 대시보드.

이 코드베이스에서 유일하게 **무로그인 쓰기(POST)를 허용하는 공개 표면**이다.
따라서 다음 방어선을 반드시 유지할 것:

1. 공개 엔드포인트는 `public_token`(secrets.token_urlsafe(32))으로만 라운드에 도달한다.
   추측 불가능한 128bit 이상 난수이므로 URL 자체가 자격증명이다.
2. 닫힌 라운드(is_open=False)에는 조회/제출 모두 거절.
3. 레이트 리밋(check_public_rate) — 단, 같은 WiFi에서 수십 명이 동시 접속하는 게
   정상이므로 한도는 넉넉하게.
4. 공개 응답에 명단(roster)·다른 사람의 점수·기수 내부 정보를 절대 싣지 않는다.

집계 규칙은 services/scoring_engine.py 참조.
"""
import logging
import secrets
from datetime import datetime, timezone
from difflib import SequenceMatcher

from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import AsyncSessionLocal
from app.deps import (
    check_public_rate, decode_ws_token, get_current_cohort_id, get_db, get_real_ip, require_staff,
)
from app.models import (
    Member, ScoringComment, ScoringCriterion, ScoringParticipant, ScoringRank,
    ScoringRosterEntry, ScoringRound, ScoringScore, ScoringTarget,
    Session as SessionModel, Team, TeamMember, User,
)
from app.services.scoring_engine import (
    CriterionLite, ParticipantLite, RankLite, ScoreLite, compute_results,
)
from app.services.scoring_ws import manager

logger = logging.getLogger("scoring")

router = APIRouter(prefix="/scoring", tags=["scoring"])
public_router = APIRouter(prefix="/public/scoring", tags=["scoring-public"])

MAX_COMMENT_LEN = 2000

# 최종 총점은 항상 100점. 심사위원 비중 + 참관위원 비중 = 100 을 서버에서 강제한다.
TOTAL_WEIGHT = 100.0

# 참가자에게 보이는 기본 안내문. 운영자가 자유롭게 고칠 수 있으므로 여기엔
# 설정에 따라 달라지는 내용(등수 개수·비중·그룹 등)은 적지 않는다 — 화면과 말이 어긋나면 안 되니까.
DEFAULT_INTRO = (
    "아래 안내를 읽고 채점해 주세요.\n\n"
    "• 이름을 입력하고 역할을 선택하면 채점이 시작됩니다.\n"
    "• 제출 후에도 마감 전까지는 수정할 수 있습니다. "
    "다시 접속해 처음에 입력한 이름과 똑같이 입력하면 기존에 매긴 점수를 불러옵니다.\n"
    "• 같은 기기·같은 브라우저로 다시 들어오면 이름을 입력하지 않아도 바로 이어서 수정할 수 있습니다."
)


# ── Schemas ──────────────────────────────────────────────────────────────────

class CriterionIn(BaseModel):
    id: int | None = None
    label: str = Field(..., max_length=100)
    description: str | None = None
    max_score: float = Field(..., gt=0)


class CriterionOut(BaseModel):
    id: int
    label: str
    description: str | None = None
    max_score: float
    order_num: int
    model_config = {"from_attributes": True}


class TargetIn(BaseModel):
    id: int | None = None
    name: str = Field(..., max_length=100)
    display_name: str | None = Field(None, max_length=100)


class TargetOut(BaseModel):
    id: int
    name: str
    display_name: str | None = None
    order_num: int
    team_id: int | None = None
    member_ids: list[int] = []
    member_names: list[str] = []
    model_config = {"from_attributes": True}


class RosterIn(BaseModel):
    id: int | None = None
    name: str = Field(..., max_length=50)
    role: str = Field("ANY", pattern=r"^(JUDGE|OBSERVER|ANY)$")
    member_id: int | None = None
    note: str | None = Field(None, max_length=100)
    group_label: str | None = Field(None, max_length=30)


class RosterOut(BaseModel):
    id: int
    name: str
    role: str
    member_id: int | None = None
    note: str | None = None
    group_label: str | None = None
    model_config = {"from_attributes": True}


class RankPoint(BaseModel):
    rank: int = Field(..., ge=1)
    points: float = Field(..., ge=0)


class RoundCreate(BaseModel):
    name: str = Field(..., max_length=100)
    session_id: int | None = None


class RoundUpdate(BaseModel):
    name: str | None = Field(None, max_length=100)
    intro: str | None = None
    session_id: int | None = None
    judge_weight: float | None = Field(None, ge=0)
    observer_weight: float | None = Field(None, ge=0)
    observer_mode: str | None = Field(None, pattern=r"^(SCORE|RANK)$")
    rank_points: list[RankPoint] | None = None
    exclude_own_team: bool | None = None
    observer_groups: list[str] | None = None


class RoundOut(BaseModel):
    id: int
    name: str
    intro: str | None = None
    session_id: int | None = None
    session_label: str | None = None
    public_token: str
    is_open: bool
    judge_weight: float
    observer_weight: float
    observer_mode: str
    rank_points: list[RankPoint]
    exclude_own_team: bool
    observer_groups: list[str] = []
    criteria: list[CriterionOut] = []
    targets: list[TargetOut] = []
    roster: list[RosterOut] = []
    submitted_count: int = 0
    created_at: datetime | None = None


class RoundListItem(BaseModel):
    id: int
    name: str
    session_label: str | None = None
    public_token: str
    is_open: bool
    target_count: int
    submitted_count: int
    created_at: datetime | None = None


class ParticipantOut(BaseModel):
    id: int
    role: str
    entered_name: str
    group_label: str | None = None
    matched_roster_id: int | None = None
    matched_member_id: int | None = None
    is_proxy: bool
    proxy_by: str | None = None
    submitted_at: datetime | None = None
    # 자동 매칭이 실패했을 때 제시할 후보 (운영진 보정용)
    suggestions: list[RosterOut] = []


class ParticipantPatch(BaseModel):
    matched_roster_id: int | None = None
    role: str | None = Field(None, pattern=r"^(JUDGE|OBSERVER)$")
    group_label: str | None = Field(None, max_length=30)


class SubmissionStatus(BaseModel):
    participants: list[ParticipantOut]
    roster: list[RosterOut]
    # roster_id → participant_id (제출 완료된 것만). 체크리스트 렌더링용.
    roster_submitted: dict[int, int]


class ScoreIn(BaseModel):
    target_id: int
    criterion_id: int
    score: float = Field(..., ge=0)


class RankIn(BaseModel):
    target_id: int
    rank: int = Field(..., ge=1)


class CommentIn(BaseModel):
    target_id: int
    criterion_id: int | None = None  # None = 팀 총평
    body: str = Field(..., max_length=MAX_COMMENT_LEN)


class SubmissionIn(BaseModel):
    scores: list[ScoreIn] = []
    ranks: list[RankIn] = []
    comments: list[CommentIn] = []


class PublicSubmissionIn(SubmissionIn):
    participant_token: str


class IdentifyIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)
    role: str = Field(..., pattern=r"^(JUDGE|OBSERVER)$")
    group_label: str | None = Field(None, max_length=30)  # 참관위원 소그룹


class MySubmission(BaseModel):
    """공개 폼이 기존 제출분을 복원할 때 쓰는 응답."""
    participant_token: str
    role: str
    entered_name: str
    group_label: str | None = None
    submitted: bool
    scores: list[ScoreIn] = []
    ranks: list[RankIn] = []
    comments: list[CommentIn] = []
    # 자기팀 제외가 켜져 있을 때, 이 사람이 채점할 수 없는 target_id 목록
    blocked_target_ids: list[int] = []


class IdentifyOut(MySubmission):
    existing: bool  # true면 프론트가 "점수를 수정하시겠습니까?" 확인창을 띄운다


class PublicCriterion(BaseModel):
    id: int
    label: str
    description: str | None = None
    max_score: float


class PublicTarget(BaseModel):
    id: int
    name: str
    members: list[str] = []  # 팀원 이름 — 심사위원이 어느 팀인지 알아보게


class PublicRound(BaseModel):
    """공개 폼용 — 명단·점수·기수 정보는 절대 포함하지 않는다."""
    name: str
    intro: str | None = None
    is_open: bool
    observer_mode: str
    rank_slots: list[int]  # RANK 모드에서 선택해야 할 등수 목록 [1,2,3]
    observer_groups: list[str] = []  # 비어 있으면 참관위원에게 그룹을 묻지 않는다
    criteria: list[PublicCriterion]
    targets: list[PublicTarget]


class ProxySubmitIn(SubmissionIn):
    """운영진 대리 입력 — 기존 참가자 지정(participant_id) 또는 새 이름으로 생성."""
    participant_id: int | None = None
    name: str | None = Field(None, max_length=50)
    role: str | None = Field(None, pattern=r"^(JUDGE|OBSERVER)$")
    group_label: str | None = Field(None, max_length=30)


class JudgeDetail(BaseModel):
    participant_id: int
    name: str
    role: str
    is_proxy: bool
    # target_id → 이 사람이 준 총점(원점수 합). 채점 안 한 팀은 없음.
    totals: dict[int, float]


class TargetComment(BaseModel):
    participant_name: str
    role: str
    criterion_id: int | None = None
    body: str


class TargetResultOut(BaseModel):
    target_id: int
    name: str
    judge_points: float
    observer_points: float
    total: float
    rank: int
    judge_count: int
    observer_count: int
    criterion_avg: dict[int, float]
    rank_votes: dict[int, int]
    comments: list[TargetComment] = []


class SubmitterLite(BaseModel):
    """결과 화면에서 '누가 어떻게 냈는지' 개별로 열어보기 위한 목록."""
    participant_id: int
    name: str
    role: str
    group_label: str | None = None
    submitted_at: datetime | None = None


class ResultsOut(BaseModel):
    round: RoundOut
    results: list[TargetResultOut]
    judges: list[JudgeDetail]
    submitters: list[SubmitterLite] = []
    judge_submitted: int
    observer_submitted: int
    # 참관위원 소그룹별 제출 인원 {"운영진": 3, "청중": 12, ...} — 분류용 표시일 뿐 집계엔 영향 없음
    observer_by_group: dict[str, int] = {}
    roster_total: int


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _get_round_or_404(round_id: int, db: AsyncSession, cohort_id: int) -> ScoringRound:
    stmt = (
        select(ScoringRound)
        .where(ScoringRound.id == round_id, ScoringRound.cohort_id == cohort_id)
        .options(
            selectinload(ScoringRound.criteria),
            selectinload(ScoringRound.targets),
            selectinload(ScoringRound.roster),
        )
        # populate_existing 필수 — 세션이 expire_on_commit=False 라서, 저장 직후 다시 조회하면
        # 아까 로드해 둔(비어 있던) 컬렉션이 그대로 재사용돼 방금 추가한 행이 응답에서 누락된다.
        .execution_options(populate_existing=True)
    )
    rnd = (await db.execute(stmt)).scalar_one_or_none()
    if rnd is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "심사 라운드를 찾을 수 없습니다")
    return rnd


def _norm(name: str) -> str:
    """이름 매칭용 정규화 — 공백 제거 + 소문자."""
    return "".join(name.split()).lower()


def _match_roster(name: str, role: str, roster: list[ScoringRosterEntry]) -> tuple[ScoringRosterEntry | None, list[ScoringRosterEntry]]:
    """명단 자동 매칭. 완전 일치 우선, 실패 시 유사도 후보 반환.

    반환: (확정 매칭 | None, 후보 목록)
    """
    target = _norm(name)
    eligible = [r for r in roster if r.role in (role, "ANY")]

    exact = [r for r in eligible if _norm(r.name) == target]
    if len(exact) == 1:
        return exact[0], []
    if len(exact) > 1:
        # 동명이인 — 운영진이 골라야 한다
        return None, exact

    # 오타 대비 — 유사도 후보 (0.6 이상, 상위 5개)
    scored = [
        (SequenceMatcher(None, target, _norm(r.name)).ratio(), r)
        for r in eligible
    ]
    cands = [r for score, r in sorted(scored, key=lambda x: -x[0]) if score >= 0.6][:5]
    return None, cands


def _blocked_targets(rnd: ScoringRound, member_id: int | None) -> list[int]:
    """자기팀 제외가 켜져 있을 때 이 사람이 채점할 수 없는 팀."""
    if not rnd.exclude_own_team or member_id is None:
        return []
    return [t.id for t in rnd.targets if member_id in (t.member_ids or [])]


def _rank_slots(rnd: ScoringRound) -> list[int]:
    return sorted(int(rp["rank"]) for rp in (rnd.rank_points or []))


def _tname(t: ScoringTarget) -> str:
    """폼·결과에 보이는 팀 이름 — 표시명을 정했으면 그걸, 아니면 원본 팀명."""
    return (t.display_name or "").strip() or t.name


async def _session_label(db: AsyncSession, session_id: int | None) -> str | None:
    if session_id is None:
        return None
    s = await db.get(SessionModel, session_id)
    return f"{s.week_num}주차 · {s.title}" if s else None


async def _submitted_count(db: AsyncSession, round_id: int) -> int:
    return (await db.execute(
        select(func.count(ScoringParticipant.id)).where(
            ScoringParticipant.round_id == round_id,
            ScoringParticipant.submitted_at.isnot(None),
        )
    )).scalar_one()


async def _round_out(db: AsyncSession, rnd: ScoringRound) -> RoundOut:
    return RoundOut(
        id=rnd.id,
        name=rnd.name,
        intro=rnd.intro,
        session_id=rnd.session_id,
        session_label=await _session_label(db, rnd.session_id),
        public_token=rnd.public_token,
        is_open=rnd.is_open,
        judge_weight=float(rnd.judge_weight),
        observer_weight=float(rnd.observer_weight),
        observer_mode=rnd.observer_mode,
        rank_points=[RankPoint(**rp) for rp in (rnd.rank_points or [])],
        exclude_own_team=rnd.exclude_own_team,
        observer_groups=list(rnd.observer_groups or []),
        criteria=[CriterionOut.model_validate(c) for c in sorted(rnd.criteria, key=lambda c: c.order_num)],
        targets=[TargetOut.model_validate(t) for t in sorted(rnd.targets, key=lambda t: t.order_num)],
        roster=[RosterOut.model_validate(r) for r in rnd.roster],
        submitted_count=await _submitted_count(db, rnd.id),
        created_at=rnd.created_at,
    )


async def _load_submission(db: AsyncSession, p: ScoringParticipant) -> tuple[list[ScoreIn], list[RankIn], list[CommentIn]]:
    scores = (await db.execute(
        select(ScoringScore).where(ScoringScore.participant_id == p.id)
    )).scalars().all()
    ranks = (await db.execute(
        select(ScoringRank).where(ScoringRank.participant_id == p.id)
    )).scalars().all()
    comments = (await db.execute(
        select(ScoringComment).where(ScoringComment.participant_id == p.id)
    )).scalars().all()
    return (
        [ScoreIn(target_id=s.target_id, criterion_id=s.criterion_id, score=float(s.score)) for s in scores],
        [RankIn(target_id=r.target_id, rank=r.rank) for r in ranks],
        [CommentIn(target_id=c.target_id, criterion_id=c.criterion_id, body=c.body) for c in comments],
    )


async def _save_submission(
    db: AsyncSession, rnd: ScoringRound, p: ScoringParticipant, body: SubmissionIn,
) -> None:
    """제출 저장 (전체 교체 upsert). 유효성 검증 후 기존 값을 지우고 새로 넣는다."""
    valid_targets = {t.id for t in rnd.targets}
    valid_criteria = {c.id: float(c.max_score) for c in rnd.criteria}
    blocked = set(_blocked_targets(rnd, p.matched_member_id))

    for s in body.scores:
        if s.target_id not in valid_targets:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "존재하지 않는 심사 대상입니다")
        if s.target_id in blocked:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "본인 소속 팀은 채점할 수 없습니다")
        if s.criterion_id not in valid_criteria:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "존재하지 않는 심사 기준입니다")
        if s.score > valid_criteria[s.criterion_id]:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"배점({valid_criteria[s.criterion_id]:g}점)을 초과한 점수입니다",
            )

    for r in body.ranks:
        if r.target_id not in valid_targets:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "존재하지 않는 심사 대상입니다")
        if r.target_id in blocked:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "본인 소속 팀은 선택할 수 없습니다")
    slots = set(_rank_slots(rnd))
    if len({r.rank for r in body.ranks}) != len(body.ranks):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "같은 등수를 두 번 선택할 수 없습니다")
    if len({r.target_id for r in body.ranks}) != len(body.ranks):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "같은 팀을 여러 등수에 선택할 수 없습니다")
    for r in body.ranks:
        if r.rank not in slots:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "선택할 수 없는 등수입니다")

    for c in body.comments:
        if c.target_id not in valid_targets:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "존재하지 않는 심사 대상입니다")
        if c.criterion_id is not None and c.criterion_id not in valid_criteria:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "존재하지 않는 심사 기준입니다")

    # 전체 교체 — 부분 수정보다 단순하고, 폼이 항상 전체 상태를 보내므로 안전
    await db.execute(delete(ScoringScore).where(ScoringScore.participant_id == p.id))
    await db.execute(delete(ScoringRank).where(ScoringRank.participant_id == p.id))
    await db.execute(delete(ScoringComment).where(ScoringComment.participant_id == p.id))

    for s in body.scores:
        db.add(ScoringScore(participant_id=p.id, target_id=s.target_id,
                            criterion_id=s.criterion_id, score=s.score))
    for r in body.ranks:
        db.add(ScoringRank(participant_id=p.id, target_id=r.target_id, rank=r.rank))
    for c in body.comments:
        if c.body.strip():
            db.add(ScoringComment(participant_id=p.id, target_id=c.target_id,
                                  criterion_id=c.criterion_id, body=c.body.strip()))

    p.submitted_at = datetime.now(timezone.utc)


# ── 운영진: 라운드 CRUD ───────────────────────────────────────────────────────

@router.get("/rounds", response_model=list[RoundListItem])
async def list_rounds(
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    rounds = (await db.execute(
        select(ScoringRound)
        .where(ScoringRound.cohort_id == cohort_id)
        .options(selectinload(ScoringRound.targets))
        .order_by(ScoringRound.created_at.desc())
    )).scalars().all()

    out = []
    for r in rounds:
        out.append(RoundListItem(
            id=r.id,
            name=r.name,
            session_label=await _session_label(db, r.session_id),
            public_token=r.public_token,
            is_open=r.is_open,
            target_count=len(r.targets),
            submitted_count=await _submitted_count(db, r.id),
            created_at=r.created_at,
        ))
    return out


@router.post("/rounds", response_model=RoundOut, status_code=status.HTTP_201_CREATED)
async def create_round(
    body: RoundCreate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    if body.session_id is not None:
        s = (await db.execute(
            select(SessionModel).where(
                SessionModel.id == body.session_id, SessionModel.cohort_id == cohort_id
            )
        )).scalar_one_or_none()
        if s is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "세션을 찾을 수 없습니다")

    rnd = ScoringRound(
        cohort_id=cohort_id,
        session_id=body.session_id,
        name=body.name,
        intro=DEFAULT_INTRO,
        public_token=secrets.token_urlsafe(32),
    )
    db.add(rnd)
    await db.commit()
    await db.refresh(rnd)

    # 세션 연동이면 그 세션의 팀을 바로 심사 대상으로 임포트
    if body.session_id is not None:
        await _import_session_teams(db, rnd, body.session_id, cohort_id)
        await db.commit()

    rnd = await _get_round_or_404(rnd.id, db, cohort_id)
    return await _round_out(db, rnd)


@router.get("/rounds/{round_id}", response_model=RoundOut)
async def get_round(
    round_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    rnd = await _get_round_or_404(round_id, db, cohort_id)
    return await _round_out(db, rnd)


@router.patch("/rounds/{round_id}", response_model=RoundOut)
async def update_round(
    round_id: int,
    body: RoundUpdate,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    rnd = await _get_round_or_404(round_id, db, cohort_id)
    data = body.model_dump(exclude_unset=True)

    if "rank_points" in data and data["rank_points"] is not None:
        pts = data["rank_points"]
        if not pts:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "등수 배점을 최소 1개 지정해야 합니다")
        if len({p["rank"] for p in pts}) != len(pts):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "등수가 중복됩니다")
        data["rank_points"] = sorted(pts, key=lambda p: p["rank"])

    if data.get("session_id") is not None:
        s = (await db.execute(
            select(SessionModel).where(
                SessionModel.id == data["session_id"], SessionModel.cohort_id == cohort_id
            )
        )).scalar_one_or_none()
        if s is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "세션을 찾을 수 없습니다")

    # 총점은 항상 100 — 심사위원 + 참관위원 비중 합계를 강제한다
    jw = data.get("judge_weight", float(rnd.judge_weight))
    ow = data.get("observer_weight", float(rnd.observer_weight))
    if abs((jw + ow) - TOTAL_WEIGHT) > 0.01:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"심사위원 + 참관위원 비중 합계는 {TOTAL_WEIGHT:g}점이어야 합니다 (현재 {jw + ow:g}점)",
        )

    for k, v in data.items():
        setattr(rnd, k, v)
    await db.commit()

    rnd = await _get_round_or_404(round_id, db, cohort_id)
    await manager.broadcast(round_id, {"type": "config.changed"})
    return await _round_out(db, rnd)


@router.delete("/rounds/{round_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_round(
    round_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    rnd = await _get_round_or_404(round_id, db, cohort_id)
    await db.delete(rnd)
    await db.commit()


@router.post("/rounds/{round_id}/open", response_model=RoundOut)
async def open_round(
    round_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    rnd = await _get_round_or_404(round_id, db, cohort_id)
    if not rnd.criteria:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "심사 기준을 1개 이상 등록해야 링크를 열 수 있습니다")
    if not rnd.targets:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "심사 대상을 1개 이상 등록해야 링크를 열 수 있습니다")
    rnd.is_open = True
    rnd.opened_at = datetime.now(timezone.utc)
    rnd.closed_at = None
    await db.commit()
    rnd = await _get_round_or_404(round_id, db, cohort_id)
    await manager.broadcast(round_id, {"type": "round.opened"})
    return await _round_out(db, rnd)


@router.post("/rounds/{round_id}/close", response_model=RoundOut)
async def close_round(
    round_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    rnd = await _get_round_or_404(round_id, db, cohort_id)
    rnd.is_open = False
    rnd.closed_at = datetime.now(timezone.utc)
    await db.commit()
    rnd = await _get_round_or_404(round_id, db, cohort_id)
    await manager.broadcast(round_id, {"type": "round.closed"})
    return await _round_out(db, rnd)


# ── 운영진: 기준 / 대상 / 명단 ────────────────────────────────────────────────

@router.put("/rounds/{round_id}/criteria", response_model=RoundOut)
async def put_criteria(
    round_id: int,
    body: list[CriterionIn],
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """기준 일괄 저장 — id가 있으면 수정, 없으면 신규, 목록에서 빠지면 삭제(점수도 함께 CASCADE)."""
    rnd = await _get_round_or_404(round_id, db, cohort_id)
    existing = {c.id: c for c in rnd.criteria}
    keep: set[int] = set()

    for i, item in enumerate(body):
        if item.id and item.id in existing:
            c = existing[item.id]
            c.label, c.description, c.max_score, c.order_num = item.label, item.description, item.max_score, i
            keep.add(c.id)
        else:
            db.add(ScoringCriterion(
                round_id=round_id, label=item.label, description=item.description,
                max_score=item.max_score, order_num=i,
            ))

    for cid, c in existing.items():
        if cid not in keep:
            await db.delete(c)

    await db.commit()
    rnd = await _get_round_or_404(round_id, db, cohort_id)
    await manager.broadcast(round_id, {"type": "config.changed"})
    return await _round_out(db, rnd)


async def _import_session_teams(
    db: AsyncSession, rnd: ScoringRound, session_id: int, cohort_id: int,
) -> None:
    """세션의 팀을 심사 대상으로 임포트 (기존 대상은 교체). member_ids는 자기팀 제외 판정용 스냅샷."""
    s = (await db.execute(
        select(SessionModel).where(SessionModel.id == session_id, SessionModel.cohort_id == cohort_id)
    )).scalar_one_or_none()
    if s is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "세션을 찾을 수 없습니다")

    teams = (await db.execute(
        select(Team).where(Team.session_id == session_id).order_by(Team.presenter_order, Team.id)
    )).scalars().all()
    if not teams:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "이 세션에는 편성된 팀이 없습니다")

    # 운영진이 지어둔 표시명은 재임포트해도 살린다 (같은 team_id 기준).
    # 주의: rnd.targets 로 접근하면 지연 로딩이 걸린다 — 방금 만든 라운드(selectinload 안 함)에서
    # MissingGreenlet 으로 터지므로, 관계 대신 명시적으로 조회한다.
    prior_rows = (await db.execute(
        select(ScoringTarget.team_id, ScoringTarget.display_name)
        .where(ScoringTarget.round_id == rnd.id, ScoringTarget.team_id.isnot(None))
    )).all()
    prior_display = {team_id: dn for team_id, dn in prior_rows if dn}

    await db.execute(delete(ScoringTarget).where(ScoringTarget.round_id == rnd.id))
    for i, t in enumerate(teams):
        # 팀원 id + 이름을 함께 스냅샷 — id는 자기팀 제외 판정용, 이름은 채점 폼 표시용.
        rows = (await db.execute(
            select(Member.id, Member.name)
            .join(TeamMember, TeamMember.member_id == Member.id)
            .where(TeamMember.team_id == t.id)
            .order_by(Member.name)
        )).all()
        db.add(ScoringTarget(
            round_id=rnd.id, team_id=t.id, name=t.name, order_num=i,
            display_name=prior_display.get(t.id),
            member_ids=[r[0] for r in rows],
            member_names=[r[1] for r in rows],
        ))


@router.post("/rounds/{round_id}/targets/import-session", response_model=RoundOut)
async def import_session_teams(
    round_id: int,
    session_id: int = Query(...),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    rnd = await _get_round_or_404(round_id, db, cohort_id)
    await _import_session_teams(db, rnd, session_id, cohort_id)
    rnd.session_id = session_id
    await db.commit()
    rnd = await _get_round_or_404(round_id, db, cohort_id)
    await manager.broadcast(round_id, {"type": "config.changed"})
    return await _round_out(db, rnd)


@router.put("/rounds/{round_id}/targets", response_model=RoundOut)
async def put_targets(
    round_id: int,
    body: list[TargetIn],
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """대상 일괄 저장 (독립 이벤트 모드에서 직접 입력)."""
    rnd = await _get_round_or_404(round_id, db, cohort_id)
    existing = {t.id: t for t in rnd.targets}
    keep: set[int] = set()

    for i, item in enumerate(body):
        if item.id and item.id in existing:
            t = existing[item.id]
            t.name, t.display_name, t.order_num = item.name, item.display_name, i
            keep.add(t.id)
        else:
            db.add(ScoringTarget(
                round_id=round_id, name=item.name,
                display_name=item.display_name, order_num=i,
            ))

    for tid, t in existing.items():
        if tid not in keep:
            await db.delete(t)

    await db.commit()
    rnd = await _get_round_or_404(round_id, db, cohort_id)
    await manager.broadcast(round_id, {"type": "config.changed"})
    return await _round_out(db, rnd)


@router.put("/rounds/{round_id}/roster", response_model=RoundOut)
async def put_roster(
    round_id: int,
    body: list[RosterIn],
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    rnd = await _get_round_or_404(round_id, db, cohort_id)
    existing = {r.id: r for r in rnd.roster}
    keep: set[int] = set()

    for item in body:
        if item.id and item.id in existing:
            r = existing[item.id]
            r.name, r.role, r.member_id, r.note = item.name, item.role, item.member_id, item.note
            r.group_label = item.group_label
            keep.add(r.id)
        else:
            db.add(ScoringRosterEntry(
                round_id=round_id, name=item.name, role=item.role,
                member_id=item.member_id, note=item.note, group_label=item.group_label,
            ))

    for rid, r in existing.items():
        if rid not in keep:
            await db.delete(r)

    await db.commit()
    rnd = await _get_round_or_404(round_id, db, cohort_id)
    return await _round_out(db, rnd)


@router.post("/rounds/{round_id}/roster/import-members", response_model=RoundOut)
async def import_cohort_members(
    round_id: int,
    role: str = Query("OBSERVER", pattern=r"^(JUDGE|OBSERVER|ANY)$"),
    group_label: str | None = Query(None, max_length=30),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """기수 멤버를 명단에 추가. group_label로 소그룹을 한 번에 태깅한다.

    이미 명단에 있는 사람은 **이번 그룹으로 갱신**한다(중복 추가 X). 운영진이 기수원을 겸하는
    경우가 많아, 그러지 않으면 어떤 버튼을 먼저 눌렀느냐에 따라 그룹이 달라져 헷갈린다.
    → 규칙: 나중에 누른 임포트가 이긴다.
    """
    rnd = await _get_round_or_404(round_id, db, cohort_id)
    by_member = {r.member_id: r for r in rnd.roster if r.member_id is not None}
    by_name = {_norm(r.name): r for r in rnd.roster}

    members = (await db.execute(
        select(Member).where(Member.cohort_id == cohort_id, Member.is_active.is_(True))
        .order_by(Member.name)
    )).scalars().all()

    for m in members:
        entry = by_member.get(m.id) or by_name.get(_norm(m.name))
        if entry is not None:
            entry.role = role
            entry.group_label = group_label
            entry.member_id = m.id  # 이름으로만 있던 항목을 실제 멤버와 연결
            continue
        db.add(ScoringRosterEntry(
            round_id=round_id, name=m.name, role=role, member_id=m.id,
            group_label=group_label,
        ))

    await db.commit()
    rnd = await _get_round_or_404(round_id, db, cohort_id)
    return await _round_out(db, rnd)


@router.post("/rounds/{round_id}/roster/import-staff", response_model=RoundOut)
async def import_staff(
    round_id: int,
    role: str = Query("OBSERVER", pattern=r"^(JUDGE|OBSERVER|ANY)$"),
    group_label: str | None = Query(None, max_length=30),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """운영진(User)을 명단에 추가. 이미 같은 이름이 있으면 **이번 그룹으로 갱신**한다.

    운영진이 기수원을 겸하는 경우가 많다. 그때 그냥 건너뛰면 "운영진 가져오기"를 눌렀는데도
    그 사람이 '기수' 그룹에 남아 버려 버튼이 거짓말을 하게 된다 → 나중에 누른 임포트가 이긴다.
    (member_id는 건드리지 않는다. 그 사람이 기수원이면 자기팀 제외 판정은 그대로 유지되어야 하므로.)
    """
    rnd = await _get_round_or_404(round_id, db, cohort_id)
    by_name = {_norm(r.name): r for r in rnd.roster}

    staff = (await db.execute(
        select(User).where(User.cohort_id == cohort_id, User.is_active.is_(True))
        .order_by(User.display_name)
    )).scalars().all()

    for u in staff:
        name = u.display_name or u.username
        entry = by_name.get(_norm(name))
        if entry is not None:
            entry.role = role
            entry.group_label = group_label
            if u.department:
                entry.note = u.department
            continue
        new_entry = ScoringRosterEntry(
            round_id=round_id, name=name, role=role,
            note=u.department, group_label=group_label,
        )
        db.add(new_entry)
        by_name[_norm(name)] = new_entry

    await db.commit()
    rnd = await _get_round_or_404(round_id, db, cohort_id)
    return await _round_out(db, rnd)


# ── 운영진: 제출 현황 / 매칭 보정 / 대리 입력 ─────────────────────────────────

@router.get("/rounds/{round_id}/participants", response_model=SubmissionStatus)
async def list_participants(
    round_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    rnd = await _get_round_or_404(round_id, db, cohort_id)
    parts = (await db.execute(
        select(ScoringParticipant)
        .where(ScoringParticipant.round_id == round_id)
        .order_by(ScoringParticipant.created_at)
    )).scalars().all()

    out: list[ParticipantOut] = []
    roster_submitted: dict[int, int] = {}
    for p in parts:
        suggestions: list[ScoringRosterEntry] = []
        if p.matched_roster_id is None:
            _, suggestions = _match_roster(p.entered_name, p.role, list(rnd.roster))
        elif p.submitted_at is not None:
            roster_submitted[p.matched_roster_id] = p.id
        out.append(ParticipantOut(
            id=p.id, role=p.role, entered_name=p.entered_name, group_label=p.group_label,
            matched_roster_id=p.matched_roster_id, matched_member_id=p.matched_member_id,
            is_proxy=p.is_proxy, proxy_by=p.proxy_by, submitted_at=p.submitted_at,
            suggestions=[RosterOut.model_validate(s) for s in suggestions],
        ))

    return SubmissionStatus(
        participants=out,
        roster=[RosterOut.model_validate(r) for r in rnd.roster],
        roster_submitted=roster_submitted,
    )


@router.patch("/participants/{participant_id}", response_model=ParticipantOut)
async def patch_participant(
    participant_id: int,
    body: ParticipantPatch,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """이름 매칭 수동 보정 — 오타로 들어온 제출을 올바른 명단 항목에 연결."""
    p = await db.get(ScoringParticipant, participant_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "제출자를 찾을 수 없습니다")
    rnd = await _get_round_or_404(p.round_id, db, cohort_id)

    data = body.model_dump(exclude_unset=True)
    if "matched_roster_id" in data:
        rid = data["matched_roster_id"]
        if rid is None:
            p.matched_roster_id = None
            p.matched_member_id = None
        else:
            entry = next((r for r in rnd.roster if r.id == rid), None)
            if entry is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "명단 항목을 찾을 수 없습니다")
            p.matched_roster_id = entry.id
            p.matched_member_id = entry.member_id
    if data.get("role"):
        p.role = data["role"]
    if "group_label" in data:
        p.group_label = data["group_label"]

    await db.commit()
    await db.refresh(p)
    await manager.broadcast(p.round_id, {"type": "submission.changed"})
    return ParticipantOut(
        id=p.id, role=p.role, entered_name=p.entered_name, group_label=p.group_label,
        matched_roster_id=p.matched_roster_id, matched_member_id=p.matched_member_id,
        is_proxy=p.is_proxy, proxy_by=p.proxy_by, submitted_at=p.submitted_at,
    )


@router.delete("/participants/{participant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_participant(
    participant_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    p = await db.get(ScoringParticipant, participant_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "제출자를 찾을 수 없습니다")
    await _get_round_or_404(p.round_id, db, cohort_id)  # cohort 검증
    round_id = p.round_id
    await db.delete(p)
    await db.commit()
    await manager.broadcast(round_id, {"type": "submission.changed"})


@router.get("/participants/{participant_id}/submission", response_model=MySubmission)
async def get_participant_submission(
    participant_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """운영진이 대리 수정하기 전에 기존 제출분을 불러온다."""
    p = await db.get(ScoringParticipant, participant_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "제출자를 찾을 수 없습니다")
    rnd = await _get_round_or_404(p.round_id, db, cohort_id)
    scores, ranks, comments = await _load_submission(db, p)
    return MySubmission(
        participant_token=p.token, role=p.role, entered_name=p.entered_name,
        group_label=p.group_label,
        submitted=p.submitted_at is not None,
        scores=scores, ranks=ranks, comments=comments,
        blocked_target_ids=_blocked_targets(rnd, p.matched_member_id),
    )


@router.put("/rounds/{round_id}/proxy-submit", response_model=ParticipantOut)
async def proxy_submit(
    round_id: int,
    body: ProxySubmitIn,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """운영진 대리 입력 — 심사위원이 종이로 낸 점수를 운영진이 대신 입력하는 경로.

    닫힌 라운드에서도 허용한다 (마감 후 정리 입력이 실제 운영 흐름).
    """
    rnd = await _get_round_or_404(round_id, db, cohort_id)

    if body.participant_id is not None:
        p = await db.get(ScoringParticipant, body.participant_id)
        if p is None or p.round_id != round_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "제출자를 찾을 수 없습니다")
    else:
        if not body.name or not body.role:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "이름과 역할이 필요합니다")
        entry, _cands = _match_roster(body.name, body.role, list(rnd.roster))
        p = ScoringParticipant(
            round_id=round_id, role=body.role, entered_name=body.name,
            group_label=body.group_label,
            token=secrets.token_urlsafe(32),
            matched_roster_id=entry.id if entry else None,
            matched_member_id=entry.member_id if entry else None,
            is_proxy=True, proxy_by=user["username"],
        )
        db.add(p)
        await db.flush()

    if body.role:
        p.role = body.role
    if body.group_label is not None:
        p.group_label = body.group_label
    p.is_proxy = True
    p.proxy_by = user["username"]
    await _save_submission(db, rnd, p, body)
    await db.commit()
    await db.refresh(p)

    await manager.broadcast(round_id, {"type": "submission.changed"})
    return ParticipantOut(
        id=p.id, role=p.role, entered_name=p.entered_name, group_label=p.group_label,
        matched_roster_id=p.matched_roster_id, matched_member_id=p.matched_member_id,
        is_proxy=p.is_proxy, proxy_by=p.proxy_by, submitted_at=p.submitted_at,
    )


# ── 운영진: 결과 집계 ─────────────────────────────────────────────────────────

@router.get("/rounds/{round_id}/results", response_model=ResultsOut)
async def get_results(
    round_id: int,
    role: str = Query("ALL", pattern=r"^(ALL|JUDGE|OBSERVER)$"),
    groups: str | None = Query(None, description="참관위원 소그룹 필터 (콤마 구분). 비우면 전체."),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """집계 결과. role/groups로 부분집합만 골라 **다시 집계**한다.

    예) role=OBSERVER&groups=청중 → 청중이 매긴 표만으로 순위를 다시 낸다.
    이때 심사위원 몫은 0점이 되므로, 총점은 그 그룹의 비중(참관위원 비중) 기준으로 읽어야 한다.
    """
    rnd = await _get_round_or_404(round_id, db, cohort_id)

    parts = (await db.execute(
        select(ScoringParticipant).where(ScoringParticipant.round_id == round_id)
    )).scalars().all()
    all_submitted = [p for p in parts if p.submitted_at is not None]
    submitted = list(all_submitted)

    # 필터 — 부분집합으로 재집계 (전체 인원이 아니라 남은 인원 기준으로 정규화된다)
    if role != "ALL":
        submitted = [p for p in submitted if p.role == role]
    group_filter = [g.strip() for g in groups.split(",") if g.strip()] if groups else []
    if group_filter:
        # 그룹은 참관위원에게만 있으므로, 심사위원은 그대로 두고 참관위원만 걸러낸다
        submitted = [
            p for p in submitted
            if p.role != "OBSERVER" or (p.group_label or "미분류") in group_filter
        ]

    pids = [p.id for p in submitted]

    scores = (await db.execute(
        select(ScoringScore).where(ScoringScore.participant_id.in_(pids))
    )).scalars().all() if pids else []
    ranks = (await db.execute(
        select(ScoringRank).where(ScoringRank.participant_id.in_(pids))
    )).scalars().all() if pids else []
    comments = (await db.execute(
        select(ScoringComment).where(ScoringComment.participant_id.in_(pids))
    )).scalars().all() if pids else []

    targets = sorted(rnd.targets, key=lambda t: t.order_num)
    criteria = sorted(rnd.criteria, key=lambda c: c.order_num)

    computed = compute_results(
        judge_weight=float(rnd.judge_weight),
        observer_weight=float(rnd.observer_weight),
        observer_mode=rnd.observer_mode,
        rank_points=list(rnd.rank_points or []),
        criteria=[CriterionLite(id=c.id, max_score=float(c.max_score)) for c in criteria],
        target_ids=[t.id for t in targets],
        participants=[ParticipantLite(id=p.id, role=p.role, name=p.entered_name) for p in submitted],
        scores=[ScoreLite(participant_id=s.participant_id, target_id=s.target_id,
                          criterion_id=s.criterion_id, score=float(s.score)) for s in scores],
        ranks=[RankLite(participant_id=r.participant_id, target_id=r.target_id, rank=r.rank) for r in ranks],
    )

    name_by_id = {t.id: _tname(t) for t in targets}
    pname = {p.id: p.entered_name for p in submitted}
    prole = {p.id: p.role for p in submitted}

    comments_by_target: dict[int, list[TargetComment]] = {}
    for c in comments:
        comments_by_target.setdefault(c.target_id, []).append(TargetComment(
            participant_name=pname.get(c.participant_id, "?"),
            role=prole.get(c.participant_id, "?"),
            criterion_id=c.criterion_id,
            body=c.body,
        ))

    results = [
        TargetResultOut(
            target_id=r.target_id,
            name=name_by_id.get(r.target_id, "?"),
            judge_points=r.judge_points,
            observer_points=r.observer_points,
            total=r.total,
            rank=r.rank,
            judge_count=r.judge_count,
            observer_count=r.observer_count,
            criterion_avg=r.criterion_avg,
            rank_votes=r.rank_votes,
            comments=comments_by_target.get(r.target_id, []),
        )
        for r in computed
    ]

    # 심사위원별 상세 (히트맵 — 관대/엄격 편차 확인용)
    totals_by: dict[int, dict[int, float]] = {}
    for s in scores:
        totals_by.setdefault(s.participant_id, {})
        totals_by[s.participant_id][s.target_id] = (
            totals_by[s.participant_id].get(s.target_id, 0.0) + float(s.score)
        )
    judges = [
        JudgeDetail(
            participant_id=p.id, name=p.entered_name, role=p.role, is_proxy=p.is_proxy,
            totals=totals_by.get(p.id, {}),
        )
        for p in submitted
        if p.role == "JUDGE" or rnd.observer_mode == "SCORE"
    ]

    # 필터 칩에 쓸 그룹 목록은 **필터 전 전체** 기준 (필터를 켰다고 선택지가 사라지면 안 됨)
    by_group: dict[str, int] = {}
    for p in all_submitted:
        if p.role != "OBSERVER":
            continue
        key = p.group_label or "미분류"
        by_group[key] = by_group.get(key, 0) + 1

    return ResultsOut(
        round=await _round_out(db, rnd),
        results=results,
        judges=judges,
        submitters=[
            SubmitterLite(
                participant_id=p.id, name=p.entered_name, role=p.role,
                group_label=p.group_label, submitted_at=p.submitted_at,
            )
            for p in sorted(submitted, key=lambda x: (x.role != "JUDGE", x.group_label or "", x.entered_name))
        ],
        judge_submitted=len([p for p in submitted if p.role == "JUDGE"]),
        observer_submitted=len([p for p in submitted if p.role == "OBSERVER"]),
        observer_by_group=by_group,
        roster_total=len(rnd.roster),
    )


@router.get("/rounds/{round_id}/export")
async def export_results_excel(
    round_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
):
    """심사 결과 Excel 다운로드 — 결과/심사위원별/상세점수/피드백/제출현황 5개 시트."""
    from urllib.parse import quote

    from fastapi.responses import StreamingResponse

    from app.services.scoring_excel import generate_scoring_excel

    rnd = await _get_round_or_404(round_id, db, cohort_id)
    buf = await generate_scoring_excel(db, rnd)

    filename = f"심사결과_{rnd.name}.xlsx"
    encoded = quote(filename)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded}"},
    )


# ── 공개(무로그인) ────────────────────────────────────────────────────────────

async def _get_public_round(token: str, db: AsyncSession) -> ScoringRound:
    rnd = (await db.execute(
        select(ScoringRound)
        .where(ScoringRound.public_token == token)
        .options(
            selectinload(ScoringRound.criteria),
            selectinload(ScoringRound.targets),
            selectinload(ScoringRound.roster),
        )
    )).scalar_one_or_none()
    if rnd is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "존재하지 않는 링크입니다")
    return rnd


@public_router.get("/{token}", response_model=PublicRound)
async def public_get_round(
    token: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    await check_public_rate(get_real_ip(request))
    rnd = await _get_public_round(token, db)
    return PublicRound(
        name=rnd.name,
        intro=rnd.intro,
        is_open=rnd.is_open,
        observer_mode=rnd.observer_mode,
        rank_slots=_rank_slots(rnd),
        observer_groups=list(rnd.observer_groups or []),
        criteria=[
            PublicCriterion(id=c.id, label=c.label, description=c.description,
                            max_score=float(c.max_score))
            for c in sorted(rnd.criteria, key=lambda c: c.order_num)
        ],
        targets=[
            PublicTarget(id=t.id, name=_tname(t), members=list(t.member_names or []))
            for t in sorted(rnd.targets, key=lambda t: t.order_num)
        ],
    )


@public_router.post("/{token}/identify", response_model=IdentifyOut)
async def public_identify(
    token: str,
    body: IdentifyIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """이름 + 역할 입력 → 참가자 토큰 발급.

    같은 이름의 기존 제출이 있으면 existing=true + 기존 점수를 함께 반환한다.
    프론트는 이때 "점수를 수정하시겠습니까?" 확인창을 띄운다.
    """
    await check_public_rate(get_real_ip(request))
    rnd = await _get_public_round(token, db)
    if not rnd.is_open:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "마감된 심사입니다")

    name = body.name.strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "이름을 입력해 주세요")

    # 같은 라운드에서 같은 이름(정규화 기준)으로 제출한 사람 찾기 → 수정 흐름
    parts = (await db.execute(
        select(ScoringParticipant).where(ScoringParticipant.round_id == rnd.id)
    )).scalars().all()
    existing = next((p for p in parts if _norm(p.entered_name) == _norm(name)), None)

    # 참관위원 소그룹은 라운드에 정의돼 있을 때만 받는다 (분류용 — 집계엔 영향 없음)
    groups = list(rnd.observer_groups or [])
    group_label = body.group_label if (body.role == "OBSERVER" and body.group_label in groups) else None

    entry_for_name, _c = _match_roster(name, body.role, list(rnd.roster))
    # 본인이 그룹을 고르지 않았으면 명단에 태깅된 기본 그룹을 물려받는다
    # (기수 멤버 임포트 → "기수", 운영진 임포트 → "운영진")
    if group_label is None and body.role == "OBSERVER" and entry_for_name and entry_for_name.group_label:
        group_label = entry_for_name.group_label

    if existing is not None:
        existing.role = body.role  # 역할을 바꿔 다시 들어온 경우 반영
        if group_label is not None:
            existing.group_label = group_label
        await db.commit()
        await db.refresh(existing)
        scores, ranks, comments = await _load_submission(db, existing)
        return IdentifyOut(
            existing=existing.submitted_at is not None,
            participant_token=existing.token,
            role=existing.role,
            entered_name=existing.entered_name,
            group_label=existing.group_label,
            submitted=existing.submitted_at is not None,
            scores=scores, ranks=ranks, comments=comments,
            blocked_target_ids=_blocked_targets(rnd, existing.matched_member_id),
        )

    entry = entry_for_name
    p = ScoringParticipant(
        round_id=rnd.id,
        role=body.role,
        entered_name=name,
        group_label=group_label,
        token=secrets.token_urlsafe(32),
        matched_roster_id=entry.id if entry else None,
        matched_member_id=entry.member_id if entry else None,
        ip=get_real_ip(request),
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)

    return IdentifyOut(
        existing=False,
        participant_token=p.token,
        role=p.role,
        entered_name=p.entered_name,
        group_label=p.group_label,
        submitted=False,
        blocked_target_ids=_blocked_targets(rnd, p.matched_member_id),
    )


@public_router.get("/{token}/me", response_model=MySubmission)
async def public_get_me(
    token: str,
    request: Request,
    participant_token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """같은 브라우저 재접속 — 이름 입력 없이 본인 제출분 복원."""
    await check_public_rate(get_real_ip(request))
    rnd = await _get_public_round(token, db)

    p = (await db.execute(
        select(ScoringParticipant).where(
            ScoringParticipant.round_id == rnd.id,
            ScoringParticipant.token == participant_token,
        )
    )).scalar_one_or_none()
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "제출 기록을 찾을 수 없습니다")

    scores, ranks, comments = await _load_submission(db, p)
    return MySubmission(
        participant_token=p.token, role=p.role, entered_name=p.entered_name,
        group_label=p.group_label,
        submitted=p.submitted_at is not None,
        scores=scores, ranks=ranks, comments=comments,
        blocked_target_ids=_blocked_targets(rnd, p.matched_member_id),
    )


@public_router.post("/{token}/submit", status_code=status.HTTP_204_NO_CONTENT)
async def public_submit(
    token: str,
    body: PublicSubmissionIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    await check_public_rate(get_real_ip(request))
    rnd = await _get_public_round(token, db)
    if not rnd.is_open:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "마감된 심사입니다")

    p = (await db.execute(
        select(ScoringParticipant).where(
            ScoringParticipant.round_id == rnd.id,
            ScoringParticipant.token == body.participant_token,
        )
    )).scalar_one_or_none()
    if p is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "제출 자격을 확인할 수 없습니다. 이름을 다시 입력해 주세요.")

    await _save_submission(db, rnd, p, body)
    p.ip = get_real_ip(request)
    await db.commit()

    await manager.broadcast(rnd.id, {"type": "submission.changed"})


# ── WebSocket (운영진 결과 화면 실시간 갱신) ──────────────────────────────────

@router.websocket("/ws/{round_id}")
async def scoring_ws(websocket: WebSocket, round_id: int, token: str = Query(...)):
    # 인증·검증은 짧게 별도 세션으로 처리 후 닫는다(긴 WS 수명 동안 DB 커넥션 점유 방지).
    async with AsyncSessionLocal() as db:
        identity = await decode_ws_token(token, db)
        if identity is None:
            await websocket.close(code=4401)
            return
        # 운영진 전용 — 기수원 토큰은 거부
        if identity["role"] != "admin":
            await websocket.close(code=4403)
            return
        rnd = await db.get(ScoringRound, round_id)
        if rnd is None:
            await websocket.close(code=4404)
            return
        # 기수 격리 — 슈퍼관리자(cohort_id=None)는 통과
        token_cohort = identity.get("cohort_id")
        if token_cohort is not None and token_cohort != rnd.cohort_id:
            await websocket.close(code=4403)
            return

    await websocket.accept()
    conn = await manager.connect(round_id, websocket)
    try:
        while True:
            # 클라이언트 하트비트(ping) 수신; 내용은 무시.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await manager.disconnect(round_id, conn)
