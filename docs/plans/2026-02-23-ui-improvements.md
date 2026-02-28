# UI Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Settings 제거, 세션 삭제, Ledger 항목 설명 수정, PostTab 수동 과제 설정 개선 4가지를 구현한다.

**Architecture:**
- Frontend: React 19 + TypeScript + TanStack Query v5 + React Router v6 + shadcn/ui
- Backend (Task 3만): FastAPI + SQLAlchemy async + Pydantic v2
- 백엔드 변경은 Task 3 (Ledger PATCH)만 필요. 나머지는 프론트엔드만 수정.

**Tech Stack:** React, TypeScript, TanStack Query, React Router, FastAPI, SQLAlchemy, Pydantic v2, shadcn/ui Dialog/Badge

---

### Task 1: Settings 완전 제거

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/App.tsx`

**Step 1: Sidebar.tsx에서 Settings NavLink와 import 제거**

`Sidebar.tsx` 현재 Footer 영역:
```tsx
// 현재 (102~116번째 줄):
<div className="px-3 py-4 border-t border-[var(--color-border-subtle)] space-y-1">
    <NavLink
        to="/settings"
        className={({ isActive }) =>
            cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                isActive
                    ? "text-white bg-[var(--color-hover)]"
                    : "text-[var(--color-text-secondary)] hover:text-white hover:bg-[var(--color-hover)]"
            )
        }
    >
        <Settings className="w-4 h-4" />
        Settings
    </NavLink>
    {user && ( ... Logout button ... )}
</div>
```

변경: NavLink 제거, `Settings` import도 제거. 결과:
```tsx
import {
    LayoutDashboard,
    Users,
    BookOpen,
    LogOut,
    Plus,
    CalendarDays,
} from "lucide-react";

// Footer 영역:
<div className="px-3 py-4 border-t border-[var(--color-border-subtle)] space-y-1">
    {user && (
        <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-[var(--color-text-secondary)] hover:text-rose-400 hover:bg-rose-500/5 transition-colors"
        >
            <LogOut className="w-4 h-4" />
            Logout
        </button>
    )}
</div>
```

**Step 2: App.tsx에서 /settings 라우트 제거**

제거할 줄:
```tsx
<Route path="/settings" element={<Navigate to="/dashboard" replace />} />
```

**Step 3: 브라우저에서 /settings 접근 시 Fallback(*)이 /dashboard로 처리하므로 동작 확인**

**Step 4: Commit**
```bash
git add frontend/src/components/Sidebar.tsx frontend/src/App.tsx
git commit -m "feat: remove unused Settings page and sidebar link"
```

---

### Task 2: 세션 삭제 기능

백엔드 `DELETE /sessions/{session_id}`는 이미 존재하며 SETUP 상태에서만 허용 (다른 상태면 400 반환).

**Files:**
- Modify: `frontend/src/hooks/useSessions.ts`
- Modify: `frontend/src/pages/session/SessionLayout.tsx`
- Modify: `frontend/src/pages/SessionList.tsx`

**Step 1: useSessions.ts에 useDeleteSession 훅 추가**

파일 끝에 추가:
```typescript
export function useDeleteSession() {
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    return useMutation({
        mutationFn: async (sessionId: number) => {
            await api.delete(`/sessions/${sessionId}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: sessionsKeys.lists() });
            queryClient.invalidateQueries({ queryKey: sessionsKeys.current() });
            toast.success("세션이 삭제되었습니다.");
            navigate("/sessions");
        },
        onError: (err: any) => {
            toast.error("삭제 실패: " + (err?.response?.data?.detail ?? "알 수 없는 오류"));
        },
    });
}
```

주의: `useNavigate`를 import해야 함. 파일 상단에 이미 없으면 추가:
```typescript
import { useNavigate } from "react-router-dom";
```

**Step 2: SessionLayout.tsx에 삭제 버튼 추가**

SETUP 상태일 때만 표시. 기존 imports에 `Trash2` 추가:
```tsx
import { Lock, Trash2 } from "lucide-react";
```

`useDeleteSession` import 추가:
```tsx
import { useSession, useUpdateSessionStatus, useDeleteSession } from "@/hooks";
```

컴포넌트 내 훅 호출 추가:
```tsx
const { mutate: deleteSession, isPending: isDeleting } = useDeleteSession();
```

`renderStatusAction` 함수의 `case "SETUP":` 분기 내용을:
```tsx
case "SETUP":
    return (
        <div className="flex items-center gap-2">
            <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                    if (confirm("세션을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.")) {
                        deleteSession(sessionId);
                    }
                }}
                disabled={isDeleting}
                className="bg-red-900/50 hover:bg-red-800 border-red-700 text-red-200"
            >
                <Trash2 className="w-3.5 h-3.5 mr-1" />
                {isDeleting ? "삭제 중..." : "세션 삭제"}
            </Button>
            <Button
                size="sm"
                onClick={() => handleStatusChange("PREP")}
                className="bg-blue-600 hover:bg-blue-700 text-white"
            >
                {typedSession.type === "INDIVIDUAL" ? "세션 준비 완료 (PREP)" : "팀 확정 (PREP 시작)"}
            </Button>
        </div>
    );
```

**Step 3: SessionList.tsx에 카드별 삭제 버튼 추가**

SessionList는 각 카드가 통째로 클릭 가능한 구조. 삭제 버튼에서 이벤트 전파를 막아야 함.

imports 추가:
```tsx
import { Plus, ArrowRight, Calendar, Users, Briefcase, Trash2 } from "lucide-react";
import { useDeleteSession } from "@/hooks";
```

컴포넌트 내에서 훅 호출:
```tsx
const { mutate: deleteSession } = useDeleteSession();
```

하지만 `useDeleteSession` 안에서 `useNavigate`를 호출하므로 SessionList에서 직접 사용해도 됨.
단, navigate to "/sessions"는 이미 현재 페이지이므로 문제없음.

카드에서 SETUP인 경우 삭제 버튼:
```tsx
<Card
    key={session.id}
    className="group relative overflow-hidden ..."
    onClick={() => navigate(`/sessions/${session.id}`)}
>
    <CardHeader className="pb-3">
        <div className="flex justify-between items-start mb-2">
            <div className="flex items-center gap-2">
                ...
            </div>
            <div className="flex items-center gap-2">
                {session.status === 'SETUP' && (
                    <button
                        className="p-1 rounded text-red-400/60 hover:text-red-400 hover:bg-red-400/10 transition-colors opacity-0 group-hover:opacity-100"
                        title="세션 삭제"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`"${session.title}" 세션을 삭제하시겠습니까?`)) {
                                deleteSession(session.id);
                            }
                        }}
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>
        </div>
        ...
    </CardHeader>
```

**Step 4: Commit**
```bash
git add frontend/src/hooks/useSessions.ts frontend/src/pages/session/SessionLayout.tsx frontend/src/pages/SessionList.tsx
git commit -m "feat: add session delete (SETUP state only) with confirmation"
```

---

### Task 3: Ledger 항목 description 수정 버튼

원장 불변성 원칙: 금액(amount_krw), 타입(type), 점수(score_delta)는 변경 불가. description만 수정 허용.

**Files:**
- Modify: `backend/app/schemas/ledger.py`
- Modify: `backend/app/routers/ledger.py`
- Modify: `frontend/src/hooks/useLedger.ts`
- Modify: `frontend/src/pages/Ledger.tsx`

**Step 1: 백엔드 스키마에 LedgerDescriptionUpdate 추가**

`backend/app/schemas/ledger.py` 끝에 추가:
```python
class LedgerDescriptionUpdate(BaseModel):
    description: str = Field(min_length=1, max_length=500)
```

`LedgerResponse`에 `member_id`가 optional이 아닌지 확인 - 이미 `member_id: int` 이므로 OK.

**Step 2: 백엔드 ledger.py에 PATCH 엔드포인트 추가**

`backend/app/routers/ledger.py` 하단에 추가:
```python
from app.schemas.ledger import LedgerResponse, LedgerType, MeritRequest, TransactionRequest, LedgerDescriptionUpdate

@router.patch("/{ledger_id}", response_model=LedgerResponse)
async def update_ledger_description(
    ledger_id: int,
    req: LedgerDescriptionUpdate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """
    원장 항목 설명(description) 수정 — 금액/타입/점수는 변경 불가
    """
    entry = await db.get(Ledger, ledger_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Ledger entry not found")
    entry.description = req.description
    await db.commit()
    await db.refresh(entry)
    return entry
```

import 줄 수정 (파일 상단 from app.schemas.ledger 임포트에 `LedgerDescriptionUpdate` 추가):
```python
from app.schemas.ledger import LedgerResponse, LedgerType, MeritRequest, TransactionRequest, LedgerDescriptionUpdate
```

**Step 3: 프론트엔드 useLedger.ts에 useUpdateLedgerDescription 훅 추가**

현재 `frontend/src/hooks/useLedger.ts`를 확인:
```bash
cat frontend/src/hooks/useLedger.ts
```

파일 끝에 추가 (LedgerEntry type과 useQueryClient가 이미 있으면 그대로):
```typescript
export function useUpdateLedgerDescription() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, description }: { id: number; description: string }) => {
            const { data } = await api.patch(`/ledger/${id}`, { description });
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["ledger"] });
            toast.success("설명이 수정되었습니다.");
        },
        onError: () => {
            toast.error("수정 실패");
        },
    });
}
```

`hooks/index.ts`에 export 확인 - 이미 `export * from "./useLedger"` 있으면 자동 export됨.

**Step 4: Ledger.tsx 테이블 행에 편집 버튼 추가**

imports 추가:
```tsx
import { Loader2, PlusCircle, ArrowRightLeft, Pencil, Check, X } from "lucide-react";
```

`useUpdateLedgerDescription` import:
```tsx
import { useLedger, useMembers, useGiveMerit, useCreateTransaction, useUpdateLedgerDescription } from "@/hooks";
```

컴포넌트 내에 상태 추가:
```tsx
const [editingId, setEditingId] = useState<number | null>(null);
const [editingDesc, setEditingDesc] = useState("");
const { mutate: updateDescription, isPending: isUpdating } = useUpdateLedgerDescription();
```

테이블 행 Description 셀을 편집 가능하게:
```tsx
<TableCell className="text-gray-300 text-sm max-w-[300px]">
    {editingId === entry.id ? (
        <div className="flex items-center gap-1">
            <Input
                value={editingDesc}
                onChange={(e) => setEditingDesc(e.target.value)}
                className="h-7 text-xs py-1 px-2"
                autoFocus
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        updateDescription({ id: entry.id, description: editingDesc }, {
                            onSuccess: () => setEditingId(null),
                        });
                    }
                    if (e.key === "Escape") setEditingId(null);
                }}
            />
            <button
                className="p-1 text-green-400 hover:text-green-300"
                disabled={isUpdating}
                onClick={() => updateDescription({ id: entry.id, description: editingDesc }, {
                    onSuccess: () => setEditingId(null),
                })}
            >
                <Check className="w-3.5 h-3.5" />
            </button>
            <button className="p-1 text-gray-500 hover:text-gray-300" onClick={() => setEditingId(null)}>
                <X className="w-3.5 h-3.5" />
            </button>
        </div>
    ) : (
        <div className="flex items-center gap-1 group/desc">
            <span className="truncate" title={entry.description}>{entry.description}</span>
            <button
                className="p-0.5 text-gray-600 hover:text-gray-300 opacity-0 group-hover/desc:opacity-100 transition-opacity shrink-0"
                onClick={() => { setEditingId(entry.id); setEditingDesc(entry.description); }}
            >
                <Pencil className="w-3 h-3" />
            </button>
        </div>
    )}
</TableCell>
```

**Step 5: Docker 재시작 (백엔드 변경 반영)**
```bash
docker compose restart backend
```

**Step 6: 동작 확인**
- Ledger 페이지 열고 항목 행에 마우스 올리면 연필 아이콘 표시
- 클릭 → 인라인 편집 → Enter 또는 체크 버튼으로 저장
- 금액/타입 컬럼은 변경 불가 (읽기 전용 유지)

**Step 7: Commit**
```bash
git add backend/app/schemas/ledger.py backend/app/routers/ledger.py \
        frontend/src/hooks/useLedger.ts frontend/src/pages/Ledger.tsx
git commit -m "feat: add ledger description inline edit (amount/type immutable)"
```

---

### Task 4: PostTab 수동 과제 설정 개선

현재 문제: assignment가 null (scan 전에 "—" 표시)일 때 클릭하면 "먼저 스캔해주세요" 에러 발생.
실제로 세션 생성 시 모든 assignment가 PENDING으로 자동 생성되므로 null인 경우는 드물지만,
PENDING 배지 클릭으로 수동 변경이 가능함을 UI에서 명확히 표시해야 함.

**Files:**
- Modify: `frontend/src/pages/session/PostTab.tsx`

**Step 1: CardDescription 텍스트 개선**

현재:
```tsx
<CardDescription>Click to toggle: PASS → LATE → MISSING → PASS (PENDING = 미스캔)</CardDescription>
```

변경:
```tsx
<CardDescription>배지를 클릭해 수동 변경: PENDING → PASS → LATE → MISSING (스캔 없이도 수동 설정 가능)</CardDescription>
```

**Step 2: "—" 배지도 클릭 가능하게 개선**

현재 `handleToggleStatus` 함수:
```tsx
const handleToggleStatus = async (assignment: any) => {
    if (!assignment) {
        toast.error("스캔된 과제 데이터가 없습니다. 먼저 스캔해주세요.");
        return;
    }
    ...
};
```

변경:
```tsx
const handleToggleStatus = async (assignment: any) => {
    if (!assignment) {
        // assignment가 아예 없는 경우 (edge case) - 안내만 표시
        toast.error("과제 데이터가 없습니다. (세션 상태 확인 필요)");
        return;
    }
    const currentStatus = assignment.status;
    const newStatus = STATUS_CYCLE[currentStatus] ?? "PASS";
    try {
        await api.patch(`/assignments/${assignment.id}`, { status: newStatus });
        await queryClient.invalidateQueries({ queryKey: ["sessions", "detail", sessionId] });
        toast.success(`${currentStatus} → ${newStatus}`);
    } catch (e) {
        toast.error("상태 변경 실패");
    }
};
```

**Step 3: PENDING 배지 시각적 개선 - "클릭 가능함" 더 명확히**

현재 PENDING 배지 스타일: `"bg-gray-800 text-gray-400 border-gray-700"`
변경: hover 효과 강화 + title 속성 추가:

```tsx
<Badge
    variant="outline"
    title={assignment ? "클릭해서 상태 변경" : "과제 데이터 없음"}
    className={`cursor-pointer hover:opacity-80 transition-opacity select-none ${
        status === "PASS"    ? "bg-green-500/10 text-green-500 border-green-500/50" :
        status === "MISSING" ? "bg-red-500/10 text-red-500 border-red-500/50" :
        status === "LATE"    ? "bg-yellow-500/10 text-yellow-500 border-yellow-500/50" :
        status === "PENDING" ? "bg-blue-900/30 text-blue-400 border-blue-700 hover:bg-blue-800/30" :
        status === "FAIL"    ? "bg-orange-500/10 text-orange-400 border-orange-500/50" :
        "bg-gray-800 text-gray-600 border-gray-800"
    }`}
    onClick={() => handleToggleStatus(assignment)}
>
    {status}
</Badge>
```

**Step 4: Commit**
```bash
git add frontend/src/pages/session/PostTab.tsx
git commit -m "fix: improve PostTab manual assignment status UX, PENDING is now visually clickable"
```
