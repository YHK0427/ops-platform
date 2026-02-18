# Phase 04: 출결 API + 팀빌딩
> 참조: `docs/spec_api.md`, `docs/spec_business_logic.md` (B-7)
> 모델: **claude-sonnet-4-5**
> 예상 소요: 2-3시간

---

## 작업 목표

출결 처리 API (마감 가드 포함)와 팀빌딩 API를 구현한다.

---

## 핵심 제약

### 출결 마감 가드
```python
# PATCH /sessions/{id}/attendance/{mid} 에서:
from datetime import datetime, timedelta, timezone

session_date = session.date  # 토요일
deadline = datetime.combine(session_date + timedelta(days=1),
                             datetime.strptime("21:59:59", "%H:%M:%S").time()
                             ).replace(tzinfo=timezone.utc)
# 일요일 21:59:59 UTC

if "excuse_type" in payload and datetime.now(timezone.utc) > deadline:
    if session.status != "FINALIZED":
        raise HTTPException(422, "사후사유서 마감 (일요일 21:59:59 초과)")
    # FINALIZED면 통과 허용 + ADJUSTMENT ledger 자동 생성
```

### FINALIZED 후 수정
```python
# PATCH /sessions/{id}/attendance/{mid}/force
# - reason 파라미터 필수
# - 변경 전후 차이를 ledger ADJUSTMENT 타입으로 자동 기록
# - deposit_after는 현재 member.current_deposit 스냅샷
```

### 팀빌딩 제약
```python
# POST /sessions/{id}/teams/generate
# - session.type == 'INDIVIDUAL' 이면 400 에러
# - "leader" in member.tags 로 리더 분리
# - Snake Draft: 리더 먼저 각 팀에 1명씩 → 나머지 net_score 내림차순으로 배분

# PATCH /sessions/{id}/teams (확정)
# - SETUP 상태에서만 허용
# - DB: teams + team_members INSERT
# - session status: SETUP → PREP 자동 전환
# - assignments 자동 생성:
#   PPT: team_id 있음 (TEAM 세션 팀 단위)
#   REVIEW, HOMEWORK, FEEDBACK: team_id NULL (개인 단위)
```

---

## 수행 작업 목록

1. **`backend/app/routers/sessions.py`** 추가

   출결:
   ```
   GET    /sessions/{id}/attendance
   PATCH  /sessions/{id}/attendance/{mid}    { status?, excuse_type?, excuse_text? }
   PATCH  /sessions/{id}/attendance/{mid}/force  { status?, excuse_type?, excuse_text?, reason }
   ```

   팀빌딩:
   ```
   POST   /sessions/{id}/teams/generate     { num_teams: int }
   PATCH  /sessions/{id}/teams              { teams: [{name, member_ids[]}] }
   ```

2. **`backend/app/services/team_builder.py`**
   - `build_teams(members, num_teams, history) -> list[list[Member]]`
   - `get_collision_warnings(teams, history) -> list[dict]`
   - Snake Draft 알고리즘 (`docs/spec_business_logic.md` B-7 참조)

---

## 완료 조건

```bash
# 출결 업데이트
curl -X PATCH http://localhost:3000/api/v1/sessions/1/attendance/1 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"LATE_UNDER10"}'
# → 200

# 마감 후 excuse_type 변경 시도 (날짜 조작 필요, 또는 단위 테스트로 확인)
# → 422 "사후사유서 마감"

# TEAM 세션 팀 자동 생성
# (먼저 TEAM 타입 세션 생성 필요)
curl -X POST http://localhost:3000/api/v1/sessions/2/teams/generate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"num_teams": 3}'
# → [{name:"Team A", members:[...]}, ...]

# INDIVIDUAL 세션에 팀 생성 시도
curl -X POST http://localhost:3000/api/v1/sessions/1/teams/generate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"num_teams": 3}'
# → 400 "INDIVIDUAL 세션에는 팀빌딩 불가"
```
