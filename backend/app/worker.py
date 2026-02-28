from arq.connections import RedisSettings
from arq import cron

from app.config import settings
from app.database import AsyncSessionLocal
from app.services.crawler_ppt import scan_ppt
from app.services.crawler_video import upload_all_videos
from app.services.crawler_excuse import scan_excuses

from sqlalchemy import select
from app.models import Member, Session, CafePost
from app.services.crawler_homework import scan_homework_all, scan_feedback_comments
from app.services.crawler_naver_login import login_with_credentials
from app.services.crawler_cafe import sync_board_to_db
from app.services.naver_session import get_valid_requests_session

# 태스크 함수들
async def task_scan_ppt(ctx, session_id: int, mode: str):
    """PPT 스캔 태스크 (Stub)"""
    async with AsyncSessionLocal() as db:
        return await scan_ppt(session_id, mode, db)

async def task_scan_homework(ctx, session_id: int):
    """과제 스캔 태스크"""
    async with AsyncSessionLocal() as db:
        # 세션 정보 조회
        session = await db.get(Session, session_id)
        if not session:
            return {"status": "failed", "reason": "Session not found"}

        # 활성 멤버 조회
        result = await db.execute(select(Member).where(Member.is_active == True))
        members = result.scalars().all()

        cfg = session.config or {}

        # REVIEW + HOMEWORK scan
        hw_count = await scan_homework_all(session.id, session.week_num, members, db)

        # FEEDBACK scan (댓글 방식)
        fb_count = 0
        if cfg.get("has_feedback", True):
            fb_count = await scan_feedback_comments(session.id, session.week_num, members, db)

        return {"status": "complete", "homework_count": hw_count, "feedback_count": fb_count}

async def task_scan_excuses(ctx, session_id: int, mode: str):
    """사유서 스캔 태스크 (PRE or POST 모드)"""
    async with AsyncSessionLocal() as db:
        session = await db.get(Session, session_id)
        if not session:
            return {"status": "failed", "reason": "Session not found"}

        result = await db.execute(select(Member).where(Member.is_active == True))
        members = result.scalars().all()

        count = await scan_excuses(session.id, session.week_num, members, mode, db, session_date=session.date)
        return {"status": "complete", "excuse_count": count, "mode": mode}

async def task_upload_videos(ctx, session_id: int):
    """영상 업로드 태스크"""
    async with AsyncSessionLocal() as db:
        return await upload_all_videos(session_id, db)

async def task_naver_login(ctx, username: str, password: str):
    """네이버 로그인 태스크 (아이디/비번 자동화)"""
    async with AsyncSessionLocal() as db:
        return await login_with_credentials(db, username, password)


async def task_sync_cafe_boards(ctx):
    """게시판 cron 동기화 — 30분마다 실행"""
    async with AsyncSessionLocal() as db:
        req_session = await get_valid_requests_session(db)
        if not req_session:
            return {"status": "skipped", "reason": "No valid Naver session"}

        members_result = await db.execute(select(Member).where(Member.is_active == True))
        members = members_result.scalars().all()

        results = []
        for board_type, menu_id in [
            ("REVIEW",   settings.NAVER_CAFE_MENU_REVIEW),
            ("PPT",      settings.NAVER_CAFE_MENU_PPT),
            ("VIDEO",    settings.NAVER_CAFE_MENU_VIDEO),
        ]:
            r = await sync_board_to_db(board_type, menu_id, req_session, members, db)
            results.append(r)

        return {"status": "complete", "boards": results}


class WorkerSettings:
    functions = [task_scan_ppt, task_scan_homework, task_scan_excuses, task_upload_videos, task_naver_login, task_sync_cafe_boards]
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    cron_jobs = [
        cron(task_sync_cafe_boards, minute={0, 30}),  # 매 30분마다 실행
    ]
