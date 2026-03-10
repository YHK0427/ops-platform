import asyncio
import json
import logging
import traceback
from datetime import datetime, timezone

AUDIT = 25
logging.addLevelName(AUDIT, "AUDIT")


def audit(self, message, *args, **kwargs):
    if self.isEnabledFor(AUDIT):
        self._log(AUDIT, message, args, **kwargs)


logging.Logger.audit = audit


class JSONFormatter(logging.Formatter):
    def format(self, record):
        log_data = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if hasattr(record, "user"):
            log_data["user"] = record.user
        if hasattr(record, "ip"):
            log_data["ip"] = record.ip
        if record.exc_info and record.exc_info[0] is not None:
            log_data["exc"] = traceback.format_exception(*record.exc_info)
        return json.dumps(log_data, ensure_ascii=False)


class TelegramHandler(logging.Handler):
    """WARNING 이상 로그를 텔레그램 alert 채널로 전송"""

    def __init__(self, bot_token: str, chat_id: str):
        super().__init__(level=logging.WARNING)
        self.bot_token = bot_token
        self.chat_id = chat_id

    def emit(self, record):
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._send(record))
        except RuntimeError:
            pass  # no event loop — skip

    async def _send(self, record):
        try:
            import httpx

            emoji = {"WARNING": "⚠️", "ERROR": "🔴", "CRITICAL": "🚨"}.get(
                record.levelname, "ℹ️"
            )
            text = f"{emoji} *{record.levelname}*\n`{record.name}`\n\n{record.getMessage()}"
            if record.exc_info and record.exc_info[0] is not None:
                tb = "".join(traceback.format_exception(*record.exc_info))
                text += f"\n\n```\n{tb[:2000]}```"
            text = text[:4000]

            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(
                    f"https://api.telegram.org/bot{self.bot_token}/sendMessage",
                    json={
                        "chat_id": self.chat_id,
                        "text": text,
                        "parse_mode": "Markdown",
                    },
                )
        except Exception:
            pass  # 텔레그램 전송 실패가 앱을 죽이면 안 됨


class TelegramAuditHandler(logging.Handler):
    """AUDIT 레벨 로그를 텔레그램 audit 채널로 전송"""

    def __init__(self, bot_token: str, chat_id: str):
        super().__init__(level=AUDIT)
        self.bot_token = bot_token
        self.chat_id = chat_id
        self.addFilter(lambda r: r.levelno == AUDIT)

    def emit(self, record):
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._send(record))
        except RuntimeError:
            pass

    async def _send(self, record):
        try:
            import httpx

            text = f"📋 *AUDIT*\n`{record.name}`\n\n{record.getMessage()}"
            text = text[:4000]

            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(
                    f"https://api.telegram.org/bot{self.bot_token}/sendMessage",
                    json={
                        "chat_id": self.chat_id,
                        "text": text,
                        "parse_mode": "Markdown",
                    },
                )
        except Exception:
            pass


def setup_logging():
    """앱/워커 시작 시 1회 호출"""
    from app.config import settings

    root = logging.getLogger()
    if root.handlers:
        return  # 이미 설정됨 (중복 호출 방지)

    root.setLevel(logging.INFO)

    # 콘솔 핸들러 (Docker logs → JSON)
    console = logging.StreamHandler()
    console.setFormatter(JSONFormatter())
    root.addHandler(console)

    # 텔레그램 alert 핸들러 (WARNING+)
    bot_token = settings.TELEGRAM_BOT_TOKEN
    alert_chat = settings.TELEGRAM_ALERT_CHAT_ID
    audit_chat = settings.TELEGRAM_AUDIT_CHAT_ID

    if bot_token and alert_chat:
        tg_alert = TelegramHandler(bot_token, alert_chat)
        root.addHandler(tg_alert)

    # 텔레그램 audit 핸들러 (AUDIT 레벨만)
    if bot_token and audit_chat:
        tg_audit = TelegramAuditHandler(bot_token, audit_chat)
        root.addHandler(tg_audit)

    # 외부 라이브러리 로그 레벨 조절
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("arq").setLevel(logging.INFO)
