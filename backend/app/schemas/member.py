from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class ScoreInfo(BaseModel):
    total_plus_score: int
    total_minus_score: int
    net_score: int
    current_deposit: int


class MemberCreate(BaseModel):
    name: str = Field(..., max_length=50)
    name_initial: Optional[str] = Field(None, max_length=10)
    email: Optional[str] = Field(None, max_length=200)
    tags: list[str] = Field(default_factory=list)


class MemberUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=50)
    name_initial: Optional[str] = Field(None, max_length=10)
    email: Optional[str] = Field(None, max_length=200)
    tags: Optional[list[str]] = None


class MemberResponse(BaseModel):
    id: int
    name: str
    name_initial: Optional[str]
    email: Optional[str]
    tags: list[str]
    is_active: bool
    created_at: datetime
    deactivated_at: Optional[datetime]
    # 점수 3분리
    total_plus_score: int
    total_minus_score: int
    net_score: int
    current_deposit: int

    model_config = {"from_attributes": True}
