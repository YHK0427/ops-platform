from typing import AsyncGenerator

import bcrypt
import redis.asyncio as aioredis
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal
from sqlalchemy import select

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

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
    """X-Forwarded-For 헤더에서 실제 클라이언트 IP 추출 (Nginx 프록시 대응)"""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        # 첫 번째 IP가 실제 클라이언트
        return forwarded.split(",")[0].strip()
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


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """AsyncSession 의존성"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
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
    return {"username": username, "role": role or "viewer"}


async def get_current_member(
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

    # DB에서 계정 활성 상태 확인
    from app.models import GenerationAccount
    result = await db.execute(
        select(GenerationAccount.is_active).where(GenerationAccount.member_id == member_id)
    )
    is_active = result.scalar_one_or_none()
    if not is_active:
        raise credentials_exception

    return {"member_id": member_id, "username": username}


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


async def require_admin_or_chairman(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """admin 역할 또는 회장단(department) — 평가 라운드 관리 권한"""
    if user["role"] == "admin":
        return user
    from app.models import User
    result = await db.execute(select(User).where(User.username == user["username"]))
    u = result.scalar_one_or_none()
    if u and u.department == "회장단":
        return user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="관리자 또는 회장단 권한이 필요합니다",
    )


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())
