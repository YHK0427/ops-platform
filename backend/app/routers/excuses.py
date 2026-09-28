"""기수 포털 사유서 — 기수원 제출 / 운영진 조회·공결 심사."""
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_cohort_id, get_current_member, get_current_user, get_db, require_staff
from app.models import ExcuseSubmission, Member, Session as SessionModel
from app.services.portal_excuse import apply_submission, classify, detach_submission, edit_deadline

portal_router = APIRouter(prefix="/portal/excuses", tags=["excuses"])
router = APIRouter(prefix="/excuses", tags=["excuses"])

_CATEGORY = "^(ABSENT|LATE|EARLY_LEAVE)$"
_REASON_KIND = "^(NORMAL|RECOGNIZED)$"


class ExcuseIn(BaseModel):
    target_date: date
    category: str = Field(pattern=_CATEGORY)
    reason_kind: str = Field(pattern=_REASON_KIND)
    reason: str = Field(min_length=1, max_length=2000)


class ExcuseEdit(BaseModel):
    category: str = Field(pattern=_CATEGORY)
    reason_kind: str = Field(pattern=_REASON_KIND)
    reason: str = Field(min_length=1, max_length=2000)


class ReviewIn(BaseModel):
    decision: str = Field(pattern="^(APPROVED|REJECTED)$")


async def _finalized(db: AsyncSession, sub: ExcuseSubmission) -> bool:
    if not sub.session_id:
        return False
    s = await db.get(SessionModel, sub.session_id)
    return s is not None and s.status == "FINALIZED"


async def _editable(db: AsyncSession, sub: ExcuseSubmission) -> bool:
    if sub.review in ("APPROVED", "REJECTED"):
        return False
    if datetime.now(timezone.utc) > edit_deadline(sub.target_date, sub.excuse_type):
        return False
    return not await _finalized(db, sub)


async def _out(db: AsyncSession, sub: ExcuseSubmission, name: str | None = None) -> dict:
    if name is None:
        name = (await db.get(Member, sub.member_id)).name
    return {
        "id": sub.id, "member_id": sub.member_id, "member_name": name,
        "target_date": sub.target_date, "excuse_type": sub.excuse_type,
        "category": sub.category, "reason_kind": sub.reason_kind, "reason": sub.reason,
        "review": sub.review, "reviewed_by": sub.reviewed_by, "reviewed_at": sub.reviewed_at,
        "session_id": sub.session_id, "created_at": sub.created_at,
        "editable": await _editable(db, sub),
    }


async def _mine(db: AsyncSession, member: dict, excuse_id: int) -> ExcuseSubmission:
    sub = await db.get(ExcuseSubmission, excuse_id)
    if sub is None or sub.member_id != member["member_id"]:
        raise HTTPException(status_code=404, detail="사유서를 찾을 수 없습니다")
    return sub


# ── 기수원 ────────────────────────────────────────────────────────────────
@portal_router.get("")
async def my_excuses(member: dict = Depends(get_current_member), db: AsyncSession = Depends(get_db)):
    subs = (await db.execute(
        select(ExcuseSubmission).where(ExcuseSubmission.member_id == member["member_id"])
        .order_by(ExcuseSubmission.target_date.desc())
    )).scalars().all()
    return [await _out(db, s) for s in subs]


@portal_router.get("/preview")
async def preview(date_: date = Query(alias="date"), _: dict = Depends(get_current_member)):
    return {"excuse_type": classify(date_, datetime.now(timezone.utc))}


@portal_router.post("", status_code=status.HTTP_201_CREATED)
async def submit(body: ExcuseIn, member: dict = Depends(get_current_member), db: AsyncSession = Depends(get_db)):
    dup = (await db.execute(
        select(ExcuseSubmission.id).where(
            ExcuseSubmission.member_id == member["member_id"],
            ExcuseSubmission.target_date == body.target_date,
        )
    )).scalar_one_or_none()
    if dup:
        raise HTTPException(status_code=409, detail="이 날짜에 이미 낸 사유서가 있습니다. 목록에서 수정해주세요.")
    excuse_type = classify(body.target_date, datetime.now(timezone.utc))
    if excuse_type is None:
        raise HTTPException(status_code=422, detail="사후사유서 마감이 지난 날짜입니다. 운영진에게 직접 연락해주세요.")
    sub = ExcuseSubmission(
        cohort_id=member["cohort_id"], member_id=member["member_id"],
        target_date=body.target_date, excuse_type=excuse_type,
        category=body.category, reason_kind=body.reason_kind, reason=body.reason.strip(),
        review="PENDING" if body.reason_kind == "RECOGNIZED" else None,
    )
    if await _finalized_for_date(db, sub):
        raise HTTPException(status_code=422, detail="이미 정산이 끝난 세션입니다. 운영진에게 직접 연락해주세요.")
    db.add(sub)
    await db.flush()
    await db.refresh(sub)
    await apply_submission(db, sub)
    await db.commit()
    return await _out(db, sub)


async def _finalized_for_date(db: AsyncSession, sub: ExcuseSubmission) -> bool:
    s = (await db.execute(
        select(SessionModel.status).where(
            SessionModel.cohort_id == sub.cohort_id, SessionModel.date == sub.target_date,
        ).limit(1)
    )).scalar_one_or_none()
    return s == "FINALIZED"


@portal_router.put("/{excuse_id}")
async def edit(excuse_id: int, body: ExcuseEdit, member: dict = Depends(get_current_member), db: AsyncSession = Depends(get_db)):
    sub = await _mine(db, member, excuse_id)
    if not await _editable(db, sub):
        raise HTTPException(status_code=422, detail="수정할 수 있는 기간이 지났습니다. 운영진에게 직접 연락해주세요.")
    prev = sub.category
    sub.category = body.category
    sub.reason = body.reason.strip()
    if body.reason_kind != sub.reason_kind:
        sub.reason_kind = body.reason_kind
        sub.review = "PENDING" if body.reason_kind == "RECOGNIZED" else None
    await apply_submission(db, sub, prev_category=prev)
    await db.commit()
    await db.refresh(sub)
    return await _out(db, sub)


@portal_router.delete("/{excuse_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel(excuse_id: int, member: dict = Depends(get_current_member), db: AsyncSession = Depends(get_db)):
    sub = await _mine(db, member, excuse_id)
    if not await _editable(db, sub):
        raise HTTPException(status_code=422, detail="취소할 수 있는 기간이 지났습니다. 운영진에게 직접 연락해주세요.")
    await detach_submission(db, sub)
    await db.delete(sub)
    await db.commit()


# ── 운영진 ────────────────────────────────────────────────────────────────
@router.get("")
async def list_excuses(
    session_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    _: dict = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    q = (select(ExcuseSubmission, Member.name)
         .join(Member, Member.id == ExcuseSubmission.member_id)
         .where(ExcuseSubmission.cohort_id == cohort_id))
    if session_id is not None:
        q = q.where(ExcuseSubmission.session_id == session_id)
    if date_from is not None:
        q = q.where(ExcuseSubmission.target_date >= date_from)
    if date_to is not None:
        q = q.where(ExcuseSubmission.target_date <= date_to)
    rows = (await db.execute(q.order_by(ExcuseSubmission.target_date.desc(), Member.name))).all()
    return [await _out(db, s, name) for s, name in rows]


@router.post("/{excuse_id}/review")
async def review(
    excuse_id: int, body: ReviewIn,
    user: dict = Depends(require_staff),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    sub = await db.get(ExcuseSubmission, excuse_id)
    if sub is None or sub.cohort_id != cohort_id:
        raise HTTPException(status_code=404, detail="사유서를 찾을 수 없습니다")
    if sub.reason_kind != "RECOGNIZED":
        raise HTTPException(status_code=422, detail="인정사유로 낸 사유서만 심사할 수 있습니다")
    if await _finalized(db, sub):
        raise HTTPException(status_code=422, detail="이미 정산이 끝난 세션입니다. 장부에서 해당 내역을 직접 수정해주세요.")
    sub.review = body.decision
    sub.reviewed_by = user["username"]
    sub.reviewed_at = datetime.now(timezone.utc)
    await apply_submission(db, sub)
    await db.commit()
    await db.refresh(sub)
    return await _out(db, sub)
