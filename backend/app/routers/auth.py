import logging
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import pyotp
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.deps import (
    _get_redis_client,
    blacklist_token,
    check_login_rate,
    get_current_cohort_id,
    get_current_member,
    get_current_user,
    get_db,
    get_real_ip,
    oauth2_scheme,
    require_admin,
    require_admin_or_chairman,
    require_staff,
    verify_password,
)
from app.models import (
    User, Member, GenerationAccount, Session, Team, TeamMember, TeamHistory,
    Assignment, Attendance, Ledger, CafePost, TreasuryExpense, Cohort,
)

logger = logging.getLogger("auth")

router = APIRouter(prefix="/auth", tags=["auth"])

TOTP_PENDING_TTL = 300  # 5분


# ── Schemas ──────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str = Field(max_length=50)
    password: str = Field(max_length=128)
    totp_code: str | None = None
    remember: bool = False


class TokenResponse(BaseModel):
    access_token: str | None = None
    token_type: str = "bearer"
    requires_totp: bool = False
    totp_pending_token: str | None = None


class VerifyTotpRequest(BaseModel):
    token: str
    totp_code: str = Field(min_length=6, max_length=6)
    remember: bool = False


class TotpEnableRequest(BaseModel):
    totp_code: str = Field(min_length=6, max_length=6)


class UserCreate(BaseModel):
    username: str = Field(max_length=50)
    password: str = Field(min_length=6, max_length=128)
    display_name: str = Field(max_length=50)
    role: str = Field(pattern=r"^(admin|manager|viewer)$")
    department: str | None = None


class MemberLoginRequest(BaseModel):
    username: str = Field(max_length=50)
    password: str = Field(max_length=128)


class MemberTokenResponse(BaseModel):
    access_token: str


class MemberMeResponse(BaseModel):
    member_id: int
    name: str
    cohort_id: int | None = None
    cohort_number: int | None = None
    cohort_name: str | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(min_length=6, max_length=128)


class UserUpdate(BaseModel):
    username: str | None = Field(None, max_length=50)
    display_name: str | None = None
    role: str | None = Field(None, pattern=r"^(admin|manager|viewer)$")
    password: str | None = Field(None, min_length=6, max_length=128)
    is_active: bool | None = None
    department: str | None = Field(None)


class UserResponse(BaseModel):
    id: int
    username: str
    display_name: str
    role: str
    department: str | None = None
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
            department=user.department,
            is_active=user.is_active,
            has_totp=bool(user.totp_secret),
            created_at=user.created_at,
        )


# ── Helpers ──────────────────────────────────────────────────────────────────

_DUMMY_HASH = bcrypt.hashpw(b"dummy", bcrypt.gensalt()).decode()


def _create_access_token(
    username: str, role: str, cohort_id: int | None, remember: bool = False
) -> str:
    minutes = settings.JWT_REMEMBER_EXPIRE_MINUTES if remember else settings.JWT_EXPIRE_MINUTES
    expire = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    # cohort_id 는 항상 claim에 포함(None=슈퍼관리자)해 구 토큰과 구분되게 한다.
    payload = {"sub": username, "role": role, "cohort_id": cohort_id, "exp": expire}
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
    ip = get_real_ip(request)

    await check_login_rate(ip, body.username)

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

    # 보관(비활성)된 기수 운영진이면 로그인 차단 (슈퍼관리자 cohort_id=NULL은 항상 허용)
    if user.cohort_id is not None:
        cohort = await db.get(Cohort, user.cohort_id)
        if cohort and not cohort.is_active:
            logger.warning("login_failed user=%s ip=%s reason=cohort_inactive", body.username, ip)
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="보관된 기수입니다.")

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

    logger.audit(f"🔑 로그인 성공 — {user.username} ({user.role}) from {ip}")
    token = _create_access_token(user.username, user.role, user.cohort_id, remember=body.remember)
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
    logger.audit(f"🔑 로그인 성공 (2FA) — {user.username} ({user.role}) from {ip}")
    token = _create_access_token(user.username, user.role, user.cohort_id, remember=body.remember)
    return TokenResponse(access_token=token)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """토큰 갱신 — cohort_id는 DB에서 재조회(권위)."""
    result = await db.execute(
        select(User).where(User.username == current_user["username"], User.is_active == True)
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="인증 실패")
    token = _create_access_token(user.username, user.role, user.cohort_id)
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
    logger.audit("logout user=%s", current_user["username"])
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Member (GenerationAccount) Auth ─────────────────────────────────────────

@router.post("/member-login", response_model=MemberTokenResponse)
async def member_login(
    body: MemberLoginRequest, request: Request, db: AsyncSession = Depends(get_db),
):
    """기수 멤버 계정 로그인 → JWT 반환"""
    ip = get_real_ip(request)

    # NOTE: 멤버 로그인은 레이트 리밋 해제 (동시 다수 접속 허용)

    result = await db.execute(
        select(GenerationAccount).where(
            GenerationAccount.username == body.username,
            GenerationAccount.is_active == True,
        )
    )
    account = result.scalar_one_or_none()

    if account is None:
        # timing-attack 방어: 항상 bcrypt 비교 수행
        verify_password(body.password, _DUMMY_HASH)
        logger.warning("member_login_failed user=%s ip=%s reason=not_found", body.username, ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="아이디 또는 비밀번호가 올바르지 않습니다",
        )

    if not verify_password(body.password, account.password_hash):
        logger.warning("member_login_failed user=%s ip=%s reason=wrong_password", body.username, ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="아이디 또는 비밀번호가 올바르지 않습니다",
        )

    member = await db.get(Member, account.member_id)
    # 보관(비활성)된 기수면 로그인 차단
    cohort = await db.get(Cohort, member.cohort_id) if member else None
    if cohort and not cohort.is_active:
        logger.warning("member_login_failed user=%s ip=%s reason=cohort_inactive", body.username, ip)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="보관된 기수입니다. 운영진에게 문의하세요.")

    expire = datetime.now(timezone.utc) + timedelta(minutes=120)
    payload = {
        "sub": account.username,
        "member_id": account.member_id,
        "account_type": "generation",
        "cohort_id": member.cohort_id if member else None,
        "exp": expire,
    }
    token = jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    mname = member.name if member else account.username
    logger.audit(f"🔓 기수 로그인 — {mname} (@{account.username}) from {ip}")  # type: ignore[attr-defined]
    return MemberTokenResponse(access_token=token)


@router.get("/member-me", response_model=MemberMeResponse)
async def member_me(
    current_member: dict = Depends(get_current_member),
    db: AsyncSession = Depends(get_db),
):
    """현재 로그인된 멤버 정보 반환"""
    member = await db.get(Member, current_member["member_id"])
    if not member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="멤버 정보를 찾을 수 없습니다",
        )
    cohort = await db.get(Cohort, member.cohort_id) if member.cohort_id else None
    return MemberMeResponse(
        member_id=member.id,
        name=member.name,
        cohort_id=member.cohort_id,
        cohort_number=cohort.number if cohort else None,
        cohort_name=cohort.name if cohort else None,
    )


@router.post("/member-change-password", status_code=status.HTTP_204_NO_CONTENT)
async def member_change_password(
    body: ChangePasswordRequest,
    current_member: dict = Depends(get_current_member),
    db: AsyncSession = Depends(get_db),
):
    """기수 본인 비밀번호 변경 (현재 비밀번호 확인 후)."""
    result = await db.execute(
        select(GenerationAccount).where(
            GenerationAccount.member_id == current_member["member_id"],
            GenerationAccount.is_active == True,
        )
    )
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="계정을 찾을 수 없습니다")
    if not verify_password(body.current_password, account.password_hash):
        raise HTTPException(status_code=400, detail="현재 비밀번호가 올바르지 않습니다")
    account.password_hash = bcrypt.hashpw(body.new_password.encode(), bcrypt.gensalt()).decode()
    await db.commit()
    member = await db.get(Member, current_member["member_id"])
    logger.audit(f"🔑 기수 비밀번호 변경 — {member.name if member else account.username} (@{account.username})")  # type: ignore[attr-defined]
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: ChangePasswordRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """운영진 본인 비밀번호 변경 (현재 비밀번호 확인 후)."""
    result = await db.execute(select(User).where(User.username == current_user["username"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="현재 비밀번호가 올바르지 않습니다")
    user.password_hash = bcrypt.hashpw(body.new_password.encode(), bcrypt.gensalt()).decode()
    await db.commit()
    logger.audit(f"change_password user={user.username}")  # type: ignore[attr-defined]
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/member-logout")
async def member_logout(token: str = Depends(oauth2_scheme)):
    """멤버 토큰 폐기 (블랙리스트 등록)"""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        exp = payload.get("exp", 0)
        ttl = max(int(exp - datetime.now(timezone.utc).timestamp()), 0)
        if ttl > 0:
            await blacklist_token(token, ttl)
    except JWTError:
        pass
    return {"status": "ok"}


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
    logger.audit("totp_enabled user=%s", current_user["username"])
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
    logger.audit("totp_disabled user=%s", current_user["username"])
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


# ── Staff list (for group building etc.) ─────────────────────────────────────

@router.get("/staff-list")
async def list_staff(
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """운영진 목록 (staff 이상 접근 가능) — 분반 배치 등에 사용. 현재 기수만."""
    result = await db.execute(
        select(User).where(User.is_active == True, User.cohort_id == cohort_id).order_by(User.id)
    )
    return [
        {"id": u.id, "display_name": u.display_name, "department": u.department}
        for u in result.scalars().all()
    ]


# ── User Management (admin only) ────────────────────────────────────────────

@router.get("/users", response_model=list[UserResponse])
async def list_users(
    current_user: dict = Depends(require_admin_or_chairman),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """사용자 목록 (admin 또는 회장단). 현재 기수 운영진 + 본인 계정(슈퍼관리자 자기 관리용)."""
    result = await db.execute(
        select(User)
        .where(or_(User.cohort_id == cohort_id, User.username == current_user["username"]))
        .order_by(User.id)
    )
    return [UserResponse.from_user(u) for u in result.scalars().all()]


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreate,
    _: dict = Depends(require_admin),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """사용자 생성 (admin 전용) — 현재 기수 운영진으로 생성. admin 역할은 불가(전체 관리자 1명뿐)."""
    if body.role == "admin":
        raise HTTPException(
            status_code=400,
            detail="기수 운영진은 admin 역할을 가질 수 없습니다 (admin은 전체 관리자 전용)",
        )
    exists = await db.execute(select(User).where(User.username == body.username))
    if exists.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="이미 존재하는 사용자명입니다")

    hashed = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    user = User(
        cohort_id=cohort_id,
        username=body.username,
        password_hash=hashed,
        display_name=body.display_name,
        role=body.role,
        department=body.department,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    logger.audit(f"user_created username={user.username} role={user.role} dept={user.department}")
    return UserResponse.from_user(user)


@router.patch("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    body: UserUpdate,
    current_user: dict = Depends(require_admin),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """사용자 수정 (admin 전용) — 현재 기수 운영진 또는 본인 계정(슈퍼관리자 자기 관리)."""
    user = await db.get(User, user_id)
    is_self = bool(user and user.username == current_user["username"])
    if not user or (user.cohort_id != cohort_id and not is_self):
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    # admin 역할은 슈퍼관리자 본인에게만 허용 (기수 운영진엔 부여 불가)
    if body.role == "admin" and not is_self:
        raise HTTPException(
            status_code=400,
            detail="기수 운영진은 admin 역할을 가질 수 없습니다 (admin은 전체 관리자 전용)",
        )
    # 본인 계정 잠금 방지: 스스로 비활성화 금지
    if is_self and body.is_active is False:
        raise HTTPException(status_code=400, detail="본인 계정은 비활성화할 수 없습니다")
    # 슈퍼관리자 자기 강등 방지: 본인 admin 역할을 다른 역할로 못 바꿈 (기수 관리 잠금 방지)
    if is_self and user.role == "admin" and body.role is not None and body.role != "admin":
        raise HTTPException(status_code=400, detail="슈퍼관리자는 본인 역할을 변경할 수 없습니다")

    if body.username is not None:
        # Check uniqueness
        existing = await db.execute(select(User).where(User.username == body.username, User.id != user_id))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="이미 사용 중인 아이디입니다")
        user.username = body.username
    if body.display_name is not None:
        user.display_name = body.display_name
    if body.role is not None:
        user.role = body.role
    if body.department is not None:
        user.department = body.department if body.department else None
    if body.password is not None:
        user.password_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    if body.is_active is not None:
        user.is_active = body.is_active

    await db.commit()
    await db.refresh(user)
    logger.audit(f"user_updated id={user_id} username={user.username}")
    return UserResponse.from_user(user)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    current_user: dict = Depends(require_admin),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """사용자 삭제 (admin 전용) — 현재 기수 운영진만. 본인 계정은 삭제 불가."""
    user = await db.get(User, user_id)
    if user and user.username == current_user["username"]:
        raise HTTPException(status_code=400, detail="본인 계정은 삭제할 수 없습니다")
    if not user or user.cohort_id != cohort_id:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    await db.delete(user)
    await db.commit()
    logger.audit(f"user_deleted id={user_id} username={user.username}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/reset-semester", status_code=status.HTTP_200_OK)
async def reset_semester(
    _: dict = Depends(require_admin),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """
    기수 초기화 (admin 전용) — **현재 기수에 한정**.
    - 현재 기수의 세션, 장부, 출석, 과제, 팀, 게시판 캐시 삭제
    - 현재 기수 멤버 유지, 디포짓 20000원 초기화, 점수 초기화
    - 타 기수 데이터는 절대 건드리지 않음.
    """
    from sqlalchemy import delete

    # 현재 기수 스코프 서브쿼리
    cohort_session_ids = select(Session.id).where(Session.cohort_id == cohort_id).scalar_subquery()
    cohort_member_ids = select(Member.id).where(Member.cohort_id == cohort_id).scalar_subquery()
    cohort_team_ids = select(Team.id).where(Team.session_id.in_(cohort_session_ids)).scalar_subquery()

    # 순서 중요: FK 의존성 역순으로 삭제 (전부 현재 기수만)
    await db.execute(delete(Ledger).where(Ledger.member_id.in_(cohort_member_ids)))
    await db.execute(delete(Assignment).where(Assignment.session_id.in_(cohort_session_ids)))
    await db.execute(delete(Attendance).where(Attendance.session_id.in_(cohort_session_ids)))
    await db.execute(delete(TeamHistory).where(TeamHistory.session_id.in_(cohort_session_ids)))
    await db.execute(delete(TeamMember).where(TeamMember.team_id.in_(cohort_team_ids)))
    await db.execute(delete(Team).where(Team.session_id.in_(cohort_session_ids)))
    await db.execute(delete(Session).where(Session.cohort_id == cohort_id))
    await db.execute(delete(CafePost).where(CafePost.cohort_id == cohort_id))
    await db.execute(delete(TreasuryExpense).where(TreasuryExpense.cohort_id == cohort_id))

    # 현재 기수 멤버 디포짓/점수 초기화
    members_result = await db.execute(select(Member).where(Member.cohort_id == cohort_id))
    count = 0
    for member in members_result.scalars().all():
        member.current_deposit = 20000
        member.total_plus_score = 0
        member.total_minus_score = 0
        member.net_score = 0
        count += 1

    await db.commit()
    logger.audit(f"semester_reset members={count}")
    return {"reset_members": count}
