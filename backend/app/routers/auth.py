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
    is_token_blacklisted,
    hash_password,
    oauth2_scheme,
    require_admin,
    require_admin_or_chairman,
    require_staff,
    resolve_current_user_row,
    verify_password,
)
from app.models import (
    User, Member, GenerationAccount, Session, Team, TeamMember, TeamHistory,
    Assignment, Attendance, Ledger, CafePost, TreasuryExpense, Cohort,
)
from app.audit_hook import record_auth_event, record_manual_event

logger = logging.getLogger("auth")

router = APIRouter(prefix="/auth", tags=["auth"])

TOTP_PENDING_TTL = 300  # 5분


# ── Schemas ──────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str = Field(max_length=50)
    password: str = Field(max_length=128)
    totp_code: str | None = None
    remember: bool = False
    cohort_id: int | None = None


class TokenResponse(BaseModel):
    access_token: str | None = None
    token_type: str = "bearer"
    requires_totp: bool = False
    totp_pending_token: str | None = None
    # 기수 분리로 같은 아이디가 여러 기수에 존재할 수 있음 — 후보가 여럿이면 골라달라고 요청.
    requires_cohort: bool = False
    cohort_choices: list[dict] | None = None


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
    role: str = Field(pattern=r"^(admin|manager|viewer|scoring_only)$")
    department: str | None = None


class MemberLoginRequest(BaseModel):
    username: str = Field(max_length=50)
    password: str = Field(max_length=128)
    cohort_id: int | None = None


class MemberTokenResponse(BaseModel):
    access_token: str | None = None
    requires_cohort: bool = False
    cohort_choices: list[dict] | None = None


class MemberMeResponse(BaseModel):
    member_id: int
    name: str
    cohort_id: int | None = None
    cohort_number: int | None = None
    cohort_name: str | None = None
    cohort_slogan: str | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(min_length=6, max_length=128)


class UserUpdate(BaseModel):
    username: str | None = Field(None, max_length=50)
    display_name: str | None = None
    role: str | None = Field(None, pattern=r"^(admin|manager|viewer|scoring_only)$")
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


# ── 로그인 백업 쿠키 ─────────────────────────────────────────────────────────
# 로그인 토큰은 localStorage 에 있는데, 사파리/WebKit 은 **스크립트가 쓴 저장소**를
# 7일간 그 사이트를 쓰지 않으면 지운다(localStorage·IndexedDB·SW 등록 모두).
# 2주에 한 번 들어오는 기수원은 그래서 매번 다시 로그인하게 된다.
# HttpOnly 쿠키는 스크립트가 쓴 저장소가 아니라서 그 삭제 대상이 아니다.
#
# 다만 이 쿠키로 **API 를 인증하지는 않는다.** 쿠키로 API 가 통과되면 다른 사이트가
# 사용자의 쿠키를 얹어 요청을 보낼 수 있다(CSRF). 이 쿠키는 오직 /auth/session 하나,
# 그것도 GET 으로 "토큰을 다시 달라"는 데만 쓴다. 응답 본문은 다른 출처의 스크립트가
# 읽을 수 없으므로(CORS) 남의 사이트가 훔쳐갈 수 없다.
STAFF_COOKIE = "ops_session"
MEMBER_COOKIE = "member_session"
# 400일 — 크롬이 그 이상은 잘라버린다.
_COOKIE_MAX_AGE = 400 * 24 * 3600


def _set_session_cookie(response: Response, name: str, token: str) -> None:
    response.set_cookie(
        key=name, value=token,
        max_age=_COOKIE_MAX_AGE,
        httponly=True,      # 이게 있어야 '스크립트가 쓴 저장소' 취급을 안 받는다
        secure=True,
        samesite="lax",     # 카카오톡에서 넘어오는 최상위 이동에도 실려야 한다
        path="/",
        # domain 은 지정하지 않는다 — 호스트 전용 쿠키가 형제 서브도메인으로 안 샌다
    )


def _clear_session_cookie(response: Response, name: str) -> None:
    response.delete_cookie(key=name, path="/", httponly=True, secure=True, samesite="lax")


def _create_access_token(
    user_id: int, username: str, role: str, cohort_id: int | None, remember: bool = False
) -> str:
    minutes = settings.JWT_REMEMBER_EXPIRE_MINUTES if remember else settings.JWT_EXPIRE_MINUTES
    expire = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    # cohort_id 는 항상 claim에 포함(None=슈퍼관리자)해 구 토큰과 구분되게 한다.
    # uid = User.id — username은 기수마다 중복 가능(#기수분리)하므로 신원 식별은 uid로.
    payload = {"sub": username, "uid": user_id, "role": role, "cohort_id": cohort_id, "exp": expire}
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


async def _create_totp_pending(user_id: int) -> str:
    """Redis에 TOTP pending 토큰 저장, 5분 TTL. user_id로 저장(username은 기수 간 중복 가능)."""
    redis = _get_redis_client()
    token = secrets.token_urlsafe(32)
    await redis.setex(f"totp_pending:{token}", TOTP_PENDING_TTL, str(user_id))
    return token


async def _get_totp_pending_user_id(token: str) -> int | None:
    """TOTP pending 토큰에서 user_id 추출 (삭제하지 않음 — 실패 시 재시도 허용)"""
    redis = _get_redis_client()
    val = await redis.get(f"totp_pending:{token}")
    return int(val) if val is not None else None


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
async def login(body: LoginRequest, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    """DB 기반 로그인 → JWT 반환 (TOTP 필요 시 pending 토큰)"""
    ip = get_real_ip(request)

    await check_login_rate(ip, body.username)

    candidates = (await db.execute(
        select(User).where(User.username == body.username, User.is_active == True)
    )).scalars().all()

    if body.cohort_id is not None:
        candidates = [u for u in candidates if u.cohort_id == body.cohort_id]

    # 기수 분리로 같은 아이디가 여러 기수에 존재할 수 있음 — 대부분은 기수마다 비번도 다르므로
    # 비번으로 먼저 좁혀서 유일하게 맞으면 기수를 안 물어봐도 되게 한다. 비번까지 같은 경우에만
    # (여러 후보의 비번이 똑같이 맞음) 진짜로 물어볼 수밖에 없다.
    matched = [u for u in candidates if await verify_password(body.password, u.password_hash)]
    if not matched:
        await verify_password(body.password, _DUMMY_HASH)  # timing-attack 방어용 더미 비교

    if len(matched) > 1:
        cohorts = (await db.execute(
            select(Cohort).where(Cohort.id.in_([u.cohort_id for u in matched if u.cohort_id is not None]))
        )).scalars().all()
        logger.info("login_ambiguous user=%s ip=%s candidates=%d", body.username, ip, len(matched))
        return TokenResponse(
            requires_cohort=True,
            cohort_choices=[{"id": c.id, "name": c.name} for c in cohorts],
        )

    user = matched[0] if matched else None

    if user is None:
        logger.warning("login_failed user=%s ip=%s reason=not_found_or_wrong_password", body.username, ip)
        await record_auth_event(db, "LOGIN_FAILED", body.username, None, None, f"{body.username} 로그인 실패(아이디/비밀번호 불일치)", request.url.path, ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="인증 실패")

    # 보관(비활성)된 기수 운영진이면 로그인 차단 (슈퍼관리자 cohort_id=NULL은 항상 허용)
    if user.cohort_id is not None:
        cohort = await db.get(Cohort, user.cohort_id)
        if cohort and not cohort.is_active:
            logger.warning("login_failed user=%s ip=%s reason=cohort_inactive", body.username, ip)
            await record_auth_event(db, "LOGIN_FAILED", user.username, user.role, user.cohort_id, f"{user.username} 로그인 실패(보관된 기수)", request.url.path, ip)
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="보관된 기수입니다.")

    # TOTP 확인
    if user.totp_secret:
        if body.totp_code:
            # 로그인 시 OTP 코드도 함께 제출한 경우
            totp = pyotp.TOTP(user.totp_secret)
            if not totp.verify(body.totp_code, valid_window=1):
                logger.warning("login_failed user=%s ip=%s reason=invalid_totp", user.username, ip)
                await record_auth_event(db, "LOGIN_FAILED", user.username, user.role, user.cohort_id, f"{user.username} 로그인 실패(OTP 불일치)", request.url.path, ip)
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="OTP 코드가 올바르지 않습니다")
        else:
            # OTP 코드 없이 비밀번호만 → pending 토큰 발급
            pending_token = await _create_totp_pending(user.id)
            logger.info("totp_pending user=%s ip=%s", user.username, ip)
            return TokenResponse(requires_totp=True, totp_pending_token=pending_token)

    logger.audit(f"🔑 로그인 성공 — {user.username} ({user.role}) from {ip}")
    await record_auth_event(db, "LOGIN", user.username, user.role, user.cohort_id, f"{user.username} 로그인 성공", request.url.path, ip)
    token = _create_access_token(user.id, user.username, user.role, user.cohort_id, remember=body.remember)
    _set_session_cookie(response, STAFF_COOKIE, token)
    return TokenResponse(access_token=token)


@router.post("/verify-totp", response_model=TokenResponse)
async def verify_totp(body: VerifyTotpRequest, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    """TOTP pending 토큰 + OTP 코드 → JWT 반환"""
    ip = request.client.host if request.client else "unknown"

    await _check_totp_rate(body.token)

    user_id = await _get_totp_pending_user_id(body.token)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="토큰이 만료되었거나 유효하지 않습니다")

    user = await db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="인증 실패")
    if not user.totp_secret:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="인증 실패")

    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(body.totp_code, valid_window=1):
        logger.warning("totp_verify_failed user=%s ip=%s", user.username, ip)
        await record_auth_event(db, "LOGIN_FAILED", user.username, user.role, user.cohort_id, f"{user.username} 로그인 실패(OTP 불일치)", request.url.path, ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="OTP 코드가 올바르지 않습니다")

    await _delete_totp_pending(body.token)
    logger.audit(f"🔑 로그인 성공 (2FA) — {user.username} ({user.role}) from {ip}")
    await record_auth_event(db, "LOGIN", user.username, user.role, user.cohort_id, f"{user.username} 로그인 성공 (2FA)", request.url.path, ip)
    token = _create_access_token(user.id, user.username, user.role, user.cohort_id, remember=body.remember)
    _set_session_cookie(response, STAFF_COOKIE, token)
    return TokenResponse(access_token=token)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """토큰 갱신 — cohort_id는 DB에서 재조회(권위)."""
    user = await resolve_current_user_row(db, current_user)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="인증 실패")
    token = _create_access_token(user.id, user.username, user.role, user.cohort_id)
    return TokenResponse(access_token=token)


@router.delete("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    current_user: dict = Depends(get_current_user),
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
):
    """로그아웃 (Redis 블랙리스트에 토큰 추가)"""
    payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    exp: int = payload.get("exp", 0)
    ttl = max(1, exp - int(datetime.now(timezone.utc).timestamp()))
    await blacklist_token(token, ttl)
    logger.audit("logout user=%s", current_user["username"])
    await record_auth_event(db, "LOGOUT", current_user["username"], current_user.get("role"), current_user.get("cohort_id"), f"{current_user['username']} 로그아웃", request.url.path)
    resp = Response(status_code=status.HTTP_204_NO_CONTENT)
    _clear_session_cookie(resp, STAFF_COOKIE)
    return resp


# ── Member (GenerationAccount) Auth ─────────────────────────────────────────

@router.post("/member-login", response_model=MemberTokenResponse)
async def member_login(
    body: MemberLoginRequest, request: Request, response: Response, db: AsyncSession = Depends(get_db),
):
    """기수 멤버 계정 로그인 → JWT 반환"""
    ip = get_real_ip(request)

    # NOTE: 멤버 로그인은 레이트 리밋 해제 (동시 다수 접속 허용)

    candidates = (await db.execute(
        select(GenerationAccount).where(
            GenerationAccount.username == body.username,
            GenerationAccount.is_active == True,
        )
    )).scalars().all()

    if body.cohort_id is not None:
        candidates = [a for a in candidates if a.cohort_id == body.cohort_id]

    # 기수별 기본 비번이 이미 다르므로(univpt{기수번호}) 비번으로 먼저 좁힌다 —
    # 대부분은 이 한 번으로 유일하게 특정되어 기수를 안 물어봐도 된다.
    matched = [a for a in candidates if await verify_password(body.password, a.password_hash)]
    if not matched:
        await verify_password(body.password, _DUMMY_HASH)  # timing-attack 방어

    if len(matched) > 1:
        cohorts = (await db.execute(
            select(Cohort).where(Cohort.id.in_([a.cohort_id for a in matched]))
        )).scalars().all()
        logger.info("member_login_ambiguous user=%s ip=%s candidates=%d", body.username, ip, len(matched))
        return MemberTokenResponse(
            requires_cohort=True,
            cohort_choices=[{"id": c.id, "name": c.name} for c in cohorts],
        )

    account = matched[0] if matched else None

    if account is None:
        logger.warning("member_login_failed user=%s ip=%s reason=not_found_or_wrong_password", body.username, ip)
        # 로그인 폼이 기수 로그인을 먼저 시도하고 실패하면 운영진 로그인으로 넘어가는 구조라,
        # 운영진이 로그인할 때마다 여기서 매번 "실패"가 찍힌다 — candidates가 애초에 없으면
        # (그 아이디로 된 기수 계정 자체가 없음) 그 정상적인 흐름이니 기록하지 않는다.
        # candidates는 있는데 비번만 틀렸으면 진짜 기수 계정 침입 시도이므로 기록한다.
        if candidates:
            await record_auth_event(db, "LOGIN_FAILED", body.username, "기수원", None, f"{body.username} 기수원 로그인 실패(아이디/비밀번호 불일치)", request.url.path, ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="아이디 또는 비밀번호가 올바르지 않습니다",
        )

    member = await db.get(Member, account.member_id)
    # 이탈/수료(비활성) 멤버는 계정이 남아있어도 로그인 차단
    if member and not member.is_active:
        logger.warning("member_login_failed user=%s ip=%s reason=member_inactive", body.username, ip)
        await record_auth_event(db, "LOGIN_FAILED", body.username, "기수원", member.cohort_id, f"{member.name} 기수원 로그인 실패(비활성 멤버)", request.url.path, ip)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="비활성화된 멤버입니다. 운영진에게 문의하세요.")
    # 보관(비활성)된 기수면 로그인 차단
    cohort = await db.get(Cohort, member.cohort_id) if member else None
    if cohort and not cohort.is_active:
        logger.warning("member_login_failed user=%s ip=%s reason=cohort_inactive", body.username, ip)
        await record_auth_event(db, "LOGIN_FAILED", body.username, "기수원", member.cohort_id if member else None, f"{body.username} 기수원 로그인 실패(보관된 기수)", request.url.path, ip)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="보관된 기수입니다. 운영진에게 문의하세요.")

    # 멤버는 개인폰 PWA로 푸시를 받고 알림 탭으로 며칠 뒤 들어오기도 해서
    # 로그인을 계속 유지한다(운영진 '로그인 유지'와 동일한 사실상 무제한 만료).
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_REMEMBER_EXPIRE_MINUTES)
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
    await record_auth_event(db, "LOGIN", account.username, "기수원", member.cohort_id if member else None, f"{mname} 기수원 로그인 성공", request.url.path, ip)
    _set_session_cookie(response, MEMBER_COOKIE, token)
    return MemberTokenResponse(access_token=token)


class SessionRestore(BaseModel):
    """브라우저가 토큰을 잃어버렸을 때 쿠키로 되살린 결과."""
    access_token: str | None = None
    kind: str | None = None   # staff / member


@router.get("/session", response_model=SessionRestore)
async def restore_session(request: Request, response: Response):
    """localStorage 가 지워졌을 때 HttpOnly 쿠키로 로그인을 되살린다.

    사파리/WebKit 은 7일간 사이트를 쓰지 않으면 **스크립트가 쓴 저장소**를 지운다.
    2주에 한 번 들어오는 기수원은 그래서 매번 다시 로그인해야 했다.
    쿠키는 그 대상이 아니라 살아남는다.

    이 엔드포인트만 쿠키를 본다. 다른 API 는 그대로 Authorization 헤더만 받는다.
    쿠키로 API 전체가 통과되면 다른 사이트가 사용자의 쿠키를 얹어 요청을 보낼 수
    있는데(CSRF), 여기는 GET 이고 응답 본문은 다른 출처의 스크립트가 읽을 수 없다.
    """
    for name, kind in ((STAFF_COOKIE, "staff"), (MEMBER_COOKIE, "member")):
        raw = request.cookies.get(name)
        if not raw:
            continue
        try:
            jwt.decode(raw, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        except JWTError:
            # 만료·위조된 쿠키는 지워서 매번 헛되이 시도하지 않게 한다
            _clear_session_cookie(response, name)
            continue
        if await is_token_blacklisted(raw):
            _clear_session_cookie(response, name)
            continue
        return SessionRestore(access_token=raw, kind=kind)
    return SessionRestore()


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
        cohort_slogan=cohort.slogan if cohort else None,
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
    if not await verify_password(body.current_password, account.password_hash):
        raise HTTPException(status_code=400, detail="현재 비밀번호가 올바르지 않습니다")
    account.password_hash = await hash_password(body.new_password)
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
    user = await resolve_current_user_row(db, current_user)
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    if not await verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="현재 비밀번호가 올바르지 않습니다")
    user.password_hash = await hash_password(body.new_password)
    await db.commit()
    logger.audit(f"change_password user={user.username}")  # type: ignore[attr-defined]
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/member-logout")
async def member_logout(request: Request, response: Response, token: str = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)):
    """멤버 토큰 폐기 (블랙리스트 등록)"""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        exp = payload.get("exp", 0)
        ttl = max(int(exp - datetime.now(timezone.utc).timestamp()), 0)
        if ttl > 0:
            await blacklist_token(token, ttl)
        username = payload.get("sub", "?")
        await record_auth_event(db, "LOGOUT", username, "기수원", payload.get("cohort_id"), f"{username} 기수원 로그아웃", request.url.path)
    except JWTError:
        pass
    _clear_session_cookie(response, MEMBER_COOKIE)
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

    user = await resolve_current_user_row(db, current_user)
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
    user = await resolve_current_user_row(db, current_user)
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
    user = await resolve_current_user_row(db, current_user)
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
        {"id": u.id, "username": u.username, "display_name": u.display_name, "department": u.department}
        for u in result.scalars().all()
    ]


# ── User Management (admin only) ────────────────────────────────────────────

@router.get("/users", response_model=list[UserResponse])
async def list_users(
    current_user: dict = Depends(require_admin_or_chairman),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """사용자 목록 (admin 또는 회장단). 현재 기수 운영진 + 슈퍼관리자 전원(서로 보임)."""
    result = await db.execute(
        select(User)
        .where(or_(User.cohort_id == cohort_id, User.cohort_id.is_(None)))
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
    exists = await db.execute(
        select(User).where(User.cohort_id == cohort_id, User.username == body.username)
    )
    if exists.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="이미 존재하는 사용자명입니다 (같은 기수 내)")

    hashed = await hash_password(body.password)
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
    if current_user.get("id") is not None:
        is_self = bool(user and user.id == current_user["id"])
    else:
        is_self = bool(user and user.username == current_user["username"])  # 구 토큰 폴백
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
        # Check uniqueness — 대상 계정과 같은 기수(슈퍼관리자면 cohort_id IS NULL) 범위 내에서만.
        existing = await db.execute(
            select(User).where(
                User.cohort_id == user.cohort_id, User.username == body.username, User.id != user_id,
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="이미 사용 중인 아이디입니다 (같은 기수 내)")
        user.username = body.username
    if body.display_name is not None:
        user.display_name = body.display_name
    if body.role is not None:
        user.role = body.role
    if body.department is not None:
        user.department = body.department if body.department else None
    if body.password is not None:
        user.password_hash = await hash_password(body.password)
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
    if current_user.get("id") is not None:
        is_self = bool(user and user.id == current_user["id"])
    else:
        is_self = bool(user and user.username == current_user["username"])  # 구 토큰 폴백
    if is_self:
        raise HTTPException(status_code=400, detail="본인 계정은 삭제할 수 없습니다")
    if not user or user.cohort_id != cohort_id:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다")
    await db.delete(user)
    await db.commit()
    logger.audit(f"user_deleted id={user_id} username={user.username}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/reset-semester", status_code=status.HTTP_200_OK)
async def reset_semester(
    request: Request,
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

    # 대량 삭제라 Core delete() 사용(ORM delete는 전체 행을 메모리에 로드해야 해서 느림) —
    # 그만큼 after_flush 훅에 안 잡히므로 테이블별로 지운 건수를 감사 로그에 직접 남긴다.
    async def _delete_and_record(stmt, table_name: str, kind_ko: str):
        result = await db.execute(stmt)
        if result.rowcount:
            await record_manual_event(
                db, "DELETE", table_name, f"{result.rowcount}건 삭제({kind_ko} · 기수 초기화)",
                request_path=request.url.path,
            )

    # 순서 중요: FK 의존성 역순으로 삭제 (전부 현재 기수만)
    await _delete_and_record(delete(Ledger).where(Ledger.member_id.in_(cohort_member_ids)), "ledger", "장부")
    await _delete_and_record(delete(Assignment).where(Assignment.session_id.in_(cohort_session_ids)), "assignments", "과제배정")
    await _delete_and_record(delete(Attendance).where(Attendance.session_id.in_(cohort_session_ids)), "attendance", "출석")
    await _delete_and_record(delete(TeamHistory).where(TeamHistory.session_id.in_(cohort_session_ids)), "team_history", "팀이력")
    await _delete_and_record(delete(TeamMember).where(TeamMember.team_id.in_(cohort_team_ids)), "team_members", "팀원배정")
    await _delete_and_record(delete(Team).where(Team.session_id.in_(cohort_session_ids)), "teams", "팀")
    await _delete_and_record(delete(Session).where(Session.cohort_id == cohort_id), "sessions", "세션")
    await _delete_and_record(delete(CafePost).where(CafePost.cohort_id == cohort_id), "cafe_posts", "카페게시글")
    await _delete_and_record(delete(TreasuryExpense).where(TreasuryExpense.cohort_id == cohort_id), "treasury_expenses", "금고지출")

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
