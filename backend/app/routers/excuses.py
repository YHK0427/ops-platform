"""기수 포털 사유서 — 기수원 제출 / 운영진 조회·공결 심사."""
import os
import uuid
from datetime import date, datetime, timezone
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_cohort_id, get_current_member, get_current_user, get_db, require_staff
from app.models import ExcuseAttachment, ExcuseSubmission, Member, Session as SessionModel
from app.services.portal_excuse import apply_submission, classify, detach_submission, edit_deadline, sniff_type

portal_router = APIRouter(prefix="/portal/excuses", tags=["excuses"])
router = APIRouter(prefix="/excuses", tags=["excuses"])

_CATEGORY = "^(ABSENT|LATE|EARLY_LEAVE)$"
# 증빙자료는 의료·가족 사정이 담긴 민감 파일이라 공개 경로(/notifications/img)가 아닌
# 별도 디렉터리에 두고, 인증된 본인·같은 기수 운영진만 받게 한다.
_ATT_DIR = "/app/files/uploads/excuse"
_ATT_MAX_BYTES = 10 * 1024 * 1024
_ATT_MAX_COUNT = 5
_ATT_EXT = {"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp"}
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


async def _attachments(db: AsyncSession, sub_id: int) -> list[ExcuseAttachment]:
    return list((await db.execute(
        select(ExcuseAttachment).where(ExcuseAttachment.submission_id == sub_id).order_by(ExcuseAttachment.id)
    )).scalars().all())


def _remove_files(atts: list[ExcuseAttachment]) -> None:
    for a in atts:
        try:
            os.remove(os.path.join(_ATT_DIR, a.stored_name))
        except OSError:
            pass


def _serve(att: ExcuseAttachment) -> FileResponse:
    return FileResponse(
        os.path.join(_ATT_DIR, att.stored_name),
        media_type=att.content_type,
        headers={
            "Content-Disposition": "inline; filename*=UTF-8''" + quote(att.original_name),
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


async def _out(db: AsyncSession, sub: ExcuseSubmission, name: str | None = None) -> dict:
    if name is None:
        name = (await db.get(Member, sub.member_id)).name
    atts = await _attachments(db, sub.id)
    return {
        "attachments": [
            {"id": a.id, "name": a.original_name, "content_type": a.content_type, "size": a.size} for a in atts
        ],
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
    atts = await _attachments(db, sub.id)
    await detach_submission(db, sub)
    await db.delete(sub)
    await db.commit()
    _remove_files(atts)


@portal_router.post("/{excuse_id}/attachments", status_code=status.HTTP_201_CREATED)
async def add_attachment(
    excuse_id: int, file: UploadFile = File(...),
    member: dict = Depends(get_current_member), db: AsyncSession = Depends(get_db),
):
    sub = await _mine(db, member, excuse_id)
    if not await _editable(db, sub):
        raise HTTPException(status_code=422, detail="수정할 수 있는 기간이 지났습니다. 운영진에게 직접 연락해주세요.")
    if len(await _attachments(db, sub.id)) >= _ATT_MAX_COUNT:
        raise HTTPException(status_code=422, detail=f"증빙자료는 {_ATT_MAX_COUNT}개까지 올릴 수 있어요")
    data = await file.read(_ATT_MAX_BYTES + 1)
    if len(data) > _ATT_MAX_BYTES:
        raise HTTPException(status_code=413, detail="파일은 10MB 이하만 가능해요")
    ctype = sniff_type(data)
    if ctype is None:
        raise HTTPException(status_code=400, detail="사진 파일(jpg/png/webp/gif)만 올릴 수 있어요")
    os.makedirs(_ATT_DIR, exist_ok=True)
    stored = uuid.uuid4().hex + _ATT_EXT[ctype]
    with open(os.path.join(_ATT_DIR, stored), "wb") as f:
        f.write(data)
    name = (file.filename or "증빙자료").replace("\r", " ").replace("\n", " ").strip()[:255] or "증빙자료"
    db.add(ExcuseAttachment(submission_id=sub.id, stored_name=stored, original_name=name,
                            content_type=ctype, size=len(data)))
    await db.commit()
    return await _out(db, sub)


@portal_router.delete("/{excuse_id}/attachments/{att_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_attachment(
    excuse_id: int, att_id: int,
    member: dict = Depends(get_current_member), db: AsyncSession = Depends(get_db),
):
    sub = await _mine(db, member, excuse_id)
    if not await _editable(db, sub):
        raise HTTPException(status_code=422, detail="수정할 수 있는 기간이 지났습니다. 운영진에게 직접 연락해주세요.")
    att = await db.get(ExcuseAttachment, att_id)
    if att is None or att.submission_id != sub.id:
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다")
    await db.delete(att)
    await db.commit()
    _remove_files([att])


@portal_router.get("/{excuse_id}/attachments/{att_id}")
async def my_attachment(
    excuse_id: int, att_id: int,
    member: dict = Depends(get_current_member), db: AsyncSession = Depends(get_db),
):
    sub = await _mine(db, member, excuse_id)
    att = await db.get(ExcuseAttachment, att_id)
    if att is None or att.submission_id != sub.id:
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다")
    return _serve(att)


# ── 운영진 ────────────────────────────────────────────────────────────────
@router.get("")
async def list_excuses(
    session_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    review: str | None = Query(None, pattern="^(PENDING|APPROVED|REJECTED)$"),
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
    if review is not None:
        q = q.where(ExcuseSubmission.review == review)
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


@router.get("/{excuse_id}/attachments/{att_id}")
async def staff_attachment(
    excuse_id: int, att_id: int,
    _: dict = Depends(get_current_user),
    cohort_id: int = Depends(get_current_cohort_id),
    db: AsyncSession = Depends(get_db),
):
    sub = await db.get(ExcuseSubmission, excuse_id)
    att = await db.get(ExcuseAttachment, att_id)
    if sub is None or sub.cohort_id != cohort_id or att is None or att.submission_id != sub.id:
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다")
    return _serve(att)
