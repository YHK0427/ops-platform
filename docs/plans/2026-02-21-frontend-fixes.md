# 프론트엔드 이슈 수정 계획

> 작성일: 2026-02-21
> 근거: `docs/frontend-issues.md`
> 대상 브랜치: main

---

## 컨텍스트

- 백엔드: FastAPI, 세션 상태 `SETUP|PREP|OPS|POST|SETTLEMENT|FINALIZED`
- 프론트: React19 + TypeScript, React Query v5, react-router-dom v7
- ISSUE-03 (is_leader 제거)는 이전 세션에서 **이미 완료**됨

---

## Task 1 — ISSUE-01 + ISSUE-04: Session 타입 & useCurrentSession 필터 수정

**파일:** `frontend/src/hooks/useSessions.ts`

### 1-1. Session 인터페이스 status 타입 수정 (line ~11)

```typescript
// Before
status: "SCHEDULED" | "PREP" | "OPS" | "POST" | "SETTLEMENT" | "finalized_pending" | "FINALIZED" | "CANCELLED" | "IN_PROGRESS";

// After
status: "SETUP" | "PREP" | "OPS" | "POST" | "SETTLEMENT" | "FINALIZED";
```

### 1-2. Session 인터페이스 teams.members 필드 수정

백엔드 `TeamResponse.members`는 `flatten_members` validator로 `MemberResponse[]`를 반환.
`MemberResponse` 필드: `id`, `name`, `email`, `student_id`, `is_active`, `current_deposit`, `net_score`

```typescript
// Before
teams?: {
    name: string;
    members: {
        member_id: number;  // WRONG — backend returns id
        name: string;
        is_active: boolean;
    }[];
}[];

// After
teams?: {
    id: number;
    name: string;
    members: {
        id: number;         // CORRECT — MemberResponse.id
        name: string;
        email?: string;
        is_active: boolean;
    }[];
}[];
```

### 1-3. useCurrentSession 필터 수정 (line ~71-80)

```typescript
// Before Priority 1
const active = data.find(s => ["PREP", "OPS", "POST", "SETTLEMENT", "IN_PROGRESS"].includes(s.status));
// Before Priority 2
const upcoming = data.filter(s => ["SETUP", "SCHEDULED"].includes(s.status))

// After Priority 1 — IN_PROGRESS 제거 (백엔드에 없는 상태)
const active = data.find(s => ["PREP", "OPS", "POST", "SETTLEMENT"].includes(s.status));
// After Priority 2 — SCHEDULED 제거 (백엔드에 없는 상태)
const upcoming = data.filter(s => s.status === "SETUP")
```

---

## Task 2 — ISSUE-02: StatusBadge 세션 상태 레이블/스타일 추가

**파일:** `frontend/src/components/StatusBadge.tsx`

### 2-1. SessionStatus 타입 수정 (line 16)

```typescript
// Before
type SessionStatus = "SCHEDULED" | "IN_PROGRESS" | "FINALIZED" | "CANCELLED";

// After
type SessionStatus = "SETUP" | "PREP" | "OPS" | "POST" | "SETTLEMENT" | "FINALIZED";
```

### 2-2. STATUS_LABEL 추가 (line ~32-35 근처)

기존 항목(`SCHEDULED`, `IN_PROGRESS`, `CANCELLED`) 제거하고 실제 세션 상태 추가:
```typescript
SETUP:      "준비중",
PREP:       "팀 확정",
OPS:        "진행중",
POST:       "스캔중",
SETTLEMENT: "정산중",
FINALIZED:  "마감",
```

### 2-3. BADGE_STYLE 추가 (line ~49-51 근처)

기존 항목(`SCHEDULED`, `IN_PROGRESS`, `CANCELLED`) 제거하고 실제 세션 상태 스타일 추가:
```typescript
SETUP:      "bg-slate-500/10 text-slate-400 border-slate-500/20",
PREP:       "bg-blue-500/10 text-blue-400 border-blue-500/20",
OPS:        "bg-green-500/10 text-green-400 border-green-500/20 animate-pulse",
POST:       "bg-purple-500/10 text-purple-400 border-purple-500/20",
SETTLEMENT: "bg-orange-500/10 text-orange-400 border-orange-500/20",
FINALIZED:  "bg-white/5 text-[var(--color-text-muted)] border-[var(--color-border-subtle)]",
```

---

## Task 3 — ISSUE-05 + ISSUE-13: SessionLayout 탭 접근 제어 & 타입 안전성

**파일:** `frontend/src/pages/session/SessionLayout.tsx`

### 3-1. Session 타입 import & OutletContext 타입 명시

`useSessions`에서 `Session` 타입을 export하고, `SessionLayout`에서 import 후 `Outlet context={{ session }}`에 타입 지정.

### 3-2. renderStatusAction에 SETUP 케이스 추가

```typescript
case "SETUP":
    return (
        <Button size="sm" onClick={() => handleStatusChange("PREP")}
            className="bg-blue-600 hover:bg-blue-700 text-white">
            팀 확정 (PREP 시작)
        </Button>
    );
```

### 3-3. 탭 접근 제어 구현

상태별 허용 탭 맵:

| 상태 | 허용 탭 |
|------|---------|
| SETUP | prep |
| PREP | prep |
| OPS | ops |
| POST | post |
| SETTLEMENT | settlement |
| FINALIZED | settlement (read-only, 이미 처리됨) |

구현: 탭 배열에 `allowedStatuses` 속성을 추가하거나, 현재 상태에서 허용된 탭 ID를 계산하는 함수를 만든다.
비허용 탭은 `pointer-events-none opacity-30` 스타일 + NavLink `end` 동작 유지.

---

## Task 4 — ISSUE-06 + ISSUE-08: PostTab 멤버 필드 & PPT 팀 단위 조회

**파일:** `frontend/src/pages/session/PostTab.tsx`

### 4-1. 멤버 필드명 수정

현재 코드에서 `session.teams[i].members`는 Task 1에서 수정된 후 `id` 필드를 사용.

`PostTab.tsx` line 113-116의 버그 수정:
```typescript
// Before (line 116 — 잘못된 필드)
{m.member?.name}
// After
{m.name}

// Before (line 114 — member_id 없음)
<TableRow key={m.id || m.member_id}>
// After
<TableRow key={m.id}>

// Before (line 121 — member_id 없음)
const assignment = getAssignment(m.member_id, type);
// After
const assignment = getAssignment(m.id, type);
```

### 4-2. PPT 과제 팀 단위 조회 (ISSUE-08)

TEAM 세션에서 PPT assignment는 `member_id=null, team_id=team.id`로 생성됨.
`getAssignment(memberId, "PPT")`는 항상 null 반환.

수정: `getTeamPPTAssignment(teamId)` 함수 추가:
```typescript
const getTeamPPTAssignment = (teamId: number) => {
    return session.assignments?.find((a: any) => a.team_id === teamId && a.type === "PPT");
};
```

테이블 렌더링 시 PPT 컬럼은 `getTeamPPTAssignment(t.id)` 사용.
단, INDIVIDUAL 세션은 팀이 없으므로 `getAssignment(m.id, "PPT")` 그대로 사용.

팀 변수는 flatMap 전에 접근 가능하도록 구조 변경:
```typescript
session.teams?.flatMap((t: any) => t.members.map((m: any) => ({ ...m, teamId: t.id, teamName: t.name })))
```
그리고 PPT 컬럼: `getTeamPPTAssignment(m.teamId)`.

---

## Task 5 — ISSUE-09: /settings 라우트 추가

**파일:** `frontend/src/App.tsx`

`/settings` 라우트를 추가해 404를 방지. 네이버 관련 설정은 Dashboard의 `NaverSessionCard`에 이미 있으므로,
`/settings`는 `/dashboard`로 redirect하는 라우트 추가:

```typescript
<Route path="/settings" element={<Navigate to="/dashboard" replace />} />
```

`DashboardLayout` 내부(`/sessions/new` 형제 라우트로) 추가.

---

## Task 6 — ISSUE-12: SettlementTab FINALIZED 화면에 Ledger 이동 버튼 추가

**파일:** `frontend/src/pages/session/SettlementTab.tsx`

현재 FINALIZED 화면 (line 85~101):
- "Session Finalized" 텍스트 ✅
- "마감 완료" disabled 버튼 ✅
- Ledger 바로가기 **없음** ❌

`useNavigate` import 추가 후, disabled 버튼 대신 실제 Ledger 이동 버튼 추가:
```tsx
<Button onClick={() => navigate("/ledger")} className="bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white">
    <ExternalLink className="w-4 h-4 mr-2" />
    Ledger에서 확인
</Button>
```

기존 disabled "마감 완료" 버튼은 제거 (불필요).

---

## Task 7 — Dashboard 필드 수정 + MemberDetail Manage 버튼

### 7-1. Dashboard member 필드 (Dashboard.tsx)

백엔드 MemberResponse 필드: `current_deposit` (not `deposit`), `net_score` (not `score`)

```typescript
// Before (line 177)
const lowDepositMembers = sortedMembers?.filter((m) => (m.deposit || 0) < 10000) || [];
// After
const lowDepositMembers = sortedMembers?.filter((m) => (m.current_deposit || 0) < 10000) || [];

// Before (line 179, 241-242)
(m.net_score || 0) <= -8
// net_score는 이미 올바름 — 그대로 유지
```

`member.deposit`만 `member.current_deposit`으로 수정. `net_score`는 올바름.

### 7-2. MemberDetail Manage 버튼 (MemberDetail.tsx)

**파일:** `frontend/src/pages/MemberDetail.tsx`

line ~132의 "Manage" 버튼에 onClick 핸들러 추가.
현재 맥락: 보증금 관리 섹션. 클릭 시 해당 섹션으로 스크롤하거나 편집 모드 토글.
가장 단순한 구현: 버튼 클릭 시 보증금 입력 modal 또는 inline edit 상태로 전환.
단, 현재 MemberDetail에 보증금 수정 UI가 없다면 버튼을 일단 제거하거나 준비중 toast 표시.

백엔드 보증금 수정 엔드포인트: `PATCH /api/v1/members/:id` (members 라우터 확인 필요)
→ MemberDetail.tsx를 읽고 현재 구조 파악 후 결정.
