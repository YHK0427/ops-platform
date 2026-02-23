from enum import Enum
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict

class LedgerType(str, Enum):
    FINE = "FINE"
    MILESTONE_FINE = "MILESTONE_FINE"
    DEPOSIT_RECHARGE = "DEPOSIT_RECHARGE"
    DEPOSIT_ADJUST = "DEPOSIT_ADJUST"
    DEPOSIT_REFUND = "DEPOSIT_REFUND"
    MERIT = "MERIT"
    ADJUSTMENT = "ADJUSTMENT"

class LedgerBase(BaseModel):
    member_id: int
    type: LedgerType
    amount_krw: int = 0
    score_delta: int = 0
    description: str

class LedgerCreate(LedgerBase):
    pass

class LedgerResponse(LedgerBase):
    id: int
    session_id: int | None = None
    created_at: datetime
    deposit_after: int

    model_config = ConfigDict(from_attributes=True)

class MeritRequest(BaseModel):
    member_ids: list[int]
    reason: str
    score_delta: int = Field(gt=0, description="부여할 상점 (양수)")
    session_id: Optional[int] = None

class TransactionRequest(BaseModel):
    member_id: int
    type: LedgerType
    amount_krw: int
    description: str

class LedgerUpdate(BaseModel):
    type: Optional[LedgerType] = None
    amount_krw: Optional[int] = None
    score_delta: Optional[int] = None
    description: Optional[str] = Field(None, min_length=1, max_length=500)
