# 기수 포털 사유서 제출 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기수원이 포털에서 사전/사후 사유서를 내면, 날짜 기준으로 저장했다가 해당 날짜 세션 출결에 자동 반영한다.

**Architecture:** 새 테이블 `excuse_submissions` 에 날짜 기준으로 저장한다. 판정·문구·상태 계산은 DB 없는 순수 함수(`services/portal_excuse.py`)로 두고 단위 테스트한다. DB 반영 함수 3개(제출 1건 반영 / 세션 생성 시 일괄 / 연결 해제)를 같은 파일에 두고 제출·수정·심사·세션 생성이 모두 이것만 부른다. 카페 스캔 코드는 건드리지 않는다.

**Tech Stack:** FastAPI + SQLAlchemy async + Alembic + PostgreSQL / React19 + TanStack Query + sonner + shadcn

**Spec:** `docs/superpowers/specs/2026-09-28-portal-excuse-design.md`

## Global Constraints

- 사전 마감 = 대상 날짜 전날 21:59:59 KST = `datetime.combine(d - 1일, time(12,59,59), tzinfo=UTC)`
- 사후 마감 = 대상 날짜 다음날 21:59:59 KST = `datetime.combine(d + 1일, time(12,59,59), tzinfo=UTC)`
- 사전/사후는 최초 제출 시각으로 서버가 판정. 수정해도 안 바뀐다.
- 사후 마감이 지난 날짜는 제출 불가: 프론트 날짜 선택기 `min` + 서버 422 `"사후사유서 마감이 지난 날짜입니다. 운영진에게 직접 연락해주세요."`
- 사용자 화면 문구는 전부 한국어.
- `backend/app/services/crawler_excuse.py`, `backend/app/routers/crawler.py` 수정 금지.
- FINALIZED 세션의 출결은 절대 건드리지 않는다.
- 커밋 메시지에 AI 표기(Co-Authored-By, Claude-Session) 금지. push 는 사용자 요청 시에만.
- 프론트 변경 후 `npx tsc -b` 통과 필수.
- 백엔드 테스트: `docker compose exec -T backend sh -c 'cd /app && python -m pytest tests -q'` (dev 백엔드는 이미지 빌드라 소스 변경 반영에 `docker compose build backend && docker compose up -d backend` 필요. 빠른 확인은 `docker cp` 후 restart).

## Review Focus

1. 사전 마감 정각(21:59:59) 경계 — 정각은 사전, 1초 뒤는 사후. Task 1 테스트로 고정.
2. 운영진이 당일 "지각(10분 이상)" 으로 찍은 뒤 기수원이 사유서를 수정 — 운영진 값이 덮이면 안 된다. Task 1 `desired_status` 테스트로 고정.
3. 기수원이 지각 → 결석으로 수정 — 이전에 우리가 세팅한 지각이 결석으로 바뀌어야 한다(`prev_category`). Task 1 테스트로 고정.
4. 사후 마감 지난 날짜를 API 로 직접 제출 — 422 (프론트 min 우회). Task 4 curl 검증.
5. 같은 날짜 두 번 제출 — 409, 기존 건 수정 유도. Task 4 curl 검증.
6. 다른 기수원의 사유서 id 로 수정·삭제 시도 — 404. Task 4 curl 검증.

---

### Task 1: 순수 판정 로직 + 단위 테스트

**Files:**
- Create: `backend/app/services/portal_excuse.py`
- Test: `backend/tests/test_portal_excuse.py`

**Interfaces:**
- Produces:
  - `classify(target_date: date, now: datetime) -> str | None` → `"PRE"` | `"POST"` | `None`(사후 마감 지남, 제출 불가)
  - `edit_deadline(target_date: date, excuse_type: str) -> datetime`
  - `CATEGORY_STATUS: dict[str, str]` = `{"ABSENT": "ABSENT", "LATE": "LATE_UNDER10", "EARLY_LEAVE": "EARLY_LEAVE"}`
  - `desired_status(category, reason_kind, review, current, prev_category=None) -> str | None` (None = 건드리지 말 것)
  - `build_excuse_text(*, category, excuse_type, reason_kind, review, created_at, reason) -> str`

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_portal_excuse.py`

```python
"""포털 사유서 판정 — 마감 경계와 출결 상태 규칙."""
from datetime import date, datetime, timezone

from app.services.portal_excuse import (
    build_excuse_text, classify, desired_status, edit_deadline,
)

D = date(2026, 10, 7)  # 수요일 세션
UTC = timezone.utc


def test_pre_until_prev_day_2159_kst():
    assert classify(D, datetime(2026, 10, 6, 12, 59, 59, tzinfo=UTC)) == "PRE"


def test_post_one_second_after_pre_deadline():
    assert classify(D, datetime(2026, 10, 6, 13, 0, 0, tzinfo=UTC)) == "POST"


def test_post_until_next_day_2159_kst():
    assert classify(D, datetime(2026, 10, 8, 12, 59, 59, tzinfo=UTC)) == "POST"


def test_closed_after_post_deadline():
    assert classify(D, datetime(2026, 10, 8, 13, 0, 0, tzinfo=UTC)) is None


def test_closed_date_does_not_block_later_date():
    now = datetime(2026, 10, 8, 14, 0, 0, tzinfo=UTC)  # 10/8 23:00 KST
    assert classify(D, now) is None                     # 10/7 세션: 사후 마감 지남
    assert classify(date(2026, 10, 14), now) == "PRE"   # 다음 주 세션: 사전 가능


def test_edit_deadline():
    assert edit_deadline(D, "PRE") == datetime(2026, 10, 6, 12, 59, 59, tzinfo=UTC)
    assert edit_deadline(D, "POST") == datetime(2026, 10, 8, 12, 59, 59, tzinfo=UTC)


def test_status_preset_from_pending_or_present():
    assert desired_status("ABSENT", "NORMAL", None, "PENDING") == "ABSENT"
    assert desired_status("LATE", "NORMAL", None, "PRESENT") == "LATE_UNDER10"


def test_staff_set_status_is_not_overwritten():
    assert desired_status("LATE", "NORMAL", None, "LATE_OVER10") is None
    assert desired_status("ABSENT", "NORMAL", None, "EXCUSED") is None


def test_recognized_pending_stays_category():
    assert desired_status("ABSENT", "RECOGNIZED", "PENDING", "PENDING") == "ABSENT"


def test_recognized_approved_becomes_excused():
    assert desired_status("ABSENT", "RECOGNIZED", "APPROVED", "ABSENT") == "EXCUSED"


def test_rejected_reverts_excused():
    assert desired_status("ABSENT", "RECOGNIZED", "REJECTED", "EXCUSED") == "ABSENT"


def test_category_edit_replaces_our_previous_value():
    assert desired_status("ABSENT", "NORMAL", None, "LATE_UNDER10", prev_category="LATE") == "ABSENT"


def test_no_change_returns_none():
    assert desired_status("ABSENT", "NORMAL", None, "ABSENT") is None


def test_excuse_text_header():
    text = build_excuse_text(
        category="ABSENT", excuse_type="PRE", reason_kind="RECOGNIZED", review="PENDING",
        created_at=datetime(2026, 10, 5, 5, 3, tzinfo=UTC), reason="병원",
    )
    assert text == "[포털] 결석 · 사전 · 인정사유(승인 대기)\n제출 2026-10-05 14:03\n---\n병원"


def test_excuse_text_post_normal():
    text = build_excuse_text(
        category="LATE", excuse_type="POST", reason_kind="NORMAL", review=None,
        created_at=datetime(2026, 10, 7, 14, 0, tzinfo=UTC), reason="늦잠",
    )
    assert text == "[포털] 지각 · 사후 · 일반사유\n제출 2026-10-07 23:00\n---\n늦잠"
```

- [ ] **Step 2: 실패 확인**

Run: `docker cp backend/tests/test_portal_excuse.py ops-platform-backend-1:/app/tests/ && docker compose exec -T backend sh -c 'cd /app && python -m pytest tests/test_portal_excuse.py -q'`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.portal_excuse'`

- [ ] **Step 3: 구현** — `backend/app/services/portal_excuse.py` (순수 부분만)

```python
"""기수 포털 사유서 — 판정 규칙과 출결 반영.

마감(KST 21:59:59 = UTC 12:59:59): 사전 = 세션 전날, 사후 = 세션 다음날.
사후 마감이 지나면 제출 불가(classify 가 None).
"""
from datetime import date, datetime, time, timedelta, timezone

CATEGORY_STATUS = {"ABSENT": "ABSENT", "LATE": "LATE_UNDER10", "EARLY_LEAVE": "EARLY_LEAVE"}
CATEGORY_LABEL = {"ABSENT": "결석", "LATE": "지각", "EARLY_LEAVE": "조퇴"}
_REVIEW_LABEL = {"PENDING": "승인 대기", "APPROVED": "승인", "REJECTED": "반려"}
_KST = timezone(timedelta(hours=9))


def _deadline(d: date, offset_days: int) -> datetime:
    return datetime.combine(d + timedelta(days=offset_days), time(12, 59, 59), tzinfo=timezone.utc)


def edit_deadline(target_date: date, excuse_type: str) -> datetime:
    return _deadline(target_date, -1 if excuse_type == "PRE" else 1)


def classify(target_date: date, now: datetime) -> str | None:
    if now <= _deadline(target_date, -1):
        return "PRE"
    if now <= _deadline(target_date, 1):
        return "POST"
    return None


def desired_status(
    category: str, reason_kind: str, review: str | None, current: str,
    prev_category: str | None = None,
) -> str | None:
    """반영 후 출결 상태. None 이면 현재 값을 그대로 둔다(운영진이 직접 찍은 값 보호)."""
    target = "EXCUSED" if reason_kind == "RECOGNIZED" and review == "APPROVED" else CATEGORY_STATUS[category]
    ours = {"PENDING", "PRESENT", CATEGORY_STATUS[category]}
    if prev_category:
        ours.add(CATEGORY_STATUS[prev_category])
    if reason_kind == "RECOGNIZED":
        ours.add("EXCUSED")
    if current not in ours or current == target:
        return None
    return target


def build_excuse_text(
    *, category: str, excuse_type: str, reason_kind: str, review: str | None,
    created_at: datetime, reason: str,
) -> str:
    kind = f"인정사유({_REVIEW_LABEL[review]})" if reason_kind == "RECOGNIZED" else "일반사유"
    head = f"[포털] {CATEGORY_LABEL[category]} · {'사전' if excuse_type == 'PRE' else '사후'} · {kind}"
    sub = f"제출 {created_at.astimezone(_KST).strftime('%Y-%m-%d %H:%M')}"
    return f"{head}\n{sub}\n---\n{reason}"
```

- [ ] **Step 4: 통과 확인**

Run: `docker cp backend/app/services/portal_excuse.py ops-platform-backend-1:/app/app/services/ && docker compose exec -T backend sh -c 'cd /app && python -m pytest tests -q'`
Expected: 기존 24개 + 신규 15개 전부 PASS

- [ ] **Step 5: 커밋**

```bash
git add backend/app/services/portal_excuse.py backend/tests/test_portal_excuse.py
git commit -m "feat(사유서): 포털 사유서 사전/사후 판정·출결 상태 규칙"
```

---

### Task 2: 모델 + 마이그레이션

**Files:**
- Modify: `backend/app/models.py` (Attendance 클래스 뒤에 추가)
- Create: `backend/alembic/versions/d3e1a5b7c9f2_excuse_submissions.py`

**Interfaces:**
- Produces: `ExcuseSubmission` ORM (컬럼명은 스펙 표 그대로)

- [ ] **Step 1: 모델 추가** — `models.py` 의 `class Attendance` 블록 바로 뒤

```python
class ExcuseSubmission(Base):
    """기수 포털에서 낸 사유서. 세션이 없어도 날짜 기준으로 받아 두고, 세션이 생기면 연결한다."""
    __tablename__ = "excuse_submissions"

    id = Column(Integer, primary_key=True)
    cohort_id = Column(Integer, ForeignKey("cohorts.id"), nullable=False, index=True)
    member_id = Column(Integer, ForeignKey("members.id"), nullable=False, index=True)
    target_date = Column(Date, nullable=False)
    excuse_type = Column(String(10), nullable=False)
    category = Column(String(20), nullable=False)
    reason_kind = Column(String(20), nullable=False)
    reason = Column(Text, nullable=False)
    review = Column(String(20))
    reviewed_by = Column(String(100))
    reviewed_at = Column(TIMESTAMP(timezone=True))
    session_id = Column(Integer, ForeignKey("sessions.id", ondelete="SET NULL"), index=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("member_id", "target_date", name="uq_excuse_member_date"),
        CheckConstraint("excuse_type IN ('PRE','POST')", name="ck_excuse_sub_type"),
        CheckConstraint("category IN ('ABSENT','LATE','EARLY_LEAVE')", name="ck_excuse_sub_category"),
        CheckConstraint("reason_kind IN ('NORMAL','RECOGNIZED')", name="ck_excuse_sub_reason_kind"),
        CheckConstraint("review IN ('PENDING','APPROVED','REJECTED') OR review IS NULL", name="ck_excuse_sub_review"),
    )

    member = relationship("Member")
```

`Date` 가 models.py 상단 import 에 없으면 `from sqlalchemy import ...` 줄에 추가.

- [ ] **Step 2: 마이그레이션** — `backend/alembic/versions/d3e1a5b7c9f2_excuse_submissions.py`

```python
"""excuse_submissions

Revision ID: d3e1a5b7c9f2
Revises: c2d9f4a71b0e
"""
import sqlalchemy as sa
from alembic import op

revision = "d3e1a5b7c9f2"
down_revision = "c2d9f4a71b0e"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "excuse_submissions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("cohort_id", sa.Integer, sa.ForeignKey("cohorts.id"), nullable=False),
        sa.Column("member_id", sa.Integer, sa.ForeignKey("members.id"), nullable=False),
        sa.Column("target_date", sa.Date, nullable=False),
        sa.Column("excuse_type", sa.String(10), nullable=False),
        sa.Column("category", sa.String(20), nullable=False),
        sa.Column("reason_kind", sa.String(20), nullable=False),
        sa.Column("reason", sa.Text, nullable=False),
        sa.Column("review", sa.String(20)),
        sa.Column("reviewed_by", sa.String(100)),
        sa.Column("reviewed_at", sa.TIMESTAMP(timezone=True)),
        sa.Column("session_id", sa.Integer, sa.ForeignKey("sessions.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("member_id", "target_date", name="uq_excuse_member_date"),
        sa.CheckConstraint("excuse_type IN ('PRE','POST')", name="ck_excuse_sub_type"),
        sa.CheckConstraint("category IN ('ABSENT','LATE','EARLY_LEAVE')", name="ck_excuse_sub_category"),
        sa.CheckConstraint("reason_kind IN ('NORMAL','RECOGNIZED')", name="ck_excuse_sub_reason_kind"),
        sa.CheckConstraint("review IN ('PENDING','APPROVED','REJECTED') OR review IS NULL", name="ck_excuse_sub_review"),
    )
    op.create_index("ix_excuse_submissions_cohort_id", "excuse_submissions", ["cohort_id"])
    op.create_index("ix_excuse_submissions_member_id", "excuse_submissions", ["member_id"])
    op.create_index("ix_excuse_submissions_session_id", "excuse_submissions", ["session_id"])


def downgrade():
    op.drop_table("excuse_submissions")
```

- [ ] **Step 3: 적용 확인**

Run: `docker compose build backend && docker compose up -d backend && docker compose exec -T backend alembic upgrade head && docker compose exec -T backend alembic current`
Expected: `d3e1a5b7c9f2 (head)`

- [ ] **Step 4: 되돌리기 확인** — `alembic downgrade -1` 후 다시 `upgrade head`. 둘 다 에러 없음.

- [ ] **Step 5: 커밋**

```bash
git add backend/app/models.py backend/alembic/versions/d3e1a5b7c9f2_excuse_submissions.py
git commit -m "feat(사유서): excuse_submissions 테이블"
```

---

### Task 3: DB 반영 함수 + 세션 생성 연동

**Files:**
- Modify: `backend/app/services/portal_excuse.py` (하단에 추가)
- Modify: `backend/app/routers/sessions.py` — `create_session` 의 출결 생성 루프 뒤, `await db.commit()` 직전

**Interfaces:**
- Consumes: Task 1 순수 함수, Task 2 `ExcuseSubmission`
- Produces:
  - `async apply_submission(db, sub: ExcuseSubmission, prev_category: str | None = None) -> None` — 연결된 세션 찾고/연결하고 출결 반영. commit 안 함.
  - `async apply_all_for_session(db, session) -> int` — 세션 생성 직후 호출. commit 안 함.
  - `async detach_submission(db, sub: ExcuseSubmission) -> None` — 취소 시 출결 사유서 칸 비움. commit 안 함.

- [ ] **Step 1: 구현** — `portal_excuse.py` 하단

```python
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


async def _session_for(db: AsyncSession, sub):
    from app.models import Session as SessionModel
    if sub.session_id:
        return await db.get(SessionModel, sub.session_id)
    return (await db.execute(
        select(SessionModel).where(
            SessionModel.cohort_id == sub.cohort_id,
            SessionModel.date == sub.target_date,
        ).order_by(SessionModel.id).limit(1)
    )).scalar_one_or_none()


async def _attendance(db: AsyncSession, session_id: int, member_id: int):
    from app.models import Attendance
    return (await db.execute(
        select(Attendance).where(
            Attendance.session_id == session_id, Attendance.member_id == member_id,
        )
    )).scalar_one_or_none()


def _write(att, sub, prev_category: str | None) -> None:
    att.excuse_type = sub.excuse_type
    att.excuse_text = build_excuse_text(
        category=sub.category, excuse_type=sub.excuse_type, reason_kind=sub.reason_kind,
        review=sub.review, created_at=sub.created_at, reason=sub.reason,
    )
    new = desired_status(sub.category, sub.reason_kind, sub.review, att.status, prev_category)
    if new:
        att.status = new


async def apply_submission(db: AsyncSession, sub, prev_category: str | None = None) -> None:
    session = await _session_for(db, sub)
    if session is None:
        return
    sub.session_id = session.id
    if session.status == "FINALIZED":
        return
    att = await _attendance(db, session.id, sub.member_id)
    if att is not None:
        _write(att, sub, prev_category)


async def apply_all_for_session(db: AsyncSession, session) -> int:
    from app.models import ExcuseSubmission
    subs = (await db.execute(
        select(ExcuseSubmission).where(
            ExcuseSubmission.cohort_id == session.cohort_id,
            ExcuseSubmission.target_date == session.date,
            ExcuseSubmission.session_id.is_(None),
        )
    )).scalars().all()
    for sub in subs:
        sub.session_id = session.id
        att = await _attendance(db, session.id, sub.member_id)
        if att is not None:
            _write(att, sub, None)
    return len(subs)


async def detach_submission(db: AsyncSession, sub) -> None:
    if not sub.session_id:
        return
    session = await _session_for(db, sub)
    if session is None or session.status == "FINALIZED":
        return
    att = await _attendance(db, session.id, sub.member_id)
    if att is not None and (att.excuse_text or "").startswith("[포털]"):
        att.excuse_type = None
        att.excuse_text = None
```

`created_at` 은 server_default 라 insert 직후 None 일 수 있다 → 제출 라우터(Task 4)에서 `db.flush()` + `db.refresh(sub)` 후 `apply_submission` 호출.

- [ ] **Step 2: 세션 생성 연동** — `sessions.py` `create_session` 안, `for member in members:` 루프가 끝난 직후, `await db.commit()` 직전:

```python
        await db.flush()
        from app.services.portal_excuse import apply_all_for_session
        await apply_all_for_session(db, session)
```

- [ ] **Step 3: 테스트 재실행** — `python -m pytest tests -q` 전부 PASS (import 깨짐 없는지).

- [ ] **Step 4: 커밋**

```bash
git add backend/app/services/portal_excuse.py backend/app/routers/sessions.py
git commit -m "feat(사유서): 포털 사유서 출결 반영 + 세션 생성 시 자동 연결"
```

---

### Task 4: API (기수원 + 운영진)

**Files:**
- Create: `backend/app/routers/excuses.py`
- Modify: `backend/app/main.py` — import 목록과 `include_router` 목록

**Interfaces:**
- Consumes: Task 1·3 함수, `get_current_member`, `get_current_user`, `require_staff`, `get_current_cohort_id`, `get_db` (`app.deps`)
- Produces (프론트가 씀):
  - 기수원 `GET /api/v1/portal/excuses` → `ExcuseOut[]`
  - 기수원 `GET /api/v1/portal/excuses/preview?date=YYYY-MM-DD` → `{excuse_type: "PRE"|"POST"|null}`
  - 기수원 `POST /api/v1/portal/excuses` body `{target_date, category, reason_kind, reason}` → `ExcuseOut`
  - 기수원 `PUT /api/v1/portal/excuses/{id}` body `{category, reason_kind, reason}` → `ExcuseOut`
  - 기수원 `DELETE /api/v1/portal/excuses/{id}` → 204
  - 운영진 `GET /api/v1/excuses?session_id=` 또는 `?date_from=&date_to=` → `ExcuseOut[]`
  - 운영진 `POST /api/v1/excuses/{id}/review` body `{decision: "APPROVED"|"REJECTED"}` → `ExcuseOut`
  - `ExcuseOut` = `{id, member_id, member_name, target_date, excuse_type, category, reason_kind, reason, review, reviewed_by, reviewed_at, session_id, created_at, editable}`

- [ ] **Step 1: 라우터 작성** — `backend/app/routers/excuses.py`

```python
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
```

`_out` 목록에서 행마다 `_editable`/`db.get` 을 부른다. 기수 인원(~25명) × 날짜 몇 개 규모라 괜찮다.
`# ponytail: 행마다 세션 조회, 목록이 수백 건 넘으면 세션 status 를 join 으로 한 번에 가져올 것`

- [ ] **Step 2: 등록** — `main.py` 라우터 import 줄에 `excuses` 추가, `include_router` 목록 끝에:

```python
app.include_router(excuses.portal_router, prefix="/api/v1")
app.include_router(excuses.router, prefix="/api/v1")
```

- [ ] **Step 3: 재빌드 + curl 검증** (dev). 토큰은 기존 방식(dev 컨테이너 안에서 `create_access_token`)으로 기수원 2명·운영진 1명 발급.

```
# 1) 세션 없는 날짜로 제출 → 201, session_id null, excuse_type PRE
# 1-1) 사흘 전 날짜로 제출 → 422 '사후사유서 마감이 지난 날짜입니다'
# 2) 같은 날짜 재제출 → 409
# 3) 다른 기수원 토큰으로 PUT/DELETE 그 id → 404
# 4) 운영진 GET /excuses?date_from=... → 방금 건 보임, member_name 있음
# 5) 기존 PREP 세션 날짜로 제출 → session_id 채워짐, attendance.excuse_text 가 "[포털]" 로 시작
# 6) RECOGNIZED 제출 → review PENDING, 운영진 review APPROVED → attendance.status EXCUSED
# 7) REJECTED → status 가 category 상태로 돌아감
# 8) 기수원 DELETE → attendance.excuse_type/excuse_text NULL
```

각 단계 결과를 psql 로 확인. 끝나면 테스트 데이터 삭제.

- [ ] **Step 4: 세션 생성 연동 확인** — 새 날짜로 제출 → 운영진 `POST /sessions` 로 그 날짜 세션 생성 → 제출 `session_id` 채워지고 출결에 반영됨. 확인 후 테스트 세션·제출 삭제.

- [ ] **Step 5: 커밋**

```bash
git add backend/app/routers/excuses.py backend/app/main.py
git commit -m "feat(사유서): 기수원 사유서 제출·수정·취소 + 운영진 조회·공결 심사 API"
```

---

### Task 5: 기수 포털 — 사유서 제출 화면

**Files:**
- Create: `frontend/src/hooks/useExcuses.ts`
- Create: `frontend/src/pages/member/MemberExcuseSection.tsx`
- Modify: `frontend/src/pages/member/MemberAttendance.tsx` — 요약 카드 아래에 `<MemberExcuseSection />`

**Interfaces:**
- Consumes: Task 4 API
- Produces: `useExcuses.ts` 의 `Excuse` 타입, `useMyExcuses`, `useExcusePreview(date)`, `useStaffExcuses(params)`, `useReviewExcuse()`, 라벨 상수 `CATEGORY_LABEL`, `REVIEW_LABEL`

- [ ] **Step 1: 훅** — `frontend/src/hooks/useExcuses.ts`

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import memberApi from "@/lib/memberApi";

export interface Excuse {
    id: number;
    member_id: number;
    member_name: string;
    target_date: string;
    excuse_type: "PRE" | "POST";
    category: "ABSENT" | "LATE" | "EARLY_LEAVE";
    reason_kind: "NORMAL" | "RECOGNIZED";
    reason: string;
    review: "PENDING" | "APPROVED" | "REJECTED" | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
    session_id: number | null;
    created_at: string;
    editable: boolean;
}

export const CATEGORY_LABEL = { ABSENT: "결석", LATE: "지각", EARLY_LEAVE: "조퇴" } as const;
export const REVIEW_LABEL = { PENDING: "승인 대기", APPROVED: "공결 승인", REJECTED: "공결 반려" } as const;

export function useMyExcuses() {
    return useQuery({
        queryKey: ["member", "excuses"],
        queryFn: async () => (await memberApi.get<Excuse[]>("/portal/excuses")).data,
    });
}

export function useExcusePreview(date: string) {
    return useQuery({
        queryKey: ["member", "excuses", "preview", date],
        queryFn: async () =>
            (await memberApi.get<{ excuse_type: "PRE" | "POST" | null }>("/portal/excuses/preview", { params: { date } })).data,
        enabled: !!date,
    });
}

export function useStaffExcuses(params: { session_id?: number; date_from?: string; date_to?: string }) {
    return useQuery({
        queryKey: ["excuses", params],
        queryFn: async () => (await api.get<Excuse[]>("/excuses", { params })).data,
    });
}

export function useReviewExcuse() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, decision }: { id: number; decision: "APPROVED" | "REJECTED" }) =>
            (await api.post<Excuse>(`/excuses/${id}/review`, { decision })).data,
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["excuses"] });
            qc.invalidateQueries({ queryKey: ["sessions"] });
        },
    });
}
```

- [ ] **Step 2: 제출 섹션** — `MemberExcuseSection.tsx`. 구성:
  - "사유서 제출" 버튼 → 폼 펼침(Dialog 대신 인라인 카드, 모바일 우선).
  - 폼 필드: `<input type="date" min={minExcuseDate()}>`, 결석/지각/조퇴 3버튼 토글, 일반사유/인정사유 2버튼 토글, `<textarea maxLength={2000}>`.
  - 날짜 고르면 `useExcusePreview` 결과로 안내 한 줄:
    - PRE → "지금 내면 **사전사유서**로 접수됩니다."
    - POST → "사전 마감이 지나 **사후사유서**로 접수됩니다."
    - null(주소창 조작 등) → "사후사유서 마감이 지난 날짜입니다." + 제출 버튼 비활성
  - 인정사유 선택 시 안내: "인정사유는 운영진 승인 후 공결 처리됩니다."
  - 제출: `memberApi.post("/portal/excuses", ...)`, 성공 `toast.success("사유서를 제출했습니다.")`, 실패 `toast.error(detail)`. 성공 시 `["member","excuses"]`, `["member","attendance"]` invalidate.
  - 목록 "내 사유서": 카드마다 `M/D · 결석 · 사전 · 일반사유`, 상태 배지(세션 연결 전 "접수됨" / 연결 후 "반영됨" / 인정사유면 `REVIEW_LABEL[review]`), 사유 본문 2줄 말줄임.
  - `editable` 이면 수정(같은 폼 재사용, 날짜 필드 잠금 → PUT) / 취소(`confirm("이 사유서를 취소할까요?")` → DELETE).

`minExcuseDate()` 는 `MemberExcuseSection.tsx` 안에 둔다. 사후 마감(다음날 21:59:59 KST)이 아직 안 지난 가장 이른 날짜:

```ts
function minExcuseDate(): string {
    const kst = new Date(Date.now() + 9 * 3600_000); // UTC 필드가 곧 KST 시각
    const closed = kst.getUTCHours() * 60 + kst.getUTCMinutes() >= 22 * 60; // 22:00 부터 어제 날짜 사후 마감
    kst.setUTCDate(kst.getUTCDate() - (closed ? 0 : 1));
    return kst.toISOString().slice(0, 10);
}
```

- [ ] **Step 3: 붙이기** — `MemberAttendance.tsx` 요약 grid `</div>` 바로 뒤에 `<MemberExcuseSection />`.

- [ ] **Step 4: 타입 체크** — `cd frontend && npx tsc -b` → 에러 0.

- [ ] **Step 5: 브라우저 확인** (dev `http://localhost:5173/member/attendance`, 기수원 토큰 localStorage 주입) — 제출·목록·수정·취소 각 1회, 390px 폭에서 가로 스크롤 없음.

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/hooks/useExcuses.ts frontend/src/pages/member/MemberExcuseSection.tsx frontend/src/pages/member/MemberAttendance.tsx
git commit -m "feat(사유서): 기수 포털 사유서 제출·수정·취소 화면"
```

---

### Task 6: 운영진 — 대시보드 사유서 섹션 + 출결표 공결 요청 배지

**Files:**
- Create: `frontend/src/components/ExcuseInbox.tsx`
- Modify: `frontend/src/pages/Dashboard.tsx` — 위험 멤버 영역 위에 `<ExcuseInbox />`
- Modify: `frontend/src/pages/session/AttendanceGrid.tsx` — 사유서 칸

**Interfaces:**
- Consumes: Task 5 `useStaffExcuses`, `useReviewExcuse`, `Excuse`, `CATEGORY_LABEL`, `REVIEW_LABEL`

- [ ] **Step 1: `ExcuseInbox.tsx`**
  - 조회 범위: 오늘 −7일 ~ +30일 (`date_from`, `date_to` 를 `YYYY-MM-DD` 로).
  - 제목 "사유서" + 승인 대기 건수 배지(`review === "PENDING"` 개수, 0 이면 숨김).
  - 날짜별 그룹. 그룹 헤더 `10/7 (수)` + `session_id` 없으면 "세션 생성 전" 회색 배지.
  - 행: 이름 · 결석/지각/조퇴 · 사전/사후 · 일반/인정사유 · 상태. 행 클릭 시 사유 본문 펼침.
  - 인정사유 PENDING 행에 "승인" / "반려" 버튼 → `useReviewExcuse`. 성공 토스트 "공결을 승인했습니다." / "공결을 반려했습니다.", 실패 `toast.error(detail)`.
  - 목록 비면 "들어온 사유서가 없습니다." 한 줄.

- [ ] **Step 2: 대시보드에 배치** — `Dashboard.tsx` 렌더 영역 상단 카드들 사이, 위험 멤버 섹션 위.

- [ ] **Step 3: 출결표 배지** — `AttendanceGrid.tsx`
  - 상단에 `const { data: portalExcuses } = useStaffExcuses({ session_id: sessionId });` 와 `const pendingByMember = new Map((portalExcuses ?? []).filter(e => e.review === "PENDING").map(e => [e.member_id, e]));`
  - 사유서 칸의 클립보드 Popover 뒤에: `pendingByMember.get(member.member_id)` 있으면 주황 "공결 요청" 배지(Popover 트리거) → 안에 사유 본문 + 승인/반려 버튼(`useReviewExcuse`). 성공 시 `["sessions","detail",sessionId]` 도 invalidate(훅이 `["sessions"]` 전체를 이미 무효화함).
  - 모바일 행(`MobileRow`)의 사유서 영역에도 같은 배지.

- [ ] **Step 4: 타입 체크** — `npx tsc -b` 에러 0.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/components/ExcuseInbox.tsx frontend/src/pages/Dashboard.tsx frontend/src/pages/session/AttendanceGrid.tsx
git commit -m "feat(사유서): 대시보드 사유서 목록·공결 심사 + 출결표 공결 요청 배지"
```

---

### Task 7: 전체 흐름 검증

- [ ] **Step 1: 시나리오 (dev 브라우저, 기수원·운영진 탭 각각)**
  1. 기수원: 세션 없는 미래 날짜로 결석·인정사유 제출 → "사전사유서로 접수" 안내, 목록 "승인 대기".
  2. 운영진 대시보드: 해당 날짜 그룹 "세션 생성 전", 승인 대기 1.
  3. 운영진: 그 날짜로 세션 생성 → 출결표에서 그 기수원 결석, 사유서 "사전 통보", 클립보드에 `[포털] 결석 · 사전 · 인정사유(승인 대기)`, "공결 요청" 배지.
  4. 출결표에서 승인 → 출결 공결, 클립보드 헤더 `인정사유(승인)`.
  5. 기수원 화면: "공결 승인", 수정·취소 버튼 없음.
  6. 다른 기수원: 같은 세션 날짜로 지각·일반사유 제출 → 즉시 출결 지각(10분 미만) 반영.
- [ ] **Step 2: 테스트 데이터 정리** — 만든 세션·사유서 삭제, psql 로 0건 확인.
- [ ] **Step 3: `npm run build` 권한 문제 시 `npx tsc -b` 로 대체, 백엔드 `pytest tests -q` 전부 PASS.**
- [ ] **Step 4: 사용자에게 보고. push 는 요청 받을 때만.**
