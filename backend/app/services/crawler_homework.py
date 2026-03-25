import logging
import re
from datetime import datetime, timezone, timedelta
from typing import Optional

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

# REVIEW and PPT scan board posts; FEEDBACK uses video board comments
BOARD_TYPE_TO_MENU = {
    "REVIEW": settings.NAVER_CAFE_MENU_REVIEW,
    "PPT":    settings.NAVER_CAFE_MENU_PPT,
}

def _parse_deadline(raw: str | None) -> datetime | None:
    """ISO datetime 문자열 → aware datetime (None이면 None)"""
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone(timedelta(hours=9)))
        return dt
    except Exception:
        return None


async def scan_homework_all(
    session_id: int,
    week_num: int,
    members: list[Member],
    db: AsyncSession,
    deadline_post: Optional[datetime] = None,
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
        for page in range(1, 14):  # 임시: 13페이지 (260개)
            data = fetch_board_articles(req_session, menu_id, page=page)
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

            article_id = article.get("articleId") or article.get("article_id")
            article_raw = {"article_id": int(article_id), "menu_id": menu_id} if article_id else None

            # 마감 기한 체크: deadline 이후 게시글은 MISSING 처리
            write_ts_ms = article.get("writeDateTimestamp", 0)
            is_late = False
            if deadline_post and write_ts_ms:
                write_dt = datetime.fromtimestamp(write_ts_ms / 1000, tz=timezone.utc)
                is_late = write_dt > deadline_post
            status = "MISSING" if is_late else "PASS"

            if member:
                # DB Upsert
                await upsert_assignment(db, session_id, member.id, assign_type, status, raw_data=article_raw)
                total_processed += 1
                if is_late:
                    logger.info(f"Late {assign_type}: {member.name} (written after deadline)")
            elif assign_type == "PPT" and team_map:
                # 멤버 매칭 실패 시, 팀명 매칭 시도 (PPT 게시판 업로드: "과제16주차_1팀")
                team_name = _extract_team_from_title(title)
                matched_team = team_map.get(team_name) if team_name else None
                if matched_team:
                    mids = team_member_ids.get(matched_team.id, [])
                    for mid in mids:
                        await upsert_assignment(db, session_id, mid, "PPT", status, raw_data=article_raw)
                    total_processed += len(mids)
                    logger.info(f"PPT team match: '{team_name}' → {len(mids)} members{' (LATE)' if is_late else ''}")
                else:
                    logger.warning(f"Member/team not found for article: {title} (writer: {writer_name})")
            else:
                logger.warning(f"Member not found for article: {title} (writer: {writer_name})")

    # 결석/공결 멤버의 REVIEW/FEEDBACK 면제(EXEMPT) 처리
    absent_stmt = select(Attendance.member_id).where(
        Attendance.session_id == session_id,
        Attendance.status.in_(("ABSENT", "EXCUSED")),
    )
    absent_result = await db.execute(absent_stmt)
    absent_ids = {row[0] for row in absent_result.all()}

    # 공결 멤버만 별도 조회 (PPT EXEMPT용 — 결석자는 PPT 제출 의무)
    excused_stmt = select(Attendance.member_id).where(
        Attendance.session_id == session_id,
        Attendance.status == "EXCUSED",
    )
    excused_result = await db.execute(excused_stmt)
    excused_ids = {row[0] for row in excused_result.all()}

    if absent_ids:
        for mid in absent_ids:
            await upsert_assignment(db, session_id, mid, "REVIEW", "EXEMPT")
            logger.info(f"REVIEW EXEMPT for absent member_id={mid}")

    # PPT: 공결(EXCUSED)만 EXEMPT (결석은 제출 의무)
    if excused_ids:
        for mid in excused_ids:
            await upsert_assignment(db, session_id, mid, "PPT", "EXEMPT")
            logger.info(f"PPT EXEMPT for excused member_id={mid}")

    # PPT: 스캔 후에도 PENDING인 멤버 → MISSING (미제출)
    pending_ppt_stmt = select(Assignment).where(
        Assignment.session_id == session_id,
        Assignment.type == "PPT",
        Assignment.status == "PENDING",
    )
    pending_ppt_result = await db.execute(pending_ppt_stmt)
    for ppt_a in pending_ppt_result.scalars().all():
        ppt_a.status = "MISSING"
        ppt_a.scanned_at = datetime.now()
        logger.info(f"PPT MISSING for member_id={ppt_a.member_id}")

    await db.commit()
    return total_processed


async def scan_feedback_comments(
    session_id: int,
    week_num: int,
    members: list[Member],
    db: AsyncSession,
    deadline_post: Optional[datetime] = None,
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
    # (commenter_id, article_id) → [comment_text, ...]: 댓글 원문
    comment_texts: dict[tuple[int, int], list[str]] = {}

    for article in video_articles:
        article_id = article.get("articleId") or article.get("article_id")
        if not article_id:
            continue
        article_id = int(article_id)

        # 영상 저자 매칭: 제목에 멤버 이름이 포함되어 있는지로 판단
        # 예: "연합UP 32기 11주차 발표-[시초윺]-김민지P(1분반 1번째)"
        title = article.get("subject", "")
        owner = None
        for m in members:
            if m.name in title:
                owner = m
                break
        if owner:
            member_to_articles.setdefault(owner.id, set()).add(article_id)

        # 댓글 작성자 수집 (텍스트 포함)
        try:
            detail = fetch_article_detail(req_session, article_id)
            comments = (
                detail.get("result", {})
                      .get("comments", {})
                      .get("items", [])
            )
            commenters_for_article: set[int] = set()
            for comment in comments:
                # 마감 기한 체크: deadline 이후 댓글은 무시
                comment_ts_ms = comment.get("updateDate", 0)
                if deadline_post and comment_ts_ms:
                    comment_dt = datetime.fromtimestamp(comment_ts_ms / 1000, tz=timezone.utc)
                    if comment_dt > deadline_post:
                        continue

                nick = comment.get("writer", {}).get("nick", "")
                commenter = match_member_by_name(nick, members)
                if commenter:
                    commenters_for_article.add(commenter.id)
                    # 댓글 텍스트 저장: (commenter_id, article_id) → text
                    body_text = comment.get("content", "").strip()
                    if body_text:
                        comment_texts.setdefault(
                            (commenter.id, article_id), []
                        ).append(body_text)
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

    # 4. 멤버 이름 맵 (raw_data에 이름 저장용)
    member_name_map = {m.id: m.name for m in members}

    # 5. 각 멤버별 FEEDBACK 상태 업데이트
    count = 0
    for member in members:
        assignment = feedback_assignments.get(member.id)
        explicit_targets: list[int] = (assignment.target_member_ids or []) if assignment else []

        # 본인 영상은 기본 포함
        effective_targets = list({member.id} | set(explicit_targets))

        # 영상이 있는 대상만 체크 (영상 없는 대상은 확인 불가이므로 skip)
        targets_with_videos = [t for t in effective_targets if t in member_to_articles]

        feedback_detail = []
        if not targets_with_videos:
            logger.warning(
                f"Member {member.id}: no video articles for any effective target "
                f"({effective_targets}) — marking PASS"
            )
            status = "PASS"
        else:
            all_covered = True
            for target_id in targets_with_videos:
                commented = all(
                    member.id in article_commenters.get(aid, set())
                    for aid in member_to_articles.get(target_id, set())
                )
                if not commented:
                    all_covered = False
                # 해당 타겟의 영상에 작성한 댓글 텍스트 수집
                texts: list[str] = []
                for aid in member_to_articles.get(target_id, set()):
                    texts.extend(comment_texts.get((member.id, aid), []))
                feedback_detail.append({
                    "member_id": target_id,
                    "name": member_name_map.get(target_id, "?"),
                    "commented": commented,
                    "is_self": target_id == member.id,
                    "comments": texts,
                })
            status = "PASS" if all_covered else "MISSING"

        raw_data = {"feedback_detail": feedback_detail} if feedback_detail else None
        await upsert_assignment(db, session_id, member.id, "FEEDBACK", status, raw_data=raw_data)
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
    # "3주차", "03주차", "3 주차", "Week 3", "Week3" 등
    # 0-padded 형식(01주차)도 매칭하되, 21주차가 1주차에 잘못 매칭되지 않도록 함
    pattern = rf"(?<!\d)0*{week_num}(?!\d)\s*주차|Week\s*0*{week_num}(?!\d)"
    return bool(re.search(pattern, title, re.IGNORECASE))


async def upsert_assignment(
    db: AsyncSession,
    session_id: int,
    member_id: int,
    type_: str,
    status: str,
    raw_data: dict | None = None,
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
        if assignment.status != status or raw_data is not None:
            assignment.status = status
            assignment.scanned_at = datetime.now()
            if raw_data is not None:
                assignment.raw_data = raw_data
    else:
        assignment = Assignment(
            session_id=session_id,
            member_id=member_id,
            type=type_,
            status=status,
            scanned_at=datetime.now(),
            raw_data=raw_data,
        )
        db.add(assignment)

    await db.flush()
