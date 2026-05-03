import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, List, Optional

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload, MediaIoBaseUpload
from playwright.async_api import async_playwright
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Session
from app.services.naver_session import get_valid_requests_session
from app.services.naver_session import _build_requests_session
# _build_requests_session은 Session 객체가 없으므로
# Playwright storage_state를 얻기 위해 DB조회 함수가 필요함.
from sqlalchemy import select
from app.models import NaverSession

logger = logging.getLogger(__name__)


def get_drive_service():
    """서비스 어카운트 JSON으로 Drive API 클라이언트 생성"""
    if not settings.GOOGLE_SERVICE_ACCOUNT_JSON:
        raise ValueError("GOOGLE_SERVICE_ACCOUNT_JSON is not set")
        
    creds_info = json.loads(settings.GOOGLE_SERVICE_ACCOUNT_JSON)
    creds = service_account.Credentials.from_service_account_info(
        creds_info, scopes=["https://www.googleapis.com/auth/drive"]
    )
    return build("drive", "v3", credentials=creds)


def create_drive_folder(folder_name: str, parent_id: str | None = None) -> str:
    """Google Drive에 폴더 생성 후 폴더 ID 반환"""
    service = get_drive_service()
    parent = parent_id or settings.GOOGLE_DRIVE_FOLDER_ID
    if not parent:
        raise ValueError("GOOGLE_DRIVE_FOLDER_ID is not set")

    metadata = {
        "name": folder_name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [parent],
    }
    folder = service.files().create(body=metadata, fields="id").execute()
    return folder["id"]


def upload_file_to_drive(file_bytes: bytes, filename: str, folder_id: str, mime_type: str = "application/octet-stream") -> str:
    """Google Drive에 파일 업로드 후 file_id 반환"""
    import io
    service = get_drive_service()
    metadata = {
        "name": filename,
        "parents": [folder_id],
    }
    media = MediaIoBaseUpload(io.BytesIO(file_bytes), mimetype=mime_type, resumable=True)
    uploaded = service.files().create(body=metadata, media_body=media, fields="id").execute()
    return uploaded["id"]


def copy_drive_file(source_file_id: str, dest_folder_id: str, new_name: str | None = None) -> str:
    """Google Drive 파일을 다른 폴더로 복사 후 file_id 반환"""
    service = get_drive_service()
    body: dict = {"parents": [dest_folder_id]}
    if new_name:
        body["name"] = new_name
    copied = service.files().copy(fileId=source_file_id, body=body, fields="id").execute()
    return copied["id"]


def download_drive_file_bytes(file_id: str) -> tuple[bytes, str]:
    """Drive 파일을 메모리로 다운로드, (bytes, filename) 반환"""
    import io
    service = get_drive_service()
    # 파일 메타 조회
    meta = service.files().get(fileId=file_id, fields="name,mimeType").execute()
    filename = meta.get("name", "download")

    # Google Workspace 파일은 export, 일반 파일은 get_media
    mime = meta.get("mimeType", "")
    if mime.startswith("application/vnd.google-apps."):
        # Google Slides → pptx export
        export_map = {
            "application/vnd.google-apps.presentation": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "application/vnd.google-apps.document": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.google-apps.spreadsheet": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }
        export_mime = export_map.get(mime, "application/pdf")
        request = service.files().export_media(fileId=file_id, mimeType=export_mime)
        ext_map = {
            "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
            "application/pdf": ".pdf",
        }
        ext = ext_map.get(export_mime, "")
        if not filename.endswith(ext):
            filename += ext
    else:
        request = service.files().get_media(fileId=file_id)

    buf = io.BytesIO()
    downloader = MediaIoBaseDownload(buf, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return buf.getvalue(), filename


class NaverSessionExpiredError(Exception):
    pass


async def _get_naver_storage_state(db: AsyncSession) -> dict:
    """DB에서 유효한 네이버 세션 storage_json 가져오기"""
    stmt = select(NaverSession).where(NaverSession.is_valid == True).order_by(NaverSession.id.desc()).limit(1)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()
    if not session:
        raise ValueError("유효한 네이버 세션이 없습니다.")
    return session.storage_json


async def _upload_single(page, video_path: str, cafe_title: str) -> bool:
    """Playwright 2단계 업로드 (모바일 웹) — 페이지 1개 재사용"""
    url = (f"https://m.cafe.naver.com/ca-fe/web/cafes/{settings.NAVER_CAFE_ID}"
           f"/menus/{settings.NAVER_CAFE_MENU_VIDEO}/articles/write?boardType=L")

    await page.goto(url)

    if "nid.naver.com" in page.url:
        raise NaverSessionExpiredError("로그인 페이지 리다이렉트됨 (세션 만료)")

    await page.wait_for_load_state("networkidle")
    await page.locator("textarea[placeholder='제목'],.textarea_input").first.fill(cafe_title)

    try:
        async with page.expect_file_chooser() as fc_info:
            await page.locator("button[aria-label*='동영상'],button:has-text('동영상')").first.click()

        file_chooser = await fc_info.value
        await file_chooser.set_files(video_path)

        # 업로드 완료 대기 (5분)
        await page.get_by_text("업로드 완료!", exact=False).wait_for(state="visible", timeout=300_000)

        # 등록 버튼 클릭 (1단계)
        await page.locator("button:has-text('등록'),button:has-text('완료'),.btn_done").first.click()
        await asyncio.sleep(3)

    except Exception as e:
        logger.error(f"1단계 업로드 실패: {e}")
        return False

    await asyncio.sleep(2)

    try:
        # 최종 등록 (2단계)
        await page.locator("button:has-text('등록'),.GnbBntRight__green,.btn_register").first.click()
        await page.wait_for_url(lambda u: "/articles/write" not in u, timeout=30_000)
        return True
    except Exception as e:
        logger.error(f"2단계 등록 실패: {e}")
        return False


async def _set_progress(redis, job_id: str, progress: list) -> None:
    """Redis에 개별 영상 진행률 저장 (TTL 1시간)"""
    if not redis or not job_id:
        return
    try:
        await redis.set(
            f"upload_progress:{job_id}",
            json.dumps(progress, ensure_ascii=False),
            ex=3600,
        )
    except Exception as e:
        logger.warning(f"Failed to set progress in Redis: {e}")


async def upload_all_videos(
    session_id: int,
    db: AsyncSession,
    *,
    redis=None,
    job_id: Optional[str] = None,
    videos: Optional[List[dict]] = None,
) -> List[dict]:
    """전체 비디오 업로드 (페이지 1개 재사용 + 순차 업로드, 직접 업로드 영상만)"""
    session = await db.get(Session, session_id)
    if not session:
        raise ValueError(f"Session {session_id} not found")

    storage = await _get_naver_storage_state(db)

    if not videos:
        logger.warning(f"No videos provided for session {session_id}")
        return []
    video_items = sorted(videos, key=lambda v: (v.get("group") or 0, v.get("order", 9999)))

    total = len(video_items)
    MAX_UPLOAD_RETRIES = 2

    # 초기 progress
    progress_list = []
    for f in video_items:
        name = f.get("name", f.get("id", "unknown"))
        progress_list.append({
            "file": name,
            "presenter": f.get("presenter", name),
            "order": f.get("order", 9999),
            "status": "pending",
            "error": None,
            "started_at": None,
        })
    await _set_progress(redis, job_id, progress_list)

    results = []

    # 중단 시그널 + browser 참조 (즉시 중단용)
    abort_event = asyncio.Event()
    browser_ref: list = [None]  # mutable container for browser reference

    async def poll_cancel():
        """Redis cancel 플래그를 2초마다 체크 — 감지 시 browser 즉시 종료"""
        while not abort_event.is_set():
            try:
                if redis:
                    flag = await redis.get(f"cancel_upload:{session_id}")
                    if flag:
                        abort_event.set()
                        logger.info("사용자 요청으로 업로드 즉시 중단")
                        await redis.delete(f"cancel_upload:{session_id}")
                        # browser 즉시 종료 → 진행 중인 Playwright에 exception 발생
                        if browser_ref[0]:
                            try:
                                await browser_ref[0].close()
                            except Exception:
                                pass
                        return
            except Exception:
                pass
            await asyncio.sleep(2)

    cancel_poller = asyncio.create_task(poll_cancel())

    # 파일별 메타 미리 계산 + 크기 정보 (모든 영상은 local_path)
    file_metas = []
    for i, video_item in enumerate(video_items):
        raw_name = video_item.get("name", video_item.get("id", "unknown"))
        local_path = video_item.get("local_path")
        size_mb = None
        if local_path and os.path.exists(local_path):
            try:
                size_mb = round(os.path.getsize(local_path) / (1024 * 1024), 1)
            except OSError:
                size_mb = None
        file_metas.append({"raw_name": raw_name, "local_path": local_path, "size_mb": size_mb})
        progress_list[i]["size_mb"] = size_mb

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        browser_ref[0] = browser  # cancel poller가 즉시 종료할 수 있도록 참조 저장
        pw_ctx = await browser.new_context(storage_state=storage)
        await pw_ctx.add_init_script(
            "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})"
        )

        page = await pw_ctx.new_page()

        for idx, video_item in enumerate(video_items):
            raw_name = file_metas[idx]["raw_name"]
            local_path = file_metas[idx]["local_path"]
            presenter = video_item.get("presenter", raw_name)

            order = video_item.get("order", 9999)
            cafe_title = video_item.get("cafe_title")
            if not cafe_title:
                group = video_item.get("group")
                if group is not None:
                    order_suffix = f"({group}분반 {order}번째)" if order != 9999 else f"({group}분반)"
                else:
                    order_suffix = f"({order}번째)" if order != 9999 else ""
                cafe_title = f"연합UP 33기 {session.week_num}주차 발표-[{session.title}]-{presenter}{order_suffix}"

            # 중단 체크
            if abort_event.is_set():
                progress_list[idx]["status"] = "cancelled"
                await _set_progress(redis, job_id, progress_list)
                results.append({"file": raw_name, "title": cafe_title, "success": False, "error": "중단"})
                continue

            logger.info(f"[{idx+1}/{total}] 처리 시작: {raw_name} -> {cafe_title}")

            try:
                if not local_path or not os.path.exists(local_path):
                    raise FileNotFoundError(f"local_path 없음 또는 파일 없음: {local_path}")

                # 업로드 시작
                progress_list[idx]["status"] = "uploading"
                progress_list[idx]["started_at"] = datetime.now(timezone.utc).isoformat()
                await _set_progress(redis, job_id, progress_list)

                ok = False
                for attempt in range(1, MAX_UPLOAD_RETRIES + 1):
                    ok = await _upload_single(page, local_path, cafe_title)
                    if ok:
                        break
                    if attempt < MAX_UPLOAD_RETRIES:
                        logger.warning(
                            f"[{idx+1}/{total}] {raw_name} 업로드 실패 "
                            f"(시도 {attempt}/{MAX_UPLOAD_RETRIES}), 재시도..."
                        )
                        # page를 닫고 새로 생성 (잔여 상태 완전 초기화)
                        try:
                            await page.close()
                        except Exception:
                            pass
                        page = await pw_ctx.new_page()
                        await asyncio.sleep(3)

                if ok:
                    progress_list[idx]["status"] = "done"
                else:
                    progress_list[idx]["status"] = "failed"
                    progress_list[idx]["error"] = f"업로드 실패 ({MAX_UPLOAD_RETRIES}회 시도)"
                await _set_progress(redis, job_id, progress_list)

                results.append({"file": raw_name, "title": cafe_title, "success": ok})
                logger.info(f"[{idx+1}/{total}] {raw_name}: {'성공' if ok else '실패'}")

                if ok:
                    await asyncio.sleep(10)  # rate limit 방지

            except NaverSessionExpiredError:
                abort_event.set()
                logger.error("네이버 세션 만료 — 남은 영상 업로드 중단")
                progress_list[idx]["status"] = "failed"
                progress_list[idx]["error"] = "세션 만료"
                await _set_progress(redis, job_id, progress_list)
                results.append({"file": raw_name, "title": cafe_title, "success": False, "error": "세션 만료"})

            except Exception as e:
                logger.error(f"[{idx+1}/{total}] {raw_name} 처리 실패: {e}", exc_info=True)
                progress_list[idx]["status"] = "failed"
                progress_list[idx]["error"] = str(e)
                await _set_progress(redis, job_id, progress_list)
                results.append({"file": raw_name, "title": cafe_title, "success": False, "error": str(e)})

        # browser가 cancel poller에 의해 이미 close되었을 수 있음
        if browser.is_connected():
            await browser.close()

    # 정리
    cancel_poller.cancel()

    # 남은 pending → cancelled
    if abort_event.is_set():
        for p in progress_list:
            if p["status"] == "pending":
                p["status"] = "cancelled"

    # 결과 요약
    success_count = sum(1 for r in results if r["success"])
    fail_count = sum(1 for r in results if not r["success"])
    cancelled_count = sum(1 for p in progress_list if p["status"] == "cancelled")
    logger.info(
        f"영상 업로드 완료: 총 {total}개 중 성공 {success_count}개, "
        f"실패 {fail_count}개, 취소 {cancelled_count}개"
    )

    if redis:
        try:
            await redis.set(
                f"upload_result:{session_id}",
                json.dumps(progress_list, ensure_ascii=False),
                ex=86400,
            )

            if job_id:
                if fail_count == 0 and cancelled_count == 0:
                    await redis.delete(f"upload_progress:{job_id}")
                else:
                    failed_items = [p for p in progress_list if p["status"] in ("failed", "cancelled")]
                    logger.warning(
                        f"미완료 영상 목록:\n"
                        + "\n".join(f"  - {p['file']}: {p.get('error') or p['status']}" for p in failed_items)
                    )
                    await redis.set(
                        f"upload_progress:{job_id}",
                        json.dumps(progress_list, ensure_ascii=False),
                        ex=86400,
                    )
                await redis.delete(f"active_upload_task:{session_id}")
        except Exception:
            pass

    return results
