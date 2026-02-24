import logging
import re
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


async def scan_excuses(
    session_id: int,
    week_num: int,
    members: list[Member],
    mode: Literal["PRE", "POST"],
    db: AsyncSession,
) -> int:
    """
    사유서 게시판(NAVER_CAFE_MENU_EXCUSE)을 스캔하여 Attendance 레코드 업데이트.
    - PRE 모드: 해당 주차 글을 찾아 매칭된 멤버의 excuse_type="PRE", excuse_text=본문 저장
    - POST 모드: 결석/지각 중 excuse_type 미설정 멤버의 글만 처리, excuse_type="POST" 저장
    """
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

    # 게시판 스캔 (최대 3페이지)
    articles = []
    for page in range(1, 4):
        try:
            data = fetch_board_articles(req_session, menu_id, page=page)
        except Exception as e:
            logger.error(f"Failed to fetch excuse board page {page}: {e}")
            break
        items = data.get("message", {}).get("result", {}).get("articleList", [])
        if not items:
            break
        articles.extend(items)

    count = 0
    for article in articles:
        title = article.get("subject", "")
        writer_nick = article.get("writer", {}).get("nick", "")

        if not _is_match_week(title, week_num):
            continue

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
        excuse_text = ""
        if article_id:
            try:
                detail = fetch_article_detail(req_session, int(article_id))
                content_html = (
                    detail.get("message", {})
                          .get("result", {})
                          .get("article", {})
                          .get("contentHtml", "")
                )
                excuse_text = _strip_html(content_html)
            except Exception as e:
                logger.warning(f"Failed to fetch article detail {article_id}: {e}")

        # Attendance 업데이트
        stmt = select(Attendance).where(
            Attendance.session_id == session_id,
            Attendance.member_id == member.id,
        )
        result = await db.execute(stmt)
        attendance = result.scalar_one_or_none()
        if attendance:
            attendance.excuse_type = mode
            attendance.excuse_text = excuse_text
            count += 1
        else:
            logger.warning(f"No attendance record for member {member.id} in session {session_id}")

    await db.commit()
    return count
