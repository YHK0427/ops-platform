import logging

from arq.connections import RedisSettings
from arq import cron
from sqlalchemy import select

from app.config import settings
from app.logging_config import setup_logging
from app.database import AsyncSessionLocal
from app.models import Member, Session
from app.services.crawler_ppt import scan_ppt
from app.services.crawler_video import upload_all_videos
from app.services.crawler_excuse import scan_excuses
from app.services.crawler_homework import scan_homework_all, scan_feedback_comments
from app.services.crawler_naver_login import login_with_credentials
from app.services.crawler_cafe import fetch_board_articles, NaverSessionExpiredError
from app.services.naver_session import get_valid_requests_session

logger = logging.getLogger("worker")

async def startup(ctx):
    setup_logging()
    logger.info("Worker started")


# 태스크 함수들
async def task_scan_ppt(ctx, session_id: int, mode: str):
    """PPT 이메일 스캔 태스크 (IMAP)"""
    logger.info(f"task_scan_ppt start session={session_id} mode={mode}")
    try:
        async with AsyncSessionLocal() as db:
            result = await scan_ppt(session_id, mode, db)
        logger.info(f"task_scan_ppt complete session={session_id}")
        return result
    except Exception as e:
        logger.error(f"task_scan_ppt failed session={session_id}: {e}", exc_info=True)
        raise

async def task_scan_homework(ctx, session_id: int):
    """과제 스캔 태스크"""
    logger.info(f"task_scan_homework start session={session_id}")
    try:
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

            result = {"status": "complete", "homework_count": hw_count, "feedback_count": fb_count}
        logger.info(f"task_scan_homework complete session={session_id}")
        return result
    except Exception as e:
        logger.error(f"task_scan_homework failed session={session_id}: {e}", exc_info=True)
        raise

async def task_scan_excuses(ctx, session_id: int, mode: str):
    """사유서 스캔 태스크 (PRE or POST 모드)"""
    logger.info(f"task_scan_excuses start session={session_id} mode={mode}")
    try:
        async with AsyncSessionLocal() as db:
            session = await db.get(Session, session_id)
            if not session:
                return {"status": "failed", "reason": "Session not found"}

            result = await db.execute(select(Member).where(Member.is_active == True))
            members = result.scalars().all()

            count = await scan_excuses(session.id, session.week_num, members, mode, db, session_date=session.date)
            result = {"status": "complete", "excuse_count": count, "mode": mode}
        logger.info(f"task_scan_excuses complete session={session_id}")
        return result
    except Exception as e:
        logger.error(f"task_scan_excuses failed session={session_id}: {e}", exc_info=True)
        raise

async def task_upload_videos(ctx, session_id: int, videos: list | None = None):
    """영상 업로드 태스크"""
    logger.info(f"task_upload_videos start session={session_id}")
    try:
        redis = ctx.get("redis")
        job_id = ctx.get("job_id")
        async with AsyncSessionLocal() as db:
            result = await upload_all_videos(session_id, db, redis=redis, job_id=job_id, videos=videos)
        logger.info(f"task_upload_videos complete session={session_id}")
        return result
    except Exception as e:
        logger.error(f"task_upload_videos failed session={session_id}: {e}", exc_info=True)
        raise

async def task_naver_login(ctx, username: str, password: str):
    """네이버 로그인 태스크 (아이디/비번 자동화)"""
    logger.info("task_naver_login start")
    try:
        async with AsyncSessionLocal() as db:
            result = await login_with_credentials(db, username, password)
        logger.info("task_naver_login complete")
        return result
    except Exception as e:
        logger.error(f"task_naver_login failed: {e}", exc_info=True)
        raise


async def task_naver_health_check(ctx):
    """네이버 세션 헬스체크 — 30분마다 API 1회 호출로 세션 유효성 확인"""
    import asyncio
    try:
        async with AsyncSessionLocal() as db:
            req_session = await get_valid_requests_session(db)
            if not req_session:
                logger.warning("naver_health_check: no valid session")
                return {"status": "no_session"}

            # 게시판 1페이지 1건만 조회 (최소 비용)
            await asyncio.to_thread(
                fetch_board_articles, req_session, settings.NAVER_CAFE_MENU_REVIEW, page=1, per_page=1
            )
        logger.info("naver_health_check: ok")
        return {"status": "ok"}
    except NaverSessionExpiredError:
        logger.warning("naver_health_check: session expired — 네이버 재로그인 필요")
        return {"status": "expired"}
    except Exception as e:
        logger.error(f"naver_health_check failed: {e}", exc_info=True)
        raise


class WorkerSettings:
    functions = [task_scan_ppt, task_scan_homework, task_scan_excuses, task_upload_videos, task_naver_login, task_naver_health_check]
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    on_startup = startup
    cron_jobs = [
        cron(task_naver_health_check, minute={0, 30}),
    ]
