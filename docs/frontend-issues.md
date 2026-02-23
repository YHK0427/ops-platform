# 프론트엔드 문제점 & 개선사항 분석

> 작성일: 2026-02-20
> 분석 기준: 백엔드 커밋 `841a6e7` + 버그픽스 세션 (BUG-01~11 수정 후)
> 분석 파일 수: 프론트엔드 src 전체 (~30개 파일)

---

## 요약

| 심각도 | 건수 | 핵심 내용 |
|--------|------|-----------|
| 🔴 Critical | 3 | 상태 enum 불일치, StatusBadge 누락, 팀장 미지정 |
| 🟠 High | 6 | 잘못된 필터 로직, 탭 접근 제한 없음, Snake Draft 미사용 등 |
| 🟡 Medium | 4 | PPT Assignment 조회 불가, 없는 라우트, 설계 불일치 |
| 🟢 Low | 5 | 타입 안전성, 캐시 전략, 미구현 UI 등 |

---

## 🔴 Critical

### ISSUE-01: Session status enum — SETUP 누락, 유령 값 다수

**파일:** `src/hooks/useSessions.ts:11`

```typescript
// 현재 (잘못됨)
status: "SCHEDULED" | "PREP" | "OPS" | "POST" | "SETTLEMENT" | "finalized_pending" | "FINALIZED" | "CANCELLED" | "IN_PROGRESS";

// 백엔드 실제 허용값 (SessionStatusUpdate pattern)
status: "SETUP" | "PREP" | "OPS" | "POST" | "SETTLEMENT" | "FINALIZED";
```

**영향:**
- `SETUP` 상태인 세션이 올바른 타입으로 인식되지 않음
- `finalized_pending`, `SCHEDULED`, `CANCELLED`, `IN_PROGRESS`는 백엔드에 존재하지 않음
- `useCurrentSession()`에서 `"IN_PROGRESS"` 필터가 영원히 false → 현재 세션을 못 찾을 수 있음

**수정:**
```typescript
status: "SETUP" | "PREP" | "OPS" | "POST" | "SETTLEMENT" | "FINALIZED";
```

---

### ISSUE-02: StatusBadge — 실제 세션 상태 레이블 전혀 없음

**파일:** `src/components/StatusBadge.tsx:16`

```typescript
// 현재 (잘못됨)
type SessionStatus = "SCHEDULED" | "IN_PROGRESS" | "FINALIZED" | "CANCELLED";

// STATUS_LABEL에도 없음
// SETUP, PREP, OPS, POST, SETTLEMENT → 정의 없음
```

**영향:** 세션 목록(`/sessions`), 대시보드, 세션 상세 헤더에서 상태 뱃지가 공백 또는 undefined 표시

**수정:**
```typescript
type SessionStatus = "SETUP" | "PREP" | "OPS" | "POST" | "SETTLEMENT" | "FINALIZED";

const STATUS_LABEL: Record<string, string> = {
    // 기존 출결/과제 상태 유지 ...
    SETUP:      "준비중",
    PREP:       "팀 확정",
    OPS:        "진행중",
    POST:       "스캔중",
    SETTLEMENT: "정산중",
    FINALIZED:  "마감",
};
```

---

### ISSUE-03: 팀 생성 시 팀장(is_leader) 항상 false

**파일:** `src/pages/wizard/StepConfirmation.tsx:42`

```typescript
// 현재 (잘못됨)
members: members.map(id => ({ member_id: id, is_leader: false }))
//                                              ^^^^^^^^^^^^ 항상 false
```

**영향:** 백엔드 `PATCH /sessions/:id/teams`는 `is_leader` 필드를 받아서 DB에 저장하는데, 항상 false로 전송. 결과적으로 모든 팀에 팀장이 없는 상태로 생성됨.

**수정:** `StepTeamBuilding.tsx`의 팀 상태에 팀장 지정 UI를 추가하고, `state.teams`에 `{ member_id, is_leader }` 구조로 저장한 뒤 전달.

---

## 🟠 High

### ISSUE-04: useCurrentSession() 유효하지 않은 상태 필터

**파일:** `src/hooks/useSessions.ts:71-80`

```typescript
// Priority 1 필터에 존재하지 않는 "IN_PROGRESS" 포함
const active = data.find(s => ["PREP", "OPS", "POST", "SETTLEMENT", "IN_PROGRESS"].includes(s.status));

// Priority 2 필터에 존재하지 않는 "SCHEDULED" 포함
const upcoming = data.filter(s => ["SETUP", "SCHEDULED"].includes(s.status))...
```

**영향:** "IN_PROGRESS" 세션은 백엔드에서 절대 오지 않으므로 실질적으로 무시됨. SETUP 세션은 Priority 2에서 올바르게 처리되므로 현재는 우연히 동작하지만, 타입 안전성 위반.

**수정:** 존재하지 않는 상태값 제거.

---

### ISSUE-05: SessionLayout — 탭 접근 제한 없음

**파일:** `src/pages/session/SessionLayout.tsx`

세션 상태에 관계없이 prep/ops/post/settlement 탭 4개 모두 항상 접근 가능.

| 상태 | 허용해야 할 탭 | 현재 |
|------|--------------|------|
| SETUP | prep만 | 전체 |
| PREP | prep만 | 전체 |
| OPS | ops만 | 전체 |
| POST | post만 | 전체 |
| SETTLEMENT | settlement만 | 전체 |
| FINALIZED | settlement(읽기전용) | 전체 |

**영향:** FINALIZED 상태 세션에서 OPS 탭으로 이동해 출석 수정 시도 가능 (서버가 거부하지만 혼란스러운 UX). SETUP 세션에서 settlement 탭 진입 시 API 오류 발생.

---

### ISSUE-06: PrepTab — TeamResponse.members 필드명 혼동

**파일:** `src/pages/session/PrepTab.tsx:77` 근처

백엔드 `TeamResponse`는 `flatten_members` validator를 통해 `TeamMember → MemberResponse`로 변환하여 반환:

```python
# backend/app/schemas/team.py:39-49
@field_validator("members", mode="before")
def flatten_members(cls, v):
    return [tm.member for tm in v if hasattr(tm, "member") and tm.member]
```

따라서 `session.teams[i].members[j]`의 타입은 `MemberResponse`이며, 필드는 `id`, `name`, `email` 등. **`member_id` 필드는 없다.**

코드에 `member_id: member.id` 수동 매핑 주석이 이미 있다는 것은 이 문제를 인식했으나 임시방편으로 처리한 것.

**수정:** 프론트 타입을 정확히 정의하거나, 백엔드 `TeamResponse`에서 `member_id`를 명시적으로 포함시키도록 스키마 수정.

---

### ISSUE-07: 팀 자동 생성(Snake Draft) 미연결

**파일:** `src/pages/wizard/StepTeamBuilding.tsx`

백엔드에 팀 이력 기반 Snake Draft 알고리즘이 구현되어 있음:
```
POST /api/v1/sessions/:id/teams/generate   { num_teams: N }
→ 활성 멤버 + TeamHistory 기반 최적 배분 반환
```

그러나 프론트엔드는 이 API를 전혀 호출하지 않고, 순수 프론트엔드 랜덤 배정만 구현함.

**영향:** 팀 히스토리(같은 팀 조합 회피) 기능이 사실상 무용지물. 백엔드 알고리즘과 프론트 배정 결과가 다름.

**흐름 문제:** `teams/generate`는 `session_id`가 필요한데, 세션은 Step 3(Confirmation)에서 생성됨. Step 2에서는 세션 ID가 없어서 API 호출 불가. → 워크플로우 재설계 필요:
- **Option A:** Step 1에서 세션 draft 생성 → Step 2에서 generate 호출 → Step 3에서 확정
- **Option B:** 세션 ID 없이 `/teams/simulate` 엔드포인트 추가 (백엔드 신규 엔드포인트)

---

### ISSUE-08: PostTab — PPT Assignment 조회 불가 (BUG-04 연동)

**파일:** `src/pages/session/PostTab.tsx`

PPT Assignment는 `member_id=None, team_id=team.id`로 생성됨 (현재 BUG-04 미수정).
프론트에서 멤버별 assignment를 조회할 때 `member_id` 기준으로 찾으면 PPT는 항상 null.

**영향:** POST 탭의 PPT 제출 현황이 항상 비어있거나 오동작. BUG-04가 해결될 때까지 이 화면은 사실상 PPT 상태를 표시할 수 없음.

**단기 해결:** PPT Assignment를 team_id 기준으로 별도 조회하는 로직 추가.

---

## 🟡 Medium

### ISSUE-09: Dashboard — `/settings` 라우트 없음

**파일:** `src/pages/Dashboard.tsx:223`

```typescript
navigate("/settings")  // 라우터에 /settings 없음 → 404
```

Naver 세션 카드에서 "설정" 버튼 클릭 시 404. 네이버 세션 관리 페이지(import/login) 연결 대상 라우트가 없음.

---

### ISSUE-10: SettlementPreviewResponse — total 합계 미제공

**현황:** 백엔드 응답 스키마:
```python
class SettlementPreviewResponse(BaseModel):
    session_id: int
    penalties: list[PenaltyItemResponse]  # 개별 페널티 목록만
    # total_fine, total_score_delta 없음!
```

프론트 `SettlementTab.tsx`에서 합계를 직접 계산:
```typescript
const penalties = previewData?.penalties || [];
// total_fine = penalties.reduce(sum of deposit_delta)  ← 프론트에서 직접 계산
```

이 자체는 동작하지만, 백엔드에서 summary를 함께 내려주는 것이 더 명확함.

---

### ISSUE-11: 팀 이름 변환 로직 불안정

**파일:** `src/pages/wizard/StepConfirmation.tsx:39`

```typescript
name: key.replace("team", "Team ")
// "team1" → "Team 1"  (숫자 앞에 공백이 삽입됨)
// "team10" → "Team 10"  ← 의도적인가?
```

State key가 `"team1"`, `"team2"`이면 `"Team 1"`, `"Team 2"`로 변환. 백엔드 DB에 그대로 저장됨.
일관성은 있으나, 팀 이름 커스터마이징 기능이 없음 (항상 자동 생성된 이름만 사용).

---

### ISSUE-12: SettlementTab — FINALIZED 상태 재진입 시 UX

FINALIZED 상태에서 settlement 탭에 접근 시 "마감 완료" 표시는 있으나, 원장 결과나 최종 페널티 요약 화면이 없음. 마감 후에는 ledger 페이지로 이동해야 결과 확인 가능 — 연결 버튼 없음.

---

## 🟢 Low

### ISSUE-13: useOutletContext에 any 타입 사용

**파일:** `src/pages/session/SessionLayout.tsx`

```typescript
useOutletContext<{ session: any }>()
```

세션 데이터를 `any`로 받아서 하위 탭에 전달. TypeScript의 타입 안전성이 탭 컴포넌트 전체에서 무력화됨.

---

### ISSUE-14: React Query 캐시 무효화 범위 과도

뮤테이션 성공 시 `invalidateQueries({ queryKey: sessionsKeys.details() })`로 모든 세션 detail을 일괄 무효화. 특정 세션 ID만 무효화하면 충분.

---

### ISSUE-15: MemberDetail "Manage" 버튼 미구현

**파일:** `src/pages/MemberDetail.tsx:132`
onClick 핸들러 없음 — 보증금 관리 기능 연결 필요.

---

### ISSUE-16: 크롤러 태스크 에러 시 재시도 UI 없음

**파일:** `src/pages/session/PrepTab.tsx`
ARQ 태스크가 실패("failed" status) 시 사용자에게 오류 메시지만 보이고 재시도 버튼 없음.

---

### ISSUE-17: 출석 마감 시간 클라이언트 시간 기준

**파일:** `src/pages/session/AttendanceGrid.tsx:35-37`
`new Date()` 기준으로 마감 여부 판단. 서버 시간과 클라이언트 시간이 다를 경우 마감 시간 오작동 가능.

---

## 확인된 정상 동작 (기존 의심 해소)

| 항목 | 결론 |
|------|------|
| PATCH /sessions/:id/teams 엔드포인트 | ✅ 백엔드에 존재, 요청 구조 일치 |
| POST /sessions/:id/finalize overrides 구조 | ✅ `{ member_id, skip_types: [] }` 일치 |
| SettlementPreviewResponse.penalties 필드명 | ✅ 프론트/백엔드 일치 |
| PenaltyItemResponse 필드 (member_name, score_delta 등) | ✅ 일치 |
| 크롤러 엔드포인트 경로 (/crawler/naver/login 등) | ✅ 전부 일치 |
| Ledger 타입 enum (FINE/MERIT/MILESTONE_FINE 등) | ✅ 일치 |

---

## 수정 우선순위

```
1차 (지금 바로) — UI 기본 동작
  ISSUE-01: Session status enum 수정
  ISSUE-02: StatusBadge 레이블 추가

2차 (세션 운영 전) — 핵심 기능
  ISSUE-03: 팀장 지정 UI + is_leader 전달
  ISSUE-07: 팀 자동 생성 API 연결 (워크플로우 재설계 포함)
  ISSUE-05: 탭 접근 상태 제한

3차 (BUG-04 해결 연동) — PPT 관련
  ISSUE-08: PostTab PPT 조회 로직

4차 (편의성)
  ISSUE-09: /settings 라우트 연결
  ISSUE-12: FINALIZED 후 결과 화면
  나머지 Low 항목들
```

---

## Playwright E2E 테스트 결과 (2026-02-21)

> 테스트 세션: 20주차, 2026-01-30, "32기 하고 싶은거 다해", **INDIVIDUAL 타입**, has_ppt=false, has_feedback=false, has_review=true
> 전체 흐름: SETUP → PREP → OPS → POST → SETTLEMENT → FINALIZED 완료
> 멤버 수: 23명 (실제 이름 seed)

### 수정 완료 항목

| ID | 파일 | 내용 | 수정 방법 |
|----|------|------|-----------|
| ISSUE-W2 | `SessionWizard.tsx` | INDIVIDUAL 타입에서 "Step 3 of 2" 표시 | `displayStep` 변수로 내부 step(3)→표시 step(2) 변환 |
| ISSUE-P1 | `PrepTab.tsx` | `has_ppt=false`에도 Presentation Scan 카드 표시 | `cfg.has_ppt !== false` 조건부 렌더링 추가 |
| ISSUE-P2 | `SessionLayout.tsx` | INDIVIDUAL 세션에서 "팀 확정 (PREP 시작)" 버튼 표시 | session.type 기반 버튼 레이블 분기 |
| ISSUE-NAV1 | `Dashboard.tsx` | "Manage Session" 버튼이 항상 `/prep` 탭으로 이동 | session.status → tab 매핑 테이블로 올바른 탭 라우팅 |
| ISSUE-PT1 | `PostTab.tsx` | INDIVIDUAL 세션 PostTab 멤버 행 완전 공백 | session.type 분기: TEAM→teams, INDIVIDUAL→attendances+useMembers |
| ISSUE-PT2 | `PostTab.tsx` | session.config 무시하고 PPT/REVIEW/FEEDBACK 컬럼 고정 표시 | `cfg.has_ppt/has_review/has_feedback` 기반 activeTypes 동적 생성 |
| ISSUE-BE1 | `sessions.py` (backend) | PATCH /sessions/:id/status → 500 MissingGreenlet 오류 | commit 후 selectinload 포함 재조회로 eager loading 보장 |
| ISSUE-BE2 | `sessions.py` (backend) | INDIVIDUAL 세션에서 SETUP→PREP 전환 시 Assignment 미생성 | SETUP→PREP + type=INDIVIDUAL 조건에서 활성 멤버별 Assignment 자동 생성 |

### 미해결 항목 → 수정 완료 (2026-02-21)

#### ISSUE-D1: ✅ Dashboard "New Session" 버튼 중복 — 수정 완료
- `Dashboard.tsx`의 PageHeader actions 버튼 제거. Sidebar + empty state CTA 유지.

#### ISSUE-D3: ✅ "Entrance Closed" 하드코딩 — 수정 완료
- 세션 날짜와 현재 시각 비교 로직 추가. 오늘+22시 이후만 표시, 과거 날짜/미래 날짜는 미표시.

#### ISSUE-S1: ✅ REVIEW 페널티 "HOMEWORK" 표시 — 수정 완료
- `SettlementTab.tsx`에 `PENALTY_TYPE_LABEL` 맵 추가. `HOMEWORK` → "과제미제출" 레이블 변환.

#### ISSUE-SET1: ✅ "Go to Settings" 버튼 — 수정 완료
- Naver 만료 경고 배너의 action 버튼 제거. 메시지를 "상단 Naver Session 카드에서 재로그인해주세요."로 변경.

---

### E2E 테스트 확인 사항 (정상 동작)

| 항목 | 결과 |
|------|------|
| 세션 전체 상태 전환 (SETUP→FINALIZED) | ✅ 정상 |
| INDIVIDUAL 세션 23명 Assignment 자동 생성 (REVIEW만) | ✅ 정상 |
| POST→SETTLEMENT 전환 시 미제출 PENDING→MISSING 자동 처리 | ✅ 정상 (23건) |
| Finalize 시 23건 FINE 원장 생성 (각 -₩1,000, -1점) | ✅ 정상 |
| Members 페이지 잔액/점수 갱신 반영 | ✅ 정상 (₩19,000, -1점) |
| INDIVIDUAL 세션 PostTab 23명 표시 + REVIEW 컬럼만 | ✅ 수정 후 정상 |
| PrepTab Presentation Scan 카드 has_ppt=false 시 미표시 | ✅ 수정 후 정상 |
