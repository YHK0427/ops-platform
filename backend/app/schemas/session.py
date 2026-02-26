from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

from app.schemas.team import TeamResponse
from app.schemas.attendance import AttendanceResponse
from app.schemas.assignment import AssignmentResponse


class SessionConfig(BaseModel):
    has_ppt_email: bool = True
    has_review: bool = True
    has_feedback: bool = True
    is_holiday: bool = False



class SessionCreate(BaseModel):
    week_num: int = Field(..., le=2147483647, description="Week number (must be fit in 4-byte integer)")
    title: str = Field(..., max_length=100)
    date: date
    type: str = Field(..., pattern="^(INDIVIDUAL|TEAM)$")
    config: Optional[SessionConfig] = None


class SessionStatusUpdate(BaseModel):
    status: str = Field(..., pattern="^(SETUP|PREP|OPS|POST|SETTLEMENT|FINALIZED)$")


class SessionBasicResponse(BaseModel):
    id: int
    week_num: int
    title: str
    date: date
    type: str
    config: Optional[dict[str, Any]]
    status: str
    finalized_at: Optional[datetime]
    created_at: datetime

    model_config = {"from_attributes": True}


class SessionResponse(SessionBasicResponse):
    teams: list[TeamResponse] = []
    attendances: list[AttendanceResponse] = []
    assignments: list[AssignmentResponse] = []

# --- Settlement & Finalize ---

class PenaltyItemResponse(BaseModel):
    type: str
    member_id: int
    member_name: str
    score_delta: int
    deposit_delta: int
    description: str

class SettlementPreviewResponse(BaseModel):
    session_id: int
    penalties: list[PenaltyItemResponse]

class SessionFinalizeOverride(BaseModel):
    member_id: int
    skip_types: list[str]  # ["ATTENDANCE", "PPT", "HOMEWORK"]

class SessionFinalizeRequest(BaseModel):
    overrides: list[SessionFinalizeOverride] = []

class SessionFinalizeResponse(BaseModel):
    status: str
    finalized_at: datetime


class SessionStatsResponse(BaseModel):
    attendance_rate: float
    attendance_present: int
    attendance_total: int
    ppt_submitted: int
    ppt_total: int
    homework_submitted: int
    homework_total: int


class FeedbackTargetUpdate(BaseModel):
    target_member_ids: list[int]
