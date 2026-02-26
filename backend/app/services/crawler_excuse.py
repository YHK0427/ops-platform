import logging
import re
from datetime import date as date_type, datetime, time, timedelta, timezone
from html.parser import HTMLParser
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Attendance, Member
from app.services.crawler_cafe import (
    extract_name_from_title,
    fetch_article_detail,
    fetch_board_articles,
    match_member_by_name,
)
from app.services.naver_session import get_valid_requests_session

logger = logging.getLogger(__name__)

# headName / 제목에서 출결 상태 감지용 매핑
_ATTENDANCE_KEYWORDS: dict[str, str] = {
    "결석": "ABSENT",
    "지각": "LATE_UNDER10",
    "조퇴": "EARLY_LEAVE",
}


class _HTMLStripper(HTMLParser):
    def __init__(self):
        super().__init__()
        self._parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self._parts.append(data)

    def get_text(self) -> str:
        return " ".join(self._parts).strip()


def _strip_html(html: str) -> str:
    s = _HTMLStripper()
    s.feed(html)
    return s.get_text()


def _is_match_week(title: str, week_num: int) -> bool:
    pattern = rf"(?<!\d){week_num}(?!\d)\s*주차|Week\s*{week_num}(?!\d)"
    return bool(re.search(pattern, title, re.IGNORECASE))


def _detect_attendance_status(head_name: str, title: str) -> str | None:
    """headName이나 제목에서 결석/지각/조퇴 키워드를 감지하여 출결 상태 반환."""
    # headName 우선 체크
    for keyword, status in _ATTENDANCE_KEYWORDS.items():
        if keyword in head_name:
            return status
    # 제목 [] 안의 키워드 체크
    bracket_match = re.search(r"\[([^\]]+)\]", title)
    if bracket_match:
        bracket_text = bracket_match.group(1)
        for keyword, status in _ATTENDANCE_KEYWORDS.items():
            if keyword in bracket_text:
                return status
    return None


async def scan_excuses(
    session_id: int,
    week_num: int,
    members: list[Member],
    mode: Literal["PRE", "POST"],
    db: AsyncSession,
    session_date: date_type | None = None,
) -> int:
    """
    사유서 게시판 스캔하여 Attendance 레코드 업데이트.

    - PRE 모드: PRE 마감 이전에 작성된 글만 처리. headName/제목에서 출결 상태 자동 감지.
    - POST 모드: PRE 마감 이후에 작성된 글만 처리. 결석/지각 중 excuse_type 미설정 멤버 대상.
    - PRE 마감: 세션 전날 21:59:59 KST (= UTC 12:59:59)
    """
    # PRE 마감 기준 계산 (ms 단위)
    pre_deadline_ms: int | None = None
    if session_date is not None:
        pre_deadline_ms = int(
            datetime.combine(
                session_date - timedelta(days=1),
                time(12, 59, 59),
                tzinfo=timezone.utc,
            ).timestamp() * 1000
        )

    req_session = await get_valid_requests_session(db)
    if req_session is None:
        logger.error("No valid Naver session — skipping excuse scan")
        return 0

    menu_id = settings.NAVER_CAFE_MENU_EXCUSE
    if not menu_id:
        logger.error("NAVER_CAFE_MENU_EXCUSE not configured")
        return 0

    if mode not in ("PRE", "POST"):
        logger.error(f"Invalid mode '{mode}' — expected PRE or POST")
        return 0

    # POST 모드: 대상 멤버 사전 필터링 (PRESENT 아니고 excuse_type 미설정)
    target_member_ids: set[int] | None = None
    if mode == "POST":
        stmt = select(Attendance).where(
            Attendance.session_id == session_id,
            Attendance.status != "PRESENT",
            Attendance.excuse_type.is_(None),
        )
        result = await db.execute(stmt)
        target_member_ids = {a.member_id for a in result.scalars().all()}
        if not target_member_ids:
            logger.info("POST mode: no unexcused absent members found")
            return 0

    # 게시판 스캔 (최대 10페이지)
    articles = []
    for page in range(1, 11):
        try:
            data = fetch_board_articles(req_session, menu_id, page=page)
        except Exception as e:
            logger.error(f"Failed to fetch excuse board page {page}: {e}")
            break
        items = data.get("result", {}).get("articleList", [])
        if not items:
            break
        articles.extend(items)

    count = 0
    for raw_article in articles:
        article = raw_article.get("item", {})
        title = article.get("subject", "")
        writer_nick = article.get("writerInfo", {}).get("nickName", "")

        if not _is_match_week(title, week_num):
            continue

        # 시간 기반 필터링: PRE 모드는 마감 전 글만, POST 모드는 마감 후 글만
        write_ts_ms = article.get("writeDateTimestamp", 0)
        if pre_deadline_ms is not None and write_ts_ms:
            is_pre_article = write_ts_ms <= pre_deadline_ms
            if mode == "PRE" and not is_pre_article:
                continue  # PRE 스캔인데 마감 후 작성된 글 → 스킵
            if mode == "POST" and is_pre_article:
                continue  # POST 스캔인데 마감 전 작성된 글 → 스킵

        # 멤버 매칭 (제목 → 닉네임 순서로 시도)
        extracted = extract_name_from_title(title)
        member = match_member_by_name(extracted, members) if extracted else None
        if not member and writer_nick:
            member = match_member_by_name(writer_nick, members)
        if not member:
            logger.warning(f"No member match for article: {title}")
            continue

        # POST 모드: 대상 멤버만 처리
        if target_member_ids is not None and member.id not in target_member_ids:
            continue

        # 게시글 본문 추출
        article_id = article.get("articleId") or article.get("article_id")
        head_name = article.get("headName", "")  # 말머리: "지각", "결석" 등
        excuse_text = ""
        if article_id:
            try:
                detail = fetch_article_detail(req_session, int(article_id))
                content_html = (
                    detail.get("result", {})
                          .get("article", {})
                          .get("contentHtml", "")
                )
                excuse_text = _strip_html(content_html)
            except Exception as e:
                logger.warning(f"Failed to fetch article detail {article_id}: {e}")

        # 제목(+ 말머리)를 본문 앞에 추가
        header = f"[{head_name}] {title}" if head_name else title
        excuse_text = f"{header}\n---\n{excuse_text}" if excuse_text else header

        # excuse_type 결정
        detected_type: str = mode  # 모드별 필터링을 이미 했으므로 mode가 곧 type

        # Attendance 업데이트
        stmt = select(Attendance).where(
            Attendance.session_id == session_id,
            Attendance.member_id == member.id,
        )
        result = await db.execute(stmt)
        attendance = result.scalar_one_or_none()
        if attendance:
            attendance.excuse_type = detected_type
            attendance.excuse_text = excuse_text

            # PRE 모드: headName/제목에서 출결 상태 자동 감지 → 미리 세팅
            if mode == "PRE":
                detected_status = _detect_attendance_status(head_name, title)
                if detected_status and attendance.status in ("PENDING", "PRESENT"):
                    attendance.status = detected_status
                    logger.info(
                        f"Attendance pre-set: member={member.name}, "
                        f"status={detected_status} (from headName='{head_name}', title='{title}')"
                    )

            count += 1
            logger.info(
                f"Excuse set: member={member.name}, type={detected_type}, "
                f"write_ts={write_ts_ms}, pre_deadline={pre_deadline_ms}"
            )
        else:
            logger.warning(f"No attendance record for member {member.id} in session {session_id}")

    await db.commit()
    return count
