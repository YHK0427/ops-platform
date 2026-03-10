"""
네이버 IMAP으로 PPT 제출 이메일을 스캔하는 모듈.

이메일 제목 패턴: 과제{주차}주차_{멤버이름}P_{세션명}
예: 과제11주차_홍길동P_프로젝트발표
"""
import email
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from email.header import decode_header
from email.utils import parsedate_to_datetime
from typing import Optional

from imapclient import IMAPClient

from app.config import settings

logger = logging.getLogger(__name__)

# PPT 관련 확장자
PPT_EXTENSIONS = {".ppt", ".pptx", ".pdf", ".key", ".odp"}

# 이메일 제목에서 멤버 이름 추출 패턴
# 과제11주차_홍길동P_프로젝트발표 → "홍길동"
MEMBER_NAME_PATTERN = re.compile(r"과제\d+주차[_ ](.+?)P[_ ]")

# 본문에서 구글 드라이브 링크 추출
DRIVE_LINK_PATTERN = re.compile(
    r"https?://drive\.google\.com/(?:file/d/|open\?id=|drive/folders/)([a-zA-Z0-9_-]+)"
)


@dataclass
class Attachment:
    filename: str
    content: bytes
    content_type: str


@dataclass
class EmailResult:
    sender: str
    member_name: str
    subject: str
    received_at: datetime
    attachments: list[Attachment] = field(default_factory=list)
    drive_links: list[str] = field(default_factory=list)


def _decode_header_value(raw: str) -> str:
    """이메일 헤더의 인코딩된 값을 디코딩"""
    parts = decode_header(raw)
    decoded = []
    for part, charset in parts:
        if isinstance(part, bytes):
            decoded.append(part.decode(charset or "utf-8", errors="replace"))
        else:
            decoded.append(part)
    return "".join(decoded)


def _extract_attachments(msg: email.message.Message) -> list[Attachment]:
    """이메일에서 PPT 관련 첨부파일 추출"""
    attachments = []
    for part in msg.walk():
        content_disposition = part.get("Content-Disposition", "")
        if "attachment" not in content_disposition and "inline" not in content_disposition:
            continue

        raw_filename = part.get_filename()
        if not raw_filename:
            continue

        filename = _decode_header_value(raw_filename)
        ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

        if ext in PPT_EXTENSIONS:
            content = part.get_payload(decode=True)
            if content:
                attachments.append(Attachment(
                    filename=filename,
                    content=content,
                    content_type=part.get_content_type() or "application/octet-stream",
                ))

    return attachments


def _extract_drive_links(msg: email.message.Message) -> list[str]:
    """이메일 본문에서 구글 드라이브 링크(file_id) 추출"""
    file_ids: list[str] = []
    for part in msg.walk():
        if part.get_content_type() in ("text/plain", "text/html"):
            payload = part.get_payload(decode=True)
            if not payload:
                continue
            charset = part.get_content_charset() or "utf-8"
            text = payload.decode(charset, errors="replace")
            for match in DRIVE_LINK_PATTERN.finditer(text):
                file_id = match.group(1)
                if file_id not in file_ids:
                    file_ids.append(file_id)
    return file_ids


class EmailScanner:
    """네이버 IMAP으로 PPT 제출 이메일 스캔"""

    def __init__(
        self,
        host: str = "imap.naver.com",
        port: int = 993,
        email_addr: Optional[str] = None,
        password: Optional[str] = None,
    ):
        self.host = host
        self.port = port
        self.email_addr = email_addr or settings.NAVER_IMAP_EMAIL
        self.password = password or settings.NAVER_IMAP_PASSWORD

    def scan(self, week_num: int) -> list[EmailResult]:
        """
        IMAP으로 해당 주차 PPT 이메일 스캔.

        1. INBOX에서 제목에 "과제{week_num}주차" 포함된 메일 검색
        2. 각 메일에서 멤버 이름, 첨부파일, 드라이브 링크 추출
        3. 동일 이름 중복 → 가장 최신만 유지
        """
        if not self.email_addr or not self.password:
            raise ValueError("NAVER_IMAP_EMAIL, NAVER_IMAP_PASSWORD가 설정되지 않았습니다")

        search_keyword = f"과제{week_num}주차"
        logger.info(f"IMAP 스캔 시작: {search_keyword} (host={self.host})")

        results_by_name: dict[str, EmailResult] = {}

        with IMAPClient(self.host, port=self.port, ssl=True) as client:
            client.login(self.email_addr, self.password)
            client.select_folder("INBOX", readonly=True)

            # 제목 검색
            msg_ids = client.search(["SUBJECT", search_keyword])
            logger.info(f"검색 결과: {len(msg_ids)}건")

            if not msg_ids:
                return []

            # 메일 가져오기 (RFC822 전체)
            fetched = client.fetch(msg_ids, ["RFC822", "INTERNALDATE"])

            for msg_id, data in fetched.items():
                try:
                    raw_email = data[b"RFC822"]
                    internal_date = data.get(b"INTERNALDATE")

                    msg = email.message_from_bytes(raw_email)

                    # 제목 디코딩
                    raw_subject = msg.get("Subject", "")
                    subject = _decode_header_value(raw_subject)

                    # 멤버 이름 추출
                    name_match = MEMBER_NAME_PATTERN.search(subject)
                    if not name_match:
                        logger.warning(f"제목에서 이름 추출 실패: {subject}")
                        continue
                    member_name = name_match.group(1).strip()

                    # 수신 시간
                    if internal_date:
                        received_at = internal_date
                    else:
                        date_str = msg.get("Date", "")
                        try:
                            received_at = parsedate_to_datetime(date_str)
                        except Exception:
                            received_at = datetime.now()

                    # 발신자
                    sender = msg.get("From", "")

                    # 첨부파일
                    attachments = _extract_attachments(msg)

                    # 드라이브 링크
                    drive_links = _extract_drive_links(msg)

                    result = EmailResult(
                        sender=sender,
                        member_name=member_name,
                        subject=subject,
                        received_at=received_at,
                        attachments=attachments,
                        drive_links=drive_links,
                    )

                    # 중복: 동일 이름 → 최신 메일만 유지
                    existing = results_by_name.get(member_name)
                    if existing is None or result.received_at > existing.received_at:
                        results_by_name[member_name] = result

                except Exception as e:
                    logger.error(f"메일 파싱 실패 (msg_id={msg_id}): {e}", exc_info=True)

        results = list(results_by_name.values())
        logger.info(f"스캔 완료: {len(results)}명 매칭")
        return results
