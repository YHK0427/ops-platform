# UnivPT Ops — 핵심 비즈니스 로직 (B-5, B-6, B-7, B-8)
> PenaltyEngine, Finalize 순서, 팀빌더, 연속출석 감지

## B-5. PenaltyEngine

```python
# services/penalty_engine.py

ATTENDANCE_MATRIX = {
    # (status, excuse_type): (score_delta, deposit_delta)
    ("LATE_UNDER10", "PRE"):  (-1, -2000),
    ("LATE_UNDER10", "POST"): (-1, -3000),
    ("LATE_UNDER10", None):   (-1, -4000),
    ("LATE_OVER10",  "PRE"):  (-2, -2000),
    ("LATE_OVER10",  "POST"): (-2, -3000),
    ("LATE_OVER10",  None):   (-2, -4000),
    ("EARLY_LEAVE",  "PRE"):  (-2, -2000),
    ("EARLY_LEAVE",  "POST"): (-2, -3000),
    ("EARLY_LEAVE",  None):   (-2, -4000),
    ("ABSENT",       "PRE"):  (-4, -4000),
    ("ABSENT",       "POST"): (-4, -6000),
    ("ABSENT",       None):   (-4, -8000),
    ("EXCUSED",      None):   (0,  0),
    ("PRESENT",      None):   (0,  0),
}

PPT_MATRIX = {
    "PASS":    (0, 0),
    "LATE":    (-1, -1000),
    "MISSING": (-2, -3000),
}

HOMEWORK_PENALTY = (-1, -1000)   # 셋 중 하나라도 MISSING

def _required_feedback(att_status: str, ppt_status: str) -> int:
    """피드백 필요 개수: OR 조건, 최대 2개"""
    is_absent = att_status in ("ABSENT", "EXCUSED")
    ppt_missing = ppt_status == "MISSING"
    return 2 if (is_absent or ppt_missing) else 1

class PenaltyEngine:
    async def calculate_all(self) -> list["PenaltyItem"]:
        penalties = []
        for member in await get_active_members(self.db):
            att     = await get_attendance(self.session.id, member.id, self.db)
            ppt     = await get_assignment(self.session.id, member.id, "PPT", self.db)
            review  = await get_assignment(self.session.id, member.id, "REVIEW", self.db)
            hw      = await get_assignment(self.session.id, member.id, "HOMEWORK", self.db)
            fb      = await get_assignment(self.session.id, member.id, "FEEDBACK", self.db)

            att_status   = att.status if att else "PRESENT"
            excuse_type  = att.excuse_type if att else None
            ppt_status   = ppt.status if ppt else "PASS"
            is_excused   = att_status == "EXCUSED"

            # 출결
            score_d, dep_d = ATTENDANCE_MATRIX.get((att_status, excuse_type), (0, 0))
            if score_d or dep_d:
                penalties.append(PenaltyItem("ATTENDANCE", member, score_d, dep_d,
                                             f"{att_status}/{excuse_type or '사유서없음'}"))

            # PPT (인정결석 면제)
            if not is_excused:
                score_d, dep_d = PPT_MATRIX.get(ppt_status, (0, 0))
                if score_d or dep_d:
                    penalties.append(PenaltyItem("PPT", member, score_d, dep_d,
                                                 f"PPT {ppt_status}"))

            # 과제/리뷰/피드백 통합
            any_hw_missing = any(
                a and a.status == "MISSING" for a in [review, hw, fb]
            )
            if any_hw_missing:
                penalties.append(PenaltyItem("HOMEWORK", member, *HOMEWORK_PENALTY,
                                             "과제/리뷰/피드백 미제출"))

        return penalties

    def check_milestone(self, member, session_score_delta: int) -> "PenaltyItem | None":
        """Finalize 시점에 호출. 이번 세션 벌점으로 경계를 넘는지 체크."""
        before = member.total_minus_score
        after  = before + session_score_delta  # session_score_delta < 0
        for threshold in [-10, -20, -30]:
            if before > threshold >= after:
                return PenaltyItem("MILESTONE_FINE", member, 0, -5000,
                                   f"누적벌점 {threshold}점 도달 추가 벌금")
        return None
```

---

## B-6. Finalize 로직 (순서 명확화)

```python
# 올바른 처리 순서 (순서가 틀리면 milestone 계산이 틀어짐)

async with db.begin():
    for p in penalties:
        if is_skipped(p, overrides): continue

        before_minus = p.member.total_minus_score  # ① 먼저 이전값 저장

        # ② 점수 업데이트
        if p.score_delta < 0:
            p.member.total_minus_score += p.score_delta    # 벌점
        elif p.score_delta > 0:
            p.member.total_plus_score  += p.score_delta    # 상점 (정산에서는 없지만 방어)

        # ③ 마일스톤 체크 (업데이트 후 비교)
        milestone = engine.check_milestone_after_update(
            before=before_minus, after=p.member.total_minus_score
        )
        if milestone:
            p.member.current_deposit += milestone.deposit_delta
            db.add(Ledger(type="MILESTONE_FINE", ...))

        # ④ 디파짓 차감
        p.member.current_deposit += p.deposit_delta

        # ⑤ Ledger 기록 (차감 후 잔액 스냅샷)
        db.add(Ledger(
            type="FINE",
            score_delta=p.score_delta,
            amount_krw=p.deposit_delta,
            deposit_after=p.member.current_deposit,
            ...
        ))
```

---

## B-7. 팀 빌더 알고리즘

```python
# services/team_builder.py

def build_teams(members: list, num_teams: int, history: list) -> list[list]:
    """
    1. 'leader' 태그 보유 멤버를 먼저 각 팀에 1명씩 배분
    2. 나머지를 net_score 내림차순 정렬
    3. Snake Draft로 배분
    4. collision_count 경고 (자동 교체 없음 → Admin이 드래그로 조정)
    """
    leaders = [m for m in members if "leader" in (m.tags or [])]
    others  = sorted([m for m in members if "leader" not in (m.tags or [])],
                     key=lambda m: m.net_score, reverse=True)

    teams = [[] for _ in range(num_teams)]
    for i, leader in enumerate(leaders):
        teams[i % num_teams].append(leader)

    direction, idx = 1, 0
    for member in others:
        teams[idx].append(member)
        nxt = idx + direction
        if nxt >= num_teams or nxt < 0:
            direction *= -1
            idx += direction
        else:
            idx = nxt

    return teams

def get_collision_warnings(teams: list[list], history: list) -> list[dict]:
    """같은 팀에 배정됐는데 과거에 2회 이상 같이 한 쌍 목록 반환 (UI 경고용)"""
    warnings = []
    for team in teams:
        ids = [m.id for m in team]
        for i in range(len(ids)):
            for j in range(i+1, len(ids)):
                a, b = min(ids[i],ids[j]), max(ids[i],ids[j])
                count = sum(1 for h in history if h.member_a_id==a and h.member_b_id==b)
                if count >= 2:
                    warnings.append({"member_a": ids[i], "member_b": ids[j], "count": count})
    return warnings
```

---

## B-8. 연속 출석 상점 자동 감지

```python
# services/streak_checker.py

async def check_attendance_streaks(db) -> list[dict]:
    """
    모든 활성 멤버 대상으로 직전 4주 연속 출석(지각/결석 전무) 체크.
    FINALIZED된 최근 4개 세션 기준.
    → 조건 충족자 목록 반환 (Admin이 [Approve] 버튼으로 상점 부여)
    """
    recent_4 = await db.execute(
        "SELECT id FROM sessions WHERE status='FINALIZED' ORDER BY week_num DESC LIMIT 4"
    )
    session_ids = [r.id for r in recent_4.fetchall()]
    if len(session_ids) < 4:
        return []

    candidates = []
    for member in await get_active_members(db):
        records = await db.execute(
            "SELECT status FROM attendance WHERE session_id=ANY(:ids) AND member_id=:mid",
            {"ids": session_ids, "mid": member.id}
        )
        statuses = [r.status for r in records.fetchall()]
        # 4개 세션 모두 PRESENT여야 함 (지각/결석 전무)
        if len(statuses) == 4 and all(s == "PRESENT" for s in statuses):
            candidates.append({"member": member, "sessions": session_ids})
    return candidates
```

**Dashboard에서 표시:**
```
┌──────────────────────────────────────────────────────┐
│  🏆 연속 출석 상점 대상자                             │
│  김민준 (4회 연속 출석) [+2점 승인] [무시]           │
│  이지은 (4회 연속 출석) [+2점 승인] [무시]           │
└──────────────────────────────────────────────────────┘
```

---

