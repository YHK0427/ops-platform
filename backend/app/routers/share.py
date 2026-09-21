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

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.deps import get_db
from app.models import Announcement, ScoringRound

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


def _page(title: str, desc: str, url: str) -> str:
    t, d = html.escape(title), html.escape(desc)
    # 스크립트를 본문에 직접 쓰지 않는다. nginx 가 붙이는 CSP 가 script-src 'self' 라
    # 인라인 스크립트는 실행되지 않는다(카카오톡 인앱 브라우저에서 "이동 중입니다…"
    # 화면에 멈춰 있던 원인). 같은 출처 파일로 빼면 CSP 를 건드리지 않고 통과한다.
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
<p id="msg">이동 중입니다…</p>
<noscript><a href="/login">계속하려면 여기를 누르세요</a></noscript>
<script src="/go/redirect.js"></script>
</body>
</html>"""


# 스크립트가 자체적으로 주소에서 id 를 읽는다 — 페이지마다 값을 심을 필요가 없어
# 캐시도 잘 되고, 인라인 없이 CSP 를 통과한다.
#
# 카카오톡 인앱 브라우저를 특별히 다룬다. 인앱 브라우저는 저장소가 따로라 로그인
# 상태가 없다. 그대로 두면 링크를 눌러도 매번 로그인 화면이 뜨고, PWA 를 깔아둬도
# 그쪽으로 넘어가지 않는다(WebView 라 OS 의 링크 연결을 안 거친다).
# 안드로이드는 intent:// 로 기본 브라우저를 띄울 수 있다. iOS 는 방법이 없어
# "다른 브라우저로 열기"를 안내한다.
_REDIRECT_JS = """(function () {
  var m = location.pathname.match(/\\/go\\/announcement\\/(\\d+)/);
  var id = m ? m[1] : "";
  var to = "/login";
  try {
    if (localStorage.getItem("member_access_token")) to = "/member/announcements/" + id;
    else if (localStorage.getItem("ops_access_token")) to = "/announcements";
  } catch (e) {}

  var ua = navigator.userAgent || "";
  var inApp = /KAKAOTALK|NAVER\\(inapp|Instagram|FBAN|FBAV|Line\\//i.test(ua);
  var isAndroid = /Android/i.test(ua);
  var isIOS = /iPhone|iPad|iPod/i.test(ua);
  var target = location.origin + to;
  var msg = document.getElementById("msg");

  function show(htmlStr) { if (msg) msg.innerHTML = htmlStr; }

  if (inApp && isAndroid) {
    // 인앱 브라우저를 빠져나간다.
    // package 를 지정하지 않는 게 핵심이다. com.android.chrome 을 박으면 크롬이
    // 강제로 열려서, PWA(WebAPK)를 깔아둔 사람도 앱으로 못 간다. 비워두면 안드로이드가
    // 주소에 맞는 앱을 고르고, PWA 가 설치돼 있으면 그쪽이 잡는다(manifest 의
    // scope 가 "/" 라 모든 주소가 대상이다). 없으면 기본 브라우저로 간다.
    // browser_fallback_url 은 아무것도 못 찾았을 때 쓰인다.
    var intent = "intent://" + location.host + to
      + "#Intent;scheme=" + location.protocol.replace(":", "")
      + ";action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE"
      + ";S.browser_fallback_url=" + encodeURIComponent(target)
      + ";end";
    location.href = intent;
    setTimeout(function () {
      show('<a href="' + target + '">계속하려면 여기를 누르세요</a>');
    }, 1500);
    return;
  }

  if (inApp && isIOS) {
    // iOS 는 인앱 브라우저를 빠져나갈 공식적인 방법이 없다. 눌러서 들어가되,
    // 로그인 상태가 없으면 기본 브라우저로 열라고 알려준다.
    show('<a href="' + to + '">눌러서 계속하기</a>'
       + '<br><br><span style="font-size:13px;color:#94a3b8">'
       + '로그인 화면이 나오면 우측 아래 <b>···</b> → <b>다른 브라우저로 열기</b>를 눌러주세요</span>');
    return;
  }

  location.replace(to);
  // 인앱 브라우저가 replace 를 무시하는 경우를 대비해 눌러서 갈 수 있게 남긴다
  setTimeout(function () {
    show('<a href="' + to + '">계속하려면 여기를 누르세요</a>');
  }, 1200);
})();
"""


@router.get("/redirect.js", include_in_schema=False)
async def redirect_js():
    return Response(
        content=_REDIRECT_JS,
        media_type="application/javascript; charset=utf-8",
        headers={"Cache-Control": "public, max-age=3600"},
    )


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

    body = _page(title, desc, f"/go/announcement/{ann_id}")
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


# ── 크롤러 전용 미리보기 ─────────────────────────────────────────────────────
# /s/{token} 같은 주소는 React 가 그리는 화면이라 통째로 서버에 넘기면 폼이 안 뜬다.
# 그래서 nginx 가 '미리보기 크롤러'일 때만 이리로 보낸다(사람은 그대로 SPA 로 간다).
# 덕분에 공유되는 모든 주소가 한 곳에서 제목을 갖는다.

def _preview_page(title: str, desc: str, path: str) -> str:
    """크롤러만 받는 페이지. 사람이 어쩌다 열어도 원래 주소로 보내준다."""
    t, d, p = html.escape(title), html.escape(desc), html.escape(path)
    return f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>{t}</title>
<meta name="robots" content="noindex, nofollow">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{_SITE_NAME}">
<meta property="og:title" content="{t}">
<meta property="og:description" content="{d}">
<meta property="og:url" content="{p}">
<meta property="og:image" content="/icons/icon-512.png">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="{t}">
<meta name="twitter:description" content="{d}">
</head>
<body><a href="{p}">{t}</a></body>
</html>"""


async def _describe(path: str, db: AsyncSession) -> tuple[str, str]:
    """주소를 보고 미리보기에 쓸 (제목, 설명)을 고른다.

    심사 채점 링크는 토큰 자체가 열쇠다 — 링크를 가진 사람은 이미 들어올 수 있으므로,
    행사 이름을 보여줘도 링크 이상으로 새어나가는 게 없다. 오히려 "무슨 채점인지"가
    보여야 받은 사람이 스팸으로 오해하지 않는다.
    로그인이 필요한 내부 화면들은 전부 일반 문구로 둔다.
    """
    parts = [x for x in path.split("?")[0].split("/") if x]

    if len(parts) >= 2 and parts[0] == "s":
        token = parts[1]
        rnd = (await db.execute(
            select(ScoringRound).where(ScoringRound.public_token == token)
        )).scalar_one_or_none()
        if rnd:
            if len(parts) >= 3 and parts[2] == "feedback":
                return (f"{rnd.name} — 팀별 피드백",
                        "로그인 없이 이름만 입력하면 됩니다. 눌러서 작성하세요.")
            return (f"{rnd.name} — 채점",
                    "로그인 없이 이름만 입력하면 됩니다. 눌러서 참여하세요.")
        return ("채점 링크", "링크가 만료되었거나 잘못된 주소입니다.")

    if parts[:1] == ["login"] or not parts:
        return (_SITE_NAME, "동아리 운영 시스템입니다.")

    return (_GENERIC_TITLE, _GENERIC_DESC)


@router.get("/__preview", include_in_schema=False)
async def crawler_preview(
    request: Request,
    path: str = "/",
    db: AsyncSession = Depends(get_db),
):
    title, desc = await _describe(path, db)
    return Response(
        content=_preview_page(title, desc, path),
        media_type="text/html; charset=utf-8",
        headers={"X-Robots-Tag": "noindex, nofollow", "Cache-Control": "public, max-age=300"},
    )
