import logging
import re
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Assignment, Member, Session
from app.services.crawler_cafe import (
    extract_name_from_title,
    fetch_article_detail,
    fetch_board_articles,
    match_member_by_name,
)
from app.services.naver_session import get_valid_requests_session

logger = logging.getLogger(__name__)

# Only REVIEW and HOMEWORK scan board posts; FEEDBACK uses video board comments
BOARD_TYPE_TO_MENU = {
    "REVIEW":   settings.NAVER_CAFE_MENU_REVIEW,
    "HOMEWORK": settings.NAVER_CAFE_MENU_HOMEWORK,
}

async def scan_homework_all(
    session_id: int,
    week_num: int,
    members: list[Member],
    db: AsyncSession,
) -> int:
    """
    특정 세션(주차)에 해당하는 과제/리뷰 게시글을 스캔하여 Assignments 테이블 업데이트
    """
    req_session = await get_valid_requests_session(db)
    if req_session is None:
        logger.error("No valid Naver session — skipping homework scan")
        return 0

    total_processed = 0

    # 각 타입별 게시판 스캔
    for assign_type, menu_id in BOARD_TYPE_TO_MENU.items():
        logger.info(f"Scanning {assign_type} (Menu ID: {menu_id}) for Week {week_num}")

        # 게시글 목록 조회 (최근 50개 정도? 주차가 안 보이면 더 조회해야 할 수도 있음)
        # 여기서는 1페이지(20개) ~ 2페이지 정도 조회
        articles = []
        for page in range(1, 4):  # 최대 3페이지 (60개)
            data = fetch_board_articles(req_session, menu_id, page=page)
            # data 구조 분석 필요 (네이버 카페 API 응답 구조)
            # 보통 data['message']['result']['articleList'] 형태
            try:
                items = data.get("message", {}).get("result", {}).get("articleList", [])
                if not items:
                    break
                articles.extend(items)
            except Exception as e:
                logger.error(f"Failed to parse article list: {e}")
                break

        # 게시글 분석 및 저장
        for article in articles:
            title = article.get("subject", "")
            writer_name = article.get("writer", {}).get("nick", "")  # 닉네임 사용 가능 시 활용

            # 주차 매칭 (제목에 "{week_num}주차" 또는 "Week {week_num}" 포함 여부)
            if not _is_match_week(title, week_num):
                continue

            # 이름 추출 및 멤버 매칭
            # 1. 제목에서 추출 시도
            extracted_name = extract_name_from_title(title)
            member = match_member_by_name(extracted_name, members)

            # 2. 제목 매칭 실패 시 작성자 닉네임 매칭 시도 (보조)
            if not member and writer_name:
                member = match_member_by_name(writer_name, members)

            if member:
                # DB Upsert
                await upsert_assignment(db, session_id, member.id, assign_type, "PASS")
                total_processed += 1
            else:
                logger.warning(f"Member not found for article: {title} (writer: {writer_name})")

    await db.commit()
    return total_processed


async def scan_feedback_comments(
    session_id: int,
    week_num: int,
    members: list[Member],
    db: AsyncSession,
) -> int:
    """
    영상 게시판에서 week_num 주차 영상들의 댓글을 스캔하여
    댓글 작성자를 멤버 매칭 후 FEEDBACK assignment 업데이트.
    댓글 있으면 PASS, 없으면 MISSING.
    """
    req_session = await get_valid_requests_session(db)
    if req_session is None:
        logger.error("No valid Naver session — skipping feedback scan")
        return 0

    # 1. 영상 게시판에서 해당 주차 게시글 수집
    video_articles = []
    for page in range(1, 4):
        data = fetch_board_articles(req_session, settings.NAVER_CAFE_MENU_VIDEO, page=page)
        items = data.get("message", {}).get("result", {}).get("articleList", [])
        if not items:
            break
        for item in items:
            if _is_match_week(item.get("subject", ""), week_num):
                video_articles.append(item)

    if not video_articles:
        logger.warning(f"No video articles found for week {week_num}")
        return 0

    logger.info(f"Found {len(video_articles)} video articles for week {week_num}")

    # 2. 각 게시글의 댓글 작성자 수집
    commenters: set[int] = set()  # member_ids who left a comment
    for article in video_articles:
        article_id = article.get("articleId") or article.get("article_id")
        if not article_id:
            continue
        try:
            detail = fetch_article_detail(req_session, article_id)
            comments = (
                detail.get("message", {})
                      .get("result", {})
                      .get("commentList", [])
            )
            for comment in comments:
                nick = comment.get("writer", {}).get("nick", "")
                member = match_member_by_name(nick, members)
                if member:
                    commenters.add(member.id)
        except Exception as e:
            logger.warning(f"Failed to fetch article {article_id}: {e}")

    # 3. 각 멤버별 FEEDBACK 상태 업데이트
    count = 0
    for member in members:
        status = "PASS" if member.id in commenters else "MISSING"
        await upsert_assignment(db, session_id, member.id, "FEEDBACK", status)
        count += 1

    await db.commit()
    return count


def _is_match_week(title: str, week_num: int) -> bool:
    """제목이 해당 주차인지 확인"""
    # "3주차", "3 주차", "Week 3", "Week3", "03주차" 등
    # 정규식으로 엄격하게 체크
    # 부정 후방탐색/전방탐색으로 숫자의 일부가 아닌 경우만 매칭
    pattern = rf"(?<!\d){week_num}(?!\d)\s*주차|Week\s*{week_num}(?!\d)"
    return bool(re.search(pattern, title, re.IGNORECASE))


async def upsert_assignment(
    db: AsyncSession,
    session_id: int,
    member_id: int,
    type_: str,
    status: str,
):
    """Assignment 생성 또는 업데이트"""
    # 이미 존재하는지 확인
    stmt = select(Assignment).where(
        Assignment.session_id == session_id,
        Assignment.member_id == member_id,
        Assignment.type == type_,
    )
    result = await db.execute(stmt)
    assignment = result.scalar_one_or_none()

    if assignment:
        if assignment.status != status:
            assignment.status = status
            assignment.scanned_at = datetime.now()
    else:
        assignment = Assignment(
            session_id=session_id,
            member_id=member_id,
            type=type_,
            status=status,
            scanned_at=datetime.now(),
        )
        db.add(assignment)

    await db.flush()
