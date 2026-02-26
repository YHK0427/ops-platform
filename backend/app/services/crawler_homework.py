import logging
import re
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Assignment, Attendance, Member, Session, Team, TeamMember
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

    # 팀 정보 로드 (HOMEWORK 게시판의 팀 PPT 매칭용)
    teams_stmt = select(Team).where(Team.session_id == session_id)
    teams_result = await db.execute(teams_stmt)
    team_map: dict[str, Team] = {t.name: t for t in teams_result.scalars().all()}

    # 팀별 멤버 ID 로드
    team_member_ids: dict[int, list[int]] = {}
    if team_map:
        for team in team_map.values():
            tm_stmt = select(TeamMember.member_id).where(TeamMember.team_id == team.id)
            tm_result = await db.execute(tm_stmt)
            team_member_ids[team.id] = [row[0] for row in tm_result.all()]

    total_processed = 0

    # 각 타입별 게시판 스캔
    for assign_type, menu_id in BOARD_TYPE_TO_MENU.items():
        logger.info(f"Scanning {assign_type} (Menu ID: {menu_id}) for Week {week_num}")

        # 게시글 목록 조회 (최근 50개 정도? 주차가 안 보이면 더 조회해야 할 수도 있음)
        # 여기서는 1페이지(20개) ~ 2페이지 정도 조회
        articles = []
        for page in range(1, 11):  # 최대 10페이지 (200개)
            data = fetch_board_articles(req_session, menu_id, page=page)
            # data 구조 분석 필요 (네이버 카페 API 응답 구조)
            # 보통 data['message']['result']['articleList'] 형태
            try:
                items = data.get("result", {}).get("articleList", [])
                if not items:
                    break
                articles.extend(items)
            except Exception as e:
                logger.error(f"Failed to parse article list: {e}")
                break

        # 게시글 분석 및 저장
        for raw_article in articles:
            article = raw_article.get("item", {})
            title = article.get("subject", "")
            writer_name = article.get("writerInfo", {}).get("nickName", "")

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
            elif assign_type == "HOMEWORK" and team_map:
                # 멤버 매칭 실패 시, 팀명 매칭 시도 (PPT 게시판 업로드: "과제16주차_1팀")
                team_name = _extract_team_from_title(title)
                matched_team = team_map.get(team_name) if team_name else None
                if matched_team:
                    mids = team_member_ids.get(matched_team.id, [])
                    for mid in mids:
                        await upsert_assignment(db, session_id, mid, "PPT", "PASS")
                    total_processed += len(mids)
                    logger.info(f"PPT team match: '{team_name}' → {len(mids)} members")
                else:
                    logger.warning(f"Member/team not found for article: {title} (writer: {writer_name})")
            else:
                logger.warning(f"Member not found for article: {title} (writer: {writer_name})")

    # 결석 멤버의 REVIEW는 면제(EXEMPT) 처리
    absent_stmt = select(Attendance.member_id).where(
        Attendance.session_id == session_id,
        Attendance.status.in_(("ABSENT", "EXCUSED")),
    )
    absent_result = await db.execute(absent_stmt)
    absent_ids = {row[0] for row in absent_result.all()}

    if absent_ids:
        for mid in absent_ids:
            await upsert_assignment(db, session_id, mid, "REVIEW", "EXEMPT")
            logger.info(f"REVIEW EXEMPT for absent member_id={mid}")

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
    target_member_ids 기반으로 FEEDBACK assignment 업데이트.

    규칙:
    - effective_targets = {본인} ∪ {target_member_ids} (본인 영상은 기본 포함)
    - effective_targets 내 모든 멤버의 영상에 댓글을 달았으면 PASS, 아니면 MISSING
    - target_member_ids 미설정 시 본인 영상만 체크
    - 영상이 없는 멤버의 경우 체크 불가 → PASS 처리 (스캔 대상 아님)
    """
    req_session = await get_valid_requests_session(db)
    if req_session is None:
        logger.error("No valid Naver session — skipping feedback scan")
        return 0

    # 1. 영상 게시판에서 해당 주차 게시글 수집
    video_articles = []
    for page in range(1, 11):  # 최대 10페이지 (200개)
        data = fetch_board_articles(req_session, settings.NAVER_CAFE_MENU_VIDEO, page=page)
        items = data.get("result", {}).get("articleList", [])
        if not items:
            break
        for raw_item in items:
            item = raw_item.get("item", {})
            if _is_match_week(item.get("subject", ""), week_num):
                video_articles.append(item)

    if not video_articles:
        logger.warning(f"No video articles found for week {week_num}")
        return 0

    logger.info(f"Found {len(video_articles)} video articles for week {week_num}")

    # 2. 각 게시글의 저자 매핑 및 댓글 수집
    # member_id → set[article_id]: 이 멤버가 올린 영상들
    member_to_articles: dict[int, set[int]] = {}
    # article_id → set[member_id]: 이 영상에 댓글을 단 멤버들
    article_commenters: dict[int, set[int]] = {}

    for article in video_articles:
        article_id = article.get("articleId") or article.get("article_id")
        if not article_id:
            continue
        article_id = int(article_id)

        # 영상 저자 매칭 (영상 제목 형식 우선, fallback으로 일반 형식)
        title = article.get("subject", "")
        extracted = extract_name_from_title(title, doc_type="VIDEO") or extract_name_from_title(title)
        owner = match_member_by_name(extracted, members) if extracted else None
        if owner:
            member_to_articles.setdefault(owner.id, set()).add(article_id)

        # 댓글 작성자 수집
        try:
            detail = fetch_article_detail(req_session, article_id)
            comments = (
                detail.get("result", {})
                      .get("comments", {})
                      .get("items", [])
            )
            commenters_for_article: set[int] = set()
            for comment in comments:
                nick = comment.get("writer", {}).get("nick", "")
                commenter = match_member_by_name(nick, members)
                if commenter:
                    commenters_for_article.add(commenter.id)
            article_commenters[article_id] = commenters_for_article
        except Exception as e:
            logger.warning(f"Failed to fetch article {article_id}: {e}")
            article_commenters[article_id] = set()

    # 3. FEEDBACK Assignment에서 target_member_ids 로드
    stmt = select(Assignment).where(
        Assignment.session_id == session_id,
        Assignment.type == "FEEDBACK",
    )
    result = await db.execute(stmt)
    feedback_assignments = {a.member_id: a for a in result.scalars().all()}

    # 4. 각 멤버별 FEEDBACK 상태 업데이트
    count = 0
    for member in members:
        assignment = feedback_assignments.get(member.id)
        explicit_targets: list[int] = (assignment.target_member_ids or []) if assignment else []

        # 본인 영상은 기본 포함
        effective_targets = list({member.id} | set(explicit_targets))

        # 영상이 있는 대상만 체크 (영상 없는 대상은 확인 불가이므로 skip)
        targets_with_videos = [t for t in effective_targets if t in member_to_articles]

        if not targets_with_videos:
            # 체크 가능한 영상이 없음 → PASS (확인 불가)
            logger.warning(
                f"Member {member.id}: no video articles for any effective target "
                f"({effective_targets}) — marking PASS"
            )
            status = "PASS"
        else:
            # 모든 target의 영상에 댓글을 달았는지 확인
            all_covered = all(
                member.id in article_commenters.get(article_id, set())
                for target_id in targets_with_videos
                for article_id in member_to_articles.get(target_id, set())
            )
            status = "PASS" if all_covered else "MISSING"

        await upsert_assignment(db, session_id, member.id, "FEEDBACK", status)
        count += 1

    await db.commit()
    return count


def _extract_team_from_title(title: str) -> str | None:
    """제목에서 팀명 추출 (예: '과제16주차_1팀' → '1팀', '과제16주차_1조' → '1조')"""
    if "_" not in title:
        return None
    parts = title.split("_")
    possible_team = parts[-1].strip()
    # "1팀", "2팀", "1조", "2조", "A팀" 등의 패턴
    if re.search(r"^.+(팀|조)$", possible_team):
        return possible_team
    return None


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
