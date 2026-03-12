from typing import AsyncGenerator

import bcrypt
import redis.asyncio as aioredis
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal

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


async def check_login_rate(ip: str) -> None:
    """Redis 기반 로그인 시도 횟수 제한 (10회/5분)"""
    redis = _get_redis_client()
    key = f"login_attempts:{ip}"
    attempts = await redis.incr(key)
    if attempts == 1:
        await redis.expire(key, 300)  # 5분 윈도우
    if attempts > 10:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="로그인 시도 횟수 초과. 5분 후 다시 시도하세요.",
        )


async def clear_login_rate(ip: str) -> None:
    """로그인 성공 시 카운터 초기화"""
    redis = _get_redis_client()
    await redis.delete(f"login_attempts:{ip}")


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


async def get_current_member(token: str = Depends(oauth2_scheme)) -> dict:
    """JWT 검증 의존성 — generation 계정 토큰이면 {"member_id": int, "username": str} 반환"""
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


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())
