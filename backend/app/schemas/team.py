from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator



from app.schemas.member import MemberResponse


class TeamGenerateRequest(BaseModel):
    num_teams: int = Field(..., ge=1, le=20)


class TeamMemberCreate(BaseModel):
    member_id: int


class TeamCreate(BaseModel):
    name: str = Field(..., max_length=50)
    members: list[TeamMemberCreate]


class TeamCreateRequest(BaseModel):
    teams: list[TeamCreate]


class TeamResponse(BaseModel):
    id: int
    session_id: int
    name: str
    created_at: datetime
    # 멤버 정보 포함 (선택적)
    members: list[MemberResponse] = []

    model_config = {"from_attributes": True}

    @field_validator("members", mode="before")
    @classmethod
    def flatten_members(cls, v):
        # SQLAlchemy relationship returns List[TeamMember]
        # We need to extract the actual Member object from TeamMember.member
        if not v:
            return []
        
        # Check if items are TeamMember objects (have 'member' attr)
        # Note: v might be a list or an instrumented list
        return [tm.member for tm in v if hasattr(tm, "member") and tm.member]

