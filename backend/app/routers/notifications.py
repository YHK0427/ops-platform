"""웹 푸시 구독 + 공지 + 발송 라우터.

- 구독: 멤버(get_current_member) / 운영진(get_current_user) 각각.
- 공지: 멤버는 본인 기수 게시 공지 열람, 운영진은 작성/관리 + 발송.
- 발송 권한: 운영진 이상(require_staff). cohort 스코프.
"""
import glob
import html as htmllib
import ipaddress
import logging
import mimetypes
import os
import re
import socket
import uuid
from datetime import datetime, timezone
from urllib.parse import quote, urljoin, urlparse

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, delete, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.deps import (
    get_current_cohort_id, get_current_member, get_current_user, get_db,
    get_member_cohort_id, require_staff,
)
from app.models import Announcement, AnnouncementComment, AnnouncementReaction, Member, PushSubscription, User
from app.services.push import resolve_subscription_ids

logger = logging.getLogger("notifications")

router = APIRouter(prefix="/notifications", tags=["notifications"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class SubKeys(BaseModel):
    p256dh: str
    auth: str


class SubscribeIn(BaseModel):
    endpoint: str
    keys: SubKeys
    ua: str | None = None


class UnsubscribeIn(BaseModel):
    endpoint: str


class AnnouncementIn(BaseModel):
    title: str = Field(max_length=200)
    content: str  # 정제 전 HTML (서버에서 한 번 더 정제 권장, v1은 길이만 제한)
    target: str = Field(default="members", pattern=r"^(members|staff|all|select)$")
    target_member_ids: list[int] | None = None
    tags: list[str] | None = None
    push: bool = True


class PushIn(BaseModel):
    title: str = Field(max_length=120)
    body: str = Field(max_length=300)
    target: str = Field(default="members", pattern=r"^(members|staff|all|select)$")
    target_member_ids: list[int] | None = None
    url: str | None = None


class AnnouncementOut(BaseModel):
    id: int
    title: str
    content: str
    target: str
    target_member_ids: list[int] | None = None
    tags: list[str] | None = None
    created_by: str | None = None
    pushed: bool
    created_at: datetime
    reactions: dict[str, int] = {}
    my_reactions: list[str] = []
    comment_count: int = 0
    model_config = {"from_attributes": True}


class ReactionIn(BaseModel):
    emoji: str


class CommentIn(BaseModel):
    content: str = Field(min_length=1, max_length=1000)


class CommentOut(BaseModel):
    id: int
    member_id: int
    name: str
    content: str
    created_at: datetime
    is_mine: bool = False


# 공지에 쓸 수 있는 이모지 (실시간 피드백과 비슷한 톤)
ALLOWED_REACTIONS = ("👍", "❤️", "🔥", "👏", "🎉", "🥹", "👀")


# ── Helpers ──────────────────────────────────────────────────────────────────

_TAG = re.compile(r"<[^>]+>")


async def _attach_reactions(db: AsyncSession, anns: list, viewer_member_id: int | None = None) -> None:
    """공지 리스트에 reactions(이모지별 카운트)·my_reactions 를 transient 속성으로 부착."""
    ids = [a.id for a in anns]
    if not ids:
        return
    rows = (await db.execute(
        select(AnnouncementReaction.announcement_id, AnnouncementReaction.emoji, AnnouncementReaction.member_id)
        .where(AnnouncementReaction.announcement_id.in_(ids))
    )).all()
    counts: dict[int, dict[str, int]] = {}
    mine: dict[int, list[str]] = {}
    for ann_id, emoji, member_id in rows:
        counts.setdefault(ann_id, {})[emoji] = counts.setdefault(ann_id, {}).get(emoji, 0) + 1
        if viewer_member_id is not None and member_id == viewer_member_id:
            mine.setdefault(ann_id, []).append(emoji)
    crows = (await db.execute(
        select(AnnouncementComment.announcement_id, func.count(AnnouncementComment.id))
        .where(AnnouncementComment.announcement_id.in_(ids))
        .group_by(AnnouncementComment.announcement_id)
    )).all()
    ccount = {ann_id: n for ann_id, n in crows}
    for a in anns:
        a.reactions = counts.get(a.id, {})
        a.my_reactions = mine.get(a.id, [])
        a.comment_count = ccount.get(a.id, 0)


def _excerpt(html: str, n: int = 120) -> str:
    txt = _TAG.sub(" ", html or "")
    txt = re.sub(r"\s+", " ", txt).strip()
    return txt[:n]


async def _notify_author(request: Request, db: AsyncSession, ann: Announcement, title: str, body: str) -> None:
    """공지 작성자(운영진)에게 푸시 — author_username 의 활성 구독으로 발송."""
    author = getattr(ann, "author_username", None)
    if not author:
        return
    sub_ids = [r[0] for r in (await db.execute(
        select(PushSubscription.id).where(
            PushSubscription.user_id.in_(select(User.id).where(User.username == author))
        )
    )).all()]
    if sub_ids:
        await _enqueue_push(request, {"title": title, "body": body, "url": f"/go/announcement/{ann.id}", "tag": f"ann-act-{ann.id}"}, sub_ids)


def _clean_tags(tags: list[str] | None) -> list[str] | None:
    """해시태그 정규화 — # 제거·공백정리·중복제거, 최대 10개·각 30자."""
    if not tags:
        return None
    out: list[str] = []
    for t in tags:
        t = re.sub(r"\s+", " ", (t or "").strip().lstrip("#")).strip()[:30]
        if t and t not in out:
            out.append(t)
        if len(out) >= 10:
            break
    return out or None


async def _upsert_subscription(db, sub: SubscribeIn, *, user_id=None, member_id=None, cohort_id=None):
    existing = (await db.execute(
        select(PushSubscription).where(PushSubscription.endpoint == sub.endpoint)
    )).scalar_one_or_none()
    if existing:
        existing.user_id = user_id
        existing.member_id = member_id
        existing.cohort_id = cohort_id
        existing.p256dh = sub.keys.p256dh
        existing.auth = sub.keys.auth
        existing.ua = sub.ua
    else:
        db.add(PushSubscription(
            user_id=user_id, member_id=member_id, cohort_id=cohort_id,
            endpoint=sub.endpoint, p256dh=sub.keys.p256dh, auth=sub.keys.auth, ua=sub.ua,
        ))
    await db.commit()


async def _enqueue_push(request: Request, payload: dict, subscription_ids: list[int]):
    pool = getattr(request.app.state, "arq_pool", None)
    if pool and subscription_ids:
        await pool.enqueue_job("task_send_push", payload=payload, subscription_ids=subscription_ids)


# ── VAPID 공개키 (공개) ───────────────────────────────────────────────────────

@router.get("/vapid-public-key")
async def vapid_public_key():
    return {"public_key": settings.VAPID_PUBLIC_KEY}


# ── 구독 (멤버) ───────────────────────────────────────────────────────────────

@router.post("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
async def subscribe_member(
    body: SubscribeIn,
    member: dict = Depends(get_current_member),
    db: AsyncSession = Depends(get_db),
):
    await _upsert_subscription(db, body, member_id=member["member_id"], cohort_id=member.get("cohort_id"))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
async def unsubscribe_member(
    body: UnsubscribeIn,
    _: dict = Depends(get_current_member),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(delete(PushSubscription).where(PushSubscription.endpoint == body.endpoint))
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── 구독 (운영진) ─────────────────────────────────────────────────────────────

@router.post("/ops/subscribe", status_code=status.HTTP_204_NO_CONTENT)
async def subscribe_ops(
    body: SubscribeIn,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    u = (await db.execute(select(User).where(User.username == current_user["username"]))).scalar_one_or_none()
    if not u:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    await _upsert_subscription(db, body, user_id=u.id, cohort_id=u.cohort_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/ops/subscribe", status_code=status.HTTP_204_NO_CONTENT)
async def unsubscribe_ops(
    body: UnsubscribeIn,
    _: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(delete(PushSubscription).where(PushSubscription.endpoint == body.endpoint))
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── 공지 (멤버 열람) ──────────────────────────────────────────────────────────

@router.get("/announcements", response_model=list[AnnouncementOut])
async def member_announcements(
    member: dict = Depends(get_current_member),
    cohort_id: int = Depends(get_member_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """본인 기수의 공지 중 대상에 본인이 포함된 것."""
    mid = member["member_id"]
    rows = await db.execute(
        select(Announcement)
        .where(
            Announcement.cohort_id == cohort_id,
            or_(
                Announcement.target.in_(("members", "all")),
                (Announcement.target == "select") & Announcement.target_member_ids.any(mid),
            ),
        )
        .order_by(Announcement.created_at.desc())
    )
    anns = list(rows.scalars().all())
    await _attach_reactions(db, anns, mid)
    return anns


@router.get("/announcements/{ann_id}", response_model=AnnouncementOut)
async def member_announcement_detail(
    ann_id: int,
    member: dict = Depends(get_current_member),
    cohort_id: int = Depends(get_member_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """본인 기수의 공지 단건 (대상에 본인 포함된 것만)."""
    mid = member["member_id"]
    ann = await db.get(Announcement, ann_id)
    if not ann or ann.cohort_id != cohort_id:
        raise HTTPException(status_code=404, detail="공지를 찾을 수 없습니다")
    allowed = ann.target in ("members", "all") or (
        ann.target == "select" and mid in (ann.target_member_ids or [])
    )
    if not allowed:
        raise HTTPException(status_code=404, detail="공지를 찾을 수 없습니다")
    await _attach_reactions(db, [ann], mid)
    return ann


@router.post("/announcements/{ann_id}/reactions", response_model=AnnouncementOut)
async def member_toggle_reaction(
    ann_id: int,
    body: ReactionIn,
    request: Request,
    member: dict = Depends(get_current_member),
    cohort_id: int = Depends(get_member_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """공지 이모지 반응 토글 (이미 누른 이모지면 취소)."""
    if body.emoji not in ALLOWED_REACTIONS:
        raise HTTPException(status_code=400, detail="허용되지 않은 이모지입니다")
    mid = member["member_id"]
    ann = await db.get(Announcement, ann_id)
    if not ann or ann.cohort_id != cohort_id:
        raise HTTPException(status_code=404, detail="공지를 찾을 수 없습니다")
    allowed = ann.target in ("members", "all") or (ann.target == "select" and mid in (ann.target_member_ids or []))
    if not allowed:
        raise HTTPException(status_code=404, detail="공지를 찾을 수 없습니다")
    existing = (await db.execute(
        select(AnnouncementReaction).where(
            AnnouncementReaction.announcement_id == ann_id,
            AnnouncementReaction.member_id == mid,
            AnnouncementReaction.emoji == body.emoji,
        )
    )).scalar_one_or_none()
    added = existing is None
    if existing:
        await db.delete(existing)
    else:
        db.add(AnnouncementReaction(announcement_id=ann_id, member_id=mid, emoji=body.emoji))
    await db.commit()
    await db.refresh(ann)
    if added:
        name = (await db.execute(select(Member.name).where(Member.id == mid))).scalar_one_or_none() or "기수원"
        await _notify_author(request, db, ann, "내 공지에 반응이 달렸어요", f"{name}님이 {body.emoji} · {ann.title}")
    await _attach_reactions(db, [ann], mid)
    return ann


# ── 공지 댓글 ─────────────────────────────────────────────────────────────────

async def _member_ann_or_404(db: AsyncSession, ann_id: int, cohort_id: int, mid: int) -> Announcement:
    ann = await db.get(Announcement, ann_id)
    if not ann or ann.cohort_id != cohort_id:
        raise HTTPException(status_code=404, detail="공지를 찾을 수 없습니다")
    allowed = ann.target in ("members", "all") or (ann.target == "select" and mid in (ann.target_member_ids or []))
    if not allowed:
        raise HTTPException(status_code=404, detail="공지를 찾을 수 없습니다")
    return ann


@router.get("/announcements/{ann_id}/comments", response_model=list[CommentOut])
async def member_list_comments(
    ann_id: int,
    member: dict = Depends(get_current_member),
    cohort_id: int = Depends(get_member_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    mid = member["member_id"]
    await _member_ann_or_404(db, ann_id, cohort_id, mid)
    rows = (await db.execute(
        select(AnnouncementComment, Member.name)
        .join(Member, Member.id == AnnouncementComment.member_id)
        .where(AnnouncementComment.announcement_id == ann_id)
        .order_by(AnnouncementComment.created_at.asc())
    )).all()
    return [
        CommentOut(id=c.id, member_id=c.member_id, name=name, content=c.content,
                   created_at=c.created_at, is_mine=(c.member_id == mid))
        for c, name in rows
    ]


@router.post("/announcements/{ann_id}/comments", response_model=CommentOut, status_code=status.HTTP_201_CREATED)
async def member_add_comment(
    ann_id: int,
    body: CommentIn,
    request: Request,
    member: dict = Depends(get_current_member),
    cohort_id: int = Depends(get_member_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    mid = member["member_id"]
    ann = await _member_ann_or_404(db, ann_id, cohort_id, mid)
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="댓글을 입력하세요")
    c = AnnouncementComment(announcement_id=ann_id, member_id=mid, content=content[:1000])
    db.add(c)
    await db.commit()
    await db.refresh(c)
    name = (await db.execute(select(Member.name).where(Member.id == mid))).scalar_one_or_none() or member["username"]
    await _notify_author(request, db, ann, "내 공지에 댓글이 달렸어요", f"{name}: {content[:50]}")
    return CommentOut(id=c.id, member_id=mid, name=name, content=c.content, created_at=c.created_at, is_mine=True)


@router.delete("/announcements/{ann_id}/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def member_delete_comment(
    ann_id: int,
    comment_id: int,
    member: dict = Depends(get_current_member),
    _: int = Depends(get_member_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """본인 댓글만 삭제."""
    c = await db.get(AnnouncementComment, comment_id)
    if not c or c.announcement_id != ann_id or c.member_id != member["member_id"]:
        raise HTTPException(status_code=404, detail="댓글을 찾을 수 없습니다")
    await db.delete(c)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/manage/announcements/{ann_id}/comments", response_model=list[CommentOut])
async def staff_list_comments(
    ann_id: int,
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """운영진 — 본인 기수 공지의 댓글 목록(모더레이션용)."""
    ann = await db.get(Announcement, ann_id)
    if not ann or ann.cohort_id != cohort_id:
        raise HTTPException(status_code=404, detail="공지를 찾을 수 없습니다")
    rows = (await db.execute(
        select(AnnouncementComment, Member.name)
        .join(Member, Member.id == AnnouncementComment.member_id)
        .where(AnnouncementComment.announcement_id == ann_id)
        .order_by(AnnouncementComment.created_at.asc())
    )).all()
    return [
        CommentOut(id=c.id, member_id=c.member_id, name=name, content=c.content,
                   created_at=c.created_at, is_mine=False)
        for c, name in rows
    ]


@router.delete("/manage/announcements/{ann_id}/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def staff_delete_comment(
    ann_id: int,
    comment_id: int,
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """운영진 — 본인 기수 공지의 댓글 삭제(모더레이션)."""
    c = await db.get(AnnouncementComment, comment_id)
    if not c or c.announcement_id != ann_id:
        raise HTTPException(status_code=404, detail="댓글을 찾을 수 없습니다")
    ann = await db.get(Announcement, ann_id)
    if not ann or ann.cohort_id != cohort_id:
        raise HTTPException(status_code=404, detail="공지를 찾을 수 없습니다")
    await db.delete(c)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── 공지 (운영진 관리) ────────────────────────────────────────────────────────

@router.get("/manage/announcements", response_model=list[AnnouncementOut])
async def list_announcements(
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        select(Announcement).where(Announcement.cohort_id == cohort_id).order_by(Announcement.created_at.desc())
    )
    anns = list(rows.scalars().all())
    await _attach_reactions(db, anns)
    return anns


@router.post("/manage/announcements", response_model=AnnouncementOut, status_code=status.HTTP_201_CREATED)
async def create_announcement(
    body: AnnouncementIn,
    request: Request,
    user: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    if body.target == "select":
        ids = body.target_member_ids or []
        valid = (await db.execute(
            select(Member.id).where(Member.id.in_(ids), Member.cohort_id == cohort_id)
        )).scalars().all()
        if not valid:
            raise HTTPException(status_code=400, detail="대상 멤버를 선택하세요 (현재 기수)")
    # 작성자 표기 = 이름 · 부서 (username 대신)
    u = (await db.execute(
        select(User.display_name, User.department).where(User.username == user["username"])
    )).first()
    author = (u.display_name + (f" · {u.department}" if u and u.department else "")) if u else user["username"]
    ann = Announcement(
        cohort_id=cohort_id, title=body.title, content=body.content,
        target=body.target, target_member_ids=body.target_member_ids,
        tags=_clean_tags(body.tags), created_by=author, author_username=user["username"], pushed=False,
    )
    db.add(ann)
    await db.commit()
    await db.refresh(ann)

    if body.push:
        sub_ids = await resolve_subscription_ids(db, cohort_id, body.target, body.target_member_ids)
        payload = {"title": body.title, "body": _excerpt(body.content), "url": f"/go/announcement/{ann.id}", "tag": f"ann-{ann.id}"}
        await _enqueue_push(request, payload, sub_ids)
        ann.pushed = True
        await db.commit()
        await db.refresh(ann)
    await _attach_reactions(db, [ann])
    return ann


@router.patch("/manage/announcements/{ann_id}", response_model=AnnouncementOut)
async def update_announcement(
    ann_id: int,
    body: AnnouncementIn,
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    ann = await db.get(Announcement, ann_id)
    if not ann or ann.cohort_id != cohort_id:
        raise HTTPException(status_code=404, detail="공지를 찾을 수 없습니다")
    old_uuids = _asset_uuids(ann.content)
    ann.title = body.title
    ann.content = body.content
    ann.target = body.target
    ann.target_member_ids = body.target_member_ids
    ann.tags = _clean_tags(body.tags)
    ann.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(ann)
    # 수정으로 본문에서 빠진 첨부/이미지 정리
    removed = old_uuids - _asset_uuids(body.content)
    if removed:
        await _cleanup_orphans(db, removed, ann_id)
    await _attach_reactions(db, [ann])
    return ann


@router.delete("/manage/announcements/{ann_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_announcement(
    ann_id: int,
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    ann = await db.get(Announcement, ann_id)
    if not ann or ann.cohort_id != cohort_id:
        raise HTTPException(status_code=404, detail="공지를 찾을 수 없습니다")
    content = ann.content
    await db.delete(ann)
    await db.commit()
    # 다른 공지가 안 쓰는 첨부/이미지 파일 정리 (best-effort)
    await _cleanup_orphans(db, _asset_uuids(content), ann_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── 공지 이미지 업로드/서빙 (로컬 디스크 — R2 미사용) ─────────────────────────
# 라이브피드백 사용법 PNG처럼 "그냥 이미지 파일"로 저장하되, git이 아니라 런타임에
# 서버 디스크(/app/files/uploads/ann)에 올린다. ./files 는 bind-mount 라 영속.
# 서빙 URL은 확장자 없는 경로(/img/{key}) — nginx 의 `.png$` 정적 정규식과 충돌 회피.

_UPLOAD_DIR = "/app/files/uploads/ann"
_FILE_DIR = "/app/files/uploads/ann/files"
_ALLOWED_IMG = {"image/png", "image/jpeg", "image/gif", "image/webp"}
_EXT = {"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp"}
# 다운로드(og:image·favicon)용 — favicon은 ico/svg도 흔해서 더 넓게 허용
_DL_EXT = {
    **_EXT, "image/jpg": ".jpg", "image/x-icon": ".ico", "image/vnd.microsoft.icon": ".ico",
    "image/svg+xml": ".svg", "image/avif": ".avif",
}
_MAX_IMG = 10 * 1024 * 1024  # 10MB
_MAX_FILE = 50 * 1024 * 1024  # 50MB (일반 첨부)


def _asset_uuids(html: str) -> set[str]:
    """본문 HTML 에서 업로드 자산(img/file) uuid 추출."""
    return set(re.findall(r"/notifications/(?:img|file)/([0-9a-f]{32})", html or ""))


def _delete_asset_files(uuid_hex: str) -> None:
    for d in (_UPLOAD_DIR, _FILE_DIR):
        for p in glob.glob(os.path.join(d, uuid_hex + ".*")):
            try:
                os.remove(p)
            except OSError:
                pass


async def _cleanup_orphans(db: AsyncSession, uuids: set[str], exclude_id: int) -> None:
    """주어진 uuid 들 중 다른 공지가 더 이상 참조하지 않는 파일을 디스크에서 삭제."""
    for u in uuids:
        ref = (await db.execute(
            select(Announcement.id).where(Announcement.id != exclude_id, Announcement.content.like(f"%{u}%")).limit(1)
        )).first()
        if not ref:
            _delete_asset_files(u)


@router.post("/manage/upload-image")
async def upload_image(
    file: UploadFile = File(...),
    _: dict = Depends(require_staff),
    __: int = Depends(get_current_cohort_id),
):
    """공지 본문 이미지 업로드 → 공개 서빙 URL 반환."""
    ctype = (file.content_type or "").lower()
    if ctype not in _ALLOWED_IMG:
        raise HTTPException(status_code=400, detail="이미지 파일만 올릴 수 있어요 (png/jpg/gif/webp)")
    data = await file.read()
    if len(data) > _MAX_IMG:
        raise HTTPException(status_code=413, detail="이미지는 10MB 이하만 가능해요")
    os.makedirs(_UPLOAD_DIR, exist_ok=True)
    key = uuid.uuid4().hex
    path = os.path.join(_UPLOAD_DIR, key + _EXT[ctype])
    with open(path, "wb") as f:
        f.write(data)
    # 확장자 없는 서빙 경로 (nginx 정적 정규식 회피)
    return {"url": f"/api/v1/notifications/img/{key}"}


@router.get("/img/{key}")
async def serve_image(key: str):
    """업로드된 공지 이미지 서빙 (공개 — <img> 임베드용, 인증 없음)."""
    if not re.fullmatch(r"[0-9a-f]{32}", key):  # uuid hex 만 허용 — 경로 탈출 방지
        raise HTTPException(status_code=404, detail="not found")
    matches = glob.glob(os.path.join(_UPLOAD_DIR, key + ".*"))
    if not matches:
        raise HTTPException(status_code=404, detail="not found")
    path = matches[0]
    media_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
    # SVG(파비콘 등)를 직접 열었을 때 스크립트 실행 차단 — sandbox + nosniff.
    return FileResponse(path, media_type=media_type, headers={
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
    })


# ── 일반 파일 첨부 업로드/다운로드 ────────────────────────────────────────────
# 이미지 외 파일(pdf/hwp/zip 등). 다운로드 강제(attachment) + octet-stream 으로
# 업로드 svg/html 의 인라인 XSS 차단. 표시 파일명은 프론트의 <a download> 가 제공.

@router.post("/manage/upload-file")
async def upload_file(
    file: UploadFile = File(...),
    _: dict = Depends(require_staff),
    __: int = Depends(get_current_cohort_id),
):
    data = await file.read()
    if len(data) > _MAX_FILE:
        raise HTTPException(status_code=413, detail="파일은 50MB 이하만 가능해요")
    os.makedirs(_FILE_DIR, exist_ok=True)
    key = uuid.uuid4().hex
    ext = os.path.splitext(file.filename or "")[1].lower()
    if not re.fullmatch(r"\.[a-z0-9]{1,10}", ext):
        ext = ".bin"
    name = file.filename or "파일"
    with open(os.path.join(_FILE_DIR, key + ext), "wb") as f:
        f.write(data)
    # 파일명은 쿼리로 전달(확장자를 URL 경로에 안 박아 nginx 정적규칙 충돌 회피).
    return {"url": f"/api/v1/notifications/file/{key}?name={quote(name)}", "name": name, "size": len(data)}


@router.get("/file/{key}")
async def serve_file(key: str, name: str = ""):
    """첨부파일 다운로드 (공개). 항상 attachment + 원본 파일명(한글 포함)으로 내려준다."""
    if not re.fullmatch(r"[0-9a-f]{32}", key):
        raise HTTPException(status_code=404, detail="not found")
    matches = glob.glob(os.path.join(_FILE_DIR, key + ".*"))
    if not matches:
        raise HTTPException(status_code=404, detail="not found")
    # 헤더 인젝션 방지(CR/LF 제거) + RFC 5987 인코딩으로 유니코드 파일명 지원
    safe = (name or "file").replace("\r", " ").replace("\n", " ").strip()[:200] or "file"
    cd = "attachment; filename*=UTF-8''" + quote(safe)
    return FileResponse(
        matches[0],
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": cd,
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "public, max-age=31536000",
        },
    )


# ── 링크 카드 미리보기 (OG 언퍼를) ────────────────────────────────────────────
# 운영진이 붙여넣은 URL의 OG 메타(제목/설명/이미지)를 가져와 카드로. 썸네일은 로컬에
# 내려받아 same-origin 서빙(CSP img-src 'self' 통과 + 핫링크 깨짐 방지).

class LinkPreviewIn(BaseModel):
    url: str = Field(max_length=2000)


class LinkPreviewOut(BaseModel):
    url: str
    title: str = ""
    description: str = ""
    image: str = ""
    favicon: str = ""
    site: str = ""


def _host_is_safe(host: str | None) -> bool:
    """SSRF 가드 — 호스트가 사설/내부 IP로 해석되면 거부."""
    if not host:
        return False
    try:
        infos = socket.getaddrinfo(host, None)
    except Exception:
        return False
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            return False
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            return False
    return True


def _meta(html: str, prop: str) -> str:
    """og:* / name=* 메타 태그 content 추출 (속성 순서 무관)."""
    for pat in (
        rf'<meta[^>]+(?:property|name)=["\']{re.escape(prop)}["\'][^>]+content=["\']([^"\']*)["\']',
        rf'<meta[^>]+content=["\']([^"\']*)["\'][^>]+(?:property|name)=["\']{re.escape(prop)}["\']',
    ):
        m = re.search(pat, html, re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return ""


async def _download_image(client: httpx.AsyncClient, img_url: str) -> str:
    """외부 이미지(og:image·favicon)를 로컬에 저장하고 서빙 URL 반환 (실패 시 '')."""
    if not _host_is_safe(urlparse(img_url).hostname):
        return ""
    try:
        r = await client.get(img_url)
        if r.status_code != 200:
            return ""
        ctype = (r.headers.get("content-type") or "").split(";")[0].strip().lower()
        ext = _DL_EXT.get(ctype)
        if not ext:
            return ""
        data = r.content[: _MAX_IMG]
        if not data:
            return ""
        os.makedirs(_UPLOAD_DIR, exist_ok=True)
        key = uuid.uuid4().hex
        with open(os.path.join(_UPLOAD_DIR, key + ext), "wb") as f:
            f.write(data)
        return f"/api/v1/notifications/img/{key}"
    except Exception:
        return ""


def _favicon_url(html: str, base_url: str) -> str:
    """<link rel=...icon...> 에서 파비콘 URL 추출 (없으면 /favicon.ico)."""
    apple = ""
    generic = ""
    for m in re.finditer(r"<link\b[^>]*>", html, re.IGNORECASE):
        tag = m.group(0)
        if not re.search(r'rel=["\'][^"\']*icon[^"\']*["\']', tag, re.IGNORECASE):
            continue
        href = re.search(r'href=["\']([^"\']+)["\']', tag, re.IGNORECASE)
        if not href:
            continue
        if "apple-touch" in tag.lower():
            apple = href.group(1)
        elif not generic:
            generic = href.group(1)
    pick = apple or generic or "/favicon.ico"
    return urljoin(base_url, pick)


@router.post("/manage/link-preview", response_model=LinkPreviewOut)
async def link_preview(
    body: LinkPreviewIn,
    _: dict = Depends(require_staff),
    __: int = Depends(get_current_cohort_id),
):
    url = body.url.strip()
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise HTTPException(status_code=400, detail="http(s) 링크만 가능해요")
    if not _host_is_safe(parsed.hostname):
        raise HTTPException(status_code=400, detail="내부 주소는 미리보기를 만들 수 없어요")

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "ko,en;q=0.8",
    }
    out = LinkPreviewOut(url=url, title=parsed.hostname, site=parsed.hostname)
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=6.0, max_redirects=4, headers=headers) as client:
            r = await client.get(url)
            html = r.text[: 1024 * 1024]

            title = _meta(html, "og:title") or _meta(html, "twitter:title")
            if not title:
                m = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
                title = m.group(1) if m else ""
            title = htmllib.unescape(re.sub(r"\s+", " ", title)).strip()
            out.title = title[:200] or parsed.hostname

            desc = _meta(html, "og:description") or _meta(html, "twitter:description") or _meta(html, "description")
            out.description = htmllib.unescape(re.sub(r"\s+", " ", desc)).strip()[:300]
            out.site = (_meta(html, "og:site_name") or parsed.hostname).strip()[:80]

            og_img = _meta(html, "og:image") or _meta(html, "twitter:image")
            if og_img:
                out.image = await _download_image(client, urljoin(url, og_img))
            # 파비콘(아이콘) — 항상 시도
            out.favicon = await _download_image(client, _favicon_url(html, str(r.url)))
    except Exception as e:  # noqa: BLE001
        logger.info("link-preview 실패 %s: %s", url, e)
    return out


# ── 임의 푸시 발송 (운영진) ───────────────────────────────────────────────────

@router.post("/manage/push")
async def send_adhoc_push(
    body: PushIn,
    request: Request,
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    sub_ids = await resolve_subscription_ids(db, cohort_id, body.target, body.target_member_ids)
    payload = {"title": body.title, "body": body.body, "url": body.url or "/", "tag": "adhoc"}
    await _enqueue_push(request, payload, sub_ids)
    return {"queued": len(sub_ids)}
