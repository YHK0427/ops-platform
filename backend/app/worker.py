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

    # 좀비 정리 — 이전 워커가 중간에 죽어서 남겨둔 임시 파일/락 제거
    from app.services.video_compress import cleanup_stale_tmp_files
    removed = cleanup_stale_tmp_files("/app/files/video")
    if removed:
        logger.info(f"startup_cleanup: stale .compressed.tmp {removed}개 삭제")

    # Redis compress 락 stale 해제
    redis = ctx.get("redis")
    if redis:
        try:
            existed = await redis.delete("compress:global_lock")
            if existed:
                logger.info("startup_cleanup: 좀비 compress 락 해제")
        except Exception as e:
            logger.warning(f"startup_cleanup: 락 해제 실패 {e}")


# 태스크 함수들
async def task_scan_ppt(ctx, session_id: int, mode: str):
    """PPT 이메일 스캔 태스크 (IMAP)"""
    label = await _get_session_label(session_id)
    logger.log(25, f"📧 PPT 이메일 스캔 시작 — {label} (mode={mode})")
    try:
        async with AsyncSessionLocal() as db:
            result = await scan_ppt(session_id, mode, db)
        found = result.get("found", "?") if isinstance(result, dict) else "?"
        logger.log(25, f"✅ PPT 스캔 완료 — {label} ({found}건 처리)")
        return result
    except Exception as e:
        logger.error(f"❌ PPT 스캔 실패 — {label}: {e}", exc_info=True)
        raise

async def task_scan_homework(ctx, session_id: int):
    """과제 스캔 태스크"""
    label = await _get_session_label(session_id)
    logger.log(25, f"📝 과제 스캔 시작 — {label}")
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
        logger.log(25, f"✅ 과제 스캔 완료 — {label} (과제 {hw_count}건, 피드백 {fb_count}건)")
        return result
    except Exception as e:
        logger.error(f"❌ 과제 스캔 실패 — {label}: {e}", exc_info=True)
        raise

async def task_scan_excuses(ctx, session_id: int, mode: str):
    """사유서 스캔 태스크 (PRE or POST 모드)"""
    label = await _get_session_label(session_id)
    mode_kr = "사전" if mode == "PRE" else "사후"
    logger.log(25, f"📄 {mode_kr}사유서 스캔 시작 — {label}")
    try:
        async with AsyncSessionLocal() as db:
            session = await db.get(Session, session_id)
            if not session:
                return {"status": "failed", "reason": "Session not found"}

            result = await db.execute(select(Member).where(Member.is_active == True))
            members = result.scalars().all()

            count = await scan_excuses(session.id, session.week_num, members, mode, db, session_date=session.date)
            result = {"status": "complete", "excuse_count": count, "mode": mode}
        logger.log(25, f"✅ {mode_kr}사유서 스캔 완료 — {label} ({count}건 처리)")
        return result
    except Exception as e:
        logger.error(f"❌ {mode_kr}사유서 스캔 실패 — {label}: {e}", exc_info=True)
        raise

async def task_upload_videos(ctx, session_id: int, videos: list | None = None):
    """영상 업로드 태스크 (네이버 카페)"""
    label = await _get_session_label(session_id)
    video_count = len(videos) if videos else "?"
    logger.log(25, f"🚀 네이버 카페 업로드 시작 — {label} ({video_count}개 영상)")
    try:
        redis = ctx.get("redis")
        job_id = ctx.get("job_id")
        async with AsyncSessionLocal() as db:
            result = await upload_all_videos(session_id, db, redis=redis, job_id=job_id, videos=videos)
        # result 는 각 영상 결과 리스트
        if isinstance(result, list):
            success = sum(1 for r in result if r.get("success"))
            failed = len(result) - success
            if failed == 0:
                logger.log(25, f"✅ 네이버 카페 업로드 완료 — {label} ({success}/{len(result)})")
            else:
                logger.warning(f"⚠️ 네이버 카페 업로드 일부 실패 — {label} ({success}/{len(result)} 성공, {failed}건 실패)")
        else:
            logger.log(25, f"✅ 네이버 카페 업로드 완료 — {label}")
        return result
    except Exception as e:
        logger.error(f"❌ 네이버 카페 업로드 실패 — {label}: {e}", exc_info=True)
        raise

async def _get_member_name(member_id: int) -> str:
    """멤버 ID → 이름 조회. 실패 시 #id 반환."""
    try:
        async with AsyncSessionLocal() as db:
            m = await db.get(Member, member_id)
            return m.name if m else f"#{member_id}"
    except Exception:
        return f"#{member_id}"


async def _get_session_label(session_id: int) -> str:
    """세션 ID → '{week}주차 {title}' 라벨. 실패 시 #id 반환."""
    try:
        async with AsyncSessionLocal() as db:
            s = await db.get(Session, session_id)
            if not s:
                return f"#{session_id}"
            return f"{s.week_num}주차 {s.title}"
    except Exception:
        return f"#{session_id}"


async def task_r2_pull_to_disk(ctx, session_id: int, member_id: int, r2_key: str, filename: str):
    """R2에서 영상을 로컬 디스크로 pull + R2 삭제.
    사용자 업로드 완료 후 background 에서 실행.
    파일이 크면 (>300MB) 압축 태스크를 뒤이어 큐잉."""
    import os
    from app.services import r2 as r2_svc
    from app.services.video_compress import COMPRESS_THRESHOLD_MB

    member_name = await _get_member_name(member_id)
    logger.info(f"task_r2_pull_to_disk start session={session_id} member={member_id} key={r2_key}")
    try:
        video_dir = "/app/files/video"
        session_dir = os.path.join(video_dir, f"session_{session_id}")
        await asyncio.to_thread(os.makedirs, session_dir, exist_ok=True)

        save_name = f"{member_id}_{filename}"
        save_path = os.path.join(session_dir, save_name)
        tmp_path = save_path + ".tmp"

        # R2 pull 을 먼저 tmp 로 받는다.
        # pull 성공이 확인되기 전에는 기존 영상을 절대 삭제하지 않는다.
        # (R2 오브젝트가 없을 때 기존 영상까지 잃는 사고 방지)
        try:
            size = await r2_svc.pull_to_disk(r2_key, tmp_path)
        except Exception as e:
            try:
                await asyncio.to_thread(os.remove, tmp_path)
            except OSError:
                pass
            raise RuntimeError(f"R2 pull 실패: {e}")

        # pull 성공 후에만 기존 해당 멤버 영상 정리(교체) + 원자적 교체
        def _cleanup():
            for existing in os.listdir(session_dir):
                full = os.path.join(session_dir, existing)
                # 진행 중인 압축/업로드 임시파일은 절대 건드리지 않는다.
                # (.compressed.tmp / .tmp 가 member prefix 로 시작해도 보호 —
                #  중복 업로드 시 진행 중이던 압축의 tmp 를 지워 VAAPI 가 깨지는 버그 방지)
                if existing.endswith(".compressed.tmp") or existing.endswith(".tmp"):
                    continue
                if (os.path.isfile(full) and existing.startswith(f"{member_id}_")
                        and full != tmp_path and full != save_path):
                    try:
                        os.remove(full)
                    except OSError:
                        pass
        await asyncio.to_thread(_cleanup)
        await asyncio.to_thread(os.replace, tmp_path, save_path)

        # 성공 시 R2 오브젝트 삭제 (무료 저장 한도 유지)
        try:
            await r2_svc.delete(r2_key)
        except Exception as e:
            logger.warning(f"r2_delete_failed key={r2_key} err={e} (파일은 이미 로컬 저장됨)")

        size_mb = round(size / (1024 * 1024), 1)
        logger.log(25, f"💾 서버 저장 완료 — {member_name} ({size_mb}MB)")

        # 큰 파일이면 압축 태스크 큐잉 (별도로 돌아 non-blocking)
        if size_mb > COMPRESS_THRESHOLD_MB:
            redis = ctx.get("redis")
            if redis:
                await redis.enqueue_job(
                    "task_compress_video",
                    session_id=session_id,
                    member_id=member_id,
                    path=save_path,
                )
                logger.info(f"compress_queued session={session_id} member={member_id} size={size_mb}MB")

        return {"status": "complete", "size_mb": size_mb, "path": save_path}
    except Exception as e:
        logger.error(f"task_r2_pull_to_disk failed session={session_id} member={member_id} ({member_name}): {e}", exc_info=True)
        raise


async def task_compress_video(ctx, session_id: int, member_id: int, path: str):
    """영상 ffmpeg 압축 (in-place, CRF 23 H.264).
    네이버 카페 업로드 전에 용량 축소. 화질은 거의 동일.

    동시성: Redis 락으로 서버 전체에서 한 번에 1개만 실행.
    다른 압축이 진행 중이면 30초 후 재시도로 defer (ARQ slot 안 잡아먹음)."""
    import os
    from app.services.video_compress import (
        compress_in_place,
        is_ffmpeg_available,
        COMPRESS_THRESHOLD_MB,
    )

    if not is_ffmpeg_available():
        logger.warning("ffmpeg 미설치 — 압축 스킵")
        return {"status": "skipped", "reason": "ffmpeg unavailable"}

    if not os.path.isfile(path):
        logger.warning(f"compress: 파일 없음 path={path}")
        return {"status": "skipped", "reason": "file not found"}

    member_name = await _get_member_name(member_id)
    redis = ctx.get("redis")
    lock_key = "compress:global_lock"
    # SETNX + TTL — 락 획득 시도. 실패하면 다른 압축 작업 진행중
    # ex=3600 으로 1시간 만료 (워커 죽어도 락 자동 해제)
    acquired = False
    if redis:
        acquired = bool(await redis.set(lock_key, "1", nx=True, ex=3600))
    if not acquired:
        # 30초 후 재시도로 defer — ARQ slot을 sleep으로 잡아먹지 않음
        logger.info(f"compress_locked session={session_id} member={member_id} — 30초 후 재시도")
        if redis:
            await redis.enqueue_job(
                "task_compress_video",
                session_id=session_id,
                member_id=member_id,
                path=path,
                _defer_by=30,
            )
        return {"status": "deferred"}

    import os as _os
    # 파일 존재 재확인 — 중간에 삭제되었을 수도
    if not _os.path.isfile(path):
        logger.warning(f"compress: 실행 시점에 파일 없음 path={path} — 스킵")
        return {"status": "skipped", "reason": "file vanished"}

    original_mb_start = round(_os.path.getsize(path) / (1024 * 1024), 1)
    # 실행 시점 크기가 임계값 이하면 재압축 불필요 — 스킵.
    # (중복 업로드로 이미 압축된 작은 파일이 다시 큐잉되는 경우 GPU/락 낭비 방지)
    if original_mb_start <= COMPRESS_THRESHOLD_MB:
        logger.info(
            f"compress_skip_small session={session_id} member={member_id} "
            f"size={original_mb_start}MB (<= {COMPRESS_THRESHOLD_MB}MB) — 재압축 생략"
        )
        return {"status": "skipped", "reason": "below_threshold", "size_mb": original_mb_start}

    logger.log(25, f"🗜️ 압축 시작 — {member_name} ({original_mb_start}MB)")
    try:
        original, compressed, encoder = await compress_in_place(path)
        original_mb = round(original / (1024 * 1024), 1)
        compressed_mb = round(compressed / (1024 * 1024), 1)
        saved_mb = round(original_mb - compressed_mb, 1)
        ratio = round(compressed / original * 100, 1) if original else 0
        encoder_label = "VAAPI" if encoder == "h264_vaapi" else "libx264"
        if saved_mb > 0:
            logger.log(
                25,
                f"✅ 압축 완료 — {member_name} ({encoder_label}: {original_mb}MB → {compressed_mb}MB, "
                f"{saved_mb}MB 절약, {100 - round(ratio)}% 감소)"
            )
        else:
            logger.log(25, f"✅ 압축 완료 — {member_name} (이미 최적 용량, 원본 유지)")
        return {
            "status": "complete",
            "encoder": encoder,
            "original_mb": original_mb,
            "compressed_mb": compressed_mb,
            "saved_mb": saved_mb,
        }
    except Exception as e:
        # 실패 시 남아있을 수 있는 tmp 정리
        tmp_path = path + ".compressed.tmp"
        if _os.path.isfile(tmp_path):
            try:
                _os.remove(tmp_path)
            except OSError:
                pass
        logger.error(f"❌ 압축 실패 — {member_name}: {e}", exc_info=True)
        raise
    finally:
        # 락 해제
        if redis:
            try:
                await redis.delete(lock_key)
            except Exception:
                pass


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
            articles = data.get("result", {}).get("articleList", [])
            if articles:
                a = articles[0].get("item", articles[0])
                nick = (a.get("writerInfo") or {}).get("nickName", "?")
                article_info = f"\n최신글: [{a.get('subject', '?')}] by {nick}"
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
    functions = [task_scan_ppt, task_scan_homework, task_scan_excuses, func(task_upload_videos, timeout=7200), func(task_r2_pull_to_disk, timeout=900), func(task_compress_video, timeout=1800), task_naver_login, task_naver_health_check]
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    on_startup = startup
    cron_jobs = [
        cron(task_naver_health_check, minute={0, 30}),
    ]
