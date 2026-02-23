import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.email_scanner import EmailScanner

logger = logging.getLogger(__name__)


async def scan_ppt(session_id: int, mode: str, db: AsyncSession) -> dict[str, Any]:
    """
    PPT 스캔 로직 (Stub)
    이메일 스캔 기능이 비활성화되어 있으므로, 
    여기서는 '스캔 수행됨' 로그만 남기고 빈 결과를 반환한다.
    실제 PPT 상태 관리는 Admin이 수동으로 수행한다.
    """
    logger.info(f"Scanning PPT for session {session_id} (mode={mode}) - DISABLED (Manual management only)")
    
    # 만약 카페 게시글 스캔 기능이 있다면 여기서 호출할 수 있음.
    # 하지만 현재 요구사항은 '이메일 스캔 불가' -> '수동 관리 대체' 이므로
    # 자동 로직은 수행하지 않음.
    
    return {"status": "skipped", "reason": "Manual management mode"}
