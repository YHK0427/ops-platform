# Phase 03: Members + Sessions CRUD
> 참조: `docs/spec_api.md`, `docs/spec_schema.md`
> 모델: **claude-sonnet-4-5**
> 예상 소요: 2시간

---

## 작업 목표

Members와 Sessions의 CRUD API를 구현한다.
Sessions는 상태 머신 전환 규칙을 엄수한다.

---

## 핵심 제약

```
Members:
- tags는 TEXT[] 배열. GET 응답에 포함.
- DELETE는 soft delete (is_active=false, deactivated_at=now())
- 비활성화 시 current_deposit을 0으로, DEPOSIT_REFUND ledger 자동 생성
- GET /members 기본은 is_active=true만 반환, ?include_inactive=true 시 전체

Sessions 상태 머신 (이 순서만 허용):
SETUP → PREP → OPS → POST → SETTLEMENT → FINALIZED
- FINALIZED에서 다른 상태로 역행 불가
- DELETE는 SETUP 상태에서만 허용

Session 생성 시 자동 처리:
- TEAM 타입: SETUP으로 생성 (팀 구성 후 PREP으로 전환)
- INDIVIDUAL 타입: SETUP으로 생성
- 생성 시 모든 활성 멤버에 대해 attendance 레코드 자동 생성 (status=PENDING)

Session title:
- VARCHAR(100) NOT NULL
- 영상 게시글 제목에 사용됨
```

---

## 수행 작업 목록

1. **`backend/app/schemas/member.py`**
   - `MemberCreate`, `MemberUpdate`, `MemberResponse` (tags 포함)
   - `MemberResponse`에 ScoreInfo 내장 (total_plus, total_minus, net, current_deposit)

2. **`backend/app/routers/members.py`**
   ```
   GET    /members                    ?include_inactive=false
   POST   /members                    { name, name_initial?, email?, tags[] }
   GET    /members/{id}               → Member + 최근 Ledger 5개
   PATCH  /members/{id}
   DELETE /members/{id}               → soft delete + DEPOSIT_REFUND ledger 자동 생성
   GET    /members/{id}/ledger        ?page=1&limit=20
   GET    /members/streak-candidates  → 4회 연속 출석 대상자
   ```

3. **`backend/app/schemas/session.py`**
   - `SessionCreate` (week_num, title, date, type, config)
   - `SessionResponse` (전체 필드 + 현재 상태)

4. **`backend/app/routers/sessions.py`**
   ```
   GET    /sessions
   POST   /sessions                   → 생성 + 전체 멤버 attendance 자동 생성
   GET    /sessions/{id}
   DELETE /sessions/{id}              SETUP 상태에서만 허용, 아니면 400
   PATCH  /sessions/{id}/status       상태 머신 전환 규칙 검증
   ```

5. **`backend/app/main.py`** 라우터 등록 업데이트

---

## 완료 조건

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"yourpassword"}' | jq -r .access_token)

# 멤버 생성
curl -X POST http://localhost:3000/api/v1/members \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"김민준","tags":["leader","frontend"]}'
# → {"id":1,"name":"김민준","tags":["leader","frontend"],...}

# 세션 생성
curl -X POST http://localhost:3000/api/v1/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"week_num":20,"title":"개인발표세션","date":"2024-05-18","type":"INDIVIDUAL"}'
# → {"id":1,"week_num":20,"title":"개인발표세션","status":"SETUP",...}

# attendance 자동 생성 확인
curl http://localhost:3000/api/v1/sessions/1/attendance \
  -H "Authorization: Bearer $TOKEN"
# → [{member_id:1, status:"PENDING"}, ...]
```
