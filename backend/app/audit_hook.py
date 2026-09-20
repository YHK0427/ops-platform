"""전역 감사 로그 훅 — SQLAlchemy Session에 after_flush 이벤트로 붙어서
insert/update/delete 되는 모든 모델(ORM 레벨 변경이면 전부, 라우터마다
따로 logger.audit() 호출을 심을 필요 없음)을 audit_logs 테이블에 자동 기록한다.

import만 되면 등록되는 구조라 app/main.py에서 한 번 import 한다.
"""
import decimal
import datetime
from sqlalchemy import event, insert
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import get_history

from app.audit_context import get_actor_label, get_actor_username, get_actor_role, get_actor_cohort_id, current_request_path

# 자기 자신과 접속 기록은 감사 대상에서 뺀다. access_logs 는 요청마다 쓰이므로
# 감사에 넣으면 기록 한 줄이 또 기록을 낳아 무한히 불어난다.
_EXCLUDED_TABLES = {"audit_logs", "access_logs"}
_REDACTED_FIELDS = {"password_hash", "totp_secret", "storage_json", "public_token", "token"}

# 테이블명 → 사람이 읽는 한국어 종류명. entity_label의 괄호 안에 붙는다.
_TABLE_LABELS_KO = {
    "cohorts": "기수", "users": "운영진계정", "generation_accounts": "기수원계정",
    "members": "멤버", "naver_sessions": "네이버세션", "sessions": "세션",
    "teams": "팀", "team_members": "팀원배정", "team_history": "팀이력",
    "team_building_boards": "팀빌딩보드", "assignments": "과제배정", "attendance": "출석",
    "ledger": "장부", "treasury_expenses": "금고지출", "cafe_posts": "카페게시글",
    "eval_rounds": "평가라운드", "eval_assignments": "평가배정", "eval_responses": "평가응답",
    "live_feedback_boards": "실시간피드백보드", "live_feedback_posts": "실시간피드백글",
    "live_feedback_reactions": "피드백반응", "live_feedback_comments": "피드백댓글",
    "live_feedback_anon_aliases": "익명별칭", "push_subscriptions": "푸시구독",
    "announcements": "공지", "announcement_reactions": "공지반응", "announcement_comments": "공지댓글",
    "scoring_rounds": "심사라운드", "scoring_areas": "심사영역", "scoring_criteria": "심사세부항목",
    "scoring_parts": "심사부", "scoring_targets": "심사대상", "scoring_roster": "심사명단",
    "scoring_participants": "심사참가자", "scoring_scores": "심사점수", "scoring_ranks": "심사순위",
    "scoring_comments": "심사총평", "scoring_deduction_rules": "감점규정", "scoring_deductions": "감점적용",
    "dev_feedback": "개발자요청",
    "auth_events": "로그인기록",
    "client_events": "클라이언트이벤트",
}


async def record_auth_event(
    db, operation: str, username: str, role: str | None, cohort_id: int | None,
    entity_label: str, request_path: str | None = None, ip: str | None = None,
) -> None:
    """로그인/로그아웃은 DB 모델 변경이 아니라 after_flush 훅에 안 잡힌다 —
    auth 라우터에서 직접 호출해서 audit_logs에 같이 남긴다."""
    from app.models import AuditLog
    label = f"{username}({role})" if role else username
    await db.execute(insert(AuditLog.__table__).values(
        actor_label=label, actor_username=username, actor_role=role, cohort_id=cohort_id,
        operation=operation, table_name="auth_events", row_id=username,
        entity_label=entity_label, changes={"ip": ip} if ip else None, request_path=request_path,
    ))
    await db.commit()


async def record_manual_event(
    db, operation: str, table_name: str, entity_label: str,
    row_id: str | None = None, owner_member_id: int | None = None,
    changes: dict | None = None, request_path: str | None = None,
) -> None:
    """Core insert()/update()/delete() 문(예: 대량 삭제)은 ORM 세션을 거치지 않아
    after_flush 훅에 안 잡힌다 — 그런 자리에서 직접 호출한다. 커밋은 호출부에서
    (보통 뒤이은 로직과 한 트랜잭션으로 묶여야 해서) 별도로 한다."""
    from app.models import AuditLog
    await db.execute(insert(AuditLog.__table__).values(
        actor_label=get_actor_label(), actor_username=get_actor_username(),
        actor_role=get_actor_role(), cohort_id=get_actor_cohort_id(),
        operation=operation, table_name=table_name, row_id=row_id,
        owner_member_id=owner_member_id, entity_label=entity_label,
        changes=changes, request_path=request_path or current_request_path.get(),
    ))

# 우선순위대로 훑어서 첫 번째로 값이 있는 필드를 사람이 읽을 이름으로 쓴다.
# (테이블마다 따로 매핑 안 만들어도 되게 — 실제 40개 테이블 컬럼 전수 조사 결과 이 순서면 전부 커버됨)
_LABEL_FIELD_PRIORITY = ["display_name", "name", "title", "label", "entered_name", "alias", "description", "reporter_display_name", "username"]
_LABEL_TEXT_FALLBACK = ["message", "content", "contents", "body"]  # 길 수 있어서 잘라서 씀
_LABEL_HINT_FALLBACK = ["type", "status", "emoji"]  # 이름 필드가 아예 없는 관계/로그성 테이블용 최후 힌트

# 이 필드들이 스냅샷에 있으면 "이 행이 어느 멤버에 대한 것인지"로 저장 — attendance/ledger처럼
# 이름 필드가 없는 테이블도 조회 시점(audit_log.py 라우터)에 멤버 이름으로 풀어서 보여줄 수 있다.
_MEMBER_OWNER_FIELD_PRIORITY = ["member_id", "presenter_member_id", "author_member_id", "matched_member_id", "member_a_id"]


def _owner_member_id(snapshot: dict) -> int | None:
    for field in _MEMBER_OWNER_FIELD_PRIORITY:
        val = snapshot.get(field)
        if val is not None:
            return int(val)
    return None


def _entity_label(table_name: str, snapshot: dict) -> str:
    kind = _TABLE_LABELS_KO.get(table_name, table_name)
    for field in _LABEL_FIELD_PRIORITY:
        val = snapshot.get(field)
        if val:
            return f"{val}({kind})"
    for field in _LABEL_TEXT_FALLBACK:
        val = snapshot.get(field)
        if val:
            text = str(val).strip().replace("\n", " ")
            if len(text) > 40:
                text = text[:40] + "..."
            return f"{text}({kind})"
    for field in _LABEL_HINT_FALLBACK:
        val = snapshot.get(field)
        if val:
            return f"{val} {kind}"
    pk = snapshot.get("id")
    return f"{kind}#{pk}" if pk is not None else kind


def _jsonable(value):
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    return str(value)


def _pk_value(obj) -> str | None:
    from sqlalchemy import inspect as sa_inspect
    try:
        state = sa_inspect(obj)
        pks = [state.attrs[col.key].value for col in state.mapper.primary_key]
        return ",".join(str(p) for p in pks if p is not None) or None
    except Exception:
        return None


def _snapshot(obj) -> dict:
    from sqlalchemy import inspect as sa_inspect
    mapper = sa_inspect(obj).mapper
    out = {}
    for col in mapper.columns:
        if col.key in _REDACTED_FIELDS:
            out[col.key] = "***"
            continue
        try:
            out[col.key] = _jsonable(getattr(obj, col.key, None))
        except Exception:
            pass
    return out


def _diff(obj) -> dict | None:
    from sqlalchemy import inspect as sa_inspect
    mapper = sa_inspect(obj).mapper
    changes = {}
    for col in mapper.columns:
        hist = get_history(obj, col.key)
        if not hist.has_changes():
            continue
        if col.key in _REDACTED_FIELDS:
            changes[col.key] = ["***", "***"]
            continue
        old = hist.deleted[0] if hist.deleted else None
        new = hist.added[0] if hist.added else getattr(obj, col.key, None)
        if old == new:
            continue
        changes[col.key] = [_jsonable(old), _jsonable(new)]
    return changes or None


@event.listens_for(Session, "after_flush")
def _record_audit_rows(session, flush_context) -> None:
    rows = []
    actor_label = get_actor_label()
    actor_username = get_actor_username()
    actor_role = get_actor_role()
    cohort_id = get_actor_cohort_id()
    request_path = current_request_path.get()

    for obj in session.new:
        table_name = getattr(obj, "__tablename__", None)
        if not table_name or table_name in _EXCLUDED_TABLES:
            continue
        snap = _snapshot(obj)
        rows.append({
            "actor_label": actor_label, "actor_username": actor_username, "actor_role": actor_role,
            "cohort_id": cohort_id, "operation": "INSERT", "table_name": table_name,
            "row_id": _pk_value(obj), "owner_member_id": _owner_member_id(snap),
            "entity_label": _entity_label(table_name, snap),
            "changes": snap, "request_path": request_path,
        })

    for obj in session.dirty:
        table_name = getattr(obj, "__tablename__", None)
        if not table_name or table_name in _EXCLUDED_TABLES:
            continue
        if not session.is_modified(obj, include_collections=False):
            continue
        changes = _diff(obj)
        if not changes:
            continue
        full_snap = _snapshot(obj)
        rows.append({
            "actor_label": actor_label, "actor_username": actor_username, "actor_role": actor_role,
            "cohort_id": cohort_id, "operation": "UPDATE", "table_name": table_name,
            "row_id": _pk_value(obj), "owner_member_id": _owner_member_id(full_snap),
            "entity_label": _entity_label(table_name, full_snap),
            "changes": changes, "request_path": request_path,
        })

    for obj in session.deleted:
        table_name = getattr(obj, "__tablename__", None)
        if not table_name or table_name in _EXCLUDED_TABLES:
            continue
        snap = _snapshot(obj)
        rows.append({
            "actor_label": actor_label, "actor_username": actor_username, "actor_role": actor_role,
            "cohort_id": cohort_id, "operation": "DELETE", "table_name": table_name,
            "row_id": _pk_value(obj), "owner_member_id": _owner_member_id(snap),
            "entity_label": _entity_label(table_name, snap),
            "changes": snap, "request_path": request_path,
        })

    if not rows:
        return

    from app.models import AuditLog
    session.execute(insert(AuditLog.__table__), rows)
