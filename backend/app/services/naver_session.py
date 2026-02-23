import json
import logging
from datetime import datetime, timezone
from typing import Optional

import requests
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import NaverSession

logger = logging.getLogger(__name__)


async def import_session(db: AsyncSession, storage_json: dict) -> NaverSession:
    """
    Playwright storage state JSON을 DB에 저장.
    기존 유효 세션은 모두 무효화(is_valid=False).
    """
    # 1. 기존 세션 무효화
    await db.execute(
        update(NaverSession)
        .where(NaverSession.is_valid == True)
        .values(is_valid=False)
    )

    # 2. 만료 시간 파싱 (NID_SES 쿠키)
    expires_hint = None
    cookies = storage_json.get("cookies", [])
    for cookie in cookies:
        if cookie.get("name") == "NID_SES":
            expires = cookie.get("expires")
            if expires:
                # timestamp -> datetime
                try:
                    expires_hint = datetime.fromtimestamp(expires, tz=timezone.utc)
                except Exception:
                    logger.warning("Failed to parse NID_SES expires", exc_info=True)
            break

    # 3. 새 세션 저장
    new_session = NaverSession(
        storage_json=storage_json,
        is_valid=True,
        expires_hint=expires_hint,
    )
    db.add(new_session)
    await db.commit()
    await db.refresh(new_session)
    return new_session


async def get_valid_requests_session(db: AsyncSession) -> Optional[requests.Session]:
    """
    DB에서 유효한 네이버 세션을 가져와 requests.Session으로 변환.
    없으면 None 반환.
    """
    stmt = select(NaverSession).where(NaverSession.is_valid == True).order_by(NaverSession.id.desc()).limit(1)
    result = await db.execute(stmt)
    naver_session = result.scalar_one_or_none()

    if not naver_session:
        return None

    return _build_requests_session(naver_session.storage_json)


def _build_requests_session(storage_json: dict) -> requests.Session:
    """storage_json(Playwright format) -> requests.Session"""
    session = requests.Session()
    
    # 헤더 설정
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://cafe.naver.com/",
        "X-Cafe-Product": "pc",
    })

    # 쿠키 주입
    cookies = storage_json.get("cookies", [])
    for cookie in cookies:
        session.cookies.set(
            cookie["name"],
            cookie["value"],
            domain=cookie.get("domain", ".naver.com"),
            path=cookie.get("path", "/"),
        )
    
    return session
