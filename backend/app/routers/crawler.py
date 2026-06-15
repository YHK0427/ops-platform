import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.deps import get_current_cohort_id, get_current_user, get_db, require_staff
from app.models import NaverSession
from app.models import Session as SessionModel
from app.schemas.crawler import (
    CrawlerTaskResponse,
    NaverSessionStatus,
    NaverImportRequest,
    ScanPPTRequest,
    ScanHomeworkRequest,
    VideoUploadRequest,
    NaverLoginRequest,
    CrawlerTaskStartRequest,
    ScanExcusesRequest,
)
from app.services.naver_session import import_session

import logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/crawler", tags=["crawler"])


async def _assert_session_cohort(session_id: int, cohort_id: int, db: AsyncSession) -> None:
    """세션이 현재 기수 소속인지 검증 (타 기수 세션에 크롤러 태스크 트리거 방지)."""
    session = await db.get(SessionModel, session_id)
    if not session or session.cohort_id != cohort_id:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")


@router.post("/naver/import", response_model=NaverSessionStatus)
async def import_naver_session_api(
    body: NaverImportRequest,
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_staff),
):
    """네이버 세션(Playwright storage state) 임포트"""
    session = await import_session(db, body.storage_json)
    return NaverSessionStatus(
        is_valid=session.is_valid,
        created_at=session.created_at,
        expires_hint=session.expires_hint,
    )


@router.get("/naver/session-status", response_model=NaverSessionStatus)
async def get_naver_session_status(
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """현재 세션 상태 조회"""
    stmt = select(NaverSession).where(NaverSession.is_valid == True).order_by(NaverSession.id.desc()).limit(1)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()
    
    if not session:
        return NaverSessionStatus(is_valid=False, created_at=None, expires_hint=None)
        
    return NaverSessionStatus(
        is_valid=True,
        created_at=session.created_at,
        expires_hint=session.expires_hint,
    )


@router.post("/scan-ppt", response_model=CrawlerTaskResponse)
async def start_scan_ppt(
    request: Request,
    body: CrawlerTaskStartRequest,
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """PPT 이메일 스캔 태스크 시작 (IMAP)"""
    await _assert_session_cohort(body.session_id, cohort_id, db)
    pool = getattr(request.app.state, "arq_pool", None)
    if not pool:
        raise HTTPException(status_code=503, detail="ARQ pool not initialized")

    job = await pool.enqueue_job("task_scan_ppt", session_id=body.session_id, mode=body.mode)
    logger.info(f"crawler_start type=scan_ppt session={body.session_id} mode={body.mode}")
    return CrawlerTaskResponse(task_id=job.job_id, status="queued")


@router.post("/scan-homework", response_model=CrawlerTaskResponse)
async def start_scan_homework(
    request: Request,
    body: CrawlerTaskStartRequest,
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """과제/리뷰/피드백 게시판 스캔 태스크 시작"""
    await _assert_session_cohort(body.session_id, cohort_id, db)
    pool = getattr(request.app.state, "arq_pool", None)
    if not pool:
        raise HTTPException(status_code=503, detail="ARQ pool not initialized")

    job = await pool.enqueue_job("task_scan_homework", session_id=body.session_id)
    logger.info(f"crawler_start type=scan_homework session={body.session_id}")
    return CrawlerTaskResponse(task_id=job.job_id, status="queued")


@router.post("/scan-excuses", response_model=CrawlerTaskResponse)
async def start_scan_excuses(
    request: Request,
    body: ScanExcusesRequest,
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """사유서 게시판 스캔 태스크 시작 (PRE/POST 모드)"""
    await _assert_session_cohort(body.session_id, cohort_id, db)
    pool = getattr(request.app.state, "arq_pool", None)
    if not pool:
        raise HTTPException(status_code=503, detail="ARQ pool not initialized")

    job = await pool.enqueue_job(
        "task_scan_excuses",
        session_id=body.session_id,
        mode=body.mode,
    )
    logger.info(f"crawler_start type=scan_excuses session={body.session_id} mode={body.mode}")
    return CrawlerTaskResponse(task_id=job.job_id, status="queued")


@router.post("/upload-videos", response_model=CrawlerTaskResponse)
async def start_upload_videos(
    request: Request,
    body: VideoUploadRequest,
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """영상 업로드 태스크 시작"""
    await _assert_session_cohort(body.session_id, cohort_id, db)
    pool = getattr(request.app.state, "arq_pool", None)
    if not pool:
        raise HTTPException(status_code=503, detail="ARQ pool not initialized")

    # 중복 실행 차단 — 이미 진행 중인 task가 있으면 거부
    redis = pool
    try:
        existing_task_id = await redis.get(f"active_upload_task:{body.session_id}")
        if existing_task_id:
            existing_id = existing_task_id if isinstance(existing_task_id, str) else existing_task_id.decode()
            from arq.jobs import Job as ArqJob
            existing_job = ArqJob(existing_id, pool)
            existing_status = await existing_job.status()
            if existing_status in ("queued", "in_progress"):
                raise HTTPException(status_code=409, detail="이미 업로드가 진행 중입니다. 기존 업로드를 중단한 후 다시 시도해주세요.")
    except HTTPException:
        raise
    except Exception:
        pass  # Redis 조회 실패 시 진행 허용

    videos_raw = None
    if body.videos:
        videos_raw = [v.model_dump() for v in body.videos]

    job = await pool.enqueue_job("task_upload_videos", session_id=body.session_id, videos=videos_raw)
    logger.info(f"crawler_start type=upload_videos session={body.session_id}")

    # 활성 태스크 Redis 등록 (다중 사용자 공유용, TTL 2시간)
    redis = pool
    try:
        await redis.set(f"active_upload_task:{body.session_id}", job.job_id, ex=7200)
    except Exception:
        pass  # Redis 저장 실패해도 업로드는 진행

    return CrawlerTaskResponse(task_id=job.job_id, status="queued")


@router.get("/task/{task_id}")
async def get_task_status(
    request: Request,
    task_id: str,
    _: str = Depends(get_current_user),
):
    """태스크 상태 조회"""
    pool = getattr(request.app.state, "arq_pool", None)
    if not pool:
        raise HTTPException(status_code=503, detail="ARQ pool not initialized")

    from arq.jobs import Job
    job = Job(task_id, pool)
    status = await job.status()
    info = await job.info()

    result = None
    if status == "complete":
        try:
            result = await job.result()
        except Exception as e:
            result = str(e)

    # 진행 중인 태스크의 실시간 progress 조회
    progress = None
    if status in ("queued", "in_progress"):
        try:
            redis = pool
            raw = await redis.get(f"upload_progress:{task_id}")
            if raw:
                progress = json.loads(raw)
        except Exception:
            pass

    return {
        "task_id": task_id,
        "status": status,
        "result": result,
        "progress": progress,
        "enqueue_time": info.enqueue_time if info else None,
    }

@router.post("/cancel-upload/{session_id}")
async def cancel_upload(
    request: Request,
    session_id: int,
    _: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """진행 중인 영상 업로드 중단"""
    await _assert_session_cohort(session_id, cohort_id, db)
    pool = getattr(request.app.state, "arq_pool", None)
    if not pool:
        raise HTTPException(status_code=503, detail="ARQ pool not initialized")

    redis = pool
    await redis.set(f"cancel_upload:{session_id}", "1", ex=300)
    logger.audit(f"crawler_cancel type=upload_videos session={session_id}")
    return {"status": "cancelling"}


@router.get("/upload-result/{session_id}")
async def get_upload_result(
    request: Request,
    session_id: int,
    _: str = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """세션의 마지막 업로드 결과 조회 (이어하기용)"""
    await _assert_session_cohort(session_id, cohort_id, db)
    pool = getattr(request.app.state, "arq_pool", None)
    if not pool:
        raise HTTPException(status_code=503, detail="ARQ pool not initialized")

    try:
        redis = pool
        raw = await redis.get(f"upload_result:{session_id}")
        if raw:
            progress = json.loads(raw)
            return {"session_id": session_id, "progress": progress}
    except Exception:
        pass

    return {"session_id": session_id, "progress": None}


@router.get("/active-task/{session_id}")
async def get_active_upload_task(
    request: Request,
    session_id: int,
    _: str = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    """세션의 활성 업로드 태스크 ID 조회 (다중 사용자 공유)"""
    await _assert_session_cohort(session_id, cohort_id, db)
    pool = getattr(request.app.state, "arq_pool", None)
    if not pool:
        raise HTTPException(status_code=503, detail="ARQ pool not initialized")

    try:
        redis = pool
        task_id = await redis.get(f"active_upload_task:{session_id}")
        if task_id:
            task_id = task_id if isinstance(task_id, str) else task_id.decode()
            # 태스크가 아직 활성 상태인지 확인
            from arq.jobs import Job
            job = Job(task_id, pool)
            status = await job.status()
            if status in ("queued", "in_progress"):
                return {"task_id": task_id, "status": status}
            else:
                # 완료/실패된 태스크는 정리
                await redis.delete(f"active_upload_task:{session_id}")
    except Exception:
        pass

    return {"task_id": None}


@router.post("/sync-boards", response_model=CrawlerTaskResponse)
async def trigger_board_sync(
    request: Request,
    _: dict = Depends(require_staff),
):
    """네이버 세션 헬스체크 수동 트리거"""
    pool = getattr(request.app.state, "arq_pool", None)
    if not pool:
        raise HTTPException(status_code=503, detail="ARQ pool not initialized")

    job = await pool.enqueue_job("task_naver_health_check")
    logger.info("crawler_start type=naver_health_check")
    return CrawlerTaskResponse(task_id=job.job_id, status="queued")


@router.post("/naver/login", response_model=CrawlerTaskResponse)
async def start_naver_login(
    body: NaverLoginRequest,
    request: Request,
    _: dict = Depends(require_staff),
):
    """네이버 로그인 태스크 시작 (자동화)"""
    pool = getattr(request.app.state, "arq_pool", None)
    if not pool:
        raise HTTPException(status_code=503, detail="ARQ pool not initialized")

    job = await pool.enqueue_job(
        "task_naver_login",
        username=body.username,
        password=body.password
    )
    logger.info(f"crawler_start type=naver_login")
    return CrawlerTaskResponse(task_id=job.job_id, status="queued")
