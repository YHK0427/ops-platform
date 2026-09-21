"""접속 기록 미들웨어.

audit_logs 는 '무엇이 바뀌었나'만 남긴다. 조회는 아무 흔적이 없어서
"누가 언제 들어왔는지"를 알 수 없었다(로그인은 한 번만 찍히고, 기수원 토큰은
사실상 만료가 없어 재로그인이 거의 없다). 이 미들웨어가 그 빈칸을 채운다.

세 가지를 조심해서 만들었다.

1. **요청을 느리게 만들지 않는다.** 응답을 먼저 돌려주고 기록은 뒤에서 쓴다.
   기록이 실패해도 사용자 요청은 영향을 받지 않는다.
2. **폭주하지 않는다.** 화면이 15초마다 자동 갱신하면 하루 5천 줄이 쌓인다.
   같은 사람이 같은 경로를 _DEDUPE_WINDOW 안에 다시 부르면 한 줄로 묶고 hits 만 올린다.
3. **쓸모없는 줄을 안 남긴다.** 헬스체크·정적 파일처럼 사람이 본 게 아닌 건 뺀다.
"""
import asyncio
import logging
import re
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update

from app.audit_context import current_actor
from app.database import AsyncSessionLocal

logger = logging.getLogger("access_log")

# 같은 (사람, 경로)를 이 시간 안에 다시 부르면 새 줄 대신 hits 를 올린다.
_DEDUPE_WINDOW = timedelta(seconds=60)

# 사람이 화면을 본 게 아닌 것들. 남겨봐야 읽을 때 방해만 된다.
_SKIP_EXACT = {
    "/health",
    "/api/v1/notifications/vapid-public-key",
}
_SKIP_PREFIX = (
    "/api/v1/notifications/img/",     # 본문 이미지 — 글 하나에 수십 개가 찍힌다
    "/api/v1/notifications/file/",
    "/docs", "/redoc", "/openapi.json",
)
# 경로에 박힌 id 를 묶는다. /sessions/14/stats 와 /sessions/15/stats 가
# 따로 쌓이면 목록이 id 로 뒤덮인다.
_ID_RE = re.compile(r"/\d+(?=/|$)")


def _entry_source(request, path: str) -> str:
    """공유 링크 랜딩(/go/)으로 들어온 사람이 '어디를 눌러서' 왔는지.

    쿼리스트링은 기록하지 않는다(길고 토큰이 섞인다). 그래서 이 한 가지만
    경로 뒤에 붙여 남긴다 — 푸시 알림이 실제로 읽히는지 알 방법이 달리 없다.
      push  = 푸시 알림을 눌렀다        (푸시 URL 에 ?src=push 를 붙여 보낸다)
      share = 공유 버튼으로 만든 링크    (서명 ?s=... 가 붙어 있다)
      direct= 주소를 직접 열었다        (둘 다 없다)
    """
    if not path.startswith("/go/announcement"):
        return ""
    q = request.query_params
    if q.get("src") == "push":
        return " (푸시)"
    if q.get("s"):
        return " (공유링크)"
    return " (직접)"


def _should_skip(path: str) -> bool:
    return path in _SKIP_EXACT or path.startswith(_SKIP_PREFIX)


def _client_ip(request) -> str | None:
    """Cloudflare Tunnel 뒤라 request.client 는 항상 내부 IP다. 헤더를 먼저 본다.

    다만 X-Forwarded-For 의 **첫 번째** 값은 클라이언트가 넣은 것일 수 있다
    (nginx 가 기존 헤더 뒤에 덧붙이는 구조). 위조 불가능한 cf-connecting-ip 를
    먼저 보고, XFF 는 마지막 값만 쓴다. 자세한 이유는 deps.get_real_ip 참고.
    """
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf.strip()[:45]
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[-1].strip()[:45]
    real = request.headers.get("x-real-ip")
    if real:
        return real.strip()[:45]
    return request.client.host[:45] if request.client else None


async def _write(row: dict) -> None:
    """뒤에서 한 줄 쓴다. 실패해도 조용히 넘어간다 — 기록 때문에 서비스가 흔들리면 안 된다."""
    try:
        from app.models import AccessLog
        async with AsyncSessionLocal() as db:
            since = datetime.now(timezone.utc) - _DEDUPE_WINDOW
            existing = (await db.execute(
                select(AccessLog.id).where(
                    AccessLog.actor_username.is_not_distinct_from(row["actor_username"]),
                    AccessLog.path == row["path"],
                    AccessLog.method == row["method"],
                    AccessLog.last_seen_at >= since,
                ).order_by(AccessLog.id.desc()).limit(1)
            )).scalar_one_or_none()

            if existing is not None:
                await db.execute(
                    update(AccessLog.__table__)
                    .where(AccessLog.__table__.c.id == existing)
                    .values(
                        hits=AccessLog.__table__.c.hits + 1,
                        last_seen_at=datetime.now(timezone.utc),
                        status_code=row["status_code"],
                        duration_ms=row["duration_ms"],
                    )
                )
            else:
                db.add(AccessLog(**row))
            await db.commit()
    except Exception:
        logger.debug("접속 기록 실패", exc_info=True)


async def access_log_middleware(request, call_next):
    start = time.monotonic()
    response = await call_next(request)
    path = request.url.path
    if _should_skip(path):
        return response

    # scope 를 먼저 본다 — 미들웨어는 엔드포인트와 다른 태스크라 ContextVar 가 안 보인다
    actor = request.scope.get("actor") or current_actor.get()
    if actor is None:
        kind, username, label, cohort = "anon", None, None, None
    elif actor.get("member_id") is not None:
        kind = "member"
        username = actor.get("username")
        label = f"{username}(기수원)"
        cohort = actor.get("cohort_id")
    else:
        kind = "staff"
        username = actor.get("username")
        role = actor.get("role")
        label = f"{username}({role})" if role else username
        cohort = actor.get("cohort_id")

    row = {
        "actor_kind": kind,
        "actor_username": username,
        "actor_label": label,
        "cohort_id": cohort,
        "method": request.method,
        "path": (_ID_RE.sub("/{id}", path) + _entry_source(request, path))[:200],
        "status_code": response.status_code,
        "duration_ms": int((time.monotonic() - start) * 1000),
        "ip": _client_ip(request),
        "user_agent": (request.headers.get("user-agent") or "")[:300] or None,
    }
    # 응답은 이미 만들어졌다. 기록은 따로 돌려서 사용자를 기다리게 하지 않는다.
    asyncio.create_task(_write(row))
    return response
