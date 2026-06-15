"""팀 빌딩 도우미 — 과거 팀세션 간 기수 겹침을 피해 팀을 짜는 독립 도구.

- 팀은 기수원(Member)만 구성 (운영진 제외).
- 과거 TEAM 세션의 team_history(같은 팀이었던 쌍)를 선택해 겹침 회피 기준으로 사용.
- 퇴출(비활성) 멤버는 현재 로스터에 없으므로, 양쪽 다 활성인 쌍만 겹침으로 집계.
- 작업 진행 상태(드래프트)는 기수당 1개 저장.
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from fastapi import HTTPException, status

from app.deps import get_current_cohort_id, get_db, require_staff
from app.models import (
    Member, Session as SessionModel, Team, TeamBuildingBoard, TeamMember, User,
)

logger = logging.getLogger("team_building")

router = APIRouter(prefix="/team-building", tags=["team-building"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class PastSession(BaseModel):
    session_id: int
    week_num: int
    title: str


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


class PastSessionTeams(BaseModel):
    session_id: int
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


class BoardResponse(BaseModel):
    id: int
    name: str
    data: dict
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


async def _get_board_or_404(board_id: int, cohort_id: int, db: AsyncSession) -> TeamBuildingBoard:
    board = await db.get(TeamBuildingBoard, board_id)
    if not board or board.cohort_id != cohort_id:
        raise HTTPException(status_code=404, detail="팀빌딩 보드를 찾을 수 없습니다")
    return board


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/past-sessions", response_model=list[PastSession])
async def list_past_sessions(
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """현재 기수의 팀 이력이 있는 과거 TEAM 세션 목록 (겹침 기준으로 선택)."""
    result = await db.execute(
        select(SessionModel.id, SessionModel.week_num, SessionModel.title)
        .where(
            SessionModel.cohort_id == cohort_id,
            SessionModel.type == "TEAM",
            SessionModel.id.in_(select(Team.session_id)),  # 팀이 짜인 세션
        )
        .order_by(SessionModel.week_num)
    )
    return [PastSession(session_id=r[0], week_num=r[1], title=r[2]) for r in result.all()]


@router.get("/data", response_model=TeamBuildingData)
async def get_data(
    session_ids: str = Query("", description="겹침 기준으로 삼을 과거 세션 id (콤마구분)"),
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

    # 선택 세션 파싱
    sids: list[int] = []
    for tok in session_ids.split(","):
        tok = tok.strip()
        if tok.isdigit():
            sids.append(int(tok))

    past_teams: list[PastSessionTeams] = []
    if sids:
        # 선택 세션이 현재 기수 소속인지 확인 (타 기수 세션 차단)
        valid_res = await db.execute(
            select(SessionModel.id, SessionModel.week_num, SessionModel.title).where(
                SessionModel.id.in_(sids), SessionModel.cohort_id == cohort_id
            )
        )
        labels = {r[0]: f"{r[1]}주차 {r[2]}" for r in valid_res.all()}
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
            for sid in valid_sids:
                tmap = sess_map.get(sid, {})
                past_teams.append(PastSessionTeams(
                    session_id=sid,
                    label=labels.get(sid, ""),
                    teams=[PastTeam(team_id=tid, name=t["name"], members=t["members"]) for tid, t in tmap.items()],
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
    return list(res.scalars().all())


@router.post("/boards", response_model=BoardResponse, status_code=status.HTTP_201_CREATED)
async def create_board(
    body: BoardCreate,
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """새 팀빌딩 보드 생성 (운영진이 이름 지정)."""
    board = TeamBuildingBoard(cohort_id=cohort_id, name=body.name.strip() or "팀 빌딩", data=body.data)
    db.add(board)
    await db.commit()
    await db.refresh(board)
    return board


@router.get("/boards/{board_id}", response_model=BoardResponse)
async def get_board(
    board_id: int,
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    return await _get_board_or_404(board_id, cohort_id, db)


@router.put("/boards/{board_id}", response_model=BoardResponse)
async def update_board(
    board_id: int,
    body: BoardUpdate,
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """보드 저장 (이름/작업상태). 자동저장에 사용."""
    board = await _get_board_or_404(board_id, cohort_id, db)
    if body.name is not None:
        board.name = body.name.strip() or board.name
    if body.data is not None:
        board.data = body.data
    board.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(board)
    return board


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
