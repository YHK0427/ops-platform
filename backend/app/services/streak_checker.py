from sqlalchemy import select, desc, or_
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import Session, Attendance, Member, Ledger

STREAK_REASON_PREFIX = "4주 연속 출석 달성"
STREAK_COUNT = 4
STREAK_SCORE = 2


async def check_attendance_streaks(db: AsyncSession, current_session_id: int):
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

    # 4. 멤버별 스트릭 상점 부여 기록 전체 조회 (prefix match)
    stmt_grants = (
        select(Ledger.member_id, Ledger.session_id, Ledger.description)
        .where(
            Ledger.type == "MERIT",
            Ledger.description.startswith(STREAK_REASON_PREFIX),
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
        member_att = att_map.get(member.id, {})
        present_count = 0
        run_sessions: list[int] = []  # oldest-first로 재정렬할 PRESENT 세션들

        # 최신순으로 연속 출석 카운팅 (PRESENT만 카운트, 나머지로 중단)
        for sid in session_ids:
            status = member_att.get(sid)
            if status == "PRESENT":
                present_count += 1
                run_sessions.append(sid)
            else:
                break

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
                "description": f"{STREAK_REASON_PREFIX} ({weeks_str})",
            })

    return {"merit_items": merit_items, "session_id": current_session_id}
