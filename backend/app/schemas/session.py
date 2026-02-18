from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class SessionConfig(BaseModel):
    has_ppt: bool = True
    has_review: bool = True
    has_feedback: bool = True
    is_holiday: bool = False


class SessionCreate(BaseModel):
    week_num: int
    title: str = Field(..., max_length=100)
    date: date
    type: str = Field(..., pattern="^(INDIVIDUAL|TEAM)$")
    config: Optional[SessionConfig] = None


class SessionStatusUpdate(BaseModel):
    status: str = Field(..., pattern="^(SETUP|PREP|OPS|POST|SETTLEMENT|FINALIZED)$")


class SessionResponse(BaseModel):
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
