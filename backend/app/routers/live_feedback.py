"""실시간 익명 상호 피드백 보드 — REST + WebSocket API.

주의: 기존 Assignment.type='FEEDBACK'(세션 후 네이버 카페 댓글 과제)와 완전히 별개.
익명 방화벽: 멤버 클라이언트에는 익명 글의 실명/author_member_id 절대 전송 금지.
발표 순서(presenter_order)도 멤버에게는 비노출.
"""

import logging
import random
import re
from datetime import datetime, timezone

from fastapi import (
    APIRouter, Depends, HTTPException, Query, Response, WebSocket, WebSocketDisconnect, status,
)
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import AsyncSessionLocal
from app.deps import (
    decode_ws_token, get_current_cohort_id, get_current_member, get_db,
    get_member_cohort_id, require_staff,
)
from app.models import (
    Attendance,
    LiveFeedbackAnonAlias,
    LiveFeedbackBoard,
    LiveFeedbackPost,
    LiveFeedbackReaction,
    Member,
    Session,
    User,
)
from app.services.live_feedback_ws import manager
from app.audit import record_audit

logger = logging.getLogger("live_feedback")

router = APIRouter(prefix="/live-feedback", tags=["live-feedback"])

ALLOWED_EMOJIS = ("👍", "❤️", "👏", "🔥", "🎉", "😮", "😂", "🥹", "🥺", "😍", "🤩", "💯", "🙌", "💪", "🙏", "✨", "⭐", "🤔", "👀", "🫶")
MAX_CONTENT_LEN = 1000

# 카테고리 색 팔레트 (프론트 정적 Tailwind 매핑과 일치해야 함)
ALLOWED_COLORS = {"emerald", "amber", "sky", "violet", "rose", "indigo", "teal", "slate"}
DEFAULT_CATEGORIES = [
    {"key": "praise", "label": "칭찬", "color": "emerald"},
    {"key": "improve", "label": "발전", "color": "amber"},
]
_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,23}$")


def _validate_categories(cats: list["CategoryIn"] | None) -> list[dict]:
    """카테고리 검증·정규화. None/빈 값이면 기본(칭찬/발전)."""
    if not cats:
        return [dict(c) for c in DEFAULT_CATEGORIES]
    if len(cats) > 8:
        raise HTTPException(status_code=400, detail="카테고리는 최대 8개까지입니다")
    out: list[dict] = []
    seen: set[str] = set()
    for c in cats:
        key = (c.key or "").strip().lower()
        label = (c.label or "").strip()
        color = (c.color or "").strip()
        if not _KEY_RE.match(key):
            raise HTTPException(status_code=400, detail="카테고리 키 형식이 올바르지 않습니다")
        if key in seen:
            raise HTTPException(status_code=400, detail="카테고리 키가 중복됩니다")
        if not (1 <= len(label) <= 20):
            raise HTTPException(status_code=400, detail="카테고리 이름은 1~20자입니다")
        if color not in ALLOWED_COLORS:
            raise HTTPException(status_code=400, detail="허용되지 않은 색입니다")
        seen.add(key)
        out.append({"key": key, "label": label, "color": color})
    return out

# 발표(피드백 대상)로 인정하는 출석 상태. 결석(ABSENT)·공결(EXCUSED)은 항상 제외.
# 조퇴(EARLY_LEAVE)는 보드의 early_leave_member_ids에 개별 포함된 사람만.
PRESENT_STATUSES = {"PRESENT", "LATE_UNDER10", "LATE_OVER10", "PENDING"}


def _attended(status: str | None, member_id: int, early_leave_ids: set[int]) -> bool:
    if status == "EARLY_LEAVE":
        return member_id in early_leave_ids
    return status in PRESENT_STATUSES

# 익명 닉네임 풀 (요상한 형용사 × 동물/사물)
_ADJ = [
    "엉뚱한", "졸린", "수상한", "용감한", "느긋한", "수줍은", "씩씩한", "날쌘",
    "멍한", "행복한", "배고픈", "호기심많은", "점잖은", "장난꾸러기", "나른한",
    "상냥한", "우아한", "엄청난", "반짝이는", "폭신한", "새침한", "든든한", "깜찍한",
]
_NOUN = [
    "너구리", "감자", "펭귄", "고등어", "수달", "햄스터", "두더지", "고슴도치",
    "문어", "알파카", "코알라", "북극곰", "다람쥐", "올빼미", "청설모", "바다표범",
    "개구리", "나무늘보", "해마", "두루미", "치타", "판다", "여우", "왕꿈틀이",
]


# ── Schemas ──────────────────────────────────────────────────────────────────

class CategoryIn(BaseModel):
    key: str
    label: str
    color: str


class BoardCreateRequest(BaseModel):
    session_id: int
    title: str = Field(min_length=1, max_length=100)
    early_leave_member_ids: list[int] | None = None
    categories: list[CategoryIn] | None = None


class BoardUpdateRequest(BaseModel):
    is_open: bool | None = None
    title: str | None = Field(default=None, max_length=100)
    early_leave_member_ids: list[int] | None = None
    categories: list[CategoryIn] | None = None


class PostCreateRequest(BaseModel):
    presenter_member_id: int
    # 카테고리별 내용 {categoryKey: text} — 최소 1개 필수
    contents: dict[str, str] = Field(default_factory=dict)
    is_anonymous: bool = True
    client_nonce: str | None = None


class PostUpdateRequest(BaseModel):
    contents: dict[str, str] = Field(default_factory=dict)
    is_anonymous: bool | None = None


class ReactionRequest(BaseModel):
    emoji: str


class PostHideRequest(BaseModel):
    is_hidden: bool


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _get_board_or_404(
    db: AsyncSession, board_id: int, cohort_id: int | None = None
) -> LiveFeedbackBoard:
    board = await db.get(LiveFeedbackBoard, board_id)
    if not board:
        raise HTTPException(status_code=404, detail="피드백 보드를 찾을 수 없습니다")
    # 기수 격리: 보드는 세션 경유 — 세션의 cohort가 현재 기수와 다르면 404
    if cohort_id is not None:
        session = await db.get(Session, board.session_id)
        if session is None or session.cohort_id != cohort_id:
            raise HTTPException(status_code=404, detail="피드백 보드를 찾을 수 없습니다")
    return board


async def _member_group(db: AsyncSession, session_id: int, member_id: int) -> int | None:
    r = await db.execute(
        select(Attendance.group_num).where(
            Attendance.session_id == session_id,
            Attendance.member_id == member_id,
        )
    )
    return r.scalar_one_or_none()


async def _early_leave_candidates(db: AsyncSession, session_id: int) -> list[dict]:
    """세션의 조퇴(EARLY_LEAVE) 출석자 — 운영진이 개별 포함 여부 선택할 후보."""
    rows = await db.execute(
        select(Attendance.member_id, Attendance.group_num, Member.name)
        .join(Member, Member.id == Attendance.member_id)
        .where(Attendance.session_id == session_id, Attendance.status == "EARLY_LEAVE")
        .order_by(Member.name)
    )
    return [{"member_id": mid, "group_num": gn, "name": name} for mid, gn, name in rows.all()]


async def _valid_early_leave_ids(db: AsyncSession, session_id: int, requested: list[int] | None) -> list[int]:
    """요청된 조퇴 포함 id 중 실제 EARLY_LEAVE인 것만 통과."""
    if not requested:
        return []
    cand = {c["member_id"] for c in await _early_leave_candidates(db, session_id)}
    return [m for m in dict.fromkeys(requested) if m in cand]


async def _presenter_columns(
    db: AsyncSession, session_id: int, reveal_order: bool,
    restrict_group: int | None = None, early_leave_ids: set[int] | None = None,
) -> list[dict]:
    """세션의 발표자 목록을 Attendance에서 실시간 조회.
    결석/공결 제외, 조퇴는 early_leave_ids에 개별 포함된 사람만.
    분반(group_num)이 있으면 분반별, 없으면(분반 미사용 개인 세션) 전체 출석자를 단일 그룹으로.
    restrict_group이 주어지면 해당 분반만(멤버는 자기 분반끼리만 피드백).
    reveal_order=False(멤버용)이면 presenter_order 제외 + 이름 가나다순(발표 순서 비노출)."""
    early = early_leave_ids or set()
    rows = await db.execute(
        select(Attendance.member_id, Attendance.group_num, Attendance.presenter_order, Attendance.status, Member.name)
        .join(Member, Member.id == Attendance.member_id)
        .where(Attendance.session_id == session_id)
    )
    # 발표한(=피드백 대상) 출석자만
    all_rows = [
        (mid, gn, po, name)
        for mid, gn, po, status, name in rows.all()
        if _attended(status, mid, early)
    ]
    has_groups = any(gn is not None for _, gn, _, _ in all_rows)

    if has_groups:
        src = [(mid, gn, po, name) for mid, gn, po, name in all_rows if gn is not None]
        if restrict_group is not None:
            src = [t for t in src if t[1] == restrict_group]
    else:
        # 분반 없는 개인 세션 → 전체 출석자, group_num=None(분반 라벨 없음)
        src = [(mid, None, po, name) for mid, gn, po, name in all_rows]

    items = [
        {"presenter_member_id": mid, "group_num": gn, "presenter_order": po, "name": name}
        for mid, gn, po, name in src
    ]
    if reveal_order:
        items.sort(key=lambda x: (
            x["group_num"] if x["group_num"] is not None else 0,
            x["presenter_order"] if x["presenter_order"] is not None else 9999,
            x["name"],
        ))
    else:
        items.sort(key=lambda x: (x["group_num"] if x["group_num"] is not None else 0, x["name"]))  # 가나다순
        for it in items:
            it.pop("presenter_order", None)
    return items


async def _get_or_create_alias(
    db: AsyncSession, board_id: int, member_id: int | None = None, user_id: int | None = None
) -> str:
    """보드 내 작성자(기수원·운영진)의 익명 닉네임 조회/생성 (같은 작성자 = 같은 닉네임).
    운영진이 익명일 때 기수원에게는 멤버와 똑같은 형식의 닉네임으로 보인다."""
    col = LiveFeedbackAnonAlias.member_id if member_id is not None else LiveFeedbackAnonAlias.user_id
    val = member_id if member_id is not None else user_id
    existing = await db.execute(
        select(LiveFeedbackAnonAlias.alias).where(
            LiveFeedbackAnonAlias.board_id == board_id, col == val,
        )
    )
    found = existing.scalar_one_or_none()
    if found:
        return found

    used_q = await db.execute(
        select(LiveFeedbackAnonAlias.alias).where(LiveFeedbackAnonAlias.board_id == board_id)
    )
    used = set(used_q.scalars().all())
    combos = [f"{a} {n}" for a in _ADJ for n in _NOUN]
    random.shuffle(combos)
    alias = next((c for c in combos if c not in used), None)
    if alias is None:
        alias = f"익명 {random.randint(1000, 9999)}"

    db.add(LiveFeedbackAnonAlias(board_id=board_id, member_id=member_id, user_id=user_id, alias=alias))
    await db.flush()
    return alias


def _reaction_summary(post: LiveFeedbackPost, viewer_member_id: int | None = None, viewer_user_id: int | None = None):
    counts: dict[str, int] = {}
    mine: list[str] = []
    for r in post.reactions:
        counts[r.emoji] = counts.get(r.emoji, 0) + 1
        if (viewer_member_id is not None and r.member_id == viewer_member_id) or \
           (viewer_user_id is not None and r.user_id == viewer_user_id):
            mine.append(r.emoji)
    return counts, mine


def _iso(dt) -> str | None:
    return dt.isoformat() if dt else None


def _post_admin_dict(post: LiveFeedbackPost, alias_map: dict[str, str] | None = None,
                     viewer_user_id: int | None = None) -> dict:
    """운영진용 — 항상 실명(운영진끼리는 익명이어도 누군지 보임) + 익명 여부 배지.
    anon_alias: 익명 글의 닉네임(발표용 화면에서 '익명 적용'을 켜면 실명 대신 표시).
    my_reactions: 이 운영진이 누른 반응(반응 토글 표시용)."""
    counts, mine = _reaction_summary(post, viewer_user_id=viewer_user_id)
    is_staff = post.author_user_id is not None
    author_name = (post.author_user.display_name if post.author_user else None) if is_staff \
        else (post.author.name if post.author else None)
    author_key = f"u{post.author_user_id}" if is_staff else f"m{post.author_member_id}"
    anon_alias = (alias_map or {}).get(author_key) if post.is_anonymous else None
    return {
        "id": post.id,
        "board_id": post.board_id,
        "presenter_member_id": post.presenter_member_id,
        "presenter_name": post.presenter.name if post.presenter else None,
        "contents": post.contents or {},
        "is_anonymous": post.is_anonymous,
        "is_hidden": post.is_hidden,
        "author_member_id": post.author_member_id,
        "author_name": author_name,
        "author_is_staff": is_staff,
        "anon_alias": anon_alias,
        "reactions": counts,
        "my_reactions": mine,
        "created_at": _iso(post.created_at),
    }


def _post_member_dict(
    post: LiveFeedbackPost,
    alias_map: dict[str, str],
    viewer_member_id: int | None = None,
) -> dict:
    """멤버용 — 익명이면 alias만(운영진 익명도 동일한 닉네임 형식, 운영진인지 노출 X),
    실명/author_member_id 절대 미포함. alias_map 키는 'm{member_id}' / 'u{user_id}'."""
    counts, mine = _reaction_summary(post, viewer_member_id)
    is_staff = post.author_user_id is not None
    author_key = f"u{post.author_user_id}" if is_staff else f"m{post.author_member_id}"
    if post.is_anonymous:
        # 익명이면 기수원에겐 그냥 닉네임 — 운영진인지 드러내지 않음
        display_name = alias_map.get(author_key) or "익명"
        author_id = None
        show_staff = False
    else:
        display_name = (post.author_user.display_name if is_staff and post.author_user else None) if is_staff \
            else (post.author.name if post.author else None)
        author_id = None if is_staff else post.author_member_id
        show_staff = is_staff  # 비익명 운영진 글은 '운영진' 배지 노출
    d = {
        "id": post.id,
        "board_id": post.board_id,
        "presenter_member_id": post.presenter_member_id,
        "presenter_name": post.presenter.name if post.presenter else None,
        "contents": post.contents or {},
        "is_anonymous": post.is_anonymous,
        "author_name": display_name,
        "is_staff": show_staff,
        "reactions": counts,
        "created_at": _iso(post.created_at),
    }
    if author_id is not None:
        d["author_member_id"] = author_id
    if viewer_member_id is not None:
        d["my_reactions"] = mine
        # 본인 글 여부만 알려줌(익명 작성자 노출 X) — 수정 버튼 표시용
        d["is_mine"] = post.author_member_id == viewer_member_id
    return d


async def _load_post_full(db: AsyncSession, post_id: int) -> LiveFeedbackPost | None:
    q = await db.execute(
        select(LiveFeedbackPost)
        .options(
            selectinload(LiveFeedbackPost.reactions),
            selectinload(LiveFeedbackPost.author),
            selectinload(LiveFeedbackPost.author_user),
            selectinload(LiveFeedbackPost.presenter),
        )
        .where(LiveFeedbackPost.id == post_id)
    )
    return q.scalar_one_or_none()


# ── 운영진 (admin/staff) ───────────────────────────────────────────────────────

@router.post("/boards", status_code=201)
async def create_board(
    body: BoardCreateRequest,
    user: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    session = await db.get(Session, body.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    # 기수 격리: 세션이 현재 기수 소속인지 검증
    if session.cohort_id != cohort_id:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    if session.type != "INDIVIDUAL":
        raise HTTPException(status_code=400, detail="개인(분반) 세션에서만 사용할 수 있습니다")

    existing = await db.execute(
        select(LiveFeedbackBoard).where(LiveFeedbackBoard.session_id == body.session_id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="이 세션에는 이미 피드백 보드가 있습니다")

    board = LiveFeedbackBoard(
        session_id=body.session_id, title=body.title,
        early_leave_member_ids=await _valid_early_leave_ids(db, body.session_id, body.early_leave_member_ids),
        categories=_validate_categories(body.categories),
    )
    db.add(board)
    await db.commit()
    await db.refresh(board)
    record_audit(user, "실시간 피드백 보드 생성", f"id={board.id} 세션={body.session_id} 제목='{body.title}'")
    return {
        "id": board.id,
        "session_id": board.session_id,
        "title": board.title,
        "is_open": board.is_open,
        "early_leave_member_ids": board.early_leave_member_ids,
        "categories": board.categories,
        "post_count": 0,
        "created_at": _iso(board.created_at),
        "closed_at": _iso(board.closed_at),
    }


@router.get("/sessions/{session_id}/early-leave")
async def session_early_leave(
    session_id: int,
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """세션의 조퇴자 후보 목록 (보드 생성/수정 시 개별 포함 선택용)."""
    # 기수 격리: 세션이 현재 기수 소속인지 검증
    session = await db.get(Session, session_id)
    if session is None or session.cohort_id != cohort_id:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    return await _early_leave_candidates(db, session_id)


@router.get("/boards")
async def list_boards(
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    # 기수 격리: 보드는 세션 경유 — 현재 기수 세션의 보드만
    boards_q = await db.execute(
        select(LiveFeedbackBoard)
        .join(Session, Session.id == LiveFeedbackBoard.session_id)
        .where(Session.cohort_id == cohort_id)
        .order_by(LiveFeedbackBoard.id.desc())
    )
    boards = boards_q.scalars().all()
    if not boards:
        return []

    counts_q = await db.execute(
        select(LiveFeedbackPost.board_id, func.count(LiveFeedbackPost.id))
        .group_by(LiveFeedbackPost.board_id)
    )
    count_map = {bid: c for bid, c in counts_q.all()}

    session_ids = [b.session_id for b in boards]
    sess_q = await db.execute(
        select(Session.id, Session.title, Session.week_num).where(Session.id.in_(session_ids))
    )
    sess_map = {sid: (title, wk) for sid, title, wk in sess_q.all()}

    out = []
    for b in boards:
        title, wk = sess_map.get(b.session_id, (None, None))
        out.append({
            "id": b.id,
            "session_id": b.session_id,
            "session_title": title,
            "session_week_num": wk,
            "title": b.title,
            "is_open": b.is_open,
            "early_leave_member_ids": b.early_leave_member_ids,
            "categories": b.categories,
            "post_count": count_map.get(b.id, 0),
            "created_at": _iso(b.created_at),
            "closed_at": _iso(b.closed_at),
        })
    return out


@router.get("/boards/{board_id}")
async def get_board_admin(
    board_id: int,
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    board = await _get_board_or_404(db, board_id, cohort_id)
    session = await db.get(Session, board.session_id)
    presenters = await _presenter_columns(
        db, board.session_id, reveal_order=True, early_leave_ids=set(board.early_leave_member_ids or []),
    )
    return {
        "id": board.id,
        "session_id": board.session_id,
        "session_title": session.title if session else None,
        "session_week_num": session.week_num if session else None,
        "title": board.title,
        "is_open": board.is_open,
        "early_leave_member_ids": board.early_leave_member_ids,
        "early_leave_candidates": await _early_leave_candidates(db, board.session_id),
        "categories": board.categories,
        "created_at": _iso(board.created_at),
        "closed_at": _iso(board.closed_at),
        "presenters": presenters,
    }


@router.patch("/boards/{board_id}")
async def update_board(
    board_id: int,
    body: BoardUpdateRequest,
    user: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    board = await _get_board_or_404(db, board_id, cohort_id)
    if body.title is not None:
        board.title = body.title
    if body.early_leave_member_ids is not None:
        board.early_leave_member_ids = await _valid_early_leave_ids(
            db, board.session_id, body.early_leave_member_ids,
        )
    if body.categories is not None:
        board.categories = _validate_categories(body.categories)
    opened_changed = False
    if body.is_open is not None and body.is_open != board.is_open:
        if board.is_open and not body.is_open:
            board.closed_at = datetime.now(timezone.utc)
        board.is_open = body.is_open
        opened_changed = True
    await db.commit()
    await db.refresh(board)

    if opened_changed:
        evt = {"type": "board.opened" if board.is_open else "board.closed",
               "data": {"board_id": board.id, "is_open": board.is_open}}
        await manager.broadcast(board.id, evt, evt)
    record_audit(user, "피드백 보드 설정 변경", f"id={board_id} 공개={board.is_open}")
    return {
        "id": board.id, "title": board.title, "is_open": board.is_open,
        "early_leave_member_ids": board.early_leave_member_ids, "categories": board.categories,
        "closed_at": _iso(board.closed_at),
    }


@router.delete("/boards/{board_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_board(
    board_id: int,
    user: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    board = await _get_board_or_404(db, board_id, cohort_id)
    title = board.title
    await db.delete(board)
    await db.commit()
    record_audit(user, "피드백 보드 삭제", f"id={board_id} 제목='{title}'")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/boards/{board_id}/posts")
async def list_posts_admin(
    board_id: int,
    user: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    await _get_board_or_404(db, board_id, cohort_id)
    viewer_uid = (await db.execute(select(User.id).where(User.username == user["username"]))).scalar_one_or_none()
    alias_q = await db.execute(
        select(LiveFeedbackAnonAlias.member_id, LiveFeedbackAnonAlias.user_id, LiveFeedbackAnonAlias.alias)
        .where(LiveFeedbackAnonAlias.board_id == board_id)
    )
    alias_map = {(f"m{mid}" if mid is not None else f"u{uid}"): alias for mid, uid, alias in alias_q.all()}
    q = await db.execute(
        select(LiveFeedbackPost)
        .options(
            selectinload(LiveFeedbackPost.reactions),
            selectinload(LiveFeedbackPost.author),
            selectinload(LiveFeedbackPost.author_user),
            selectinload(LiveFeedbackPost.presenter),
        )
        .where(LiveFeedbackPost.board_id == board_id)
        .order_by(LiveFeedbackPost.created_at)
    )
    return [_post_admin_dict(p, alias_map, viewer_user_id=viewer_uid) for p in q.scalars().all()]


@router.delete("/posts/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_post(
    post_id: int,
    user: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    post = await db.get(LiveFeedbackPost, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="피드백을 찾을 수 없습니다")
    # 기수 격리: 글이 속한 보드의 세션 cohort 검증
    await _get_board_or_404(db, post.board_id, cohort_id)
    board_id = post.board_id
    await db.delete(post)
    await db.commit()
    evt = {"type": "post.deleted", "data": {"post_id": post_id}}
    await manager.broadcast(board_id, evt, evt)
    record_audit(user, "피드백 글 삭제(모더레이션)", f"post={post_id} board={board_id}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/posts/{post_id}")
async def hide_post(
    post_id: int,
    body: PostHideRequest,
    user: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    post = await db.get(LiveFeedbackPost, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="피드백을 찾을 수 없습니다")
    # 기수 격리: 글이 속한 보드의 세션 cohort 검증
    await _get_board_or_404(db, post.board_id, cohort_id)
    post.is_hidden = body.is_hidden
    await db.commit()
    record_audit(user, "피드백 글 가리기" if body.is_hidden else "피드백 글 다시 표시", f"post={post_id} board={post.board_id}")
    # 멤버에게는 가려진 글이 사라지고(post.deleted처럼), 운영진엔 상태 갱신
    admin_evt = {"type": "post.hidden", "data": {"post_id": post_id, "is_hidden": body.is_hidden}}
    member_evt = (
        {"type": "post.deleted", "data": {"post_id": post_id}}
        if body.is_hidden
        else {"type": "post.unhidden", "data": {"post_id": post_id}}
    )
    await manager.broadcast(post.board_id, admin_evt, member_evt)
    return {"id": post_id, "is_hidden": body.is_hidden}


# ── 멤버 (generation) ──────────────────────────────────────────────────────────

@router.get("/member/open-board")
async def member_open_board(
    member: dict = Depends(get_current_member),
    member_cohort_id: int = Depends(get_member_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """현재 열려있는 피드백 보드(가장 최근). 없으면 null."""
    # 기수 격리: 본인 기수 세션의 보드만
    q = await db.execute(
        select(LiveFeedbackBoard)
        .join(Session, Session.id == LiveFeedbackBoard.session_id)
        .where(LiveFeedbackBoard.is_open == True, Session.cohort_id == member_cohort_id)  # noqa: E712
        .order_by(LiveFeedbackBoard.created_at.desc())
        .limit(1)
    )
    board = q.scalar_one_or_none()
    if not board:
        return None
    session = await db.get(Session, board.session_id)
    return {
        "id": board.id,
        "title": board.title,
        "session_title": session.title if session else None,
        "session_week_num": session.week_num if session else None,
        "is_open": board.is_open,
    }


@router.get("/member/boards")
async def member_list_boards(
    member: dict = Depends(get_current_member),
    member_cohort_id: int = Depends(get_member_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """멤버용 피드백 보드 전체 목록(이전 기록 포함). 최신순."""
    # 기수 격리: 본인 기수 세션의 보드만
    boards_q = await db.execute(
        select(LiveFeedbackBoard)
        .join(Session, Session.id == LiveFeedbackBoard.session_id)
        .where(Session.cohort_id == member_cohort_id)
        .order_by(LiveFeedbackBoard.created_at.desc())
    )
    boards = boards_q.scalars().all()
    if not boards:
        return []
    sess_q = await db.execute(
        select(Session.id, Session.title, Session.week_num).where(
            Session.id.in_([b.session_id for b in boards])
        )
    )
    sess_map = {sid: (title, wk) for sid, title, wk in sess_q.all()}
    out = []
    for b in boards:
        title, wk = sess_map.get(b.session_id, (None, None))
        out.append({
            "id": b.id,
            "title": b.title,
            "session_title": title,
            "session_week_num": wk,
            "is_open": b.is_open,
            "created_at": _iso(b.created_at),
        })
    return out


@router.get("/member/boards/{board_id}")
async def member_get_board(
    board_id: int,
    member: dict = Depends(get_current_member),
    member_cohort_id: int = Depends(get_member_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    board = await _get_board_or_404(db, board_id, member_cohort_id)
    session = await db.get(Session, board.session_id)
    my_group = await _member_group(db, board.session_id, member["member_id"])
    # 분반이 나뉘면 같은 분반끼리만 (발표 순서 비노출), 결석 제외·조퇴는 설정 따름
    presenters = await _presenter_columns(
        db, board.session_id, reveal_order=False,
        restrict_group=my_group, early_leave_ids=set(board.early_leave_member_ids or []),
    )
    return {
        "id": board.id,
        "title": board.title,
        "session_title": session.title if session else None,
        "session_week_num": session.week_num if session else None,
        "is_open": board.is_open,
        "my_group": my_group,
        "categories": board.categories,
        "presenters": presenters,
    }


@router.get("/member/boards/{board_id}/posts")
async def member_list_posts(
    board_id: int,
    member: dict = Depends(get_current_member),
    member_cohort_id: int = Depends(get_member_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """멤버용 글 목록(익명 변형, 가려진 글 제외). 같은 분반만. 마감되어도 읽기는 허용."""
    board = await _get_board_or_404(db, board_id, member_cohort_id)
    # 같은 분반 스코프: 내 분반 발표자에 대한 글만
    my_group = await _member_group(db, board.session_id, member["member_id"])
    scoped = await _presenter_columns(
        db, board.session_id, reveal_order=False,
        restrict_group=my_group, early_leave_ids=set(board.early_leave_member_ids or []),
    )
    allowed_ids = {c["presenter_member_id"] for c in scoped}

    alias_q = await db.execute(
        select(LiveFeedbackAnonAlias.member_id, LiveFeedbackAnonAlias.user_id, LiveFeedbackAnonAlias.alias)
        .where(LiveFeedbackAnonAlias.board_id == board_id)
    )
    alias_map = {(f"m{mid}" if mid is not None else f"u{uid}"): alias for mid, uid, alias in alias_q.all()}
    q = await db.execute(
        select(LiveFeedbackPost)
        .options(
            selectinload(LiveFeedbackPost.reactions),
            selectinload(LiveFeedbackPost.author),
            selectinload(LiveFeedbackPost.author_user),
            selectinload(LiveFeedbackPost.presenter),
        )
        .where(LiveFeedbackPost.board_id == board_id, LiveFeedbackPost.is_hidden == False)  # noqa: E712
        .order_by(LiveFeedbackPost.created_at)
    )
    viewer = member["member_id"]
    return [
        _post_member_dict(p, alias_map, viewer)
        for p in q.scalars().all()
        if p.presenter_member_id in allowed_ids
    ]


@router.post("/member/boards/{board_id}/posts", status_code=201)
async def member_create_post(
    board_id: int,
    body: PostCreateRequest,
    member: dict = Depends(get_current_member),
    member_cohort_id: int = Depends(get_member_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    board = await _get_board_or_404(db, board_id, member_cohort_id)
    if not board.is_open:
        raise HTTPException(status_code=400, detail="피드백이 마감되었습니다")
    # 카테고리별 내용 정규화 (보드 카테고리 키만, 빈 값 제거)
    valid_keys = {c["key"] for c in (board.categories or [])}
    contents: dict[str, str] = {}
    for k, v in (body.contents or {}).items():
        if k not in valid_keys:
            continue
        text = (v or "").strip()
        if not text:
            continue
        if len(text) > MAX_CONTENT_LEN:
            raise HTTPException(status_code=400, detail="내용이 너무 깁니다")
        contents[k] = text
    if not contents:
        raise HTTPException(status_code=400, detail="내용을 입력하세요")
    # 같은 분반 스코프 + 출석 검증
    my_group = await _member_group(db, board.session_id, member["member_id"])
    scoped = await _presenter_columns(
        db, board.session_id, reveal_order=False,
        restrict_group=my_group, early_leave_ids=set(board.early_leave_member_ids or []),
    )
    if body.presenter_member_id not in {c["presenter_member_id"] for c in scoped}:
        raise HTTPException(status_code=400, detail="피드백할 수 없는 대상입니다")

    author_id = member["member_id"]
    post = LiveFeedbackPost(
        board_id=board_id,
        author_member_id=author_id,
        presenter_member_id=body.presenter_member_id,
        contents=contents,
        is_anonymous=body.is_anonymous,
    )
    db.add(post)

    alias = None
    if body.is_anonymous:
        alias = await _get_or_create_alias(db, board_id, member_id=author_id)

    await db.commit()

    full = await _load_post_full(db, post.id)
    alias_map = {f"m{author_id}": alias} if alias else {}
    admin_payload = {"type": "post.created", "data": {**_post_admin_dict(full, alias_map), "client_nonce": body.client_nonce}}
    member_payload = {"type": "post.created", "data": {**_post_member_dict(full, alias_map), "client_nonce": body.client_nonce}}
    await manager.broadcast(board_id, admin_payload, member_payload)

    return member_payload["data"]


@router.post("/boards/{board_id}/posts/staff", status_code=201)
async def staff_create_post(
    board_id: int,
    body: PostCreateRequest,
    user: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """운영진이 피드백 작성 — 모든 발표자 대상(분반 제한 없음).
    익명이면 기수원에겐 닉네임으로 보이고, 운영진끼리는 항상 실명으로 보인다."""
    board = await _get_board_or_404(db, board_id, cohort_id)
    if not board.is_open:
        raise HTTPException(status_code=400, detail="피드백이 마감되었습니다")
    valid_keys = {c["key"] for c in (board.categories or [])}
    contents: dict[str, str] = {}
    for k, v in (body.contents or {}).items():
        if k not in valid_keys:
            continue
        text = (v or "").strip()
        if not text:
            continue
        if len(text) > MAX_CONTENT_LEN:
            raise HTTPException(status_code=400, detail="내용이 너무 깁니다")
        contents[k] = text
    if not contents:
        raise HTTPException(status_code=400, detail="내용을 입력하세요")
    # 발표자 검증 — 분반 제한 없이 보드 세션의 모든 발표자 허용
    presenters = await _presenter_columns(
        db, board.session_id, reveal_order=False,
        early_leave_ids=set(board.early_leave_member_ids or []),
    )
    if body.presenter_member_id not in {c["presenter_member_id"] for c in presenters}:
        raise HTTPException(status_code=400, detail="피드백할 수 없는 대상입니다")

    uid = (await db.execute(select(User.id).where(User.username == user["username"]))).scalar_one_or_none()
    if uid is None:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    post = LiveFeedbackPost(
        board_id=board_id,
        author_user_id=uid,
        presenter_member_id=body.presenter_member_id,
        contents=contents,
        is_anonymous=body.is_anonymous,
    )
    db.add(post)
    alias = None
    if body.is_anonymous:
        alias = await _get_or_create_alias(db, board_id, user_id=uid)
    await db.commit()

    full = await _load_post_full(db, post.id)
    alias_map = {f"u{uid}": alias} if alias else {}
    admin_payload = {"type": "post.created", "data": {**_post_admin_dict(full, alias_map), "client_nonce": body.client_nonce}}
    member_payload = {"type": "post.created", "data": {**_post_member_dict(full, alias_map), "client_nonce": body.client_nonce}}
    await manager.broadcast(board_id, admin_payload, member_payload)

    return _post_admin_dict(full, alias_map)


@router.patch("/member/posts/{post_id}")
async def member_update_post(
    post_id: int,
    body: PostUpdateRequest,
    member: dict = Depends(get_current_member),
    member_cohort_id: int = Depends(get_member_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """본인이 쓴 피드백 글 수정. 수정 시각으로 created_at 갱신(목록 상단으로 다시 올라감)."""
    post = await _load_post_full(db, post_id)
    if not post or post.author_member_id != member["member_id"]:
        raise HTTPException(status_code=404, detail="글을 찾을 수 없습니다")
    board = await _get_board_or_404(db, post.board_id, member_cohort_id)
    if not board.is_open:
        raise HTTPException(status_code=400, detail="피드백이 마감되어 수정할 수 없습니다")

    valid_keys = {c["key"] for c in (board.categories or [])}
    contents: dict[str, str] = {}
    for k, v in (body.contents or {}).items():
        if k not in valid_keys:
            continue
        text = (v or "").strip()
        if not text:
            continue
        if len(text) > MAX_CONTENT_LEN:
            raise HTTPException(status_code=400, detail="내용이 너무 깁니다")
        contents[k] = text
    if not contents:
        raise HTTPException(status_code=400, detail="내용을 입력하세요")

    post.contents = contents
    if body.is_anonymous is not None:
        post.is_anonymous = body.is_anonymous
    post.created_at = func.now()  # 수정 시점으로 시간 재기록
    await db.commit()

    full = await _load_post_full(db, post_id)
    author_id = full.author_member_id
    alias_map = {}
    if full.is_anonymous:
        alias_map = {f"m{author_id}": await _get_or_create_alias(db, full.board_id, member_id=author_id)}
    admin_payload = {"type": "post.updated", "data": _post_admin_dict(full, alias_map)}
    member_payload = {"type": "post.updated", "data": _post_member_dict(full, alias_map)}
    await manager.broadcast(full.board_id, admin_payload, member_payload)

    return _post_member_dict(full, alias_map, member["member_id"])


@router.post("/member/posts/{post_id}/reactions", status_code=201)
async def member_add_reaction(
    post_id: int,
    body: ReactionRequest,
    member: dict = Depends(get_current_member),
    member_cohort_id: int = Depends(get_member_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    if body.emoji not in ALLOWED_EMOJIS:
        raise HTTPException(status_code=400, detail="허용되지 않은 이모지입니다")
    post = await db.get(LiveFeedbackPost, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="피드백을 찾을 수 없습니다")
    # 기수 격리: 글이 속한 보드의 세션 cohort 검증
    board = await _get_board_or_404(db, post.board_id, member_cohort_id)
    if not board.is_open:
        raise HTTPException(status_code=400, detail="피드백이 마감되었습니다")

    member_id = member["member_id"]
    dup = await db.execute(
        select(LiveFeedbackReaction.id).where(
            LiveFeedbackReaction.post_id == post_id,
            LiveFeedbackReaction.member_id == member_id,
            LiveFeedbackReaction.emoji == body.emoji,
        )
    )
    if dup.scalar_one_or_none() is None:
        db.add(LiveFeedbackReaction(post_id=post_id, member_id=member_id, emoji=body.emoji))
        await db.commit()

    await _broadcast_reaction(db, post_id, post.board_id)
    return {"post_id": post_id, "emoji": body.emoji}


@router.delete("/member/posts/{post_id}/reactions/{emoji}", status_code=status.HTTP_204_NO_CONTENT)
async def member_remove_reaction(
    post_id: int,
    emoji: str,
    member: dict = Depends(get_current_member),
    member_cohort_id: int = Depends(get_member_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    post = await db.get(LiveFeedbackPost, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="피드백을 찾을 수 없습니다")
    # 기수 격리: 글이 속한 보드의 세션 cohort 검증
    await _get_board_or_404(db, post.board_id, member_cohort_id)
    member_id = member["member_id"]
    existing = await db.execute(
        select(LiveFeedbackReaction).where(
            LiveFeedbackReaction.post_id == post_id,
            LiveFeedbackReaction.member_id == member_id,
            LiveFeedbackReaction.emoji == emoji,
        )
    )
    row = existing.scalar_one_or_none()
    if row:
        await db.delete(row)
        await db.commit()
    await _broadcast_reaction(db, post_id, post.board_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/posts/{post_id}/reactions", status_code=201)
async def staff_add_reaction(
    post_id: int,
    body: ReactionRequest,
    user: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """운영진이 피드백 글에 반응."""
    if body.emoji not in ALLOWED_EMOJIS:
        raise HTTPException(status_code=400, detail="허용되지 않은 이모지입니다")
    post = await db.get(LiveFeedbackPost, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="피드백을 찾을 수 없습니다")
    await _get_board_or_404(db, post.board_id, cohort_id)
    uid = (await db.execute(select(User.id).where(User.username == user["username"]))).scalar_one_or_none()
    if uid is None:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    dup = await db.execute(
        select(LiveFeedbackReaction.id).where(
            LiveFeedbackReaction.post_id == post_id,
            LiveFeedbackReaction.user_id == uid,
            LiveFeedbackReaction.emoji == body.emoji,
        )
    )
    if dup.scalar_one_or_none() is None:
        db.add(LiveFeedbackReaction(post_id=post_id, user_id=uid, emoji=body.emoji))
        await db.commit()
    await _broadcast_reaction(db, post_id, post.board_id)
    return {"post_id": post_id, "emoji": body.emoji}


@router.delete("/posts/{post_id}/reactions/{emoji}", status_code=status.HTTP_204_NO_CONTENT)
async def staff_remove_reaction(
    post_id: int,
    emoji: str,
    user: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    post = await db.get(LiveFeedbackPost, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="피드백을 찾을 수 없습니다")
    await _get_board_or_404(db, post.board_id, cohort_id)
    uid = (await db.execute(select(User.id).where(User.username == user["username"]))).scalar_one_or_none()
    existing = await db.execute(
        select(LiveFeedbackReaction).where(
            LiveFeedbackReaction.post_id == post_id,
            LiveFeedbackReaction.user_id == uid,
            LiveFeedbackReaction.emoji == emoji,
        )
    )
    row = existing.scalar_one_or_none()
    if row:
        await db.delete(row)
        await db.commit()
    await _broadcast_reaction(db, post_id, post.board_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _broadcast_reaction(db: AsyncSession, post_id: int, board_id: int) -> None:
    counts_q = await db.execute(
        select(LiveFeedbackReaction.emoji, func.count(LiveFeedbackReaction.id))
        .where(LiveFeedbackReaction.post_id == post_id)
        .group_by(LiveFeedbackReaction.emoji)
    )
    counts = {emoji: c for emoji, c in counts_q.all()}
    evt = {"type": "reaction.changed", "data": {"post_id": post_id, "reactions": counts}}
    await manager.broadcast(board_id, evt, evt)


# ── WebSocket ──────────────────────────────────────────────────────────────────

@router.websocket("/ws/{board_id}")
async def feedback_ws(websocket: WebSocket, board_id: int, token: str = Query(...)):
    # 인증·검증은 짧게 별도 세션으로 처리 후 닫는다(긴 WS 수명 동안 DB 커넥션 점유 방지).
    async with AsyncSessionLocal() as db:
        identity = await decode_ws_token(token, db)
        if identity is None:
            await websocket.close(code=4401)
            return
        # scoring_only(외부 임시 · 심사 전용)는 심사 탭 밖의 기능이라 여기 구독을 막는다.
        if identity.get("user_role") == "scoring_only":
            await websocket.close(code=4403)
            return
        board = await db.get(LiveFeedbackBoard, board_id)
        if board is None:
            await websocket.close(code=4404)
            return
        # 기수 격리: 구독하려는 보드의 세션 cohort와 토큰 cohort 비교.
        # 멤버=DB 권위 cohort, 운영진=claim cohort(None=슈퍼관리자 → 전 기수 허용).
        token_cohort = identity.get("cohort_id")
        board_session = await db.get(Session, board.session_id)
        board_cohort = board_session.cohort_id if board_session else None
        if token_cohort is not None and token_cohort != board_cohort:
            await websocket.close(code=4403)
            return
        if identity["role"] == "member" and not board.is_open:
            await websocket.close(code=4403)
            return

    await websocket.accept()
    conn = await manager.connect(board_id, websocket, identity["role"], identity.get("member_id"))
    try:
        while True:
            # 클라이언트 하트비트(ping) 수신; 내용은 무시.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await manager.disconnect(board_id, conn)
