"""감사 로그 조회 — 전체 관리자(admin) 전용. app/audit_hook.py가 자동 기록한
audit_logs 테이블을 필터·페이지네이션해서 보여준다."""
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, func, desc, cast, Date
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, require_admin
from app.models import AuditLog, Member
from app.audit_hook import _TABLE_LABELS_KO

router = APIRouter(prefix="/audit-logs", tags=["audit-log"])


class AuditLogOut(BaseModel):
    id: int
    created_at: datetime
    actor_label: str
    actor_username: str | None
    actor_role: str | None
    cohort_id: int | None
    operation: str
    table_name: str
    row_id: str | None
    entity_label: str | None
    changes: dict | list | None
    request_path: str | None

    class Config:
        from_attributes = True


class TableOption(BaseModel):
    name: str
    label: str


class AuditLogPage(BaseModel):
    items: list[AuditLogOut]
    total: int


@router.get("", response_model=AuditLogPage)
async def list_audit_logs(
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(require_admin),
    actor_username: str | None = Query(None, description="행위자 아이디로 필터"),
    table_name: str | None = Query(None, description="테이블명으로 필터"),
    operation: str | None = Query(None, description="INSERT/UPDATE/DELETE로 필터"),
    cohort_id: int | None = Query(None, description="기수로 필터"),
    member_id: int | None = Query(None, description="영향받은 멤버로 필터(누구의 출석/장부 등이 바뀌었는지)"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    q = select(AuditLog)
    count_q = select(func.count()).select_from(AuditLog)
    if actor_username:
        q = q.where(AuditLog.actor_username == actor_username)
        count_q = count_q.where(AuditLog.actor_username == actor_username)
    if table_name:
        q = q.where(AuditLog.table_name == table_name)
        count_q = count_q.where(AuditLog.table_name == table_name)
    if operation:
        q = q.where(AuditLog.operation == operation.upper())
        count_q = count_q.where(AuditLog.operation == operation.upper())
    if cohort_id is not None:
        q = q.where(AuditLog.cohort_id == cohort_id)
        count_q = count_q.where(AuditLog.cohort_id == cohort_id)
    if member_id is not None:
        q = q.where(AuditLog.owner_member_id == member_id)
        count_q = count_q.where(AuditLog.owner_member_id == member_id)

    total = (await db.execute(count_q)).scalar_one()
    rows = (await db.execute(q.order_by(desc(AuditLog.id)).limit(limit).offset(offset))).scalars().all()

    # attendance/ledger처럼 이름 필드가 없는 테이블은 owner_member_id만 저장돼 있다 —
    # 이 페이지에 나온 멤버 id들만 한 번에 이름으로 풀어서 entity_label 앞에 붙여준다.
    member_ids = {r.owner_member_id for r in rows if r.owner_member_id is not None}
    member_names: dict[int, str] = {}
    if member_ids:
        member_rows = (await db.execute(select(Member.id, Member.name).where(Member.id.in_(member_ids)))).all()
        member_names = {mid: name for mid, name in member_rows}

    items = []
    for r in rows:
        label = r.entity_label
        if r.owner_member_id is not None:
            mname = member_names.get(r.owner_member_id, f"#{r.owner_member_id}")
            label = f"{mname} — {label}" if label else mname
        items.append(AuditLogOut(
            id=r.id, created_at=r.created_at, actor_label=r.actor_label,
            actor_username=r.actor_username, actor_role=r.actor_role, cohort_id=r.cohort_id,
            operation=r.operation, table_name=r.table_name, row_id=r.row_id,
            entity_label=label, changes=r.changes, request_path=r.request_path,
        ))
    return {"items": items, "total": total}


class DailyCount(BaseModel):
    date: date
    count: int


@router.get("/daily-counts", response_model=list[DailyCount])
async def daily_activity_counts(
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(require_admin),
    actor_username: str | None = Query(None),
    table_name: str | None = Query(None),
    operation: str | None = Query(None),
    cohort_id: int | None = Query(None),
    member_id: int | None = Query(None),
    days: int = Query(14, ge=1, le=90),
):
    """활동 로그 탭 그래프용 — 현재 필터 조건으로 최근 N일간 일별 건수.
    DB TimeZone은 UTC라 그냥 date로 캐스팅하면 하루 경계가 KST 09:00에 걸려
    자정~오전9시 활동이 전날 막대로 새는 문제가 생긴다 — KST로 변환 후 자른다."""
    day_col = cast(func.timezone("Asia/Seoul", AuditLog.created_at), Date)
    q = select(day_col.label("day"), func.count()).group_by(day_col).order_by(day_col)
    if actor_username:
        q = q.where(AuditLog.actor_username == actor_username)
    if table_name:
        q = q.where(AuditLog.table_name == table_name)
    if operation:
        q = q.where(AuditLog.operation == operation.upper())
    if cohort_id is not None:
        q = q.where(AuditLog.cohort_id == cohort_id)
    if member_id is not None:
        q = q.where(AuditLog.owner_member_id == member_id)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    q = q.where(AuditLog.created_at >= cutoff)

    rows = (await db.execute(q)).all()
    return [{"date": d, "count": c} for d, c in rows]


@router.get("/tables", response_model=list[TableOption])
async def list_audit_tables(
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    """필터 드롭다운용 — 실제로 로그가 남은 테이블만, 한국어 이름과 함께."""
    rows = (await db.execute(select(AuditLog.table_name).distinct())).scalars().all()
    options = [{"name": r, "label": _TABLE_LABELS_KO.get(r, r)} for r in rows]
    return sorted(options, key=lambda o: o["label"])
