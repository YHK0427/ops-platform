"""웹 푸시 구독 + 공지 + 발송 라우터.

- 구독: 멤버(get_current_member) / 운영진(get_current_user) 각각.
- 공지: 멤버는 본인 기수 게시 공지 열람, 운영진은 작성/관리 + 발송.
- 발송 권한: 운영진 이상(require_staff). cohort 스코프.
"""
import glob
import ipaddress
import logging
import mimetypes
import os
import re
import socket
import uuid
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, delete, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.deps import (
    get_current_cohort_id, get_current_member, get_current_user, get_db,
    get_member_cohort_id, require_staff,
)
from app.models import Announcement, Member, PushSubscription, User
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
    created_by: str | None = None
    pushed: bool
    created_at: datetime
    model_config = {"from_attributes": True}


# ── Helpers ──────────────────────────────────────────────────────────────────

_TAG = re.compile(r"<[^>]+>")


def _excerpt(html: str, n: int = 120) -> str:
    txt = _TAG.sub(" ", html or "")
    txt = re.sub(r"\s+", " ", txt).strip()
    return txt[:n]


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
    return list(rows.scalars().all())


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
    return ann


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
    return list(rows.scalars().all())


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
        created_by=author, pushed=False,
    )
    db.add(ann)
    await db.commit()
    await db.refresh(ann)

    if body.push:
        sub_ids = await resolve_subscription_ids(db, cohort_id, body.target, body.target_member_ids)
        payload = {"title": body.title, "body": _excerpt(body.content), "url": f"/member/announcements/{ann.id}", "tag": f"ann-{ann.id}"}
        await _enqueue_push(request, payload, sub_ids)
        ann.pushed = True
        await db.commit()
        await db.refresh(ann)
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
    ann.title = body.title
    ann.content = body.content
    ann.target = body.target
    ann.target_member_ids = body.target_member_ids
    ann.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(ann)
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
    await db.delete(ann)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── 공지 이미지 업로드/서빙 (로컬 디스크 — R2 미사용) ─────────────────────────
# 라이브피드백 사용법 PNG처럼 "그냥 이미지 파일"로 저장하되, git이 아니라 런타임에
# 서버 디스크(/app/files/uploads/ann)에 올린다. ./files 는 bind-mount 라 영속.
# 서빙 URL은 확장자 없는 경로(/img/{key}) — nginx 의 `.png$` 정적 정규식과 충돌 회피.

_UPLOAD_DIR = "/app/files/uploads/ann"
_ALLOWED_IMG = {"image/png", "image/jpeg", "image/gif", "image/webp"}
_EXT = {"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp"}
_MAX_IMG = 10 * 1024 * 1024  # 10MB


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
    return FileResponse(path, media_type=media_type, headers={"Cache-Control": "public, max-age=31536000, immutable"})


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


async def _download_thumb(client: httpx.AsyncClient, img_url: str) -> str:
    """OG 이미지를 로컬에 저장하고 서빙 URL 반환 (실패 시 '')."""
    if not _host_is_safe(urlparse(img_url).hostname):
        return ""
    try:
        r = await client.get(img_url)
        if r.status_code != 200:
            return ""
        ctype = (r.headers.get("content-type") or "").split(";")[0].strip().lower()
        if ctype not in _EXT:
            return ""
        data = r.content[: _MAX_IMG]
        os.makedirs(_UPLOAD_DIR, exist_ok=True)
        key = uuid.uuid4().hex
        with open(os.path.join(_UPLOAD_DIR, key + _EXT[ctype]), "wb") as f:
            f.write(data)
        return f"/api/v1/notifications/img/{key}"
    except Exception:
        return ""


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

    headers = {"User-Agent": "Mozilla/5.0 (compatible; UnivPTLinkBot/1.0)", "Accept-Language": "ko,en;q=0.8"}
    out = LinkPreviewOut(url=url, site=parsed.hostname)
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=5.0, max_redirects=3, headers=headers) as client:
            r = await client.get(url)
            html = r.text[: 512 * 1024]
            title = _meta(html, "og:title")
            if not title:
                m = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
                title = (m.group(1).strip() if m else "")[:200]
            out.title = title or url
            out.description = _meta(html, "og:description")[:300]
            out.site = _meta(html, "og:site_name") or parsed.hostname
            og_img = _meta(html, "og:image")
            if og_img:
                out.image = await _download_thumb(client, urljoin(url, og_img))
    except Exception as e:  # noqa: BLE001
        logger.info("link-preview 실패 %s: %s", url, e)
        out.title = out.title or url
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
