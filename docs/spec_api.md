# UnivPT Ops — API 엔드포인트 명세 (B-3)

## B-3. API 엔드포인트

Base URL: `/api/v1`

### Auth
```
POST   /auth/login           { username, password } → { access_token, token_type }
POST   /auth/refresh         → { access_token }
DELETE /auth/logout
```

### Members
```
GET    /members                    → Member[]
POST   /members                    { name, name_initial?, email?, tags[] }
GET    /members/{id}               → Member + Stats
PATCH  /members/{id}               { name?, name_initial?, email?, tags[]? }
DELETE /members/{id}               → Soft delete (is_active=false)
GET    /members/{id}/ledger        → LedgerEntry[] (페이지네이션)
GET    /members/streak-candidates  → Member[] (4회 연속 출석 조건 충족자)
```

### Sessions
```
GET    /sessions                           → Session[]
POST   /sessions                           { week_num, title, date, type, config }
GET    /sessions/{id}                      → Session (title 포함) + Teams + summary
DELETE /sessions/{id}                      → SETUP 상태에서만 가능
PATCH  /sessions/{id}/status               { status }  ← 상태 머신 전환

# 팀 구성 (TEAM 세션만)
POST   /sessions/{id}/teams/generate       { num_teams } → Team[]
PATCH  /sessions/{id}/teams                { teams: [{name, member_ids[]}] }

# 출결
GET    /sessions/{id}/attendance                   → Attendance[]
PATCH  /sessions/{id}/attendance/{mid}             { status, excuse_type?, excuse_text? }
# 가드 1: session.date + 1일 22:00 이후 excuse_type 변경 시 → 422 "사후사유서 마감"
#          (단, FINALIZED 상태면 Admin 강제 수정 허용 + ADJUSTMENT ledger 자동 생성)
# 가드 2: FINALIZED 상태에서 status 변경 시 → 변경분만큼 ledger ADJUSTMENT 자동 생성
PATCH  /sessions/{id}/attendance/{mid}/force       { status, excuse_type?, excuse_text?, reason }
# FINALIZED 후 비상 수정 전용 엔드포인트. reason 필수. ADJUSTMENT ledger 자동 기록.

# PPT (스캔)
GET    /sessions/{id}/assignments?type=PPT → Assignment[]
PATCH  /sessions/{id}/assignments/{id}     { status }  ← 수동 수정
```

### Crawler
```
GET    /crawler/naver/session-status  → { is_valid, validated_at, expires_hint }
POST   /crawler/naver/import          { storage_json }  ← 로컬 PC에서 생성한 세션 import
POST   /crawler/scan-ppt              { session_id, mode: 'regular'|'late' } → { task_id }
POST   /crawler/scan-homework         { session_id } → { task_id }
POST   /crawler/upload-videos         { session_id } → { task_id }
GET    /crawler/task/{task_id}        → { status, result?, error?, progress? }
```

> **로그인 전략:** 홈서버에서 headless=False 브라우저 띄우기 어려우므로,
> 로컬 PC에서 `python login_helper.py` 실행 → storage_state.json 생성 → 
> `POST /crawler/naver/import`로 DB에 저장하는 방식 권장

### Ledger
```
GET    /ledger           ?member_id=&type=&page=&limit=  → LedgerEntry[]
POST   /ledger/merit     { member_ids[], reason, score_delta, custom_desc? }
POST   /ledger/transaction { member_id, type, amount_krw, description }
```

### Settlement
```
GET    /sessions/{id}/settlement-preview  → PenaltySummary[]
POST   /sessions/{id}/finalize            { overrides?: [{member_id, skip_types: string[]}] }
```

---

