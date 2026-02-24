from pydantic import BaseModel
from typing import Optional, Any
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

class VideoUploadRequest(BaseModel):
    session_id: int

class NaverLoginRequest(BaseModel):
    username: str
    password: str

class DriveVideoItem(BaseModel):
    id: str
    name: str
    presenter: str
    order: int  # parsed from (N번째), 9999 if absent

class DriveVideoListResponse(BaseModel):
    videos: list[DriveVideoItem]

class ScanExcusesRequest(BaseModel):
    session_id: int
    mode: str  # "PRE" or "POST"
