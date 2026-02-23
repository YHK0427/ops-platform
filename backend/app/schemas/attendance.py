from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class AttendanceUpdate(BaseModel):
    status: Optional[str] = Field(None, pattern="^(PENDING|PRESENT|LATE_UNDER10|LATE_OVER10|EARLY_LEAVE|ABSENT|EXCUSED)$")
    excuse_type: Optional[str] = Field(None, pattern="^(PRE|POST)$")
    excuse_text: Optional[str] = None


class AttendanceForceUpdate(BaseModel):
    status: Optional[str] = Field(None, pattern="^(PENDING|PRESENT|LATE_UNDER10|LATE_OVER10|EARLY_LEAVE|ABSENT|EXCUSED)$")
    excuse_type: Optional[str] = Field(None, pattern="^(PRE|POST)$")
    excuse_text: Optional[str] = None
    reason: str = Field(..., description="강제 변경 사유 (필수)")


class AttendanceResponse(BaseModel):
    id: int
    session_id: int
    member_id: int
    status: str
    excuse_type: Optional[str]
    excuse_text: Optional[str]
    updated_at: datetime

    model_config = {"from_attributes": True}
