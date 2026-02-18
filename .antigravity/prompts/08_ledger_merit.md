# Phase 08: Ledger API + 상점 부여 + 연속출석 감지
> 참조: `docs/spec_api.md`, `docs/spec_business_logic.md` (B-8)
> 모델: **claude-sonnet-4-5**
> 예상 소요: 1-2시간

---

## 작업 목표

Ledger 조회/수동 조정 API와 상점 부여 기능을 구현한다.
4회 연속 출석 자동 감지 서비스를 구현한다.

---

## 핵심 제약

### MERIT 상점 처리
```python
# POST /ledger/merit
# - total_plus_score += score_delta (양수)
# - amount_krw = 0 (디파짓 변동 없음)
# - Ledger type = 'MERIT'
# - deposit_after = 현재 current_deposit (변동 없음)
```

### 연속 출석 감지
```python
# FINALIZED 세션 최근 4개 기준
# 모두 status == "PRESENT" (지각/결석 전무)
# GET /members/streak-candidates → 조건 충족자 목록
# Admin이 [+2점 승인] 클릭 → POST /ledger/merit로 처리
```

### DEPOSIT_REFUND (멤버 비활성화 시)
```python
# DELETE /members/{id} 시:
# 1. member.is_active = false, deactivated_at = now()
# 2. Ledger(type="DEPOSIT_REFUND",
#           amount_krw=+member.current_deposit,  # 양수 (환불)
#           score_delta=0,
#           deposit_after=0)
# 3. member.current_deposit = 0
```

---

## 수행 작업 목록

1. **`backend/app/routers/ledger.py`**
   ```
   GET  /ledger              ?member_id=&type=&page=&limit=
   POST /ledger/merit        { member_ids[], reason, score_delta, custom_desc? }
   POST /ledger/transaction  { member_id, type, amount_krw, description }
   ```

2. **`backend/app/services/streak_checker.py`** (`docs/spec_business_logic.md` B-8 참조)
   - `check_attendance_streaks(db) -> list[dict]`
   - FINALIZED 최근 4세션 기준
   - 4개 세션 모두 PRESENT인 멤버 반환

3. **`backend/app/routers/members.py`** 업데이트
   - `GET /members/streak-candidates` → `streak_checker.check_attendance_streaks()` 호출

---

## 완료 조건

```bash
# 상점 부여
curl -X POST http://localhost:3000/api/v1/ledger/merit \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"member_ids":[1],"reason":"오늘의 피피티","score_delta":1}'
# → 200

# 부여 후 멤버 점수 확인
curl http://localhost:3000/api/v1/members/1 \
  -H "Authorization: Bearer $TOKEN"
# → total_plus_score 1 증가 확인

# Ledger 조회
curl "http://localhost:3000/api/v1/ledger?member_id=1" \
  -H "Authorization: Bearer $TOKEN"
# → [{type:"MERIT", score_delta:1, amount_krw:0, ...}]

# 연속출석 후보 (4세션 FINALIZED 후 테스트)
curl http://localhost:3000/api/v1/members/streak-candidates \
  -H "Authorization: Bearer $TOKEN"
```
