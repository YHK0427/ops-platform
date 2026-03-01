import logging
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import pyotp
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from jose import jwt
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.deps import (
    _get_redis_client,
    blacklist_token,
    check_login_rate,
    clear_login_rate,
    get_current_user,
    get_db,
    oauth2_scheme,
    require_admin,
    verify_password,
)
from app.models import User

logger = logging.getLogger("auth")

router = APIRouter(prefix="/auth", tags=["auth"])

TOTP_PENDING_TTL = 300  # 5분


# ── Schemas ──────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str = Field(max_length=50)
    password: str = Field(max_length=128)
    totp_code: str | None = None


class TokenResponse(BaseModel):
    access_token: str | None = None
    token_type: str = "bearer"
    requires_totp: bool = False
    totp_pending_token: str | None = None


class VerifyTotpRequest(BaseModel):
    token: str
    totp_code: str = Field(min_length=6, max_length=6)


class TotpEnableRequest(BaseModel):
    totp_code: str = Field(min_length=6, max_length=6)


class UserCreate(BaseModel):
    username: str = Field(max_length=50)
    password: str = Field(min_length=6, max_length=128)
    display_name: str = Field(max_length=50)
    role: str = Field(pattern=r"^(admin|manager|viewer)$")


class UserUpdate(BaseModel):
    display_name: str | None = None
    role: str | None = Field(None, pattern=r"^(admin|manager|viewer)$")
    password: str | None = Field(None, min_length=6, max_length=128)
    is_active: bool | None = None


class UserResponse(BaseModel):
    id: int
    username: str
    display_name: str
    role: str
    is_active: bool
    has_totp: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}

    @classmethod
    def from_user(cls, user: User) -> "UserResponse":
        return cls(
            id=user.id,
            username=user.username,
            display_name=user.display_name,
            role=user.role,
            is_active=user.is_active,
            has_totp=bool(user.totp_secret),
            created_at=user.created_at,
        )


# ── Helpers ──────────────────────────────────────────────────────────────────

_DUMMY_HASH = bcrypt.hashpw(b"dummy", bcrypt.gensalt()).decode()


def _create_access_token(username: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    payload = {"sub": username, "role": role, "exp": expire}
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


async def _create_totp_pending(username: str) -> str:
    """Redis에 TOTP pending 토큰 저장, 5분 TTL"""
    redis = _get_redis_client()
    token = secrets.token_urlsafe(32)
    await redis.setex(f"totp_pending:{token}", TOTP_PENDING_TTL, username)
    return token


async def _get_totp_pending_username(token: str) -> str | None:
    """TOTP pending 토큰에서 username 추출 (삭제하지 않음 — 실패 시 재시도 허용)"""
    redis = _get_redis_client()
    return await redis.get(f"totp_pending:{token}")


async def _delete_totp_pending(token: str) -> None:
    """TOTP 인증 성공 시 pending 토큰 삭제"""
    redis = _get_redis_client()
    await redis.delete(f"totp_pending:{token}")


async def _check_totp_rate(token: str) -> None:
    """TOTP 시도 횟수 제한 (5회 — 초과 시 pending 토큰도 삭제)"""
    redis = _get_redis_client()
    key = f"totp_attempts:{token}"
    attempts = await redis.incr(key)
    if attempts == 1:
        await redis.expire(key, TOTP_PENDING_TTL)
    if attempts > 5:
        await redis.delete(f"totp_pending:{token}")
        await redis.delete(key)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="OTP 시도 횟수 초과. 다시 로그인하세요.",
        )


# ── Auth Endpoints ───────────────────────────────────────────────────────────

@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """DB 기반 로그인 → JWT 반환 (TOTP 필요 시 pending 토큰)"""
    ip = request.client.host if request.client else "unknown"

    await check_login_rate(ip)

    result = await db.execute(
        select(User).where(User.username == body.username, User.is_active == True)
    )
    user = result.scalar_one_or_none()

    if user is None:
        verify_password(body.password, _DUMMY_HASH)
        logger.warning("login_failed user=%s ip=%s reason=not_found", body.username, ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="인증 실패")

    if not verify_password(body.password, user.password_hash):
        logger.warning("login_failed user=%s ip=%s reason=wrong_password", body.username, ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="인증 실패")

    await clear_login_rate(ip)

    # TOTP 확인
    if user.totp_secret:
        if body.totp_code:
            # 로그인 시 OTP 코드도 함께 제출한 경우
            totp = pyotp.TOTP(user.totp_secret)
            if not totp.verify(body.totp_code, valid_window=1):
                logger.warning("login_failed user=%s ip=%s reason=invalid_totp", user.username, ip)
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="OTP 코드가 올바르지 않습니다")
        else:
            # OTP 코드 없이 비밀번호만 → pending 토큰 발급
            pending_token = await _create_totp_pending(user.username)
            logger.info("totp_pending user=%s ip=%s", user.username, ip)
            return TokenResponse(requires_totp=True, totp_pending_token=pending_token)

    logger.info("login_success user=%s ip=%s role=%s", user.username, ip, user.role)
    token = _create_access_token(user.username, user.role)
    return TokenResponse(access_token=token)


@router.post("/verify-totp", response_model=TokenResponse)
async def verify_totp(body: VerifyTotpRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """TOTP pending 토큰 + OTP 코드 → JWT 반환"""
    ip = request.client.host if request.client else "unknown"

    await _check_totp_rate(body.token)

    username = await _get_totp_pending_username(body.token)
    if not username:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="토큰이 만료되었거나 유효하지 않습니다")

    result = await db.execute(
        select(User).where(User.username == username, User.is_active == True)
    )
    user = result.scalar_one_or_none()
    if not user or not user.totp_secret:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="인증 실패")

    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(body.totp_code, valid_window=1):
        logger.warning("totp_verify_failed user=%s ip=%s", username, ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="OTP 코드가 올바르지 않습니다")

    await _delete_totp_pending(body.token)
    logger.info("login_success user=%s ip=%s role=%s (totp)", user.username, ip, user.role)
    token = _create_access_token(user.username, user.role)
    return TokenResponse(access_token=token)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(current_user: dict = Depends(get_current_user)):
    """토큰 갱신"""
    token = _create_access_token(current_user["username"], current_user["role"])
    return TokenResponse(access_token=token)


@router.delete("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    current_user: dict = Depends(get_current_user),
    token: str = Depends(oauth2_scheme),
):
    """로그아웃 (Redis 블랙리스트에 토큰 추가)"""
    payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    exp: int = payload.get("exp", 0)
    ttl = max(1, exp - int(datetime.now(timezone.utc).timestamp()))
    await blacklist_token(token, ttl)
    logger.info("logout user=%s", current_user["username"])
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── TOTP Setup (admin only) ─────────────────────────────────────────────────

@router.post("/totp/setup")
async def totp_setup(current_user: dict = Depends(require_admin)):
    """TOTP 시크릿 생성 (아직 활성화하지 않음)"""
    secret = pyotp.random_base32()
    totp = pyotp.TOTP(secret)
    uri = totp.provisioning_uri(name=current_user["username"], issuer_name="UnivPT Ops")
    return {"secret": secret, "otpauth_uri": uri}


@router.post("/totp/enable")
async def totp_enable(
    body: TotpEnableRequest,
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """TOTP 활성화 (코드 검증 후 DB 저장)"""
    # 임시 secret은 setup에서 프론트가 보관 → 이 요청에서 함께 전달
    # 하지만 보안상 setup에서 Redis에 임시 저장하는 게 나음
    # 간단하게: setup → 프론트가 secret 보관 → enable에 secret+code 전달
    raise HTTPException(501, "Use /totp/confirm instead")


@router.post("/totp/confirm")
async def totp_confirm(
    body: dict,
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """TOTP 확인 후 활성화 — secret + code를 함께 받음"""
    secret = body.get("secret", "")
    totp_code = body.get("totp_code", "")
    if not secret or not totp_code:
        raise HTTPException(400, "secret과 totp_code가 필요합니다")

    totp = pyotp.TOTP(secret)
    if not totp.verify(totp_code, valid_window=1):
        raise HTTPException(400, "OTP 코드가 올바르지 않습니다")

    result = await db.execute(
        select(User).where(User.username == current_user["username"])
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")

    user.totp_secret = secret
    await db.commit()
    logger.info("totp_enabled user=%s", current_user["username"])
    return {"status": "enabled"}


@router.delete("/totp")
async def totp_disable(
    current_user: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """TOTP 비활성화"""
    result = await db.execute(
        select(User).where(User.username == current_user["username"])
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")

    user.totp_secret = None
    await db.commit()
    logger.info("totp_disabled user=%s", current_user["username"])
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/totp/status")
async def totp_status(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """현재 사용자의 TOTP 설정 상태"""
    result = await db.execute(
        select(User).where(User.username == current_user["username"])
    )
    user = result.scalar_one_or_none()
    return {"enabled": bool(user and user.totp_secret)}


# ── User Management (admin only) ────────────────────────────────────────────

@router.get("/users", response_model=list[UserResponse])
async def list_users(
    _: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """사용자 목록 (admin 전용)"""
    result = await db.execute(select(User).order_by(User.id))
    return [UserResponse.from_user(u) for u in result.scalars().all()]


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreate,
    _: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """사용자 생성 (admin 전용)"""
    exists = await db.execute(select(User).where(User.username == body.username))
    if exists.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="이미 존재하는 사용자명입니다")

    hashed = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    user = User(
        username=body.username,
        password_hash=hashed,
        display_name=body.display_name,
        role=body.role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return UserResponse.from_user(user)


@router.patch("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    body: UserUpdate,
    _: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """사용자 수정 (admin 전용)"""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")

    if body.display_name is not None:
        user.display_name = body.display_name
    if body.role is not None:
        user.role = body.role
    if body.password is not None:
        user.password_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    if body.is_active is not None:
        user.is_active = body.is_active

    await db.commit()
    await db.refresh(user)
    return UserResponse.from_user(user)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    _: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """사용자 비활성화 (admin 전용)"""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    user.is_active = False
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
