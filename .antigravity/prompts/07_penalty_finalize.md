# Phase 07: 과제 스캔 + PenaltyEngine + Finalize
> 참조: `docs/spec_business_logic.md`, `docs/spec_crawler.md`, `docs/spec_schema.md` (페널티 매트릭스)
> 모델: **claude-opus-4-5** ← Finalize 순서 로직이 치명적, Opus로 정확하게
> 예상 소요: 3-4시간

---

## 작업 목표

과제 스캔, 페널티 계산 엔진, Finalize 처리를 구현한다.
**Finalize 처리 순서가 틀리면 milestone 계산이 틀어진다. 순서 절대 준수.**

---

## 핵심 제약

### 페널티 매트릭스 (docs/spec_schema.md B-2 그대로 구현)
```python
ATTENDANCE_MATRIX = {
    ("LATE_UNDER10", "PRE"):  (-1, -2000),
    ("LATE_UNDER10", "POST"): (-1, -3000),
    ("LATE_UNDER10", None):   (-1, -4000),
    ("LATE_OVER10",  "PRE"):  (-2, -2000),
    # ... 전체 매트릭스 spec_schema.md 참조
}

PPT_MATRIX = {
    "PASS":    (0, 0),
    "LATE":    (-1, -1000),
    "MISSING": (-2, -3000),
}

HW_PENALTY = (-1, -1000)  # 셋 중 하나라도 MISSING이면 동일
```

### Finalize 처리 순서 (절대 변경 금지)
```python
for p in active_penalties:
    # ① before 저장
    before_minus = member.total_minus_score

    # ② 점수 업데이트
    if p.score_delta < 0:
        member.total_minus_score += p.score_delta
    elif p.score_delta > 0:
        member.total_plus_score += p.score_delta
    # net_score는 트리거가 자동 계산

    # ③ milestone 체크 (업데이트 후 비교)
    milestone = check_milestone(before_minus, member.total_minus_score)
    if milestone:
        member.current_deposit -= 5000
        db.add(Ledger(type="MILESTONE_FINE", amount_krw=-5000, score_delta=0, ...))

    # ④ 디파짓 차감
    member.current_deposit += p.deposit_delta

    # ⑤ Ledger 기록 (차감 후 잔액 스냅샷)
    db.add(Ledger(type="FINE", deposit_after=member.current_deposit, ...))
```

### Milestone 체크 로직
```python
def check_milestone(before: int, after: int) -> bool:
    # before > -10 >= after → milestone
    # before > -20 >= after → milestone
    # before > -30 >= after → milestone
    for threshold in [-10, -20, -30]:
        if before > threshold >= after:
            return True
    return False
```

### 피드백 필요 개수
```python
def required_feedback_count(att_status, ppt_status):
    is_absent = att_status in ("ABSENT", "EXCUSED")
    ppt_missing = ppt_status == "MISSING"
    return 2 if (is_absent or ppt_missing) else 1
# 결석 + PPT 미제출 = 2 (누적 아님, OR 조건)
```

### 과제 패널티 (비누적)
```python
any_missing = any(a.status == "MISSING" for a in [review, homework, feedback])
if any_missing:
    penalties.append((-1, -1000, "과제 미제출"))
# 셋 모두 미제출이어도 동일하게 -1점, -1000원
```

---

## 수행 작업 목록

1. **`backend/app/services/crawler_homework.py`**
   - `scan_homework_all(req_session, week, session_id, attendance_map, members, db)`
   - 게시판 전체 한 번에 수집 → 이름 파싱으로 일괄 매핑 (멤버별 개별 호출 금지)
   - `upsert_assignment(session_id, member_id, type, status, db)`

2. **`backend/app/services/penalty_engine.py`** (`docs/spec_business_logic.md` B-5 참조)
   - `ATTENDANCE_MATRIX`, `PPT_MATRIX`, `HW_PENALTY` 정의
   - `calculate_penalties(session, attendances, assignments) -> list[PenaltyItem]`
   - `check_milestone(before, after) -> bool`

3. **`backend/app/services/finalize.py`** (`docs/spec_business_logic.md` B-6 참조)
   - `finalize_session(session_id, overrides, db)` — 위 순서 엄수
   - overrides: `[{member_id, skip_types: [str]}]` — 면제 처리
   - TEAM 세션: finalize 후 team_history INSERT
   - session.status → FINALIZED, finalized_at = now()

4. **`backend/app/routers/sessions.py`** 추가
   ```
   GET    /sessions/{id}/settlement-preview  → PenaltySummary[]
   POST   /sessions/{id}/finalize            { overrides? }
   PATCH  /sessions/{id}/assignments/{id}    { status }  ← 수동 수정
   ```

5. **`backend/app/worker.py`** 업데이트
   - `task_scan_homework` 함수 구현

6. **`backend/app/routers/crawler.py`** 업데이트
   ```
   POST /crawler/scan-homework   { session_id } → { task_id }
   ```

---

## 완료 조건

```bash
# settlement preview
curl http://localhost:3000/api/v1/sessions/1/settlement-preview \
  -H "Authorization: Bearer $TOKEN"
# → [{member_id, member_name, lines:[{type, description, score_delta, deposit_delta}], total_score, total_deposit}]

# finalize (면제 없이)
curl -X POST http://localhost:3000/api/v1/sessions/1/finalize \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
# → {"status": "ok", "finalized_at": "..."}

# finalize 후 재시도 → 400
curl -X POST http://localhost:3000/api/v1/sessions/1/finalize \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
# → 400 "이미 정산 완료된 세션"

# milestone 단위 테스트:
# before=-9, after=-11 → milestone True
# before=-11, after=-12 → milestone False (이미 지남)
# before=-19, after=-21 → milestone True
```
