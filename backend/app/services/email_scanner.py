import logging

logger = logging.getLogger(__name__)

class EmailScanner:
    def __init__(self):
        logger.info("EmailScanner initialized (Stub mode)")

    def scan_emails(self, keyword: str):
        """이메일 스캔 (미구현)"""
        logger.warning(f"Email scan requested for '{keyword}' but strict mode prevents email access.")
        return []
