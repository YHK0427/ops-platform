import asyncio
import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.deps import get_current_user, get_db
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
    DriveVideoListResponse,
    DriveVideoItem,
    ScanExcusesRequest,
)
from app.services.naver_session import import_session
from app.services.crawler_video import list_drive_videos, parse_presenter_name

router = APIRouter(prefix="/crawler", tags=["crawler"])


def _parse_order(name: str) -> int:
    m = re.search(r'\((\d+)번째\)', name)
    return int(m.group(1)) if m else 9999


@router.post("/naver/import", response_model=NaverSessionStatus)
async def import_naver_session_api(
    body: NaverImportRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
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
    _: str = Depends(get_current_user),
):
    """PPT 스캔 태스크 시작 (Stub 실행)"""
    pool = getattr(request.app.state, "arq_pool", None)
    if not pool:
        raise HTTPException(status_code=503, detail="ARQ pool not initialized")

    job = await pool.enqueue_job("task_scan_ppt", session_id=body.session_id, mode=body.mode)
    return CrawlerTaskResponse(task_id=job.job_id, status="queued")


@router.post("/scan-homework", response_model=CrawlerTaskResponse)
async def start_scan_homework(
    request: Request,
    body: CrawlerTaskStartRequest,
    _: str = Depends(get_current_user),
):
    """과제/리뷰/피드백 게시판 스캔 태스크 시작"""
    pool = getattr(request.app.state, "arq_pool", None)
    if not pool:
        raise HTTPException(status_code=503, detail="ARQ pool not initialized")

    job = await pool.enqueue_job("task_scan_homework", session_id=body.session_id)
    return CrawlerTaskResponse(task_id=job.job_id, status="queued")


@router.post("/scan-excuses", response_model=CrawlerTaskResponse)
async def start_scan_excuses(
    request: Request,
    body: ScanExcusesRequest,
    _: str = Depends(get_current_user),
):
    """사유서 게시판 스캔 태스크 시작 (PRE/POST 모드)"""
    pool = getattr(request.app.state, "arq_pool", None)
    if not pool:
        raise HTTPException(status_code=503, detail="ARQ pool not initialized")

    job = await pool.enqueue_job(
        "task_scan_excuses",
        session_id=body.session_id,
        mode=body.mode,
    )
    return CrawlerTaskResponse(task_id=job.job_id, status="queued")


@router.post("/upload-videos", response_model=CrawlerTaskResponse)
async def start_upload_videos(
    request: Request,
    body: VideoUploadRequest,
    _: str = Depends(get_current_user),
):
    """영상 업로드 태스크 시작"""
    pool = getattr(request.app.state, "arq_pool", None)
    if not pool:
        raise HTTPException(status_code=503, detail="ARQ pool not initialized")

    job = await pool.enqueue_job("task_upload_videos", session_id=body.session_id)
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
            
    return {
        "task_id": task_id,
        "status": status,
        "result": result,
        "enqueue_time": info.enqueue_time if info else None,
    }

@router.post("/sync-boards", response_model=CrawlerTaskResponse)
async def trigger_board_sync(
    request: Request,
    _: str = Depends(get_current_user),
):
    """수동 게시판 동기화 트리거"""
    pool = getattr(request.app.state, "arq_pool", None)
    if not pool:
        raise HTTPException(status_code=503, detail="ARQ pool not initialized")

    job = await pool.enqueue_job("task_sync_cafe_boards")
    return CrawlerTaskResponse(task_id=job.job_id, status="queued")


@router.get("/drive-videos", response_model=DriveVideoListResponse)
async def list_drive_videos_api(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """드라이브 영상 목록 조회 (Google Drive API, 동기 → thread offload)"""
    session = await db.get(SessionModel, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    try:
        files = await asyncio.to_thread(list_drive_videos, session.week_num)
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Drive API 오류: {e}")

    videos = [
        DriveVideoItem(
            id=f["id"],
            name=f["name"],
            presenter=parse_presenter_name(f["name"]),
            order=_parse_order(f["name"]),
        )
        for f in files
    ]
    return DriveVideoListResponse(videos=videos)


@router.post("/naver/login", response_model=CrawlerTaskResponse)
async def start_naver_login(
    body: NaverLoginRequest,
    request: Request,
    _: str = Depends(get_current_user),
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
    return CrawlerTaskResponse(task_id=job.job_id, status="queued")
