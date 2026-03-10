from pydantic import BaseModel
from typing import Optional, Any, Literal, List
from datetime import datetime

class NaverSessionStatus(BaseModel):
    is_valid: bool
    created_at: Optional[datetime]
    expires_hint: Optional[datetime]

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

class VideoUploadRequest(BaseModel):
    session_id: int
    videos: Optional[List[VideoOrderItem]] = None

class NaverLoginRequest(BaseModel):
    username: str
    password: str

class DriveVideoItem(BaseModel):
    id: str
    name: str
    presenter: str
    order: int            # parsed from (N번째), 9999 if absent
    group: Optional[int] = None   # 분반 번호
    cafe_title: str = ""  # 자동 생성된 카페 게시글 제목

class DriveVideoListResponse(BaseModel):
    videos: list[DriveVideoItem]

class ScanExcusesRequest(BaseModel):
    session_id: int
    mode: Literal["PRE", "POST"]
