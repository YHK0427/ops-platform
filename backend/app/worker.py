import asyncio
import logging

from arq.connections import RedisSettings
from arq import cron, func
from sqlalchemy import select, delete

from app.config import settings
from app.logging_config import setup_logging
from app.database import AsyncSessionLocal
from app.models import Member, Session, PushSubscription
from app.services.push import send_webpush
from app.services.crawler_ppt import scan_ppt
from app.services.crawler_video import upload_all_videos
from app.services.crawler_excuse import scan_excuses
from app.services.crawler_homework import scan_homework_all, scan_feedback_comments
from app.services.crawler_naver_login import login_with_credentials
from app.services.crawler_cafe import fetch_board_articles, fetch_article_detail, NaverSessionExpiredError
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

            # 활성 멤버 조회 — 세션이 속한 기수만
            result = await db.execute(
                select(Member).where(Member.is_active == True, Member.cohort_id == session.cohort_id)
            )
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

            result = await db.execute(
                select(Member).where(Member.is_active == True, Member.cohort_id == session.cohort_id)
            )
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


_NAVER_DOWN_KEY = "naver:down_alerted"


async def _naver_auto_login(redis, reason: str):
    """네이버 자동 로그인 시도 (env 크레덴셜 사용).

    세션이 죽어 있으면 30분마다 여기로 온다. 알림은 죽은 걸 처음 본 1회만 보내고,
    되살아나면(체크 정상 또는 로그인 성공) 플래그를 지워 다음 장애 때 다시 알린다.
    """
    first = await redis.set(_NAVER_DOWN_KEY, "1", nx=True)
    # 계정은 기수 대표가 대시보드에서 직접 로그인한다. env 에 계정이 없으면 자동 로그인은 건너뛴다.
    if not (settings.NAVER_ID and settings.NAVER_PWD):
        (logger.warning if first else logger.info)(f"{reason} — 대시보드에서 네이버 재로그인 필요")
        return {"status": "skipped", "reason": "NAVER_ID/NAVER_PWD 미설정"}
    (logger.warning if first else logger.info)(f"{reason} — 자동 로그인 시도")
    async with AsyncSessionLocal() as db:
        result = await login_with_credentials(db, settings.NAVER_ID, settings.NAVER_PWD)
    if result.get("status") == "complete":
        await redis.delete(_NAVER_DOWN_KEY)
        logger.log(25, f"네이버 자동 로그인 성공 (만료: {result.get('expires_hint')})")
    else:
        (logger.warning if first else logger.info)(f"네이버 자동 로그인 실패 — {result.get('reason', 'unknown')}")
    return result


async def task_naver_health_check(ctx):
    """네이버 세션 헬스체크 — 30분마다 API 1회 호출로 세션 유효성 확인"""
    import asyncio
    try:
        async with AsyncSessionLocal() as db:
            req_session = await get_valid_requests_session(db)
            if not req_session:
                return await _naver_auto_login(ctx["redis"], "네이버 세션 없음")

            # 게시판 1페이지 1건만 조회 (최소 비용)
            data = await asyncio.to_thread(
                fetch_board_articles, req_session, settings.NAVER_CAFE_MENU_REVIEW, page=1, per_page=1
            )
            # 최신 게시글 정보 추출
            articles = data.get("result", {}).get("articleList", [])
            if articles:
                a = articles[0].get("item", articles[0])
                # 목록 API 는 비로그인도 200 이라 세션 판별이 안 된다. 본문은 비로그인 시 401.
                await asyncio.to_thread(fetch_article_detail, req_session, a["articleId"])
                nick = (a.get("writerInfo") or {}).get("nickName", "?")
                article_info = f"\n최신글: [{a.get('subject', '?')}] by {nick}"
            else:
                article_info = "\n게시글 없음"
        await ctx["redis"].delete(_NAVER_DOWN_KEY)
        logger.log(25, f"네이버 세션 체크: 정상 (menu={settings.NAVER_CAFE_MENU_REVIEW}){article_info}")
        return {"status": "ok"}
    except NaverSessionExpiredError:
        return await _naver_auto_login(ctx["redis"], "네이버 세션 만료")
    except Exception as e:
        logger.error(f"네이버 세션 체크 실패: {e}", exc_info=True)
        raise


async def task_send_push(ctx, payload: dict, subscription_ids: list):
    """웹 푸시 발송 — 구독 id 목록에 payload 전송. 만료(404/410) 구독은 자동 삭제."""
    if not subscription_ids:
        return {"sent": 0, "expired": 0}
    sent = 0
    expired_ids = []
    async with AsyncSessionLocal() as db:
        subs = (await db.execute(
            select(PushSubscription).where(PushSubscription.id.in_(subscription_ids))
        )).scalars().all()
        for sub in subs:
            # pywebpush는 동기 → 스레드로
            result = await asyncio.to_thread(send_webpush, sub.endpoint, sub.p256dh, sub.auth, payload)
            if result == "ok":
                sent += 1
            elif result == "expired":
                expired_ids.append(sub.id)
        if expired_ids:
            await db.execute(delete(PushSubscription).where(PushSubscription.id.in_(expired_ids)))
            await db.commit()
    logger.log(25, f"🔔 푸시 발송 — 성공 {sent} · 만료정리 {len(expired_ids)}")
    return {"sent": sent, "expired": len(expired_ids)}


async def task_heartbeat(ctx):
    """데드맨 스위치 — 5분마다 외부(healthchecks.io 등)에 '나 살아있다'를 찍는다.

    이 핑이 끊기면 외부 서비스가 메일을 보낸다. 서버가 통째로 꺼지든, 인터넷이
    끊기든, 워커가 살아만 있고 큐를 안 돌리든 전부 '핑이 안 온다'로 잡힌다.
    안에서 감시하는 건 뭐든 서버와 운명을 같이하므로, 밖에서 침묵을 감시해야 한다.

    이 체크만 예외적으로 DB까지 건드린다(deep check). 액추에이터가 '사람에게 메일'
    뿐이라 안전하다 — 컨테이너를 죽이는 헬스체크였다면 절대 이렇게 하면 안 된다.
    """
    url = (settings.HEARTBEAT_URL or "").strip()
    if not url:
        return {"skipped": "HEARTBEAT_URL 미설정"}
    import httpx
    from sqlalchemy import text as _text
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(_text("SELECT 1"))
        async with httpx.AsyncClient(timeout=10) as c:
            await c.get(url)
        return {"ok": True}
    except Exception as e:
        # 실패는 exit-code 경로로 즉시 알린다 — 유예시간 만료를 기다리지 않는다
        logger.warning(f"heartbeat 실패: {e}")
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                await c.get(url.rstrip("/") + "/1")
        except Exception:
            pass
        return {"ok": False}


async def task_cleanup_access_logs(ctx):
    """접속 기록 보존 정리 — 90일 지난 건 지운다.

    하루 몇 천 줄이면 1년에 200만 줄이다. 지금 규모에선 감당되지만, 아무도 안 보는
    옛날 기록이 디스크를 계속 먹게 두면 결국 누군가 새벽에 치워야 한다.
    """
    from sqlalchemy import text as _text
    async with AsyncSessionLocal() as db:
        res = await db.execute(_text(
            "DELETE FROM access_logs WHERE created_at < now() - interval '90 days'"
        ))
        await db.commit()
    if res.rowcount:
        logger.info(f"접속 기록 정리: {res.rowcount}줄 삭제")
    return {"deleted": res.rowcount}


# 같은 문제로 계속 알림이 오면 사람이 알림을 끈다. 한 번 알린 문제는
# 이 시간 동안 다시 안 알린다. 해소되면 '복구됨'을 한 번 보내고 잊는다.
_ALERT_COOLDOWN_MIN = 60
_alert_state: dict[str, float] = {}


async def _notify_infra(text_msg: str) -> None:
    """운영진 텔레그램 alert 채널로. 설정이 없으면 조용히 넘어간다."""
    if not (settings.TELEGRAM_BOT_TOKEN and settings.TELEGRAM_ALERT_CHAT_ID):
        return
    import httpx
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            await c.post(
                f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/sendMessage",
                json={"chat_id": settings.TELEGRAM_ALERT_CHAT_ID, "text": text_msg},
            )
    except Exception:
        logger.warning("인프라 알림 전송 실패", exc_info=True)


async def task_infra_snapshot(ctx):
    """1분마다 서버 상태를 한 줄 남기고, 임계값을 넘으면 알린다.

    화면은 보고 있어야만 알 수 있다. 사람이 안 보고 있을 때 터지는 게 문제라서
    넘어가는 순간에 알림을 보낸다. 무엇을 알릴지는 '증상'만 고른다 —
    CPU 가 튀는 건 알리지 않는다. 사람이 할 수 있는 일이 없기 때문이다.
    """
    import time as _t
    from sqlalchemy import text as _text
    from app.models import InfraSnapshot

    snap = {}
    async with AsyncSessionLocal() as db:
        try:
            import os, shutil
            load1, _, _ = os.getloadavg()
            disk = shutil.disk_usage("/")
            mem_total = mem_avail = None
            with open("/proc/meminfo") as f:
                for line in f:
                    k, _, rest = line.partition(":")
                    if k == "MemTotal":
                        mem_total = int(rest.split()[0])
                    elif k == "MemAvailable":
                        mem_avail = int(rest.split()[0])
            snap["cpu_load_1m"] = round(load1, 2)
            snap["disk_used_percent"] = round(disk.used / disk.total * 100, 1)
            if mem_total and mem_avail is not None:
                snap["memory_used_percent"] = round((1 - mem_avail / mem_total) * 100, 1)

            t0 = _t.monotonic()
            await db.execute(_text("SELECT 1"))
            snap["db_latency_ms"] = round((_t.monotonic() - t0) * 1000, 1)
            snap["db_size_mb"] = round(
                (await db.execute(_text("SELECT pg_database_size(current_database())"))).scalar() / 1048576, 1)
            snap["db_connections"] = int((await db.execute(_text(
                "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()"))).scalar())

            # 지난 1분 동안 우리 API 가 받은 요청과 실패
            r = (await db.execute(_text("""
                SELECT COALESCE(sum(hits),0),
                       COALESCE(sum(hits) FILTER (WHERE status_code >= 400),0),
                       percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms)
                FROM access_logs WHERE last_seen_at >= now() - interval '1 minute'
            """))).first()
            snap["requests"], snap["errors"] = int(r[0]), int(r[1])
            snap["p95_ms"] = int(r[2]) if r[2] is not None else None
        except Exception:
            logger.warning("스냅샷 수집 일부 실패", exc_info=True)

        try:
            from app.deps import _get_redis_client
            redis = _get_redis_client()
            info = await redis.info(section="memory")
            snap["redis_used_mb"] = round(info.get("used_memory", 0) / 1048576, 1)
            snap["queue_depth"] = int(await redis.zcard("arq:queue"))
            snap["worker_alive"] = (await redis.get("arq:queue:health-check")) is not None
        except Exception:
            pass

        db.add(InfraSnapshot(**snap))
        await db.commit()

    # ── 알림: 사람이 실제로 할 일이 있는 것만 ──
    now = _t.time()
    alerts: list[tuple[str, str]] = []
    if (snap.get("disk_used_percent") or 0) >= 90:
        alerts.append(("disk", f"⚠️ 디스크가 {snap['disk_used_percent']}% 찼습니다. 오래된 백업·영상·도커 이미지를 지우세요."))
    if snap.get("worker_alive") is False:
        alerts.append(("worker", "⚠️ 작업 워커가 멈췄습니다. 과제 검사와 푸시 알림이 처리되지 않습니다.\ndocker compose restart worker"))
    if (snap.get("queue_depth") or 0) > 200:
        alerts.append(("queue", f"⚠️ 처리 대기 중인 작업이 {snap['queue_depth']}건입니다. 워커가 따라가지 못하고 있습니다."))
    if snap.get("requests") and snap["errors"] / snap["requests"] > 0.3 and snap["requests"] >= 20:
        alerts.append(("errors", f"⚠️ 최근 1분 요청의 {snap['errors']}/{snap['requests']} 가 실패했습니다."))

    firing = {k for k, _ in alerts}
    for key, msg in alerts:
        if now - _alert_state.get(key, 0) > _ALERT_COOLDOWN_MIN * 60:
            _alert_state[key] = now
            await _notify_infra(msg)
    # 해소되면 한 번 알리고 상태를 지운다 — 언제 정상으로 돌아왔는지 모르면 불안하다
    for key in list(_alert_state):
        if key not in firing:
            del _alert_state[key]
            await _notify_infra(f"✅ 해결됨: {key}")

    return snap


async def task_cleanup_snapshots(ctx):
    """스냅샷 보존 정리 — 90일."""
    from sqlalchemy import text as _text
    async with AsyncSessionLocal() as db:
        res = await db.execute(_text(
            "DELETE FROM infra_snapshots WHERE created_at < now() - interval '90 days'"))
        await db.commit()
    return {"deleted": res.rowcount}


class WorkerSettings:
    functions = [task_heartbeat, task_infra_snapshot, task_cleanup_access_logs, task_cleanup_snapshots, task_scan_ppt, task_scan_homework, task_scan_excuses, func(task_upload_videos, timeout=7200), func(task_r2_pull_to_disk, timeout=900), func(task_compress_video, timeout=1800), task_naver_login, task_naver_health_check, task_send_push]
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    on_startup = startup
    # 기본값 3600초라 시간당 한 번만 기록돼 감시용으로 못 쓴다. 1분으로 당겨
    # arq:queue:health-check 를 모니터링 화면과 워커 헬스체크가 같이 쓰게 한다.
    health_check_interval = 60
    cron_jobs = [
        cron(task_naver_health_check, minute={0, 30}),
        cron(task_heartbeat, minute=set(range(0, 60, 5))),
        cron(task_cleanup_access_logs, hour={4}, minute={30}),
        cron(task_cleanup_snapshots, hour={4}, minute={35}),
        # 그래프의 해상도가 여기서 정해진다. 1분마다 한 줄.
        cron(task_infra_snapshot, minute=set(range(60)), run_at_startup=True),
    ]
