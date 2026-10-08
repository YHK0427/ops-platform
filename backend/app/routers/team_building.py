"""팀 빌딩 도우미 — 과거 팀세션 간 기수 겹침을 피해 팀을 짜는 독립 도구.

- 팀은 기수원(Member)만 구성 (운영진 제외).
- 과거 TEAM 세션의 team_history(같은 팀이었던 쌍)를 선택해 겹침 회피 기준으로 사용.
- 퇴출(비활성) 멤버는 현재 로스터에 없으므로, 양쪽 다 활성인 쌍만 겹침으로 집계.
- 작업 진행 상태(드래프트)는 기수당 여러 보드로 저장.
- 보드는 세션과 연결 가능(session_id). 세션 미생성 보드도 다른 보드의 겹침 기준으로 선택 가능,
  세션에 연결된 보드는 세션으로 대체(중복 방지).
- 연결된 보드의 기수 배치는 세션 팀이 기준(읽을 때 세션 팀으로 맞춤). 세션이 팀 수정 가능 단계
  (SETUP/PREP)면 보드에서 옮긴 것이 세션 팀에 바로 반영되고, 그 이후 단계면 보드는 읽기 전용.
"""
import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from fastapi import HTTPException, status

from app.audit_context import get_actor_label, get_actor_username
from app.deps import get_current_cohort_id, get_db, require_staff
from app.models import (
    Assignment, Member, Session as SessionModel, Team, TeamBuildingBoard, TeamMember, User,
)

# 세션 팀을 고칠 수 있는 단계 — sessions.confirm_teams 와 같은 기준
TEAM_EDITABLE = ("SETUP", "PREP")

logger = logging.getLogger("team_building")

router = APIRouter(prefix="/team-building", tags=["team-building"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class PastSession(BaseModel):
    session_id: int
    week_num: int
    title: str
    status: str | None = None


class MemberLite(BaseModel):
    id: int
    name: str
    tags: list[str] = []


class StaffLite(BaseModel):
    id: int
    name: str
    department: str | None = None


class PastMember(BaseModel):
    id: int
    name: str


class PastTeam(BaseModel):
    team_id: int
    name: str
    members: list[PastMember]
    staff: list[int] = []  # 운영진 user id — 보드 출처이거나, 세션에 연결된 보드에서 자동 추정


class PastSessionTeams(BaseModel):
    source: str = "session"  # "session" | "board"
    session_id: int | None = None
    board_id: int | None = None
    label: str
    teams: list[PastTeam]


class TeamBuildingData(BaseModel):
    members: list[MemberLite]
    staff: list[StaffLite]
    past_teams: list[PastSessionTeams]


class BoardCreate(BaseModel):
    name: str
    data: dict = {}


class BoardUpdate(BaseModel):
    name: str | None = None
    data: dict | None = None
    session_id: int | None = None  # 보낸 경우에만 반영 (null = 연결 해제)


class BoardResponse(BaseModel):
    id: int
    name: str
    data: dict
    created_by: str | None = None
    session_id: int | None = None
    session_label: str | None = None
    session_status: str | None = None  # SETUP/PREP 이면 보드↔세션 양방향, 그 이후면 보드 읽기 전용
    created_at: datetime
    updated_at: datetime | None = None


async def _get_board_or_404(board_id: int, cohort_id: int, db: AsyncSession) -> TeamBuildingBoard:
    board = await db.get(TeamBuildingBoard, board_id)
    if not board or board.cohort_id != cohort_id:
        raise HTTPException(status_code=404, detail="팀빌딩 보드를 찾을 수 없습니다")
    return board


def _session_label(week_num: int, title: str) -> str:
    # 제목에 이미 "N주차"가 들어간 세션이 많다 — "2주차 2주차 정기세션" 중복 방지
    return title if title.lstrip().startswith(f"{week_num}주차") else f"{week_num}주차 {title}"


_NUM = re.compile(r"\d+")


def _team_slots(teams: list[Team]) -> dict[int, int]:
    """세션 팀 id → 보드 팀 번호. 이름의 숫자("3조")를 우선 쓰고, 없거나 겹치면 남는 번호를 순서대로."""
    ordered = sorted(teams, key=lambda t: t.id)
    slots: dict[int, int] = {}
    for t in ordered:
        m = _NUM.search(t.name or "")
        if m and int(m.group()) not in slots.values():
            slots[t.id] = int(m.group())
    nxt = 1
    for t in ordered:
        if t.id not in slots:
            while nxt in slots.values():
                nxt += 1
            slots[t.id] = nxt
    return slots


async def _session_teams(session_id: int, db: AsyncSession) -> tuple[list[Team], dict[int, int]]:
    """세션 팀 목록 + 멤버 매핑 {member_id: team_id}."""
    teams = list((await db.execute(select(Team).where(Team.session_id == session_id))).scalars().all())
    rows = await db.execute(
        select(TeamMember.member_id, TeamMember.team_id).where(TeamMember.team_id.in_([t.id for t in teams]))
    ) if teams else None
    return teams, ({mid: tid for mid, tid in rows.all()} if rows else {})


async def _synced_data(board: TeamBuildingBoard, db: AsyncSession) -> dict:
    """연결된 보드는 기수 배치를 세션 팀으로 맞춰서 돌려준다(세션 = 기준). 운영진 배치는 보드 것 유지."""
    data = dict(board.data or {})
    if not board.session_id:
        return data
    teams, member_team = await _session_teams(board.session_id, db)
    slots = _team_slots(teams)
    asgn = {k: v for k, v in (data.get("assignment") or {}).items() if not k.startswith("m")}
    for mid, tid in member_team.items():
        asgn[f"m{mid}"] = slots[tid]
    data["assignment"] = asgn
    cur = data.get("num_teams") if isinstance(data.get("num_teams"), int) else 0
    data["num_teams"] = max(cur, max(slots.values(), default=0)) or 6
    return data


async def _board_out_db(board: TeamBuildingBoard, db: AsyncSession) -> BoardResponse:
    sess = await db.get(SessionModel, board.session_id) if board.session_id else None
    return BoardResponse(
        id=board.id, name=board.name, data=await _synced_data(board, db), created_by=board.created_by,
        session_id=board.session_id,
        session_label=_session_label(sess.week_num, sess.title) if sess else None,
        session_status=sess.status if sess else None,
        created_at=board.created_at, updated_at=board.updated_at,
    )


def _member_slots(data: dict) -> dict[int, int | None]:
    """보드에 올라온 기수별 팀 번호 (미배정이면 None). 보드 명단에 없는 기수(비활성 등)는 키 자체가 없다."""
    num = data.get("num_teams") if isinstance(data.get("num_teams"), int) else 99
    out: dict[int, int | None] = {}
    for key, slot in (data.get("assignment") or {}).items():
        if key[:1] == "m" and key[1:].isdigit():
            out[int(key[1:])] = slot if type(slot) is int and 1 <= slot <= num else None
    return out


async def _push_to_session(sess: SessionModel, data: dict, prev: dict, db: AsyncSession) -> bool:
    """보드에서 *직전 저장 대비 옮긴 기수만* 세션 팀에 반영 (SETUP/PREP 전용). 반환: 변경 여부.

    - 전체 덮어쓰기를 하지 않는 이유: 보드를 열어둔 사이 세션에서 고친 팀을, 보드에서 다른 사람
      한 명 옮겼다고 되돌려 버리면 안 된다. 보드 명단에 없는 기수(비활성)도 건드리지 않는다.
    - 팀 행은 지우고 다시 만들지 않는다 → 팀 과제(PPT 이메일 제출 상태) 보존.
      (sessions.confirm_teams 는 팀을 재생성해 팀 과제가 초기화되므로 쓰지 않음)
    """
    new, old = _member_slots(data), _member_slots(prev)
    moved = {mid: slot for mid, slot in new.items() if mid not in old or old[mid] != slot}
    if not moved:
        return False
    valid = set((await db.execute(
        select(Member.id).where(Member.id.in_(moved), Member.cohort_id == sess.cohort_id)
    )).scalars().all())
    moved = {mid: slot for mid, slot in moved.items() if mid in valid}

    teams, member_team = await _session_teams(sess.id, db)
    slot_team = {slot: tid for tid, slot in _team_slots(teams).items()}
    changed = False

    # 새 팀 번호 → 팀 생성 (+ 팀 PPT 이메일 과제)
    for slot in sorted({s for s in moved.values() if s is not None} - set(slot_team)):
        team = Team(session_id=sess.id, name=f"{slot}조")
        db.add(team)
        await db.flush()
        slot_team[slot] = team.id
        if sess.status == "PREP" and (sess.config or {}).get("has_ppt_email", True):
            db.add(Assignment(session_id=sess.id, team_id=team.id, member_id=None, type="PPT_EMAIL", status="PENDING"))
        changed = True

    added = []
    for mid, slot in moved.items():
        tid = member_team.get(mid)
        if slot is None:
            if tid is not None:
                await db.execute(delete(TeamMember).where(TeamMember.team_id == tid, TeamMember.member_id == mid))
                changed = True
        elif tid is None:
            db.add(TeamMember(team_id=slot_team[slot], member_id=mid))
            added.append(mid)
            changed = True
        elif slot_team[slot] != tid:
            await db.execute(
                update(TeamMember).where(TeamMember.team_id == tid, TeamMember.member_id == mid)
                .values(team_id=slot_team[slot])
            )
            changed = True

    # 새로 들어온 기수 개인 과제 (confirm_teams PREP 재편집과 동일 규칙: 없는 것만 생성)
    if added and sess.status == "PREP":
        cfg = sess.config or {}
        existing = {(r[0], r[1]) for r in (await db.execute(
            select(Assignment.member_id, Assignment.type).where(
                Assignment.session_id == sess.id, Assignment.member_id.in_(added))
        )).all()}
        for mid in added:
            for typ, key in (("PPT", "has_ppt"), ("REVIEW", "has_review"), ("FEEDBACK", "has_feedback")):
                if cfg.get(key, True) and (mid, typ) not in existing:
                    db.add(Assignment(session_id=sess.id, member_id=mid, type=typ, status="PENDING",
                                      **({"target_count": 1} if typ == "FEEDBACK" else {})))

    # 비게 된 팀: 팀 과제가 전부 대기 상태일 때만 정리 (제출 기록 있는 팀은 남김)
    await db.flush()
    teams, member_team = await _session_teams(sess.id, db)
    occupied = set(member_team.values())
    for t in teams:
        if t.id in occupied:
            continue
        statuses = set((await db.execute(
            select(Assignment.status).where(Assignment.team_id == t.id)
        )).scalars().all())
        if statuses <= {"PENDING"}:
            await db.execute(delete(Assignment).where(Assignment.team_id == t.id))
            await db.execute(delete(Team).where(Team.id == t.id))
            changed = True

    if changed:
        logger.info("board_synced_to_session session=%s moved=%d", sess.id, len(moved))
    return changed


def _board_teams(data: dict) -> dict[int, dict[str, list[int]]]:
    """보드 assignment({"m12": 3, "u4": 2, "m7": "pool"}) → {팀번호: {"members": [...], "staff": [...]}}."""
    num_teams = data.get("num_teams") if isinstance(data.get("num_teams"), int) else 99
    teams: dict[int, dict[str, list[int]]] = {}
    for key, slot in (data.get("assignment") or {}).items():
        if type(slot) is not int or not (1 <= slot <= num_teams):
            continue
        kind, raw = key[:1], key[1:]
        if kind not in ("m", "u") or not raw.isdigit():
            continue
        t = teams.setdefault(slot, {"members": [], "staff": []})
        t["members" if kind == "m" else "staff"].append(int(raw))
    return teams


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/past-sessions", response_model=list[PastSession])
async def list_past_sessions(
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """현재 기수의 팀 이력이 있는 과거 TEAM 세션 목록 (겹침 기준으로 선택)."""
    result = await db.execute(
        select(SessionModel.id, SessionModel.week_num, SessionModel.title, SessionModel.status)
        .where(
            SessionModel.cohort_id == cohort_id,
            SessionModel.type == "TEAM",
            SessionModel.id.in_(select(Team.session_id)),  # 팀이 확정된 세션 (진행 전 포함)
        )
        .order_by(SessionModel.week_num)
    )
    return [PastSession(session_id=r[0], week_num=r[1], title=r[2], status=r[3]) for r in result.all()]


@router.get("/data", response_model=TeamBuildingData)
async def get_data(
    session_ids: str = Query("", description="겹침 기준으로 삼을 과거 세션 id (콤마구분)"),
    board_ids: str = Query("", description="겹침 기준으로 삼을 세션 미연결 보드 id (콤마구분)"),
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """현재 기수 활성 멤버(로스터) + 선택 세션들의 겹침 쌍을 반환."""
    # 현재 기수 활성 멤버
    members_res = await db.execute(
        select(Member.id, Member.name, Member.tags)
        .where(Member.is_active == True, Member.cohort_id == cohort_id)
        .order_by(Member.name)
    )
    members = [MemberLite(id=r[0], name=r[1], tags=list(r[2] or [])) for r in members_res.all()]

    # 현재 기수 운영진 (보드에서 참여 설정 가능 — 겹침 이력은 없음, 배치용)
    staff_res = await db.execute(
        select(User.id, User.display_name, User.department)
        .where(User.is_active == True, User.cohort_id == cohort_id)
        .order_by(User.display_name)
    )
    staff = [StaffLite(id=r[0], name=r[1], department=r[2]) for r in staff_res.all()]

    def _ids(raw: str) -> list[int]:
        return [int(t) for t in (tok.strip() for tok in raw.split(",")) if t.isdigit()]

    sids = _ids(session_ids)
    bids = _ids(board_ids)

    past_teams: list[PastSessionTeams] = []
    if sids:
        # 선택 세션이 현재 기수 소속인지 확인 (타 기수 세션 차단)
        valid_res = await db.execute(
            select(SessionModel.id, SessionModel.week_num, SessionModel.title).where(
                SessionModel.id.in_(sids), SessionModel.cohort_id == cohort_id
            )
        )
        labels = {r[0]: _session_label(r[1], r[2]) for r in valid_res.all()}
        valid_sids = list(labels.keys())

        if valid_sids:
            # 각 세션의 실제 팀 구성(기수 명단). 퇴출 멤버 이름도 표시하되 겹침은 프론트가 현재 로스터로 필터.
            rows = await db.execute(
                select(Team.session_id, Team.id, Team.name, Member.id, Member.name)
                .join(TeamMember, TeamMember.team_id == Team.id)
                .join(Member, Member.id == TeamMember.member_id)
                .where(Team.session_id.in_(valid_sids))
                .order_by(Team.session_id, Team.id, Member.name)
            )
            # session -> team_id -> {name, members[]}
            sess_map: dict[int, dict[int, dict]] = {}
            for sid, tid, tname, mid, mname in rows.all():
                t = sess_map.setdefault(sid, {}).setdefault(tid, {"name": tname, "members": []})
                t["members"].append(PastMember(id=mid, name=mname))
            # 세션에 연결된 보드가 있으면 그 보드의 운영진 배치를 세션 팀에 자동 추정.
            # 세션 팀엔 기수원만 저장되므로, 보드 팀과 기수원이 가장 많이 겹치는 세션 팀에 배치
            # (세션에서 팀을 일부 수정해도 따라감).
            linked_res = await db.execute(
                select(TeamBuildingBoard.session_id, TeamBuildingBoard.data)
                .where(TeamBuildingBoard.session_id.in_(valid_sids))
            )
            auto_staff: dict[int, dict[int, list[int]]] = {}
            for sid, bdata in linked_res.all():
                sess_teams = sess_map.get(sid, {})
                for bt in _board_teams(bdata or {}).values():
                    if not bt["staff"]:
                        continue
                    bm = set(bt["members"])
                    best_tid, best_n = None, 0
                    for tid, t in sess_teams.items():
                        n = len(bm & {m.id for m in t["members"]})
                        if n > best_n:
                            best_tid, best_n = tid, n
                    if best_tid is not None:
                        auto_staff.setdefault(sid, {}).setdefault(best_tid, []).extend(bt["staff"])

            for sid in valid_sids:
                tmap = sess_map.get(sid, {})
                past_teams.append(PastSessionTeams(
                    source="session",
                    session_id=sid,
                    label=labels.get(sid, ""),
                    teams=[
                        PastTeam(team_id=tid, name=t["name"], members=t["members"],
                                 staff=auto_staff.get(sid, {}).get(tid, []))
                        for tid, t in tmap.items()
                    ],
                ))

    if bids:
        # 세션 미연결 보드만 (연결된 보드는 해당 세션으로 대체 → 중복 방지)
        boards_res = await db.execute(
            select(TeamBuildingBoard).where(
                TeamBuildingBoard.id.in_(bids),
                TeamBuildingBoard.cohort_id == cohort_id,
                TeamBuildingBoard.session_id.is_(None),
            ).order_by(TeamBuildingBoard.created_at)
        )
        boards = list(boards_res.scalars().all())
        bteams = {b.id: _board_teams(b.data or {}) for b in boards}
        all_mids = {mid for bt in bteams.values() for t in bt.values() for mid in t["members"]}
        names: dict[int, str] = {}
        if all_mids:
            nres = await db.execute(
                select(Member.id, Member.name).where(Member.id.in_(all_mids), Member.cohort_id == cohort_id)
            )
            names = {r[0]: r[1] for r in nres.all()}
        for b in boards:
            past_teams.append(PastSessionTeams(
                source="board",
                board_id=b.id,
                label=b.name,
                teams=[
                    PastTeam(
                        team_id=idx,
                        name=f"팀 {idx}",
                        members=sorted(
                            (PastMember(id=mid, name=names[mid]) for mid in t["members"] if mid in names),
                            key=lambda m: m.name,
                        ),
                        staff=t["staff"],
                    )
                    for idx, t in sorted(bteams[b.id].items())
                ],
            ))

    return TeamBuildingData(members=members, staff=staff, past_teams=past_teams)


@router.get("/boards", response_model=list[BoardResponse])
async def list_boards(
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """현재 기수의 팀빌딩 보드 목록 (예: 리슨업 팀빌딩, BP 팀빌딩)."""
    res = await db.execute(
        select(TeamBuildingBoard)
        .where(TeamBuildingBoard.cohort_id == cohort_id)
        .order_by(TeamBuildingBoard.created_at.desc())
    )
    # 연결된 보드는 세션 팀으로 맞춘 배치를 내려준다 (위저드 '보드에서 불러오기'가 이 값을 씀)
    return [await _board_out_db(b, db) for b in res.scalars().all()]


@router.post("/boards", response_model=BoardResponse, status_code=status.HTTP_201_CREATED)
async def create_board(
    body: BoardCreate,
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """새 팀빌딩 보드 생성 (운영진이 이름 지정)."""
    board = TeamBuildingBoard(
        cohort_id=cohort_id, name=body.name.strip() or "팀 빌딩", data=body.data,
        created_by=get_actor_label(), created_by_username=get_actor_username(),
    )
    db.add(board)
    await db.commit()
    await db.refresh(board)
    return await _board_out_db(board, db)


@router.get("/boards/{board_id}", response_model=BoardResponse)
async def get_board(
    board_id: int,
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    return await _board_out_db(await _get_board_or_404(board_id, cohort_id, db), db)


@router.put("/boards/{board_id}", response_model=BoardResponse)
async def update_board(
    board_id: int,
    body: BoardUpdate,
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """보드 저장 (이름/작업상태/세션 연결). 자동저장에 사용."""
    board = await _get_board_or_404(board_id, cohort_id, db)
    if body.name is not None:
        board.name = body.name.strip() or board.name
    linking = "session_id" in body.model_fields_set
    if body.data is not None:
        prev = board.data or {}
        board.data = body.data
        # 이미 연결된 보드의 배치 변경 → 세션이 팀 수정 가능 단계면 세션 팀에 반영.
        # 그 이후 단계면 반영하지 않는다(읽을 때 세션 팀으로 덮이므로 보드는 사실상 읽기 전용).
        if board.session_id and not linking:
            sess = await db.get(SessionModel, board.session_id)
            if sess and sess.status in TEAM_EDITABLE:
                await _push_to_session(sess, body.data, prev, db)
    if linking:
        if board.session_id and board.session_id != body.session_id:
            # 연결 해제/변경 시 마지막 세션 팀 구성을 보드에 남긴다 (읽을 때만 맞추던 값을 고정)
            board.data = await _synced_data(board, db)
        if body.session_id is not None:
            sess = await db.get(SessionModel, body.session_id)
            if not sess or sess.cohort_id != cohort_id or sess.type != "TEAM":
                raise HTTPException(status_code=400, detail="같은 기수의 팀세션만 연결할 수 있습니다")
            # 세션 1개 ↔ 보드 1개: 같은 세션에 연결돼 있던 다른 보드는 해제 (마지막 세션 팀 구성은 남김)
            others = (await db.execute(select(TeamBuildingBoard).where(
                TeamBuildingBoard.session_id == body.session_id, TeamBuildingBoard.id != board.id,
            ))).scalars().all()
            for other in others:
                other.data = await _synced_data(other, db)
                other.session_id = None
        board.session_id = body.session_id
        if body.session_id is not None:
            # 연결 시점부터 세션 팀이 기준 — 저장값도 맞춰 둬야 다음 저장의 '옮긴 사람' 비교가 맞다
            board.data = await _synced_data(board, db)
    board.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(board)
    return await _board_out_db(board, db)


@router.delete("/boards/{board_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_board(
    board_id: int,
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    board = await _get_board_or_404(board_id, cohort_id, db)
    await db.delete(board)
    await db.commit()
