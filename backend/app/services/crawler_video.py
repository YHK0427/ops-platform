import asyncio
import json
import logging
import os
import re
from typing import Any, List

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
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
        creds_info, scopes=["https://www.googleapis.com/auth/drive.readonly"]
    )
    return build("drive", "v3", credentials=creds)


def list_drive_videos(week_num: int) -> List[dict]:
    """
    드라이브 폴더에서 해당 주차 영상 목록을 순서대로 가져옴.
    파일명에 (N번째) 포함 → 번호 기준 오름차순 정렬.
    주차 필터링? -> spec에는 week_num 인자가 있지만, 
    만약 폴더에 여러 주차가 섞여있다면 필터링 필요.
    하지만 spec: "드라이브 폴더에서 해당 주차 영상 목록을..."
    파일명에 주차가 포함되어 있나? -> "김민준(8번째).mp4". 주차 정보 없음.
    아마도 폴더 자체가 해당 주차 폴더이거나,
    운영자가 해당 주차 영상만 넣어놓는다고 가정. (spec "1. Admin이 구글 드라이브 폴더에 영상을 순서대로 정리")
    """
    if not settings.GOOGLE_DRIVE_FOLDER_ID:
        raise ValueError("GOOGLE_DRIVE_FOLDER_ID is not set")

    service = get_drive_service()
    
    # 쿼리: 폴더 ID + video mimeType
    # trash 제외
    query = f"'{settings.GOOGLE_DRIVE_FOLDER_ID}' in parents and mimeType contains 'video/' and trashed=false"
    
    results = service.files().list(
        q=query,
        fields="files(id, name)",
        orderBy="name"
    ).execute()
    
    files = results.get("files", [])
    
    def sort_key(f):
        # (N번째) 숫자 기준 정렬. 없으면 뒤로 보냄.
        m = re.search(r'\((\d+)번째\)', f["name"])
        return int(m.group(1)) if m else 9999
        
    return sorted(files, key=sort_key)


def parse_presenter_name(filename: str) -> str:
    """
    '김민준(8번째).mp4' → '김민준'
    파싱 실패 시 확장자 제거한 전체 이름 반환
    """
    m = re.match(r'^(.+?)\s*\(', filename)
    if m:
        return m.group(1).strip()
    return os.path.splitext(filename)[0].strip()


def download_drive_file(file_id: str, dest_path: str) -> None:
    service = get_drive_service()
    request = service.files().get_media(fileId=file_id)
    with open(dest_path, "wb") as f:
        downloader = MediaIoBaseDownload(f, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()


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
    """Playwright 2단계 업로드 (모바일 웹)"""
    url = (f"https://m.cafe.naver.com/ca-fe/web/cafes/{settings.NAVER_CAFE_ID}"
           f"/menus/{settings.NAVER_CAFE_MENU_VIDEO}/articles/write?boardType=L")
    
    await page.goto(url)
    
    # 로그인 리다이렉트 체크
    if "nid.naver.com" in page.url:
        raise NaverSessionExpiredError("로그인 페이지 리다이렉트됨 (세션 만료)")
        
    await page.wait_for_load_state("networkidle")
    
    # 제목 입력
    await page.locator("textarea[placeholder='제목'],.textarea_input").first.fill(cafe_title)
    
    try:
        # 파일 업로드
        async with page.expect_file_chooser() as fc_info:
            await page.locator("button[aria-label*='동영상'],button:has-text('동영상')").first.click()
        
        file_chooser = await fc_info.value
        await file_chooser.set_files(video_path)
        
        # 업로드 완료 대기 (3분)
        # "업로드 완료!" 텍스트 확인
        await page.get_by_text("업로드 완료!", exact=False).wait_for(state="visible", timeout=180_000)
        
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
        # 글쓰기 완료 후 화면 전환 대기
        await page.wait_for_url(lambda u: "/articles/write" not in u, timeout=30_000)
        return True
    except Exception as e:
        logger.error(f"2단계 등록 실패: {e}")
        return False


async def upload_all_videos(session_id: int, db: AsyncSession) -> List[dict]:
    """전체 비디오 업로드 프로세스"""
    # 세션 정보 조회
    session = await db.get(Session, session_id)
    if not session:
        raise ValueError(f"Session {session_id} not found")

    # 네이버 세션 (Playwright용)
    storage = await _get_naver_storage_state(db)

    # 드라이브 파일 목록
    # 실제로는 구글 서비스 계정 설정이 되어 있어야 함.
    # 설정이 없으면 에러 발생.
    drive_files = list_drive_videos(session.week_num)
    if not drive_files:
        logger.warning(f"No videos found in Drive for week {session.week_num}")
        return []

    results = []
    tmp_dir = "/app/files/video"
    os.makedirs(tmp_dir, exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(storage_state=storage)
        
        # webdriver 감지 우회
        await ctx.add_init_script(
            "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})"
        )
        
        page = await ctx.new_page()

        for drive_file in drive_files:
            raw_name = drive_file["name"]
            presenter = parse_presenter_name(raw_name)
            
            # 게시글 제목: {week}주차_{title}_{presenter}
            cafe_title = f"{session.week_num}주차_{session.title}_{presenter}"
            tmp_path = os.path.join(tmp_dir, raw_name)

            logger.info(f"Processing video: {raw_name} -> {cafe_title}")

            try:
                # 1. 다운로드
                download_drive_file(drive_file["id"], tmp_path)
                
                # 2. 업로드
                ok = await _upload_single(page, tmp_path, cafe_title)
                
                results.append({"file": raw_name, "title": cafe_title, "success": ok})
                logger.info(f"Upload result for {raw_name}: {ok}")
                
                if ok:
                    await asyncio.sleep(10) # rate limit 방지
                    
            except Exception as e:
                logger.error(f"Failed to process {raw_name}: {e}", exc_info=True)
                results.append({"file": raw_name, "title": cafe_title, "success": False, "error": str(e)})
            
            finally:
                # 임시 파일 삭제
                if os.path.exists(tmp_path):
                    try:
                        os.remove(tmp_path)
                    except Exception:
                        pass

        await browser.close()

    return results
