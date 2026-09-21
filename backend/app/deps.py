import asyncio
from typing import AsyncGenerator

import bcrypt
import redis.asyncio as aioredis
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal
from app.audit_context import set_actor
from sqlalchemy import select

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

# scoring_only(외부 임시 · 심사 전용) 역할이 예외적으로 접근 가능한 경로.
# 심사 라우터 본편 + 로그인 유지에 꼭 필요한 자기 자신 관련 셀프서비스 엔드포인트만 허용한다.
_SCORING_ONLY_ALLOWED_PREFIXES = (
    "/api/v1/scoring",
    "/api/v1/auth/refresh",
    "/api/v1/auth/logout",
    "/api/v1/auth/change-password",
    "/api/v1/auth/totp",
    "/api/v1/members/me",
    "/api/v1/notifications/ops/subscribe",
)

# Redis 기반 토큰 블랙리스트 (재시작 후에도 유효)
_redis_client: aioredis.Redis | None = None


def _get_redis_client() -> aioredis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis_client


async def blacklist_token(token: str, ttl_seconds: int) -> None:
    """토큰을 블랙리스트에 추가 (TTL = 토큰 잔여 만료 시간)"""
    redis = _get_redis_client()
    await redis.setex(f"blacklist:{token}", ttl_seconds, "1")


async def is_token_blacklisted(token: str) -> bool:
    redis = _get_redis_client()
    return await redis.exists(f"blacklist:{token}") > 0


def get_real_ip(request: Request) -> str:
    """실제 클라이언트 IP.

    **X-Forwarded-For 의 첫 번째 값을 믿으면 안 된다.** nginx 는
    `$proxy_add_x_forwarded_for` 로 기존 헤더 뒤에 덧붙이기 때문에, 클라이언트가
    `X-Forwarded-For: 9.9.9.9` 를 보내면 백엔드에는 `9.9.9.9, <터널IP>` 로 도착한다.
    첫 값을 쓰면 공격자가 자기 IP 를 마음대로 정할 수 있다 — 요청마다 바꾸면
    IP 기준 레이트 리밋이 전부 무력화되고, 감사 로그의 IP 도 오염된다.

    Cloudflare Tunnel 을 통과하면 엣지가 cf-connecting-ip 를 **덮어쓰므로**
    클라이언트가 위조할 수 없다. 그걸 먼저 보고, 없으면 XFF 의 **마지막** 값
    (프록시가 직접 붙인 값)을 쓴다.
    """
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf.strip()[:45]
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        # 마지막 값 = 바로 앞 프록시가 붙인 것. 앞쪽은 전부 클라이언트가 넣을 수 있다.
        return forwarded.split(",")[-1].strip()[:45]
    return request.client.host if request.client else "unknown"


async def check_login_rate(ip: str, username: str = "") -> None:
    """Redis 기반 로그인 시도 횟수 제한 (IP당 10회 + 계정당 10회 / 5분)"""
    redis = _get_redis_client()
    # IP 기반
    ip_key = f"login_attempts:{ip}"
    ip_attempts = await redis.incr(ip_key)
    if ip_attempts == 1:
        await redis.expire(ip_key, 300)
    # 계정 기반 (username이 있는 경우)
    if username:
        user_key = f"login_attempts:user:{username}"
        user_attempts = await redis.incr(user_key)
        if user_attempts == 1:
            await redis.expire(user_key, 300)
        if user_attempts > 10:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="로그인 시도 횟수 초과. 5분 후 다시 시도하세요.",
            )
    if ip_attempts > 10:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="로그인 시도 횟수 초과. 5분 후 다시 시도하세요.",
        )


async def check_public_rate(ip: str, bucket: str = "scoring", limit: int = 3000, window: int = 600) -> None:
    """공개(무로그인) 엔드포인트용 레이트 리밋 — 아주 넉넉하게.

    같은 강의실 WiFi에서 수백 명이 접속하면 공인 IP가 **하나로 뭉친다**(NAT).
    한 사람이 폼을 여는 데만 조회·확인·제출로 3~4회 요청하므로, 한도를 낮게 잡으면
    정상 참가자가 막힌다. 청중 수백 명을 상정해 넉넉히 두고, 스크립트성 폭주만 걸러낸다.
    (개인 식별은 IP가 아니라 브라우저에 저장된 참가자 토큰으로 하므로, 같은 WiFi여도 서로 안 섞인다.)
    """
    redis = _get_redis_client()
    key = f"public_rate:{bucket}:{ip}"
    attempts = await redis.incr(key)
    if attempts == 1:
        await redis.expire(key, window)
    if attempts > limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
        )


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """AsyncSession 의존성"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def get_current_user(request: Request, token: str = Depends(oauth2_scheme)) -> dict:
    """JWT 검증 의존성 — 유효한 토큰이면 {"username": str, "role": str} 반환.
    generation 계정 토큰은 거부한다."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="인증 정보가 유효하지 않습니다",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        if await is_token_blacklisted(token):
            raise credentials_exception

        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        username: str | None = payload.get("sub")
        role: str | None = payload.get("role")
        account_type: str | None = payload.get("account_type")
        if username is None:
            raise credentials_exception
        # generation 계정 토큰으로 ops 엔드포인트 접근 차단
        if account_type == "generation":
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    # scoring_only(외부 임시 · 심사 전용) — 허용 목록 밖은 전부 차단.
    # 다른 라우터들은 role을 아예 안 보는 곳(get_current_user만 거는 GET들)이 많아서,
    # 여기서 한 곳에서 막아야 새 역할이 다른 기능에 새어나가지 않는다.
    if (role or "viewer") == "scoring_only" and not any(
        request.url.path.startswith(p) for p in _SCORING_ONLY_ALLOWED_PREFIXES
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="심사 탭 전용 계정입니다",
        )

    # cohort_id: 신규 토큰엔 claim 존재(None=슈퍼관리자). 구 토큰엔 없음 → cohort_claim=False로
    # 표시해 get_current_cohort_id 가 DB 폴백하도록 한다.
    actor = {
        "username": username,
        # uid: User.id — 기수 분리로 username이 기수 간 중복될 수 있어 신원 식별엔 이걸 우선 사용.
        # 구 토큰(발급 당시 uid claim 없음)은 None → 호출부가 username(+cohort_id)로 폴백.
        "id": payload.get("uid"),
        "role": role or "viewer",
        "cohort_id": payload.get("cohort_id"),
        "cohort_claim": "cohort_id" in payload,
    }
    set_actor(actor, request.url.path, request.scope)
    return actor


async def resolve_current_user_row(db: AsyncSession, current_user: dict):
    """current_user(JWT 클레임 dict)에 대응하는 User row 조회.
    uid claim 있으면 그걸로 정확히 조회(기수 간 username 중복에도 안전).
    구 토큰(uid 없음)은 username(+cohort_claim 있으면 cohort_id까지)으로 폴백 조회 —
    폴백 중 동명이인이 여러 기수에 있으면 가장 오래된(id 최소) 계정을 고른다."""
    from app.models import User

    uid = current_user.get("id")
    if uid is not None:
        return await db.get(User, uid)

    q = select(User).where(User.username == current_user["username"])
    if current_user.get("cohort_claim"):
        q = q.where(User.cohort_id == current_user.get("cohort_id"))
    result = await db.execute(q.order_by(User.id))
    return result.scalars().first()


async def get_current_member(
    request: Request,
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """JWT 검증 의존성 — generation 계정 토큰이면 {"member_id": int, "username": str} 반환.
    DB에서 계정 활성 상태를 확인한다."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="인증 정보가 유효하지 않습니다",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        if await is_token_blacklisted(token):
            raise credentials_exception

        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        username: str | None = payload.get("sub")
        member_id: int | None = payload.get("member_id")
        account_type: str | None = payload.get("account_type")
        if username is None or account_type != "generation" or member_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    # DB에서 계정 활성 상태 + 소속 기수 확인 (cohort_id는 DB 권위 — 구 토큰도 안전)
    from app.models import GenerationAccount, Member
    result = await db.execute(
        select(GenerationAccount.is_active, Member.cohort_id, Member.is_active)
        .join(Member, Member.id == GenerationAccount.member_id)
        .where(GenerationAccount.member_id == member_id)
    )
    row = result.first()
    if not row or not row[0] or not row[2]:
        # row[0]=계정 활성, row[2]=멤버 활성 — 이탈/수료 멤버는 계정이 남아있어도
        # 이미 발급된 토큰으로도 더 이상 접근 못 하게 여기서 막는다(로그인 시점뿐 아니라
        # 매 요청마다 확인 — 멤버 토큰은 만료가 사실상 무제한이라 더 중요함).
        raise credentials_exception

    actor = {"member_id": member_id, "username": username, "cohort_id": row[1]}
    set_actor(actor, request.url.path, request.scope)
    return actor


async def decode_ws_token(token: str, db: AsyncSession) -> dict | None:
    """WebSocket용 토큰 검증 (브라우저 WS는 Authorization 헤더 불가 → 쿼리 토큰).

    성공 시 역할별 dict 반환, 실패 시 None:
    - 멤버(generation): {"role": "member", "member_id": int, "username": str}
    - 운영진/스태프:     {"role": "admin",  "username": str, "user_role": str}
    """
    try:
        if await is_token_blacklisted(token):
            return None
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except JWTError:
        return None

    username: str | None = payload.get("sub")
    uid: int | None = payload.get("uid")
    if username is None:
        return None
    account_type: str | None = payload.get("account_type")

    if account_type == "generation":
        member_id: int | None = payload.get("member_id")
        if member_id is None:
            return None
        from app.models import GenerationAccount, Member
        result = await db.execute(
            select(GenerationAccount.is_active, Member.cohort_id, Member.is_active)
            .join(Member, Member.id == GenerationAccount.member_id)
            .where(GenerationAccount.member_id == member_id)
        )
        row = result.first()
        if not row or not row[0] or not row[2]:
            return None
        return {"role": "member", "member_id": member_id, "username": username, "cohort_id": row[1]}

    # ops/staff 토큰 — viewer 이상이면 구독 허용(운영진 라이브 뷰)
    role = payload.get("role") or "viewer"
    # cohort_id: 신규 토큰은 claim(None=슈퍼관리자). 구 토큰(claim 없음)은 DB에서 소속 기수 조회
    # → 구 운영진 토큰이 슈퍼관리자처럼 전 기수 보드를 구독하는 누출 방지.
    cohort_id = payload.get("cohort_id")
    if "cohort_id" not in payload:
        from app.models import User
        q = select(User.cohort_id)
        q = q.where(User.id == uid) if uid is not None else q.where(User.username == username)
        result = await db.execute(q)
        cohort_id = result.scalar_one_or_none()
    return {"role": "admin", "username": username, "user_role": role, "cohort_id": cohort_id}


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """admin 역할 필수"""
    if user["role"] != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="관리자 권한이 필요합니다",
        )
    return user


def require_staff(user: dict = Depends(get_current_user)) -> dict:
    """admin 또는 manager(운영진) 역할 필수 — viewer 차단"""
    if user["role"] not in ("admin", "manager"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="운영진 이상 권한이 필요합니다",
        )
    return user


def require_scoring_staff(user: dict = Depends(get_current_user)) -> dict:
    """admin·manager 또는 scoring_only(외부 임시 · 심사 전용) — 심사 라우터 전용.

    scoring_only는 get_current_user에서 이미 심사 경로 밖은 다 막혀 있으니, 여기서는
    그 역할을 심사 라우터에 한해 admin/manager와 동등하게 통과시켜주기만 하면 된다.
    """
    if user["role"] not in ("admin", "manager", "scoring_only"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="운영진 이상 권한이 필요합니다",
        )
    return user


async def require_admin_or_chairman(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """admin 역할 또는 회장단(department) — 평가 라운드 관리 권한"""
    if user["role"] == "admin":
        return user
    u = await resolve_current_user_row(db, user)
    if u and u.department == "회장단":
        return user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="관리자 또는 회장단 권한이 필요합니다",
    )


async def get_current_cohort_id(
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> int:
    """현재 요청의 활성 기수 id (운영진용).

    - 일반 운영진: 본인 소속 기수로 강제 스코프.
    - 슈퍼관리자(cohort_id=NULL): 헤더 X-Cohort-Id 로 활성 기수 선택.
    토큰에 cohort_id claim이 없으면(구 토큰) DB에서 소속 기수를 조회한다.
    """
    cohort_id = user.get("cohort_id")
    if not user.get("cohort_claim"):
        # 구 토큰 — DB에서 소속 기수 조회 (권위)
        from app.models import User
        q = select(User.cohort_id)
        uid = user.get("id")
        q = q.where(User.id == uid) if uid is not None else q.where(User.username == user["username"])
        result = await db.execute(q)
        cohort_id = result.scalar_one_or_none()

    if cohort_id is not None:
        return cohort_id

    # 여기까지 왔으면 cohort_id가 없음 = 슈퍼관리자여야 함.
    # 방어: admin 역할이 아닌데 cohort가 없으면(비정상 계정) 헤더로 임의 기수 접근 차단.
    if user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="소속 기수를 확인할 수 없습니다",
        )

    # 슈퍼관리자 — 헤더로 활성 기수 지정
    hdr = request.headers.get("X-Cohort-Id")
    if not hdr:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="활성 기수를 선택해야 합니다 (X-Cohort-Id 헤더 누락)",
        )
    try:
        return int(hdr)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="X-Cohort-Id 헤더 값이 올바르지 않습니다",
        )


async def get_member_cohort_id(member: dict = Depends(get_current_member)) -> int:
    """현재 멤버의 소속 기수 id (기수 포털용 — 항상 본인 기수로 고정)."""
    cohort_id = member.get("cohort_id")
    if cohort_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="기수 정보를 확인할 수 없습니다",
        )
    return cohort_id


def require_superadmin(user: dict = Depends(get_current_user)) -> dict:
    """슈퍼관리자(전 기수 총괄) 전용 — cohort_id 없는 admin 계정.

    주의: get_current_user는 claim만 보므로, 구 admin 토큰(claim 없음)도 통과한다.
    슈퍼관리자 전용 작업은 기수 생성/전환 등 admin 한정이라 실질 위험 없음.
    """
    if user["role"] != "admin" or user.get("cohort_id") is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="슈퍼관리자 권한이 필요합니다",
        )
    return user


async def verify_password(plain: str, hashed: str) -> bool:
    """bcrypt는 CPU-bound라 이벤트 루프를 직접 블로킹함(수백ms) — 스레드로 위임.
    특히 로그인 시 후보 여러 명을 순차 검증할 때(기수 간 아이디 중복) 동시
    로그인이 몰리면 서버 전체가 멈추는 걸 막는다."""
    return await asyncio.to_thread(bcrypt.checkpw, plain.encode(), hashed.encode())


async def hash_password(plain: str) -> str:
    """verify_password와 동일 이유로 스레드 위임. 특히 계정 일괄 생성/비번 일괄
    초기화(최대 활성 멤버 수만큼 루프)에서 감싸지 않으면 그 기수 작업 하나가
    수 초간 이벤트 루프를 완전히 막아 다른 기수의 실시간 트래픽까지 멈춘다."""
    def _hash() -> str:
        return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()
    return await asyncio.to_thread(_hash)
