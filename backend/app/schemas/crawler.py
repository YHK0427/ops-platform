from pydantic import BaseModel
from typing import Optional, Any, Literal, List
from datetime import datetime

class NaverSessionStatus(BaseModel):
    is_valid: bool  # DB 에 등록된 세션이 있나
    created_at: Optional[datetime]
    expires_hint: Optional[datetime]
    # 워커 헬스체크가 네이버에 실제로 물어본 결과. None 이면 이 세션은 아직 확인 전.
    alive: Optional[bool] = None
    nick: Optional[str] = None
    level_name: Optional[str] = None
    checked_at: Optional[datetime] = None

class CrawlerTaskResponse(BaseModel):
    task_id: str
    status: str
    result: Optional[Any] = None
    enqueue_time: Optional[datetime] = None

class NaverImportRequest(BaseModel):
    storage_json: Any

class CrawlerTaskStartRequest(BaseModel):
    session_id: int
    mode: Optional[str] = "REGULAR"

class ScanPPTRequest(BaseModel):
    session_id: int
    mode: str

class ScanHomeworkRequest(BaseModel):
    session_id: int

class VideoOrderItem(BaseModel):
    id: str
    name: str
    presenter: str
    order: int
    group: Optional[int] = None        # 분반 번호 (e.g., 2분반 → 2)
    cafe_title: Optional[str] = None   # 카페 게시글 제목 (없으면 자동 생성)
    local_path: Optional[str] = None   # 서버 로컬 파일 경로 (직접 업로드 시)

class VideoUploadRequest(BaseModel):
    session_id: int
    videos: Optional[List[VideoOrderItem]] = None

class NaverLoginRequest(BaseModel):
    username: str
    password: str

class ScanExcusesRequest(BaseModel):
    session_id: int
    mode: Literal["PRE", "POST"]
