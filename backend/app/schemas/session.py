from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

from app.schemas.team import TeamResponse
from app.schemas.attendance import AttendanceResponse
from app.schemas.assignment import AssignmentResponse


class SessionConfig(BaseModel):
    has_ppt_email: bool = True
    has_ppt: bool = True
    has_review: bool = True
    has_feedback: bool = True
    has_groups: bool = False                         # 분반 (2개 그룹) — INDIVIDUAL 세션 전용
    is_holiday: bool = False
    deadline_ppt_email: Optional[str] = None       # ISO datetime
    deadline_ppt_email_late: Optional[str] = None  # ISO datetime (late submission)
    deadline_post: Optional[str] = None             # ISO datetime


class SessionConfigUpdate(BaseModel):
    config: dict



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

class MeritItemResponse(BaseModel):
    member_id: int
    member_name: str
    score_delta: int
    description: str
    source: str  # "streak" | "manual"

class SettlementPreviewResponse(BaseModel):
    session_id: int
    penalties: list[PenaltyItemResponse]
    merits: list[MeritItemResponse] = []

class StagedMeritCreate(BaseModel):
    member_ids: list[int]
    score_delta: int = Field(ge=1)
    reason: str

class SessionFinalizeOverride(BaseModel):
    member_id: int
    skip_types: list[str]  # ["ATTENDANCE", "PPT", "HOMEWORK"]

class SessionFinalizeRequest(BaseModel):
    overrides: list[SessionFinalizeOverride] = []
    skip_merit_indices: list[int] = []

class SessionFinalizeResponse(BaseModel):
    status: str
    finalized_at: datetime


class SessionStatsResponse(BaseModel):
    attendance_rate: float
    attendance_present: int   # 출석으로 친 인원(출석+지각+조퇴)
    attendance_total: int     # PENDING 포함 전체 행 수
    # 출석률 분모(= 전체 − 미입력) 와 상태별 내역. 숫자 하나만 보면 왜 그 값인지
    # 알 수 없어 화면에서 함께 풀어 보여준다.
    attendance_processed: int = 0
    att_present_only: int = 0
    att_late: int = 0
    att_early_leave: int = 0
    att_excused: int = 0
    att_absent: int = 0
    att_pending: int = 0
    ppt_submitted: int
    ppt_total: int
    ppt_email_submitted: int
    ppt_email_total: int
    homework_submitted: int
    homework_total: int


class FeedbackTargetUpdate(BaseModel):
    target_member_ids: list[int]


class FeedbackRandomAssignRequest(BaseModel):
    extra_count_normal: int = 1   # 출석자 추가 배정 수 (본인 자동 포함 제외)
    extra_count_absent: int = 2   # 결석자 추가 배정 수
