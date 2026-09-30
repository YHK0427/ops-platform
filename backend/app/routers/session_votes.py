"""오프·오피 투표.

세션마다 기수원이 오프(오늘의 프레젠터)·오피(오늘의 PPT)를 한 표씩 던진다.
- 개인 세션: 분반별로, 후보 = 사람. 본인에게는 투표 불가.
- 팀 세션: 항상 전체 한 번, 후보 = 팀. 자기 팀에는 투표 불가. 1등 팀 전원이 상점을 받고,
  상점 명목·점수는 운영진이 투표를 열 때 고른다.
- 운영진이 출석 탭에서 후보를 골라 열고, 실시간으로 득표·누가 누구를 찍었는지 본다.
- 닫으면 1등을 세션 정산 대기 상점(config.staged_merits)에 올린다. 동률이면 운영진이
  부문별로 '동률자 재투표' 또는 '동률자 모두 올리기'를 고른다.
- 기수원에게는 결과를 절대 내보내지 않는다(후보 명단과 내 표만).

투표권은 열려 있는 동안 매번 출결에서 계산한다 — 출결·분반이 바뀌면 투표권과 집계가 바로 따라간다.
닫는 순간의 투표권자는 closed_voters 에 남겨, 닫은 뒤의 결과 화면이 결과와 어긋나지 않게 한다.

잠금 순서(교착 방지): 투표 → (원 투표) → 세션. 세션 행은 정산 대기 상점(config)을 고칠 때만 잡는다.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.database import AsyncSessionLocal
from app.deps import decode_ws_token, get_current_cohort_id, get_current_member, get_db, get_member_cohort_id, require_staff
from app.models import (
    VOTE_CATEGORIES, Attendance, Member, Session, SessionVote, SessionVoteBallot, Team, TeamMember,
)
from app.services.live_feedback_ws import vote_manager

logger = logging.getLogger(__name__)
router = APIRouter(tags=["session-votes"])

# 결석·공결만 빠진다. 출결을 아직 안 찍은(PENDING) 사람도 오늘 온 사람으로 본다(실시간 피드백 보드와 같은 기준).
VOTER_STATUSES = {"PRESENT", "LATE_UNDER10", "LATE_OVER10", "EARLY_LEAVE", "PENDING"}
LABEL = {"OFF": "오프", "OPI": "오피"}
# 엑셀 내보내기가 "오프/오피 선정" 부분일치로 칸을 찾는다
DEFAULT_MERIT = {c: {"reason": "오프/오피 선정", "score": 1} for c in VOTE_CATEGORIES}


# ── 공통 ────────────────────────────────────────────────────────────────────

async def _signal(cohort_id: int, ballot: bool = False) -> None:
    """화면들에 '다시 조회하라' 신호만 보낸다(내용은 각자 권한에 맞는 API 로 받는다)."""
    if ballot:  # 표 하나하나는 운영진 화면만
        await vote_manager.broadcast(cohort_id, {"type": "vote.ballot"}, None)
    else:
        evt = {"type": "vote.changed"}
        await vote_manager.broadcast(cohort_id, evt, evt)


async def _session(db: AsyncSession, session_id: int, cohort_id: int | None) -> Session:
    s = await db.get(Session, session_id)
    if not s or (cohort_id is not None and s.cohort_id != cohort_id):
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    return s


async def _lock_session(db: AsyncSession, s: Session) -> Session:
    """정산 대기 상점(config)을 고치기 전에 — 1·2분반을 동시에 닫거나 운영진이 상점을 같이 올려도
    서로 덮어쓰지 않게 세션 행을 잡고 최신 값을 다시 읽는다."""
    return (await db.execute(
        select(Session).where(Session.id == s.id).with_for_update().execution_options(populate_existing=True)
    )).scalar_one()


def _not_finalized(s: Session) -> None:
    if s.status == "FINALIZED":
        raise HTTPException(status_code=400, detail="이미 정산이 끝난 세션입니다")


async def _vote(db: AsyncSession, vote_id: int, cohort_id: int | None) -> tuple[SessionVote, Session]:
    """투표 행을 잡는다(닫기·표 저장·다시 열기가 동시에 와도 순서대로)."""
    v = (await db.execute(
        select(SessionVote).where(SessionVote.id == vote_id).with_for_update().execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if not v:
        raise HTTPException(status_code=404, detail="투표를 찾을 수 없습니다")
    return v, await _session(db, v.session_id, cohort_id)


def _gkey(g: int | None) -> str:
    """화면에 내보내는 분반 키 — 분반 없음은 "all" (프론트 gkey 와 같아야 한다)."""
    return "all" if g is None else str(g)


def _is_team(s: Session) -> bool:
    return s.type == "TEAM"


async def _groups(db: AsyncSession, s: Session) -> list[int | None]:
    if _is_team(s):  # 팀 세션은 항상 전체 한 번
        return [None]
    rows = (await db.execute(
        select(Attendance.group_num).where(Attendance.session_id == s.id, Attendance.group_num.isnot(None)).distinct()
    )).scalars().all()
    return sorted(rows) or [None]


async def _eligible(db: AsyncSession, session_id: int, group_num: int | None) -> dict[int, str]:
    """투표권자 {member_id: 이름} — 그 분반(없으면 전체)의 오늘 출석자."""
    q = (select(Member.id, Member.name)
         .join(Attendance, Attendance.member_id == Member.id)
         .where(Attendance.session_id == session_id, Attendance.status.in_(VOTER_STATUSES), Member.is_active == True)  # noqa: E712
         .order_by(Member.name))
    if group_num is not None:
        q = q.where(Attendance.group_num == group_num)
    return {mid: name for mid, name in (await db.execute(q)).all()}


async def _teams(db: AsyncSession, session_id: int) -> dict[int, dict]:
    """세션의 팀 {team_id: {"name", "members": [(member_id, 이름)]}} — 팀 이름순."""
    teams = {t.id: {"name": t.name, "members": []} for t in (await db.execute(
        select(Team).where(Team.session_id == session_id).order_by(Team.name)
    )).scalars().all()}
    rows = (await db.execute(
        select(TeamMember.team_id, Member.id, Member.name).join(Member, Member.id == TeamMember.member_id)
        .where(TeamMember.team_id.in_(list(teams) or [0])).order_by(Member.name)
    )).all()
    for tid, mid, name in rows:
        teams[tid]["members"].append((mid, name))
    return teams


def _team_of(teams: dict[int, dict]) -> dict[int, int]:
    return {mid: tid for tid, t in teams.items() for mid, _ in t["members"]}


def _people(teams: dict[int, dict]) -> list[dict]:
    """팀 후보 표시용 — 이름 + 팀원 이름."""
    return [{"id": tid, "name": t["name"], "sub": ", ".join(n for _, n in t["members"])} for tid, t in teams.items()]


def _tally(vote: SessionVote, ballots: list[SessionVoteBallot], voters: set[int]) -> dict[str, dict[int, int]]:
    """부문별 {후보: 득표} — 투표권이 있는 사람의 표만 센다."""
    out: dict[str, dict[int, int]] = {}
    for cat, cands in vote.candidates.items():
        counts = {c: 0 for c in cands}
        for b in ballots:
            if b.category == cat and b.voter_member_id in voters and b.candidate_id in counts:
                counts[b.candidate_id] += 1
        out[cat] = counts
    return out


def _merit(v: SessionVote, cat: str) -> dict:
    return (v.merit or DEFAULT_MERIT).get(cat) or DEFAULT_MERIT[cat]


def _stage(s: Session, v: SessionVote, cat: str, winners: list[int], teams: dict[int, dict] | None = None) -> None:
    """1등을 정산 대기 상점에 올린다. 팀이면 그 팀 전원."""
    m = _merit(v, cat)
    cfg = dict(s.config or {})
    staged = list(cfg.get("staged_merits", []))
    for w in winners:
        if v.kind == "TEAM":
            t = (teams or {}).get(w)
            if not t:
                continue
            for mid, _ in t["members"]:
                staged.append({"member_id": mid, "score_delta": m["score"], "reason": f"{m['reason']} ({LABEL[cat]} · {t['name']})", "vote_id": v.id})
        else:
            staged.append({"member_id": w, "score_delta": m["score"], "reason": f"{m['reason']} ({LABEL[cat]})", "vote_id": v.id})
    cfg["staged_merits"] = staged
    s.config = cfg
    flag_modified(s, "config")


def _unstage(s: Session, vote_ids: set[int]) -> None:
    """이 투표들이 올린 상점만 뺀다(운영진이 손으로 올린 상점은 그대로)."""
    cfg = dict(s.config or {})
    cfg["staged_merits"] = [m for m in cfg.get("staged_merits", []) if m.get("vote_id") not in vote_ids]
    s.config = cfg
    flag_modified(s, "config")


async def _descendants(db: AsyncSession, vote_id: int) -> list[int]:
    out, frontier = [], [vote_id]
    while frontier:
        kids = (await db.execute(select(SessionVote.id).where(SessionVote.parent_id.in_(frontier)))).scalars().all()
        out += kids
        frontier = list(kids)
    return out


async def _push_open(request: Request, db: AsyncSession, s: Session, vote: SessionVote) -> None:
    from app.routers.notifications import _enqueue_push
    from app.services.push import resolve_subscription_ids
    try:
        voters = list((await _eligible(db, s.id, vote.group_num)).keys())
        sub_ids = await resolve_subscription_ids(db, s.cohort_id, "select", voters)
        what = "오프·오피 재투표" if vote.round > 1 else "오프·오피 투표"
        await _enqueue_push(request, {
            "title": f"{what}가 열렸습니다",
            "body": f"{s.week_num}주차 {s.title} — 지금 투표해 주세요",
            "url": "/member/vote",
            "tag": f"vote-{vote.id}",
        }, sub_ids)
    except Exception:  # 알림 실패가 투표 열기를 막으면 안 된다
        logger.warning("투표 알림 발송 실패", exc_info=True)


async def finalize_blocker(db: AsyncSession, session_id: int) -> str | None:
    """세션 마감을 막아야 하는 투표 상태 — 열린 투표나 정하지 않은 동률이 있으면 상점이 빠진 채 마감된다.
    호출하는 쪽이 세션 행을 먼저 잡아야 확인과 마감 사이에 투표가 다시 열리지 않는다."""
    votes = (await db.execute(select(SessionVote).where(SessionVote.session_id == session_id))).scalars().all()
    if any(v.is_open for v in votes):
        return "진행 중인 오프·오피 투표가 있습니다. 출석 탭에서 투표를 먼저 닫아주세요."
    if any(r.get("tie") and not r.get("resolved") for v in votes for r in (v.result or {}).values()):
        return "오프·오피 투표 동률이 처리되지 않았습니다. 재투표 또는 모두 올리기를 먼저 골라주세요."
    return None


# ── 운영진 ──────────────────────────────────────────────────────────────────

class MeritIn(BaseModel):
    reason: str = Field(min_length=1, max_length=40)
    score: int = Field(ge=1, le=10)


class OpenIn(BaseModel):
    group_num: int | None = None
    candidates: list[int]
    merit: dict[str, MeritIn] | None = None  # 팀 세션만 — 부문별 상점 명목·점수


class CandidatesIn(BaseModel):
    candidates: list[int]
    merit: dict[str, MeritIn] | None = None


def _merit_in(s: Session, merit: dict[str, MeritIn] | None) -> dict | None:
    if merit is None:
        return None
    if not _is_team(s):
        raise HTTPException(status_code=422, detail="상점 명목·점수는 팀 세션에서만 고를 수 있습니다")
    if set(merit) != set(VOTE_CATEGORIES):
        raise HTTPException(status_code=422, detail="오프·오피 상점을 모두 정해주세요")
    return {c: {"reason": m.reason.strip(), "score": m.score} for c, m in merit.items()}


async def _check_candidates(db: AsyncSession, s: Session, ids: list[int]) -> list[int]:
    ids = list(dict.fromkeys(ids))
    if _is_team(s):
        if len(ids) < 2:
            raise HTTPException(status_code=422, detail="후보 팀을 2개 이상 골라주세요")
        if not set(ids) <= set(await _teams(db, s.id)):
            raise HTTPException(status_code=422, detail="이 세션의 팀만 후보로 넣을 수 있습니다")
        return ids
    if len(ids) < 2:
        raise HTTPException(status_code=422, detail="후보를 2명 이상 골라주세요")
    ok = set((await db.execute(
        select(Member.id).where(Member.id.in_(ids), Member.cohort_id == s.cohort_id)
    )).scalars().all())
    if ok != set(ids):
        raise HTTPException(status_code=422, detail="이 기수 기수원만 후보로 넣을 수 있습니다")
    return ids


@router.get("/sessions/{session_id}/votes")
async def list_votes(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int | None = Depends(get_current_cohort_id),
):
    s = await _session(db, session_id, cohort_id)
    team = _is_team(s)
    groups = await _groups(db, s)
    votes = (await db.execute(
        select(SessionVote).where(SessionVote.session_id == session_id).order_by(SessionVote.round, SessionVote.id)
    )).scalars().all()
    for g in {v.group_num for v in votes}:  # 투표를 연 뒤 분반이 바뀌어도 기존 투표는 보이게
        if g not in groups:
            groups.append(g)
    eligible = {g: await _eligible(db, session_id, g) for g in groups}
    teams = await _teams(db, session_id) if team or any(v.kind == "TEAM" for v in votes) else {}
    ballots = (await db.execute(
        select(SessionVoteBallot).where(SessionVoteBallot.vote_id.in_([v.id for v in votes] or [0]))
    )).scalars().all()

    # 이름표: 사람(투표권자·후보·닫힐 때 투표권자) + 팀
    people = {m: n for e in eligible.values() for m, n in e.items()}
    need = {mid for v in votes if v.kind == "MEMBER" for c in v.candidates.values() for mid in c}
    need |= {mid for v in votes for mid in (v.closed_voters or [])}
    need -= people.keys()
    if need:
        people.update(dict((await db.execute(select(Member.id, Member.name).where(Member.id.in_(need)))).all()))
    team_names = {tid: t["name"] for tid, t in teams.items()}

    out = []
    for v in votes:
        names = team_names if v.kind == "TEAM" else people
        # 열려 있으면 지금 출석자, 닫혔으면 닫는 순간의 투표권자
        voter_ids = list(eligible.get(v.group_num, {})) if v.is_open or v.closed_voters is None else v.closed_voters
        mine = [b for b in ballots if b.vote_id == v.id]
        picks: dict[int, dict[str, int]] = {}
        for b in mine:
            picks.setdefault(b.voter_member_id, {})[b.category] = b.candidate_id
        out.append({
            "id": v.id, "group_num": v.group_num, "kind": v.kind, "round": v.round, "parent_id": v.parent_id,
            "is_open": v.is_open, "result": v.result, "merit": {c: _merit(v, c) for c in VOTE_CATEGORIES},
            "opened_at": v.opened_at, "closed_at": v.closed_at,
            "candidates": {cat: [{"id": m, "name": names.get(m, f"#{m}")} for m in ids] for cat, ids in v.candidates.items()},
            "tally": {cat: {str(k): n for k, n in c.items()} for cat, c in _tally(v, mine, set(voter_ids)).items()},
            "voters": sorted(({"id": m, "name": people.get(m, f"#{m}"), "picks": picks.get(m, {})} for m in voter_ids),
                             key=lambda x: x["name"]),
        })
    return {
        "session_status": s.status,
        "kind": "TEAM" if team else "MEMBER",
        "groups": groups,
        "eligible": {_gkey(g): [{"id": m, "name": n} for m, n in e.items()] for g, e in eligible.items()},
        # 투표 열 때 기본 후보(모두 체크) — 개인 세션은 그 분반 출석자, 팀 세션은 세션의 모든 팀
        "pool": {_gkey(g): (_people(teams) if team else [{"id": m, "name": n} for m, n in e.items()]) for g, e in eligible.items()},
        "default_merit": DEFAULT_MERIT,
        "votes": out,
    }


@router.post("/sessions/{session_id}/votes", status_code=status.HTTP_201_CREATED)
async def open_vote(
    session_id: int,
    body: OpenIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int | None = Depends(get_current_cohort_id),
):
    s = await _session(db, session_id, cohort_id)
    _not_finalized(s)
    if body.group_num not in await _groups(db, s):
        raise HTTPException(status_code=422, detail="없는 분반입니다")
    dup = (await db.execute(select(SessionVote.id).where(
        SessionVote.session_id == session_id, SessionVote.round == 1,
        SessionVote.group_num.is_(None) if body.group_num is None else SessionVote.group_num == body.group_num,
    ))).first()
    if dup:
        raise HTTPException(status_code=409, detail="이 분반 투표가 이미 있습니다. 다시 열기를 사용하세요")
    ids = await _check_candidates(db, s, body.candidates)
    v = SessionVote(session_id=session_id, group_num=body.group_num, round=1, kind="TEAM" if _is_team(s) else "MEMBER",
                    candidates={c: ids for c in VOTE_CATEGORIES}, merit=_merit_in(s, body.merit))
    db.add(v)
    try:
        await db.commit()
    except IntegrityError:  # 운영진 두 명이 동시에 연 경우(uq_session_vote_round1)
        await db.rollback()
        raise HTTPException(status_code=409, detail="이 분반 투표가 이미 있습니다. 다시 열기를 사용하세요")
    await _signal(s.cohort_id)
    await _push_open(request, db, s, v)
    return {"id": v.id}


@router.put("/session-votes/{vote_id}/candidates")
async def update_candidates(
    vote_id: int,
    body: CandidatesIn,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int | None = Depends(get_current_cohort_id),
):
    v, s = await _vote(db, vote_id, cohort_id)
    _not_finalized(s)
    if not v.is_open or v.round != 1:
        raise HTTPException(status_code=409, detail="진행 중인 본투표만 후보를 바꿀 수 있습니다")
    ids = await _check_candidates(db, s, body.candidates)
    v.candidates = {c: ids for c in VOTE_CATEGORIES}
    if body.merit is not None:
        v.merit = _merit_in(s, body.merit)
    # 빠진 후보에게 간 표는 무효 — 그 사람들은 다시 고르게 된다
    await db.execute(delete(SessionVoteBallot).where(
        SessionVoteBallot.vote_id == v.id, SessionVoteBallot.candidate_id.notin_(ids)))
    await db.commit()
    await _signal(s.cohort_id)
    return {"ok": True}


@router.post("/session-votes/{vote_id}/close")
async def close_vote(
    vote_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int | None = Depends(get_current_cohort_id),
):
    v, s = await _vote(db, vote_id, cohort_id)
    s = await _lock_session(db, s)
    _not_finalized(s)
    if not v.is_open:
        raise HTTPException(status_code=409, detail="이미 닫힌 투표입니다")
    voters = set(await _eligible(db, s.id, v.group_num))
    teams = await _teams(db, s.id) if v.kind == "TEAM" else None
    ballots = (await db.execute(select(SessionVoteBallot).where(SessionVoteBallot.vote_id == v.id))).scalars().all()
    result = {}
    for cat, counts in _tally(v, ballots, voters).items():
        top = max(counts.values(), default=0)
        winners = [m for m, n in counts.items() if n == top] if top > 0 else []
        if len(winners) == 1:
            _stage(s, v, cat, winners, teams)
            result[cat] = {"winners": winners, "votes": top, "tie": False, "resolved": "auto"}
        else:  # 동률(2명 이상) — 운영진 선택 대기. 표가 하나도 없으면 아무도 안 뽑힌다.
            result[cat] = {"winners": winners, "votes": top, "tie": len(winners) > 1, "resolved": None if winners else "none"}
    v.is_open = False
    v.result = result
    v.closed_voters = sorted(voters)
    v.closed_at = func.now()
    await db.commit()
    await _signal(s.cohort_id)
    return {"result": result}


class ResolveIn(BaseModel):
    OFF: str | None = None  # "runoff" | "all"
    OPI: str | None = None


@router.post("/session-votes/{vote_id}/resolve")
async def resolve_tie(
    vote_id: int,
    body: ResolveIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int | None = Depends(get_current_cohort_id),
):
    v, s = await _vote(db, vote_id, cohort_id)
    s = await _lock_session(db, s)
    _not_finalized(s)
    teams = await _teams(db, s.id) if v.kind == "TEAM" else None
    result = dict(v.result or {})
    runoff: dict[str, list[int]] = {}
    for cat in VOTE_CATEGORIES:
        choice = getattr(body, cat)
        if choice is None:
            continue
        r = result.get(cat)
        if v.is_open or not r or not r.get("tie") or r.get("resolved"):
            raise HTTPException(status_code=409, detail=f"{LABEL[cat]} 부문은 정할 동률이 없습니다")
        if choice == "all":
            _stage(s, v, cat, r["winners"], teams)
        elif choice == "runoff":
            runoff[cat] = r["winners"]
        else:
            raise HTTPException(status_code=422, detail="runoff 또는 all 중에서 골라주세요")
        result[cat] = {**r, "resolved": choice}
    v.result = result
    flag_modified(v, "result")
    child = None
    if runoff:
        child = SessionVote(session_id=s.id, group_num=v.group_num, kind=v.kind, round=v.round + 1, parent_id=v.id,
                            candidates=runoff, merit=v.merit)
        db.add(child)
    await db.commit()
    await _signal(s.cohort_id)
    if child:
        await _push_open(request, db, s, child)
    return {"runoff_id": child.id if child else None}


@router.post("/session-votes/{vote_id}/reopen")
async def reopen_vote(
    vote_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int | None = Depends(get_current_cohort_id),
):
    v, s = await _vote(db, vote_id, cohort_id)
    s = await _lock_session(db, s)
    _not_finalized(s)
    if v.is_open:
        raise HTTPException(status_code=409, detail="이미 진행 중인 투표입니다")
    kids = await _descendants(db, v.id)
    _unstage(s, {v.id, *kids})
    if kids:
        await db.execute(delete(SessionVote).where(SessionVote.id.in_(kids)))
    v.is_open = True
    v.result = None
    v.closed_voters = None
    v.closed_at = None
    await db.commit()
    await _signal(s.cohort_id)
    await _push_open(request, db, s, v)
    return {"ok": True}


@router.delete("/session-votes/{vote_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_vote(
    vote_id: int,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
    cohort_id: int | None = Depends(get_current_cohort_id),
):
    v, s = await _vote(db, vote_id, cohort_id)
    parent = None
    if v.parent_id:  # 원 투표를 세션보다 먼저 잡는다(잠금 순서)
        parent = (await db.execute(
            select(SessionVote).where(SessionVote.id == v.parent_id).with_for_update().execution_options(populate_existing=True)
        )).scalar_one_or_none()
    s = await _lock_session(db, s)
    _not_finalized(s)
    kids = await _descendants(db, v.id)
    _unstage(s, {v.id, *kids})
    if parent and parent.result:
        # 재투표를 지우면 원 투표의 그 부문 동률이 '재투표로 넘김' 상태로 갇힌다 → 다시 고를 수 있게 되돌린다
        res = dict(parent.result)
        for cat in v.candidates:
            if cat in res and res[cat].get("resolved") == "runoff":
                res[cat] = {**res[cat], "resolved": None}
        parent.result = res
        flag_modified(parent, "result")
    await db.delete(v)  # 재투표·표는 FK CASCADE
    await db.commit()
    await _signal(s.cohort_id)


# ── 기수원 ──────────────────────────────────────────────────────────────────

@router.get("/session-votes/member/open")
async def member_open_votes(
    member: dict = Depends(get_current_member),
    cohort_id: int = Depends(get_member_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """내가 투표할 수 있는 열린 투표. 결과·득표는 절대 싣지 않는다."""
    me = member["member_id"]
    rows = (await db.execute(
        select(SessionVote, Session, Attendance.group_num)
        .join(Session, Session.id == SessionVote.session_id)
        .join(Attendance, (Attendance.session_id == Session.id) & (Attendance.member_id == me))
        .where(SessionVote.is_open == True, Session.cohort_id == cohort_id, Session.status != "FINALIZED",  # noqa: E712
               Attendance.status.in_(VOTER_STATUSES))
        .order_by(SessionVote.id)
    )).all()
    votes = [(v, s) for v, s, g in rows if v.group_num is None or v.group_num == g]
    if not votes:
        return []
    mids = {m for v, _ in votes if v.kind == "MEMBER" for c in v.candidates.values() for m in c}
    names = dict((await db.execute(select(Member.id, Member.name).where(Member.id.in_(mids or [0])))).all())
    teams_by_session = {s.id: await _teams(db, s.id) for v, s in votes if v.kind == "TEAM"}
    mine = (await db.execute(select(SessionVoteBallot).where(
        SessionVoteBallot.vote_id.in_([v.id for v, _ in votes]), SessionVoteBallot.voter_member_id == me,
    ))).scalars().all()

    out = []
    for v, s in votes:
        if v.kind == "TEAM":
            teams = teams_by_session[s.id]
            own = _team_of(teams).get(me)
            card = {t["id"]: t for t in _people(teams)}
            cands = {cat: [card.get(t, {"id": t, "name": f"#{t}", "sub": ""}) for t in c if t != own] for cat, c in v.candidates.items()}
        else:
            cands = {cat: [{"id": m, "name": names.get(m, "")} for m in c if m != me] for cat, c in v.candidates.items()}
        out.append({
            "id": v.id, "round": v.round, "group_num": v.group_num, "kind": v.kind,
            "session_title": s.title, "session_week_num": s.week_num,
            "candidates": cands,
            "my": {b.category: b.candidate_id for b in mine if b.vote_id == v.id},
        })
    return out


class BallotIn(BaseModel):
    OFF: int | None = None
    OPI: int | None = None


@router.put("/session-votes/member/{vote_id}/ballot")
async def cast_ballot(
    vote_id: int,
    body: BallotIn,
    member: dict = Depends(get_current_member),
    cohort_id: int = Depends(get_member_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    me = member["member_id"]
    v, s = await _vote(db, vote_id, cohort_id)
    if not v.is_open or s.status == "FINALIZED":
        raise HTTPException(status_code=409, detail="투표가 마감되었습니다")
    if me not in await _eligible(db, s.id, v.group_num):
        raise HTTPException(status_code=403, detail="이 투표에 참여할 수 없습니다")
    own_team = _team_of(await _teams(db, s.id)).get(me) if v.kind == "TEAM" else None
    for cat in body.model_fields_set:
        if cat not in v.candidates:
            raise HTTPException(status_code=422, detail=f"이번 투표에는 {LABEL[cat]} 부문이 없습니다")
        pick = getattr(body, cat)
        existing = (await db.execute(select(SessionVoteBallot).where(
            SessionVoteBallot.vote_id == v.id, SessionVoteBallot.voter_member_id == me, SessionVoteBallot.category == cat,
        ))).scalar_one_or_none()
        if pick is None:  # 선택 취소
            if existing:
                await db.delete(existing)
            continue
        if v.kind == "TEAM" and pick == own_team:
            raise HTTPException(status_code=422, detail="자기 팀에는 투표할 수 없습니다")
        if v.kind == "MEMBER" and pick == me:
            raise HTTPException(status_code=422, detail="본인에게는 투표할 수 없습니다")
        if pick not in v.candidates[cat]:
            raise HTTPException(status_code=422, detail="후보가 아닙니다")
        if existing:
            existing.candidate_id = pick
        else:
            db.add(SessionVoteBallot(vote_id=v.id, voter_member_id=me, category=cat, candidate_id=pick))
    await db.commit()
    await _signal(s.cohort_id, ballot=True)
    return {"ok": True}


# ── 실시간 ──────────────────────────────────────────────────────────────────

@router.websocket("/session-votes/ws")
async def vote_ws(websocket: WebSocket, token: str = Query(...), cohort: int | None = Query(None)):
    async with AsyncSessionLocal() as db:
        identity = await decode_ws_token(token, db)
    if identity is None or identity.get("user_role") == "scoring_only":
        await websocket.close(code=4401)
        return
    # 기수원은 토큰(DB) 기수로 고정. 운영진은 토큰 기수, 기수가 없는 전체 관리자(admin 역할)만 cohort 로 고른다
    # (REST 의 get_current_cohort_id 와 같은 규칙 — admin 이 아닌데 기수가 없으면 막는다).
    room = identity.get("cohort_id")
    if room is None and identity["role"] == "admin" and identity.get("user_role") == "admin":
        room = cohort
    if room is None:
        await websocket.close(code=4403)
        return
    await websocket.accept()
    conn = await vote_manager.connect(room, websocket, identity["role"], identity.get("member_id"))
    try:
        while True:
            await websocket.receive_text()  # 하트비트 — 내용 무시
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await vote_manager.disconnect(room, conn)
