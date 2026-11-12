from sqlalchemy import select, desc, or_
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import Session, Attendance, Member, Ledger

from app.services.penalty_rules import PenaltyRules, get_rules

# 상점 설명: "{N}주 연속 출석 달성 (주차들)". 이미 준 상점은 이 문구로 찾는다(N이 바뀌어도 잡히게 N 앞은 안 봄).
STREAK_REASON_MARK = "연속 출석 달성"


def _present_run(session_ids_newest_first: list[int], member_att: dict[int, str]) -> list[int]:
    """최신 세션부터 거꾸로 이어지는 출석(PRESENT) 세션들 — 다른 상태(미처리 포함)나 기록 없음에서 끊긴다."""
    run: list[int] = []
    for sid in session_ids_newest_first:
        if member_att.get(sid) != "PRESENT":
            break
        run.append(sid)
    return run


async def current_streaks(db: AsyncSession, cohort_id: int) -> dict[int, int]:
    """기수 활성 멤버별 지금 연속 출석 횟수 (마감된 세션 기준)."""
    return {mid: run for mid, (run, _) in (await current_streak_state(db, cohort_id)).items()}


async def current_streak_state(db: AsyncSession, cohort_id: int) -> dict[int, tuple[int, int]]:
    """기수 활성 멤버별 (지금 연속 출석 횟수, 그 연속 안에서 이미 받은 연속출석 상점 수). 멤버 탭 표시용.
    받은 수는 check_attendance_streaks 와 같은 기준(문구 + 지금 연속 구간의 세션)으로 센다."""
    session_ids = list((await db.execute(
        select(Session.id).where(Session.cohort_id == cohort_id, Session.status == "FINALIZED")
        .order_by(desc(Session.date), desc(Session.week_num))
    )).scalars().all())
    member_ids = (await db.execute(
        select(Member.id).where(Member.is_active == True, Member.cohort_id == cohort_id)  # noqa: E712
    )).scalars().all()
    att_map: dict[int, dict[int, str]] = {}
    if session_ids:
        for mid, sid, st in (await db.execute(
            select(Attendance.member_id, Attendance.session_id, Attendance.status)
            .where(Attendance.session_id.in_(session_ids))
        )).all():
            att_map.setdefault(mid, {})[sid] = st
    grants: dict[int, list[int | None]] = {}
    for mid, sid in (await db.execute(
        select(Ledger.member_id, Ledger.session_id).join(Member, Member.id == Ledger.member_id)
        .where(Member.cohort_id == cohort_id, Ledger.type == "MERIT", Ledger.description.contains(STREAK_REASON_MARK))
    )).all():
        grants.setdefault(mid, []).append(sid)
    out: dict[int, tuple[int, int]] = {}
    for mid in member_ids:
        run = set(_present_run(session_ids, att_map.get(mid, {})))
        out[mid] = (len(run), sum(1 for sid in grants.get(mid, []) if sid in run))
    return out


async def check_attendance_streaks(db: AsyncSession, current_session_id: int, rules: PenaltyRules | None = None):
    """
    해당 세션 기준으로 4회 연속 출석(PRESENT) 달성 멤버별 개별 merit 항목 반환.

    규칙:
    - 해당 세션 포함, FINALIZED 세션 + 현재 세션을 날짜 역순으로 확인
    - PRESENT: 카운팅 +1
    - 그 외 (EXCUSED, LATE, ABSENT 등): 스트릭 종료
    - 가능한 스트릭 = 연속 출석 수 // 4
    - 이미 부여된 스트릭 수(현재 연속 구간 내)를 차감
      → 8주 연속 출석 시 4주차에 1번, 8주차에 또 1번 = 총 2번 스트릭

    반환: {"merit_items": [{member_id, member_name, score_delta, description}]}
    """
    # 0. 현재 세션의 기수 — 스트릭 계산은 같은 기수 내에서만 (타 기수 출석/멤버 격리)
    cur_session = await db.get(Session, current_session_id)
    if not cur_session:
        return {"merit_items": [], "session_id": current_session_id}
    cohort_id = cur_session.cohort_id
    if rules is None:
        rules = await get_rules(db, cohort_id)
    STREAK_COUNT, STREAK_SCORE = rules.streak_count, rules.streak_score
    if STREAK_SCORE <= 0:
        return {"merit_items": [], "session_id": current_session_id}

    # 1. 현재 세션 포함 + FINALIZED 세션을 날짜 역순으로 조회 (id + week_num) — 같은 기수만
    stmt_sessions = (
        select(Session.id, Session.week_num)
        .where(
            Session.cohort_id == cohort_id,
            or_(
                Session.status == "FINALIZED",
                Session.id == current_session_id,
            ),
        )
        .order_by(desc(Session.date), desc(Session.week_num))
    )
    result = await db.execute(stmt_sessions)
    session_rows = list(result.all())

    session_ids = [r.id for r in session_rows]
    # session_id -> week_num 매핑
    week_num_map: dict[int, int] = {r.id: r.week_num for r in session_rows}

    if len(session_ids) < STREAK_COUNT:
        return {"merit_items": [], "session_id": current_session_id}

    # 2. 활성 멤버 조회 — 같은 기수만
    stmt_members = select(Member).where(Member.is_active == True, Member.cohort_id == cohort_id)  # noqa: E712
    result = await db.execute(stmt_members)
    members = result.scalars().all()

    # 3. 출석 데이터 조회
    stmt_att = select(Attendance).where(Attendance.session_id.in_(session_ids))
    result = await db.execute(stmt_att)
    att_map: dict[int, dict[int, str]] = {}
    for a in result.scalars().all():
        att_map.setdefault(a.member_id, {})[a.session_id] = a.status

    # 4. 멤버별 스트릭 상점 부여 기록 조회 (prefix match) — 같은 기수 멤버로 한정
    #    (기수 필터 없으면 전체 Ledger를 LIKE로 풀스캔하게 됨)
    stmt_grants = (
        select(Ledger.member_id, Ledger.session_id, Ledger.description)
        .join(Member, Member.id == Ledger.member_id)
        .where(
            Member.cohort_id == cohort_id,
            Ledger.type == "MERIT",
            Ledger.description.contains(STREAK_REASON_MARK),
        )
    )
    result = await db.execute(stmt_grants)
    # member_id -> list of (session_id, description)
    grant_list: dict[int, list[tuple[int | None, str]]] = {}
    for row in result:
        grant_list.setdefault(row.member_id, []).append(
            (row.session_id, row.description)
        )

    # 5. 스트릭 판정 → 개별 merit 항목 생성
    merit_items = []
    for member in members:
        # 최신순으로 연속 출석 카운팅 (PRESENT만 카운트, 나머지로 중단)
        run_sessions = _present_run(session_ids, att_map.get(member.id, {}))  # 최신순
        present_count = len(run_sessions)

        possible_streaks = present_count // STREAK_COUNT

        # 현재 연속 구간에 속하는 기존 부여만 카운팅
        member_grants = grant_list.get(member.id, [])
        run_sessions_set = set(run_sessions)
        grants_in_run = sum(
            1 for gs, _ in member_grants if gs in run_sessions_set
        )

        new_streaks = possible_streaks - grants_in_run
        if new_streaks <= 0:
            continue

        # oldest-first 정렬 (run_sessions는 최신순이므로 역순)
        run_sessions_oldest_first = list(reversed(run_sessions))

        # 각 미부여 스트릭마다 개별 항목 생성
        for i in range(grants_in_run, possible_streaks):
            # i번째 스트릭 = (i*4) ~ (i*4+3) 인덱스의 PRESENT 세션
            start_idx = i * STREAK_COUNT
            end_idx = start_idx + STREAK_COUNT
            streak_session_ids = run_sessions_oldest_first[start_idx:end_idx]
            streak_weeks = [week_num_map[sid] for sid in streak_session_ids]
            weeks_str = ",".join(str(w) for w in streak_weeks)

            merit_items.append({
                "member_id": member.id,
                "member_name": member.name,
                "score_delta": STREAK_SCORE,
                "description": f"{STREAK_COUNT}주 {STREAK_REASON_MARK} ({weeks_str})",
            })

    return {"merit_items": merit_items, "session_id": current_session_id}
