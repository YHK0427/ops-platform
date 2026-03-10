"""
PPT 이메일 스캔 오케스트레이션.

EmailScanner로 이메일을 가져와서 멤버 매칭, deadline 판정,
구글 드라이브 업로드/복사를 수행하고 Assignment 상태를 업데이트한다.
"""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models import Assignment, Member, Session, Team, TeamMember
from app.services.email_scanner import EmailScanner, EmailResult

logger = logging.getLogger(__name__)


def _parse_deadline(raw: str | None) -> datetime | None:
    """ISO datetime 문자열 → aware datetime (None이면 None)"""
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            # 한국 시간으로 가정 → UTC로 변환 (KST = UTC+9)
            from datetime import timedelta
            dt = dt.replace(tzinfo=timezone(timedelta(hours=9)))
        return dt
    except Exception:
        return None


def _make_aware(dt: datetime) -> datetime:
    """naive datetime을 UTC aware로 변환"""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


async def scan_ppt(session_id: int, mode: str, db: AsyncSession) -> dict[str, Any]:
    """
    PPT 이메일 스캔 + 드라이브 업로드 + Assignment 업데이트.

    mode는 하위호환용 (현재 무시, 한 번에 전체 스캔).

    Returns:
        {
            total_emails: int,
            matched: int,
            uploaded: int,
            skipped: int,
            unmatched_names: list[str],
            results: list[dict],
        }
    """
    # 1. 세션 로드
    session = await db.get(Session, session_id)
    if not session:
        raise ValueError(f"Session {session_id} not found")

    cfg = session.config or {}
    week_num = session.week_num

    # 데드라인
    deadline = _parse_deadline(cfg.get("deadline_ppt_email"))
    deadline_late = _parse_deadline(cfg.get("deadline_ppt_email_late"))

    # 드라이브 ppt 폴더
    ppt_folder_id = cfg.get("drive_ppt_folder_id")

    # 2. 활성 멤버 조회 (이름 → Member 매핑)
    members_result = await db.execute(
        select(Member).where(Member.is_active == True)
    )
    all_members = members_result.scalars().all()
    # 이름 → Member 매핑 (완전 일치 우선)
    name_to_member: dict[str, Member] = {}
    for m in all_members:
        name_to_member[m.name] = m

    # 3. PPT_EMAIL Assignment 목록 로드
    assignments_result = await db.execute(
        select(Assignment).where(
            Assignment.session_id == session_id,
            Assignment.type == "PPT_EMAIL",
        )
    )
    all_assignments = assignments_result.scalars().all()

    # member_id → Assignment (INDIVIDUAL)
    member_assignment: dict[int, Assignment] = {}
    # team_id → Assignment (TEAM)
    team_assignment: dict[int, Assignment] = {}
    for a in all_assignments:
        if a.member_id:
            member_assignment[a.member_id] = a
        elif a.team_id:
            team_assignment[a.team_id] = a

    # TEAM 세션: member_id → team_id 매핑
    member_to_team: dict[int, int] = {}
    if session.type == "TEAM":
        tm_result = await db.execute(
            select(TeamMember).join(Team).where(Team.session_id == session_id)
        )
        for tm in tm_result.scalars().all():
            member_to_team[tm.member_id] = tm.team_id

    # 4. IMAP 스캔 (동기 → to_thread)
    scanner = EmailScanner()
    email_results: list[EmailResult] = await asyncio.to_thread(scanner.scan, week_num)

    # 5. 각 이메일 결과 처리
    matched = 0
    uploaded = 0
    skipped = 0
    unmatched_names: list[str] = []
    detail_results: list[dict] = []

    for er in email_results:
        # a) 멤버 매칭
        member = name_to_member.get(er.member_name)

        # 부분 일치 fallback
        if not member:
            for m in all_members:
                if er.member_name in m.name or m.name in er.member_name:
                    member = m
                    break

        if not member:
            unmatched_names.append(er.member_name)
            detail_results.append({
                "name": er.member_name,
                "status": "unmatched",
                "subject": er.subject,
            })
            continue

        # b) Assignment 찾기
        assignment: Assignment | None = None
        if session.type == "TEAM":
            team_id = member_to_team.get(member.id)
            if team_id:
                assignment = team_assignment.get(team_id)
        else:
            assignment = member_assignment.get(member.id)

        if not assignment:
            detail_results.append({
                "name": er.member_name,
                "member_id": member.id,
                "status": "no_assignment",
                "subject": er.subject,
            })
            continue

        matched += 1

        # c) 제출 시간 판정
        received = _make_aware(er.received_at)
        new_status: str
        if deadline and received <= deadline:
            new_status = "PASS"
        elif deadline_late and received <= deadline_late:
            new_status = "LATE"
        elif not deadline and not deadline_late:
            # 데드라인 미설정 → 제출 확인만 (PASS 처리)
            new_status = "PASS"
        else:
            # 기한 지남 → 그래도 제출은 된 것이므로 LATE 처리
            new_status = "LATE"

        # 이미 PASS/EXEMPT인 경우 스킵 (수동 처리 우선)
        if assignment.status in ("PASS", "EXEMPT"):
            skipped += 1
            detail_results.append({
                "name": er.member_name,
                "member_id": member.id,
                "status": "already_" + assignment.status.lower(),
                "subject": er.subject,
            })
            continue

        # d) 파일 업로드
        drive_file_id = None
        original_filename = None

        if ppt_folder_id:
            try:
                if er.attachments:
                    # 첨부파일 → 드라이브 업로드
                    att = er.attachments[0]  # 첫 번째 첨부 사용
                    from app.services.crawler_video import upload_file_to_drive
                    upload_name = f"{er.member_name}_{att.filename}"
                    drive_file_id = await asyncio.to_thread(
                        upload_file_to_drive,
                        att.content,
                        upload_name,
                        ppt_folder_id,
                        att.content_type,
                    )
                    original_filename = att.filename
                    uploaded += 1
                elif er.drive_links:
                    # 드라이브 링크 → 복사
                    from app.services.crawler_video import copy_drive_file
                    source_id = er.drive_links[0]
                    copy_name = f"{er.member_name}_PPT"
                    drive_file_id = await asyncio.to_thread(
                        copy_drive_file,
                        source_id,
                        ppt_folder_id,
                        copy_name,
                    )
                    original_filename = f"drive_link:{source_id}"
                    uploaded += 1
            except Exception as e:
                logger.error(f"파일 업로드 실패 ({er.member_name}): {e}", exc_info=True)
                # 업로드 실패해도 상태는 업데이트

        # e) Assignment 업데이트
        assignment.status = new_status
        assignment.scanned_at = datetime.now(timezone.utc)
        assignment.raw_data = {
            **(assignment.raw_data or {}),
            "drive_file_id": drive_file_id,
            "original_filename": original_filename,
            "sender": er.sender,
            "received_at": er.received_at.isoformat(),
            "subject": er.subject,
        }
        flag_modified(assignment, "raw_data")

        detail_results.append({
            "name": er.member_name,
            "member_id": member.id,
            "status": new_status,
            "drive_file_id": drive_file_id,
            "subject": er.subject,
        })

    await db.commit()

    return {
        "total_emails": len(email_results),
        "matched": matched,
        "uploaded": uploaded,
        "skipped": skipped,
        "unmatched_names": unmatched_names,
        "results": detail_results,
    }
