# Ledger/Session/Member/Feedback 개선 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ledger 전체 필드 편집, 세션 삭제 가드를 "원장 항목 없을 때"로 변경, 비활성 멤버 재활성화, 피드백 대상 지정 UI를 OpsTab에 추가한다.

**Architecture:**
- Backend(FastAPI + SQLAlchemy async): Ledger PATCH 확장, Session DELETE 가드 변경, Member PATCH에 is_active 추가
- Frontend(React 19 + TanStack Query v5 + shadcn/ui): Ledger 편집 다이얼로그, SessionLayout/SessionList 삭제 버튼 위치 변경, MemberDetail 재활성화 버튼, OpsTab 피드백 대상 지정 UI
- 모든 변경은 TanStack Query 캐시 무효화로 전체 화면 동기화

**Tech Stack:** FastAPI, SQLAlchemy async, Pydantic v2, React 19, TanStack Query v5, React Router v6, shadcn/ui Dialog/Select/Badge, lucide-react

---

### Task 1: Ledger 전체 필드 편집 (백엔드)

**Files:**
- Modify: `backend/app/schemas/ledger.py`
- Modify: `backend/app/routers/ledger.py`

#### 현재 상태 파악
- `LedgerDescriptionUpdate`: description만 수정
- `PATCH /{ledger_id}`: description만 업데이트

#### 변경: LedgerUpdate 스키마로 확장

`backend/app/schemas/ledger.py`에서 `LedgerDescriptionUpdate` 클래스를 다음으로 교체:

```python
class LedgerUpdate(BaseModel):
    type: Optional[LedgerType] = None
    amount_krw: Optional[int] = None
    score_delta: Optional[int] = None
    description: Optional[str] = Field(None, min_length=1, max_length=500)
```

파일 상단에 `Optional` import 확인 - 없으면 추가:
```python
from typing import Optional
```

#### 변경: PATCH 엔드포인트 확장

`backend/app/routers/ledger.py`에서:

1. import 줄 수정:
```python
from app.schemas.ledger import LedgerResponse, LedgerType, MeritRequest, TransactionRequest, LedgerUpdate
```

2. `PATCH /{ledger_id}` 엔드포인트 전체 교체:

```python
@router.patch("/{ledger_id}", response_model=LedgerResponse)
async def update_ledger_entry(
    ledger_id: int,
    req: LedgerUpdate,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """
    원장 항목 수정 (type, amount_krw, score_delta, description 모두 수정 가능)
    - amount_krw 변경 시: 멤버의 current_deposit에 delta 적용
    - score_delta 변경 시: 멤버의 total_plus_score/total_minus_score에 delta 적용
    """
    entry = await db.get(Ledger, ledger_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Ledger entry not found")

    member = await db.get(Member, entry.member_id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    # amount_krw 변경
    if req.amount_krw is not None and req.amount_krw != entry.amount_krw:
        delta = req.amount_krw - entry.amount_krw
        member.current_deposit += delta
        entry.deposit_after = member.current_deposit
        entry.amount_krw = req.amount_krw

    # score_delta 변경
    if req.score_delta is not None and req.score_delta != entry.score_delta:
        old_score = entry.score_delta
        new_score = req.score_delta

        # 기존 점수 효과 제거
        if old_score > 0:
            member.total_plus_score = max(0, member.total_plus_score - old_score)
        elif old_score < 0:
            member.total_minus_score = min(0, member.total_minus_score - old_score)

        # 새 점수 효과 추가
        if new_score > 0:
            member.total_plus_score += new_score
        elif new_score < 0:
            member.total_minus_score += new_score

        member.net_score = member.total_plus_score + member.total_minus_score
        entry.score_delta = new_score

    # type 변경
    if req.type is not None:
        entry.type = req.type

    # description 변경
    if req.description is not None:
        entry.description = req.description

    await db.commit()
    await db.refresh(entry)
    return entry
```

#### Step: Docker 재시작

```bash
cd /home/ubuntu/ops-platform
docker compose restart backend
sleep 5
docker compose logs backend --tail=20
```

백엔드 에러 없이 시작되면 OK.

#### Step: Commit

```bash
git add backend/app/schemas/ledger.py backend/app/routers/ledger.py
git commit -m "feat: extend ledger PATCH to edit type/amount/score/description with member balance recalc"
```

---

### Task 2: Ledger 편집 UI (프론트엔드)

**Files:**
- Modify: `frontend/src/hooks/useLedger.ts`
- Modify: `frontend/src/pages/Ledger.tsx`

#### useLedger.ts 훅 업데이트

현재 `useUpdateLedgerDescription`를 `useUpdateLedger`로 확장:

`frontend/src/hooks/useLedger.ts`에서 `useUpdateLedgerDescription` 함수 이름과 시그니처 변경:

```typescript
export function useUpdateLedger() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, data }: {
            id: number;
            data: { type?: string; amount_krw?: number; score_delta?: number; description?: string };
        }) => {
            const { data: updated } = await api.patch(`/ledger/${id}`, data);
            return updated;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["ledger"] });
            queryClient.invalidateQueries({ queryKey: ["members"] }); // 멤버 잔액 갱신
            toast.success("항목이 수정되었습니다.");
        },
        onError: () => {
            toast.error("수정 실패");
        },
    });
}
```

주의: 기존 `useUpdateLedgerDescription`이 있으면 이름 변경 (replace_all로 안전하게). `hooks/index.ts`에서 export 확인.

#### Ledger.tsx 편집 다이얼로그 추가

현재 인라인 편집(description만)을 → 전체 필드 편집 다이얼로그로 변경.

imports 변경:
```tsx
import { Loader2, PlusCircle, ArrowRightLeft, Pencil } from "lucide-react";
import { useLedger, useMembers, useGiveMerit, useCreateTransaction, useUpdateLedger } from "@/hooks";
```

새 `EditLedgerDialog` 컴포넌트 추가 (파일 상단, `GrantMeritDialog` 위에):

```tsx
const LEDGER_TYPES = [
    "FINE", "MILESTONE_FINE", "DEPOSIT_RECHARGE", "DEPOSIT_ADJUST",
    "DEPOSIT_REFUND", "MERIT", "ADJUSTMENT"
];

function EditLedgerDialog({ entry, memberName }: { entry: LedgerEntry; memberName: string }) {
    const [open, setOpen] = useState(false);
    const [type, setType] = useState(entry.type);
    const [amount, setAmount] = useState(entry.amount_krw);
    const [score, setScore] = useState(entry.score_delta);
    const [description, setDescription] = useState(entry.description);
    const { mutate: updateLedger, isPending } = useUpdateLedger();

    // 다이얼로그 열릴 때 현재 값으로 초기화
    const handleOpen = (isOpen: boolean) => {
        if (isOpen) {
            setType(entry.type);
            setAmount(entry.amount_krw);
            setScore(entry.score_delta);
            setDescription(entry.description);
        }
        setOpen(isOpen);
    };

    const handleSubmit = () => {
        updateLedger({
            id: entry.id,
            data: { type, amount_krw: amount, score_delta: score, description },
        }, {
            onSuccess: () => setOpen(false),
        });
    };

    return (
        <Dialog open={open} onOpenChange={handleOpen}>
            <DialogTrigger asChild>
                <button
                    className="p-0.5 text-gray-600 hover:text-gray-300 opacity-0 group-hover/row:opacity-100 transition-opacity shrink-0"
                    onClick={(e) => e.stopPropagation()}
                >
                    <Pencil className="w-3 h-3" />
                </button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[450px]">
                <DialogHeader>
                    <DialogTitle>원장 항목 수정</DialogTitle>
                    <DialogDescription>
                        <span className="font-medium">{memberName}</span>의 원장 항목을 수정합니다.
                        amount/score 변경 시 멤버 잔액이 즉시 반영됩니다.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Type</Label>
                        <Select value={type} onValueChange={setType}>
                            <SelectTrigger className="col-span-3">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {LEDGER_TYPES.map(t => (
                                    <SelectItem key={t} value={t}>{t}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Amount</Label>
                        <Input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(parseInt(e.target.value) || 0)}
                            className="col-span-3"
                            placeholder="KRW (음수 가능)"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Score</Label>
                        <Input
                            type="number"
                            value={score}
                            onChange={(e) => setScore(parseInt(e.target.value) || 0)}
                            className="col-span-3"
                            placeholder="점수 (음수 가능)"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Description</Label>
                        <Input
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="col-span-3"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
                    <Button onClick={handleSubmit} disabled={isPending || !description}>
                        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        저장
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
```

TableRow에 `group/row` 클래스 추가 및 Description 셀을 원래 (truncate 버전)로 되돌리고, Description 셀 끝에 `EditLedgerDialog` 추가:

현재 description TableCell의 기존 인라인 편집 코드를 제거하고 다음으로 교체:

```tsx
<TableRow key={entry.id} className="group/row hover:bg-white/5 transition-colors">
    {/* ... date, member, type, badge cells 유지 ... */}
    <TableCell className="text-gray-300 text-sm max-w-[300px]">
        <div className="flex items-center gap-1">
            <span className="truncate" title={entry.description}>{entry.description}</span>
            <EditLedgerDialog
                entry={entry}
                memberName={entry.member_name || memberMap.get(entry.member_id) || String(entry.member_id)}
            />
        </div>
    </TableCell>
    {/* ... amount, score, balance cells 유지 ... */}
</TableRow>
```

주의: `editingId`, `editingDesc`, `useUpdateLedgerDescription`, `Check`, `X` 관련 코드를 모두 제거.
`LedgerEntry` 타입에 `member_name?: string` 필드가 있는지 확인 - `hooks/useLedger.ts`에서 확인.

#### Step: Commit

```bash
git add frontend/src/hooks/useLedger.ts frontend/src/pages/Ledger.tsx
git commit -m "feat: ledger edit dialog for all fields (type/amount/score/description) with live member balance sync"
```

---

### Task 3: 세션 삭제 가드 변경 (SETUP → 원장 항목 없을 때)

**Files:**
- Modify: `backend/app/routers/sessions.py`
- Modify: `frontend/src/pages/session/SessionLayout.tsx`
- Modify: `frontend/src/pages/SessionList.tsx`

#### 백엔드: DELETE 가드 변경

`backend/app/routers/sessions.py`의 `delete_session` 함수:

현재:
```python
if session.status != "SETUP":
    raise HTTPException(
        status_code=400,
        detail=f"SETUP 상태에서만 삭제 가능합니다 (현재: {session.status})",
    )
```

변경:
```python
if session.status == "FINALIZED":
    raise HTTPException(
        status_code=400,
        detail="정산이 완료된 세션은 삭제할 수 없습니다",
    )
# 원장 항목이 있으면 삭제 불가 (이미 디파짓이 적용됨)
from sqlalchemy import func
result = await db.execute(
    select(func.count(Ledger.id)).where(Ledger.session_id == session_id)
)
ledger_count = result.scalar() or 0
if ledger_count > 0:
    raise HTTPException(
        status_code=400,
        detail=f"이미 원장 항목이 존재하는 세션은 삭제할 수 없습니다 ({ledger_count}건)",
    )
```

주의: `func`가 이미 import되어 있으면 중복 import 불필요.
`select`도 이미 import되어 있으면 OK.

#### 프론트엔드: SessionLayout.tsx 삭제 버튼 분리

현재: delete 버튼이 `renderStatusAction`의 `case "SETUP":` 안에만 있음.
변경: delete 버튼을 `renderStatusAction`과 분리하여 별도로 렌더링. FINALIZED가 아닌 모든 상태에서 표시.

현재 SETUP case:
```tsx
case "SETUP":
    return (
        <div className="flex items-center gap-2">
            <Button ... 삭제 버튼 .../>
            <Button ... PREP 버튼 .../>
        </div>
    );
```

변경: SETUP case에서 삭제 버튼 제거하고 PREP 버튼만 남김:
```tsx
case "SETUP":
    return (
        <Button
            size="sm"
            onClick={() => handleStatusChange("PREP")}
            className="bg-blue-600 hover:bg-blue-700 text-white"
        >
            {typedSession.type === "INDIVIDUAL" ? "세션 준비 완료 (PREP)" : "팀 확정 (PREP 시작)"}
        </Button>
    );
```

헤더 actions에 삭제 버튼 추가 (FINALIZED가 아닐 때만):
```tsx
actions={
    <div className="flex items-center gap-2">
        {typedSession.status !== "FINALIZED" && (
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
        )}
        {renderStatusAction()}
        <div className="h-6 w-px bg-white/10 mx-2" />
        {/* ... FINALIZED 뱃지, StatusBadge ... */}
    </div>
}
```

#### 프론트엔드: SessionList.tsx 삭제 아이콘 조건 변경

현재: `session.status === 'SETUP'`인 카드에만 Trash2 아이콘 표시.
변경: `session.status !== 'FINALIZED'`인 카드에 표시.

해당 조건 찾아서 변경:
```tsx
{session.status !== 'FINALIZED' && (
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
```

#### Step: Docker 재시작

```bash
cd /home/ubuntu/ops-platform
docker compose restart backend
sleep 5
```

#### Step: Commit

```bash
git add backend/app/routers/sessions.py \
        frontend/src/pages/session/SessionLayout.tsx \
        frontend/src/pages/SessionList.tsx
git commit -m "fix: session delete guard — block only when ledger entries exist or FINALIZED, show delete btn for all non-finalized states"
```

---

### Task 4: 비활성 멤버 재활성화

**Files:**
- Modify: `backend/app/schemas/member.py`
- Modify: `backend/app/routers/members.py`
- Modify: `frontend/src/hooks/useMembers.ts`
- Modify: `frontend/src/pages/MemberDetail.tsx`

#### 백엔드: MemberUpdate에 is_active 추가

`backend/app/schemas/member.py`의 `MemberUpdate` 클래스에 추가:

```python
class MemberUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=50)
    name_initial: Optional[str] = Field(None, max_length=10)
    email: Optional[str] = Field(None, max_length=200)
    tags: Optional[list[str]] = None
    is_active: Optional[bool] = None  # 재활성화용
```

#### 백엔드: update_member 핸들러 수정

`backend/app/routers/members.py`의 `update_member` 함수:

현재:
```python
update_data = body.model_dump(exclude_unset=True)
for field, value in update_data.items():
    setattr(member, field, value)
await db.commit()
await db.refresh(member)
return member
```

변경:
```python
update_data = body.model_dump(exclude_unset=True)
for field, value in update_data.items():
    setattr(member, field, value)
# 재활성화 시 deactivated_at 초기화
if update_data.get("is_active") is True:
    member.deactivated_at = None
await db.commit()
await db.refresh(member)
return member
```

#### 프론트엔드: useReactivateMember 훅 추가

`frontend/src/hooks/useMembers.ts` 끝에 추가:

```typescript
export function useReactivateMember() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => {
            const { data } = await api.patch<Member>(`/members/${id}`, { is_active: true });
            return data;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: membersKeys.lists() });
            queryClient.invalidateQueries({ queryKey: membersKeys.detail(data.id) });
            toast.success("멤버가 재활성화되었습니다.");
        },
        onError: (err: any) => {
            toast.error("재활성화 실패: " + (err?.response?.data?.detail ?? "알 수 없는 오류"));
        },
    });
}
```

hooks/index.ts에 자동 export 확인 (`export * from "./useMembers"` 있으면 OK).

#### 프론트엔드: MemberDetail.tsx에 재활성화 버튼 추가

`frontend/src/pages/MemberDetail.tsx` 수정:

1. Import 추가:
```tsx
import { useMember, useLedger, useDeactivateMember, useCreateTransaction, useReactivateMember } from "@/hooks";
```

2. 훅 호출 추가 (컴포넌트 내부):
```tsx
const reactivateMutation = useReactivateMember();
```

3. 비활성화 버튼 근처에 재활성화 버튼 추가 (member?.is_active 조건 분기):

현재 비활성화 버튼이 있는 위치(PageHeader actions나 별도 섹션)를 찾아 다음으로 교체:
```tsx
{member?.is_active ? (
    <Button
        variant="destructive"
        size="sm"
        onClick={() => {
            if (confirm(`${member.name}을(를) 비활성화하시겠습니까? 잔여 디파짓이 자동 환불됩니다.`)) {
                deactivateMutation.mutate(memberId, {
                    onSuccess: () => navigate("/members"),
                });
            }
        }}
        disabled={deactivateMutation.isPending}
        className="bg-red-900/50 hover:bg-red-800 border-red-700 text-red-200"
    >
        {deactivateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
        멤버 비활성화
    </Button>
) : (
    <Button
        size="sm"
        onClick={() => {
            if (confirm(`${member?.name}을(를) 재활성화하시겠습니까?`)) {
                reactivateMutation.mutate(memberId);
            }
        }}
        disabled={reactivateMutation.isPending}
        className="bg-green-900/50 hover:bg-green-800 border-green-700 text-green-200"
    >
        {reactivateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
        재활성화
    </Button>
)}
```

주의: 현재 `MemberDetail.tsx`를 먼저 읽어서 비활성화 버튼이 정확히 어디 있는지 파악하고, 해당 위치에 맞게 수정.

#### Step: Commit

```bash
git add backend/app/schemas/member.py backend/app/routers/members.py \
        frontend/src/hooks/useMembers.ts frontend/src/pages/MemberDetail.tsx
git commit -m "feat: member reactivation — add is_active to PATCH + reactivate button in MemberDetail"
```

---

### Task 5: 피드백 대상 지정 UI → OpsTab으로 이동

**Background:**
- 피드백(FEEDBACK) assignment는 세션 생성 시 모든 멤버에게 자동 생성됨.
- 각 멤버는 세션 중 특정 다른 멤버(들)에게 피드백을 줘야 함.
- 백엔드: `PATCH /sessions/{session_id}/assignments/{member_id}/feedback-targets` 이미 존재.
- 훅: `useSetFeedbackTargets` in `frontend/src/hooks/useSessions.ts` 이미 존재.
- OpsTab에서 출결이 확정된 후 피드백 대상을 지정하는 것이 논리적.

**Files:**
- Modify: `frontend/src/pages/session/OpsTab.tsx`

#### OpsTab.tsx에 피드백 대상 지정 UI 추가

먼저 `OpsTab.tsx` 전체를 읽어 현재 구조 파악.

현재 OpsTab에 없는 import 추가:
```tsx
import { useSetFeedbackTargets } from "@/hooks";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users } from "lucide-react";
```

컴포넌트 내에 훅 호출 추가:
```tsx
const { mutate: setFeedbackTargets } = useSetFeedbackTargets();
```

피드백 대상 지정 로직:
- `session.config?.has_feedback !== false`일 때만 표시
- FEEDBACK 타입 assignment 목록: `session.assignments?.filter(a => a.type === "FEEDBACK")`
- 출석 데이터에서 PRESENT/LATE 멤버를 후보로 제공
- 각 행: 피드백 작성자 이름 + 현재 target_member_ids + 드롭다운으로 대상 변경

피드백 패널 (Video Upload 아래, Quick Actions 위에 삽입):
```tsx
{session.config?.has_feedback !== false && (
    <div className="bg-[var(--color-surface)] p-6 rounded-xl border border-[var(--color-border)]">
        <div className="flex items-start justify-between mb-6">
            <div>
                <h3 className="font-bold text-lg mb-1 flex items-center gap-2">
                    <Users className="w-5 h-5 text-[var(--color-accent)]" />
                    피드백 대상 지정
                </h3>
                <p className="text-sm text-[var(--color-text-secondary)]">
                    각 멤버가 피드백을 작성할 대상을 지정합니다. (보통 1명, 결석 시 2명)
                </p>
            </div>
        </div>

        {(() => {
            const feedbackAssignments = session.assignments?.filter((a: any) => a.type === "FEEDBACK") || [];
            // 피드백 대상 후보: 세션에 출석하는 모든 멤버
            const attendances = session.attendances || [];
            const allMemberIds = attendances.map((a: any) => a.member_id);

            if (feedbackAssignments.length === 0) {
                return (
                    <p className="text-sm text-[var(--color-text-muted)] text-center py-4">
                        피드백 과제가 없거나 세션 데이터를 로딩 중입니다.
                    </p>
                );
            }

            return (
                <div className="rounded-md border border-[var(--color-border)] overflow-hidden">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-gray-900/50 hover:bg-gray-900/50">
                                <TableHead>피드백 작성자</TableHead>
                                <TableHead>피드백 대상 (지정)</TableHead>
                                <TableHead className="w-[80px] text-center">대상 수</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {feedbackAssignments.map((assignment: any) => {
                                const writerAttendance = attendances.find(
                                    (a: any) => a.member_id === assignment.member_id
                                );
                                const writerName = writerAttendance?.member_name
                                    ?? `ID:${assignment.member_id}`;

                                const currentTargetId = assignment.target_member_ids?.[0]
                                    ? String(assignment.target_member_ids[0])
                                    : "";

                                return (
                                    <TableRow key={assignment.id} className="hover:bg-white/5">
                                        <TableCell className="font-medium">{writerName}</TableCell>
                                        <TableCell>
                                            <Select
                                                value={currentTargetId}
                                                onValueChange={(val) => {
                                                    setFeedbackTargets({
                                                        sessionId: session.id,
                                                        memberId: assignment.member_id,
                                                        targetMemberIds: val ? [parseInt(val)] : [],
                                                    });
                                                }}
                                            >
                                                <SelectTrigger className="w-[180px]">
                                                    <SelectValue placeholder="대상 선택..." />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="">미지정</SelectItem>
                                                    {allMemberIds
                                                        .filter((id: number) => id !== assignment.member_id)
                                                        .map((id: number) => {
                                                            const att = attendances.find((a: any) => a.member_id === id);
                                                            const name = att?.member_name ?? `ID:${id}`;
                                                            return (
                                                                <SelectItem key={id} value={String(id)}>
                                                                    {name}
                                                                </SelectItem>
                                                            );
                                                        })
                                                    }
                                                </SelectContent>
                                            </Select>
                                        </TableCell>
                                        <TableCell className="text-center text-sm text-[var(--color-text-muted)]">
                                            {assignment.target_member_ids?.length ?? 0}명
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            );
        })()}
    </div>
)}
```

주의:
- `session.attendances`에서 `member_name`이 있는지 확인 — 없으면 `session.teams`나 members 목록으로 이름 조회 필요
- `session` 타입(Session from useSessions.ts)에 `assignments`, `attendances`가 있는지 확인
- 만약 이름 매핑이 필요하면: `useMembers()` 호출 후 id→name Map 사용

실제로 OpsTab.tsx를 읽으면 session에는 `attendances`와 `assignments`가 있을 수 있는데, 세션 상세 API가 이를 eager load하는지 확인.
SessionLayout.tsx에서 `useSession(sessionId)` → 이미 teams, attendance, assignments를 eager load.

이름 조회를 위해 `useMembers` 추가가 필요할 수 있음. 실제 코드를 먼저 읽고 판단.

#### Step: Commit

```bash
git add frontend/src/pages/session/OpsTab.tsx
git commit -m "feat: add feedback target designation UI in OpsTab"
```

---

## 실행 순서

1. Task 1 + 2 (Ledger 편집) — 백엔드 먼저, 프론트엔드 후
2. Task 3 (Session delete guard) — 백엔드 먼저, 프론트엔드 후
3. Task 4 (Member reactivation)
4. Task 5 (Feedback OpsTab) — 순수 프론트엔드

각 Task 후 `docker compose restart backend` (백엔드 변경 시).
