"""오프·오피 투표.

세션마다 분반별로 기수원이 오프(오늘의 프레젠터)·오피(오늘의 PPT)를 한 표씩 던진다.
- 운영진이 출석 탭에서 후보를 골라 열고, 실시간으로 득표·누가 누구를 찍었는지 본다.
- 닫으면 1등을 세션 정산 대기 상점(config.staged_merits)에 올린다. 동률이면 운영진이
  부문별로 '동률자 재투표' 또는 '동률자 모두 올리기'를 고른다.
- 기수원에게는 결과를 절대 내보내지 않는다(후보 명단과 내 표만).

투표권은 저장하지 않고 매번 출결에서 계산한다 — 출결·분반이 바뀌면 투표권과 집계가 바로 따라간다.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.database import AsyncSessionLocal
from app.deps import decode_ws_token, get_current_cohort_id, get_current_member, get_db, get_member_cohort_id, require_staff
from app.models import VOTE_CATEGORIES, Attendance, Member, Session, SessionVote, SessionVoteBallot
from app.services.live_feedback_ws import vote_manager

logger = logging.getLogger(__name__)
router = APIRouter(tags=["session-votes"])

# 결석·공결만 빠진다. 출결을 아직 안 찍은(PENDING) 사람도 오늘 온 사람으로 본다(실시간 피드백 보드와 같은 기준).
VOTER_STATUSES = {"PRESENT", "LATE_UNDER10", "LATE_OVER10", "EARLY_LEAVE", "PENDING"}
LABEL = {"OFF": "오프", "OPI": "오피"}
MERIT_REASON = "오프/오피 선정 ({})"  # 엑셀 내보내기가 "오프/오피 선정" 부분일치로 칸을 찾는다


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


def _not_finalized(s: Session) -> None:
    if s.status == "FINALIZED":
        raise HTTPException(status_code=400, detail="이미 정산이 끝난 세션입니다")


async def _vote(db: AsyncSession, vote_id: int, cohort_id: int | None, lock: bool = False) -> tuple[SessionVote, Session]:
    q = select(SessionVote).where(SessionVote.id == vote_id)
    if lock:  # 닫기·표 저장이 동시에 와도 순서대로
        q = q.with_for_update()
    v = (await db.execute(q)).scalar_one_or_none()
    if not v:
        raise HTTPException(status_code=404, detail="투표를 찾을 수 없습니다")
    return v, await _session(db, v.session_id, cohort_id)


async def _groups(db: AsyncSession, session_id: int) -> list[int | None]:
    rows = (await db.execute(
        select(Attendance.group_num).where(Attendance.session_id == session_id, Attendance.group_num.isnot(None)).distinct()
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


def _tally(vote: SessionVote, ballots: list[SessionVoteBallot], voters: set[int]) -> dict[str, dict[int, int]]:
    """부문별 {후보: 득표} — 지금 투표권이 있는 사람의 표만 센다."""
    out: dict[str, dict[int, int]] = {}
    for cat, cands in vote.candidates.items():
        counts = {c: 0 for c in cands}
        for b in ballots:
            if b.category == cat and b.voter_member_id in voters and b.candidate_member_id in counts:
                counts[b.candidate_member_id] += 1
        out[cat] = counts
    return out


def _stage(s: Session, vote_id: int, cat: str, member_ids: list[int]) -> None:
    cfg = dict(s.config or {})
    staged = list(cfg.get("staged_merits", []))
    for mid in member_ids:
        staged.append({"member_id": mid, "score_delta": 1, "reason": MERIT_REASON.format(LABEL[cat]), "vote_id": vote_id})
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


# ── 운영진 ──────────────────────────────────────────────────────────────────

class OpenIn(BaseModel):
    group_num: int | None = None
    candidates: list[int]


class CandidatesIn(BaseModel):
    candidates: list[int]


async def _check_candidates(db: AsyncSession, s: Session, ids: list[int]) -> list[int]:
    ids = list(dict.fromkeys(ids))
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
    groups = await _groups(db, session_id)
    votes = (await db.execute(
        select(SessionVote).where(SessionVote.session_id == session_id).order_by(SessionVote.round, SessionVote.id)
    )).scalars().all()
    for g in {v.group_num for v in votes}:  # 투표를 연 뒤 분반이 바뀌어도 기존 투표는 보이게
        if g not in groups:
            groups.append(g)
    eligible = {g: await _eligible(db, session_id, g) for g in groups}
    ballots = (await db.execute(
        select(SessionVoteBallot).where(SessionVoteBallot.vote_id.in_([v.id for v in votes] or [0]))
    )).scalars().all()
    all_ids = {mid for v in votes for c in v.candidates.values() for mid in c}
    names = {**{m: n for e in eligible.values() for m, n in e.items()}}
    missing = all_ids - names.keys()
    if missing:
        names.update({mid: n for mid, n in (await db.execute(select(Member.id, Member.name).where(Member.id.in_(missing)))).all()})

    out = []
    for v in votes:
        voters = eligible.get(v.group_num, {})
        mine = [b for b in ballots if b.vote_id == v.id]
        picks: dict[int, dict[str, int]] = {}
        for b in mine:
            picks.setdefault(b.voter_member_id, {})[b.category] = b.candidate_member_id
        out.append({
            "id": v.id, "group_num": v.group_num, "round": v.round, "parent_id": v.parent_id,
            "is_open": v.is_open, "result": v.result,
            "opened_at": v.opened_at, "closed_at": v.closed_at,
            "candidates": {cat: [{"id": m, "name": names.get(m, f"#{m}")} for m in ids] for cat, ids in v.candidates.items()},
            "tally": {cat: {str(k): n for k, n in c.items()} for cat, c in _tally(v, mine, set(voters)).items()},
            "voters": [{"id": m, "name": n, "picks": picks.get(m, {})} for m, n in voters.items()],
        })
    return {
        "session_status": s.status,
        "groups": groups,
        "eligible": {str(g): [{"id": m, "name": n} for m, n in e.items()] for g, e in eligible.items()},
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
    if body.group_num not in await _groups(db, session_id):
        raise HTTPException(status_code=422, detail="없는 분반입니다")
    dup = (await db.execute(select(SessionVote.id).where(
        SessionVote.session_id == session_id, SessionVote.round == 1,
        SessionVote.group_num.is_(None) if body.group_num is None else SessionVote.group_num == body.group_num,
    ))).first()
    if dup:
        raise HTTPException(status_code=409, detail="이 분반 투표가 이미 있습니다. 다시 열기를 사용하세요")
    ids = await _check_candidates(db, s, body.candidates)
    v = SessionVote(session_id=session_id, group_num=body.group_num, round=1, candidates={c: ids for c in VOTE_CATEGORIES})
    db.add(v)
    await db.commit()
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
    v, s = await _vote(db, vote_id, cohort_id, lock=True)
    _not_finalized(s)
    if not v.is_open or v.round != 1:
        raise HTTPException(status_code=409, detail="진행 중인 본투표만 후보를 바꿀 수 있습니다")
    ids = await _check_candidates(db, s, body.candidates)
    v.candidates = {c: ids for c in VOTE_CATEGORIES}
    # 빠진 후보에게 간 표는 무효 — 그 사람들은 다시 고르게 된다
    await db.execute(delete(SessionVoteBallot).where(
        SessionVoteBallot.vote_id == v.id, SessionVoteBallot.candidate_member_id.notin_(ids)))
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
    v, s = await _vote(db, vote_id, cohort_id, lock=True)
    _not_finalized(s)
    if not v.is_open:
        raise HTTPException(status_code=409, detail="이미 닫힌 투표입니다")
    voters = set(await _eligible(db, s.id, v.group_num))
    ballots = (await db.execute(select(SessionVoteBallot).where(SessionVoteBallot.vote_id == v.id))).scalars().all()
    result = {}
    for cat, counts in _tally(v, ballots, voters).items():
        top = max(counts.values(), default=0)
        winners = [m for m, n in counts.items() if n == top] if top > 0 else []
        if len(winners) == 1:
            _stage(s, v.id, cat, winners)
            result[cat] = {"winners": winners, "votes": top, "tie": False, "resolved": "auto"}
        else:  # 동률(2명 이상) — 운영진 선택 대기. 표가 하나도 없으면 아무도 안 뽑힌다.
            result[cat] = {"winners": winners, "votes": top, "tie": len(winners) > 1, "resolved": None if winners else "none"}
    v.is_open = False
    v.result = result
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
    v, s = await _vote(db, vote_id, cohort_id, lock=True)
    _not_finalized(s)
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
            _stage(s, v.id, cat, r["winners"])
        elif choice == "runoff":
            runoff[cat] = r["winners"]
        else:
            raise HTTPException(status_code=422, detail="runoff 또는 all 중에서 골라주세요")
        result[cat] = {**r, "resolved": choice}
    v.result = result
    flag_modified(v, "result")
    child = None
    if runoff:
        child = SessionVote(session_id=s.id, group_num=v.group_num, round=v.round + 1, parent_id=v.id, candidates=runoff)
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
    v, s = await _vote(db, vote_id, cohort_id, lock=True)
    _not_finalized(s)
    if v.is_open:
        raise HTTPException(status_code=409, detail="이미 진행 중인 투표입니다")
    kids = await _descendants(db, v.id)
    _unstage(s, {v.id, *kids})
    if kids:
        await db.execute(delete(SessionVote).where(SessionVote.id.in_(kids)))
    v.is_open = True
    v.result = None
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
    v, s = await _vote(db, vote_id, cohort_id, lock=True)
    _not_finalized(s)
    kids = await _descendants(db, v.id)
    _unstage(s, {v.id, *kids})
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
        .where(SessionVote.is_open == True, Session.cohort_id == cohort_id,  # noqa: E712
               Attendance.status.in_(VOTER_STATUSES))
        .order_by(SessionVote.id)
    )).all()
    votes = [(v, s) for v, s, g in rows if v.group_num is None or v.group_num == g]
    if not votes:
        return []
    ids = {m for v, _ in votes for c in v.candidates.values() for m in c}
    names = dict((await db.execute(select(Member.id, Member.name).where(Member.id.in_(ids)))).all())
    mine = (await db.execute(select(SessionVoteBallot).where(
        SessionVoteBallot.vote_id.in_([v.id for v, _ in votes]), SessionVoteBallot.voter_member_id == me,
    ))).scalars().all()
    return [{
        "id": v.id, "round": v.round, "group_num": v.group_num,
        "session_title": s.title, "session_week_num": s.week_num,
        "candidates": {cat: [{"id": m, "name": names.get(m, "")} for m in c if m != me] for cat, c in v.candidates.items()},
        "my": {b.category: b.candidate_member_id for b in mine if b.vote_id == v.id},
    } for v, s in votes]


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
    v, s = await _vote(db, vote_id, cohort_id, lock=True)
    if not v.is_open:
        raise HTTPException(status_code=409, detail="투표가 마감되었습니다")
    if me not in await _eligible(db, s.id, v.group_num):
        raise HTTPException(status_code=403, detail="이 투표에 참여할 수 없습니다")
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
        if pick == me:
            raise HTTPException(status_code=422, detail="본인에게는 투표할 수 없습니다")
        if pick not in v.candidates[cat]:
            raise HTTPException(status_code=422, detail="후보가 아닌 사람입니다")
        if existing:
            existing.candidate_member_id = pick
        else:
            db.add(SessionVoteBallot(vote_id=v.id, voter_member_id=me, category=cat, candidate_member_id=pick))
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
    # 기수원은 토큰(DB) 기수로 고정. 운영진은 토큰 기수, 전 기수 관리자만 cohort 파라미터로 고른다.
    room = identity.get("cohort_id")
    if room is None and identity["role"] == "admin":
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

