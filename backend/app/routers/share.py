"""공유 링크 랜딩 — 카카오톡·인스타 등에 붙여넣었을 때 미리보기가 뜨게 한다.

왜 서버가 HTML 을 내려줘야 하나:
프론트는 Vite SPA 라 index.html 이 고정이고 제목·설명은 React 가 나중에 채운다.
그런데 카카오톡·슬랙·페이스북의 미리보기 크롤러는 **자바스크립트를 실행하지 않는다.**
그래서 링크를 공유하면 전부 "UnivPT Ops" 하나로만 보인다. 이 라우터가 크롤러에게는
Open Graph 태그가 박힌 HTML 을, 사람에게는 원래 가던 화면으로 보내는 스크립트를 준다.

왜 서명이 붙나:
/go/announcement/12 는 숫자만 바꾸면 되는 주소라, 미리보기를 그냥 열어두면 누구나
공지 제목을 순서대로 긁어갈 수 있다. 동아리 공지엔 사람 이름과 징계 내용이 들어간다.
그래서 공유 버튼이 만든 링크(서명 포함)에만 제목을 보여주고, 서명이 없거나 틀리면
일반적인 문구만 보여준다. 서명은 앱 비밀키로 만든 HMAC 이라 별도 저장이 필요 없다.

본문 발췌는 넣지 않는다. 제목까지가 '어디로 가는 링크인지' 알려주는 최소한이고,
본문은 로그인한 사람만 볼 내용이다.
"""
import hashlib
import hmac
import html

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.deps import get_db
from app.models import Announcement

router = APIRouter(prefix="/go", tags=["share"])

_SITE_NAME = "UnivPT Ops"
_GENERIC_TITLE = "UnivPT 동아리 알림"
_GENERIC_DESC = "동아리 운영 시스템입니다. 로그인 후 확인하세요."


def sign(ann_id: int) -> str:
    """공유 링크에 붙일 짧은 서명. 저장할 게 없도록 앱 비밀키로 만든다."""
    mac = hmac.new(settings.JWT_SECRET_KEY.encode(), f"ann:{ann_id}".encode(), hashlib.sha256)
    return mac.hexdigest()[:12]


def _verify(ann_id: int, sig: str | None) -> bool:
    # compare_digest — 앞자리부터 맞춰보는 식의 추측(타이밍 공격)을 막는다
    return bool(sig) and hmac.compare_digest(sign(ann_id), sig)


def _page(title: str, desc: str, url: str, redirect_id: int) -> str:
    t, d = html.escape(title), html.escape(desc)
    return f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>{t}</title>
<meta name="robots" content="noindex, nofollow">
<meta property="og:type" content="article">
<meta property="og:site_name" content="{_SITE_NAME}">
<meta property="og:title" content="{t}">
<meta property="og:description" content="{d}">
<meta property="og:url" content="{html.escape(url)}">
<meta property="og:image" content="/icons/icon-512.png">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="{t}">
<meta name="twitter:description" content="{d}">
<style>body{{font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;color:#475569}}</style>
</head>
<body>
<p>이동 중입니다…</p>
<script>
// 사람이 열었을 때만 실행된다(크롤러는 JS 를 안 돌린다).
// 기수원 토큰이 있으면 기수 포털 상세로, 운영진 토큰이면 공지 관리로, 없으면 로그인으로.
(function () {{
  var id = {redirect_id};
  var to = "/login";
  try {{
    if (localStorage.getItem("member_access_token")) to = "/member/announcements/" + id;
    else if (localStorage.getItem("ops_access_token")) to = "/announcements";
  }} catch (e) {{}}
  location.replace(to);
}})();
</script>
<noscript><a href="/login">계속하려면 여기를 누르세요</a></noscript>
</body>
</html>"""


@router.get("/announcement/{ann_id}")
async def announcement_landing(
    ann_id: int,
    response: Response,
    s: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    title, desc = _GENERIC_TITLE, _GENERIC_DESC

    if _verify(ann_id, s):
        ann = await db.get(Announcement, ann_id)
        # 특정 멤버 지정 공지는 제목 자체가 민감할 수 있어 미리보기에서 제외한다.
        if ann and ann.target != "select":
            title = ann.title
            kind = "자료" if getattr(ann, "kind", "notice") == "resource" else "공지"
            author = f" · {ann.created_by}" if ann.created_by else ""
            desc = f"UnivPT {kind}{author} — 눌러서 확인하세요."

    body = _page(title, desc, f"/go/announcement/{ann_id}", ann_id)
    return Response(
        content=body,
        media_type="text/html; charset=utf-8",
        headers={
            # 검색엔진에 잡히지 않게. 내부 동아리 도구라 노출될 이유가 없다.
            "X-Robots-Tag": "noindex, nofollow",
            # 미리보기 크롤러가 잠깐 캐시해도 되지만, 제목이 바뀌면 곧 반영되게 짧게.
            "Cache-Control": "public, max-age=300",
        },
    )
