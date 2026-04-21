import asyncio
import logging

from arq.connections import RedisSettings
from arq import cron, func
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

            # deadline_post 파싱
            from app.services.crawler_homework import _parse_deadline
            deadline_post = _parse_deadline(cfg.get("deadline_post"))

            # REVIEW + HOMEWORK scan
            hw_count = await scan_homework_all(session.id, session.week_num, members, db, deadline_post=deadline_post)

            # FEEDBACK scan (댓글 방식)
            fb_count = 0
            if cfg.get("has_feedback", True):
                fb_count = await scan_feedback_comments(session.id, session.week_num, members, db, deadline_post=deadline_post)

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

async def task_r2_pull_to_disk(ctx, session_id: int, member_id: int, r2_key: str, filename: str):
    """R2에서 영상을 로컬 디스크로 pull + R2 삭제.
    사용자 업로드 완료 후 background 에서 실행."""
    import os
    from app.services import r2 as r2_svc

    logger.info(f"task_r2_pull_to_disk start session={session_id} member={member_id} key={r2_key}")
    try:
        video_dir = "/app/files/video"
        session_dir = os.path.join(video_dir, f"session_{session_id}")
        await asyncio.to_thread(os.makedirs, session_dir, exist_ok=True)

        # 기존 해당 멤버 영상 정리 (교체)
        def _cleanup():
            for existing in os.listdir(session_dir):
                full = os.path.join(session_dir, existing)
                if os.path.isfile(full) and existing.startswith(f"{member_id}_"):
                    try:
                        os.remove(full)
                    except OSError:
                        pass
        await asyncio.to_thread(_cleanup)

        save_name = f"{member_id}_{filename}"
        save_path = os.path.join(session_dir, save_name)
        tmp_path = save_path + ".tmp"

        try:
            size = await r2_svc.pull_to_disk(r2_key, tmp_path)
            await asyncio.to_thread(os.replace, tmp_path, save_path)
        except Exception as e:
            try:
                await asyncio.to_thread(os.remove, tmp_path)
            except OSError:
                pass
            raise RuntimeError(f"R2 pull 실패: {e}")

        # 성공 시 R2 오브젝트 삭제 (무료 저장 한도 유지)
        try:
            await r2_svc.delete(r2_key)
        except Exception as e:
            logger.warning(f"r2_delete_failed key={r2_key} err={e} (파일은 이미 로컬 저장됨)")

        size_mb = round(size / (1024 * 1024), 1)
        logger.log(25, f"r2_pull_complete session={session_id} member={member_id} file={save_name} size={size_mb}MB")
        return {"status": "complete", "size_mb": size_mb, "path": save_path}
    except Exception as e:
        logger.error(f"task_r2_pull_to_disk failed session={session_id} member={member_id}: {e}", exc_info=True)
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


async def _naver_auto_login():
    """네이버 자동 로그인 시도 (env 크레덴셜 사용)"""
    username = settings.NAVER_ID or "bleach4738"
    password = settings.NAVER_PWD or "youngheon633005!"
    async with AsyncSessionLocal() as db:
        result = await login_with_credentials(db, username, password)
    if result.get("status") == "complete":
        logger.log(25, f"네이버 자동 로그인 성공 (만료: {result.get('expires_hint')})")
    else:
        logger.warning(f"네이버 자동 로그인 실패 — {result.get('reason', 'unknown')}")
    return result


async def task_naver_health_check(ctx):
    """네이버 세션 헬스체크 — 30분마다 API 1회 호출로 세션 유효성 확인"""
    import asyncio
    try:
        async with AsyncSessionLocal() as db:
            req_session = await get_valid_requests_session(db)
            if not req_session:
                logger.warning("네이버 세션 없음 — 자동 로그인 시도")
                return await _naver_auto_login()

            # 게시판 1페이지 1건만 조회 (최소 비용)
            data = await asyncio.to_thread(
                fetch_board_articles, req_session, settings.NAVER_CAFE_MENU_REVIEW, page=1, per_page=1
            )
            # 최신 게시글 정보 추출
            articles = data.get("message", {}).get("result", {}).get("articleList", [])
            if articles:
                a = articles[0]
                article_info = f"\n최신글: [{a.get('subject', '?')}] by {a.get('nickname', '?')}"
            else:
                article_info = "\n게시글 없음"
        logger.log(25, f"네이버 세션 체크: 정상 (menu={settings.NAVER_CAFE_MENU_REVIEW}){article_info}")
        return {"status": "ok"}
    except NaverSessionExpiredError:
        logger.warning("네이버 세션 만료 — 자동 로그인 시도")
        return await _naver_auto_login()
    except Exception as e:
        logger.error(f"네이버 세션 체크 실패: {e}", exc_info=True)
        raise


class WorkerSettings:
    functions = [task_scan_ppt, task_scan_homework, task_scan_excuses, func(task_upload_videos, timeout=7200), func(task_r2_pull_to_disk, timeout=900), task_naver_login, task_naver_health_check]
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    on_startup = startup
    cron_jobs = [
        cron(task_naver_health_check, minute={0, 30}),
    ]
