from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class AttendanceUpdate(BaseModel):
    status: Optional[str] = Field(None, pattern="^(PENDING|PRESENT|LATE_UNDER10|LATE_OVER10|EARLY_LEAVE|ABSENT|EXCUSED)$")
    excuse_type: Optional[str] = Field(None, pattern="^(PRE|POST)$")
    excuse_text: Optional[str] = None
    note: Optional[str] = None


class AttendanceForceUpdate(BaseModel):
    status: Optional[str] = Field(None, pattern="^(PENDING|PRESENT|LATE_UNDER10|LATE_OVER10|EARLY_LEAVE|ABSENT|EXCUSED)$")
    excuse_type: Optional[str] = Field(None, pattern="^(PRE|POST)$")
    excuse_text: Optional[str] = None
    note: Optional[str] = None
    reason: str = Field(..., description="강제 변경 사유 (필수)")


class AttendanceResponse(BaseModel):
    id: int
    session_id: int
    member_id: int
    status: str
    excuse_type: Optional[str]
    excuse_text: Optional[str]
    note: Optional[str] = None
    group_num: Optional[int] = None
    presenter_order: Optional[int] = None
    updated_at: datetime

    model_config = {"from_attributes": True}


class GroupAssignment(BaseModel):
    groups: dict[str, list[int]]  # {"1": [member_ids...], "2": [member_ids...]}
    staff_groups: dict[str, list[int]] | None = None  # {"1": [user_ids...], "2": [user_ids...]}


class GroupGenerateRequest(BaseModel):
    method: str = "random"  # "random" | "balanced"
