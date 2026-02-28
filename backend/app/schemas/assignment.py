from datetime import datetime
from typing import Any, Optional, List

from pydantic import BaseModel, Field


class AssignmentUpdate(BaseModel):
    status: Optional[str] = Field(None, pattern="^(PENDING|PASS|LATE|MISSING|EXEMPT)$")
    # PPT의 경우 PASS/LATE/MISSING (FAIL은 보통 안 씀? spec에는 PASS/FAIL/LATE/MISSING 등 명시 없으나 ENUM 확인 필요)
    # models.py Assignment status default="PENDING"
    # Business Logic: PPT 미제출 -> MISSING or FAIL?
    # spec_business_logic: "미제출 = -1점 (MISSING)"
    # 따라서 status는 PENDING, PASS, LATE, MISSING, FAIL 등 허용.
    
    # 또한 type이 PPT가 아닌 경우에도 쓸 수 있게 범용적으로?
    # 여기서는 PPT 수동 관리가 주 목적이므로 PASS/LATE/MISSING 위주.


class AssignmentResponse(BaseModel):
    id: int
    session_id: int
    member_id: Optional[int] = None
    team_id: Optional[int] = None
    type: str
    status: str
    scanned_at: Optional[datetime] = None
    target_member_ids: Optional[List[int]] = None
    raw_data: Optional[dict[str, Any]] = None

    model_config = {"from_attributes": True}
