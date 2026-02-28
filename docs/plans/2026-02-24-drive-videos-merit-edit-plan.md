# Drive Video List + Merit Edit/Delete Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Drive video list preview in OpsTab and edit/delete actions on session merit entries in SettlementTab.

**Architecture:** Two independent features. (1) New `GET /crawler/drive-videos` endpoint wraps the existing `list_drive_videos()` function with async thread offload; frontend fetches on-demand and renders inline. (2) New `DELETE /ledger/{id}` endpoint reverses balance effects then hard-deletes; frontend adds hover edit/delete controls to MeritPanel rows.

**Tech Stack:** FastAPI + SQLAlchemy async (backend), React 19 + TanStack Query v5 + shadcn/ui (frontend)

---

### Task 1: Backend — `GET /crawler/drive-videos` endpoint

**Files:**
- Modify: `backend/app/routers/crawler.py`
- Modify: `backend/app/schemas/crawler.py`

**Step 1: Add response schema to `crawler.py`**

In `backend/app/schemas/crawler.py`, add after existing schemas:

```python
class DriveVideoItem(BaseModel):
    id: str
    name: str
    presenter: str
    order: int  # parsed from (N번째), 9999 if absent

class DriveVideoListResponse(BaseModel):
    videos: list[DriveVideoItem]
```

**Step 2: Add endpoint to `backend/app/routers/crawler.py`**

Add imports at top:
```python
import asyncio
from app.models import Session as SessionModel
```

Add after the `/sync-boards` endpoint:

```python
@router.get("/drive-videos", response_model=DriveVideoListResponse)
async def list_drive_videos_api(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """드라이브 영상 목록 조회 (Google Drive API, 동기 → thread offload)"""
    from app.services.crawler_video import list_drive_videos, parse_presenter_name
    import re

    session = await db.get(SessionModel, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    try:
        files = await asyncio.to_thread(list_drive_videos, session.week_num)
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Drive API 오류: {e}")

    def parse_order(name: str) -> int:
        m = re.search(r'\((\d+)번째\)', name)
        return int(m.group(1)) if m else 9999

    videos = [
        DriveVideoItem(
            id=f["id"],
            name=f["name"],
            presenter=parse_presenter_name(f["name"]),
            order=parse_order(f["name"]),
        )
        for f in files
    ]
    return DriveVideoListResponse(videos=videos)
```

**Step 3: Import schema in router**

Add to imports in `crawler.py`:
```python
from app.schemas.crawler import (
    ...
    DriveVideoListResponse,
)
```

**Step 4: Verify backend starts cleanly**

```bash
docker compose restart backend && sleep 3 && docker compose logs backend --tail 20
```
Expected: no import errors, `Application startup complete`

**Step 5: Commit**

```bash
git add backend/app/schemas/crawler.py backend/app/routers/crawler.py
git commit -m "feat: GET /crawler/drive-videos endpoint"
```

---

### Task 2: Backend — `DELETE /ledger/{ledger_id}` endpoint

**Files:**
- Modify: `backend/app/routers/ledger.py`

**Step 1: Add DELETE endpoint at end of `ledger.py`**

```python
@router.delete("/{ledger_id}", status_code=204)
async def delete_ledger_entry(
    ledger_id: int,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """
    원장 항목 삭제 — amount_krw·score_delta 효과 역전 후 행 삭제
    """
    entry = await db.get(Ledger, ledger_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Ledger entry not found")

    member = await db.get(Member, entry.member_id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    # 잔액 효과 역전
    if entry.amount_krw != 0:
        member.current_deposit -= entry.amount_krw

    # 점수 효과 역전
    if entry.score_delta > 0:
        member.total_plus_score = max(0, member.total_plus_score - entry.score_delta)
    elif entry.score_delta < 0:
        member.total_minus_score = min(0, member.total_minus_score - entry.score_delta)

    if entry.score_delta != 0:
        member.net_score = member.total_plus_score + member.total_minus_score

    await db.delete(entry)
    await db.commit()
```

**Step 2: Restart and verify**

```bash
docker compose restart backend && sleep 3 && docker compose logs backend --tail 10
```

**Step 3: Commit**

```bash
git add backend/app/routers/ledger.py
git commit -m "feat: DELETE /ledger/{ledger_id} with balance reversal"
```

---

### Task 3: Frontend hooks

**Files:**
- Modify: `frontend/src/hooks/useCrawler.ts`
- Modify: `frontend/src/hooks/useLedger.ts`

**Step 1: Add `useDriveVideos` to `useCrawler.ts`**

Add interface and hook at end of file:

```typescript
export interface DriveVideoItem {
    id: string;
    name: string;
    presenter: string;
    order: number;
}

export function useDriveVideos() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (sessionId: number) => {
            const { data } = await api.get<{ videos: DriveVideoItem[] }>(
                `/crawler/drive-videos?session_id=${sessionId}`
            );
            return data.videos;
        },
        onError: () => {
            toast.error("드라이브 영상 목록 조회 실패");
        },
    });
}
```

Also add `useQueryClient` to the tanstack-query import if not already present.

**Step 2: Add `useDeleteLedgerEntry` to `useLedger.ts`**

Add at end of file:

```typescript
export function useDeleteLedgerEntry() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => {
            await api.delete(`/ledger/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["ledger"] });
            queryClient.invalidateQueries({ queryKey: ["members"] });
            toast.success("삭제되었습니다.");
        },
        onError: () => {
            toast.error("삭제 실패");
        },
    });
}
```

**Step 3: Export from `index.ts`** (already exports `* from "./useCrawler"` and `* from "./useLedger"` — nothing to add)

**Step 4: TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors

**Step 5: Commit**

```bash
git add frontend/src/hooks/useCrawler.ts frontend/src/hooks/useLedger.ts
git commit -m "feat: useDriveVideos + useDeleteLedgerEntry hooks"
```

---

### Task 4: Frontend — Drive video list in OpsTab

**Files:**
- Modify: `frontend/src/pages/session/OpsTab.tsx`

**Step 1: Add imports at top of OpsTab.tsx**

Add to existing import block:
```typescript
import { useDriveVideos, type DriveVideoItem } from "@/hooks";
```

Add `Film` to lucide imports.

**Step 2: Add state and hook usage inside `OpsTab` component**

After `const { mutate: uploadVideos, ... }` line:
```typescript
const { mutate: fetchDriveVideos, isPending: isLoadingDrive, data: driveVideos } = useDriveVideos();
```

**Step 3: Replace the Video Upload panel header section**

Change the header from:
```tsx
<div className="flex items-start justify-between mb-6">
    <div>...</div>
    <Button onClick={handleCafeUpload} ...>Start Upload Process</Button>
</div>
```

To:
```tsx
<div className="flex items-start justify-between mb-4">
    <div>
        <h3 className="font-bold text-lg mb-1">Video Upload</h3>
        <p className="text-sm text-[var(--color-text-secondary)]">
            구글 드라이브 영상을 다운로드하여 네이버 카페에 업로드합니다.
        </p>
    </div>
    <div className="flex items-center gap-2">
        <Button
            variant="outline"
            onClick={() => fetchDriveVideos(session.id)}
            disabled={isLoadingDrive}
            className="border-[var(--color-border)] hover:bg-white/5"
        >
            {isLoadingDrive
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <Film className="w-4 h-4 mr-2" />}
            드라이브 확인
        </Button>
        <Button onClick={handleCafeUpload} disabled={isUploading} className="bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]">
            <UploadCloud className="w-4 h-4 mr-2" />
            {isUploading ? "Starting..." : "업로드 시작"}
        </Button>
    </div>
</div>
```

**Step 4: Add drive video list panel between header and task status**

After the header div and before `{renderTaskStatus()}`:

```tsx
{/* Drive Video List */}
{driveVideos !== undefined && (
    <div className="mb-4 rounded-lg border border-[var(--color-border)] overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-900/40 border-b border-[var(--color-border)]">
            <Film className="w-4 h-4 text-[var(--color-accent)]" />
            <span className="text-sm font-medium">드라이브 영상 목록</span>
            <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/20">
                총 {driveVideos.length}개
            </span>
        </div>
        {driveVideos.length === 0 ? (
            <div className="py-8 text-center text-sm text-[var(--color-text-muted)]">
                드라이브에 영상이 없습니다.
            </div>
        ) : (
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)] text-xs">
                        <th className="text-left px-4 py-2 w-[60px]">순서</th>
                        <th className="text-left px-4 py-2">파일명</th>
                        <th className="text-left px-4 py-2 w-[120px]">발표자</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                    {[...driveVideos]
                        .sort((a, b) => a.order - b.order)
                        .map((v) => (
                            <tr key={v.id} className="hover:bg-white/5">
                                <td className="px-4 py-2 font-mono text-[var(--color-text-muted)] text-xs">
                                    {v.order === 9999 ? "-" : `${v.order}번째`}
                                </td>
                                <td className="px-4 py-2 text-gray-300 font-mono text-xs truncate max-w-[300px]" title={v.name}>
                                    {v.name}
                                </td>
                                <td className="px-4 py-2 font-medium text-gray-200">{v.presenter}</td>
                            </tr>
                        ))}
                </tbody>
            </table>
        )}
    </div>
)}
```

**Step 5: TypeScript check + verify no regressions**

```bash
cd frontend && npx tsc --noEmit
```

**Step 6: Commit**

```bash
git add frontend/src/pages/session/OpsTab.tsx
git commit -m "feat: drive video list inline panel in OpsTab"
```

---

### Task 5: Frontend — Merit edit/delete in SettlementTab

**Files:**
- Modify: `frontend/src/pages/session/SettlementTab.tsx`

**Step 1: Add imports**

Add to existing imports:
```typescript
import { useDeleteLedgerEntry, useUpdateLedger } from "@/hooks/useLedger";
import { Pencil, Trash2 } from "lucide-react";
```
(Trophy, Table, etc. already imported)

**Step 2: Update `MeritPanel` to accept and use edit/delete hooks**

Replace the current `MeritPanel` function with the version below. Key changes:
- Row shows pencil + trash on hover (`group/row`, `group-hover/row:flex`)
- Inline edit popover (score + reason) using `Popover` + `Command` — or simpler: just a small controlled form in a `Popover`
- Delete calls `useDeleteLedgerEntry`

```tsx
function MeritPanel({
    sessionId,
    merits,
    memberNameMap,
}: {
    sessionId: number;
    merits: MeritEntry[];
    memberNameMap: Map<number, string>;
}) {
    const { mutate: deleteMerit, isPending: isDeleting } = useDeleteLedgerEntry();
    const { mutate: updateMerit, isPending: isUpdating } = useUpdateLedger();

    return (
        <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
                <div className="flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-yellow-500" />
                    <h3 className="font-semibold text-sm">이 세션 상점 내역</h3>
                    {merits.length > 0 && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                            {merits.length}건
                        </span>
                    )}
                </div>
                <GrantMeritDialog
                    sessionId={sessionId}
                    trigger={
                        <Button size="sm" variant="outline" className="h-7 text-xs bg-yellow-500/10 text-yellow-400 border-yellow-500/20 hover:bg-yellow-500/20">
                            <Trophy className="w-3 h-3 mr-1" />
                            상점 부여
                        </Button>
                    }
                />
            </div>
            <Table>
                <TableHeader>
                    <TableRow className="bg-gray-900/30 hover:bg-gray-900/30">
                        <TableHead>멤버</TableHead>
                        <TableHead>사유</TableHead>
                        <TableHead className="text-right w-[80px]">점수</TableHead>
                        <TableHead className="text-right w-[120px] text-[var(--color-text-muted)] font-normal text-xs">일시</TableHead>
                        <TableHead className="w-[72px]" />
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {merits.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={5} className="text-center py-8 text-[var(--color-text-muted)] text-sm">
                                이 세션에 부여된 상점이 없습니다.
                            </TableCell>
                        </TableRow>
                    ) : (
                        merits.map((entry) => (
                            <MeritRow
                                key={entry.id}
                                entry={entry}
                                memberName={memberNameMap.get(entry.member_id) ?? `ID:${entry.member_id}`}
                                onDelete={() => deleteMerit(entry.id)}
                                onUpdate={(data) => updateMerit({ id: entry.id, data })}
                                isDeleting={isDeleting}
                                isUpdating={isUpdating}
                            />
                        ))
                    )}
                </TableBody>
            </Table>
        </div>
    );
}
```

**Step 3: Add `MeritRow` sub-component below `MeritPanel`**

```tsx
function MeritRow({
    entry,
    memberName,
    onDelete,
    onUpdate,
    isDeleting,
    isUpdating,
}: {
    entry: MeritEntry;
    memberName: string;
    onDelete: () => void;
    onUpdate: (data: { score_delta?: number; description?: string }) => void;
    isDeleting: boolean;
    isUpdating: boolean;
}) {
    const [editOpen, setEditOpen] = useState(false);
    const [editScore, setEditScore] = useState(entry.score_delta);
    const [editReason, setEditReason] = useState(entry.description);

    // Reset edit fields when entry changes
    React.useEffect(() => {
        setEditScore(entry.score_delta);
        setEditReason(entry.description);
    }, [entry.score_delta, entry.description]);

    const handleSave = () => {
        onUpdate({ score_delta: editScore, description: editReason });
        setEditOpen(false);
    };

    return (
        <TableRow className="group/row hover:bg-white/5">
            <TableCell className="font-medium text-gray-300">{memberName}</TableCell>
            <TableCell className="text-sm text-[var(--color-text-secondary)]">{entry.description}</TableCell>
            <TableCell className="text-right font-mono text-green-400">+{entry.score_delta}</TableCell>
            <TableCell className="text-right text-xs font-mono text-[var(--color-text-muted)]">
                {new Date(entry.created_at).toLocaleDateString()}
            </TableCell>
            <TableCell>
                <div className="flex items-center justify-end gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
                    {/* Edit Popover */}
                    <Popover open={editOpen} onOpenChange={setEditOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 hover:bg-white/10"
                                disabled={isUpdating}
                            >
                                <Pencil className="w-3 h-3" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 bg-[var(--color-elevated)] border-[var(--color-border)] p-3" align="end">
                            <div className="space-y-3">
                                <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase">상점 수정</p>
                                <div className="space-y-1">
                                    <label className="text-xs text-[var(--color-text-muted)]">점수</label>
                                    <Input
                                        type="number"
                                        value={editScore}
                                        onChange={(e) => setEditScore(Number(e.target.value))}
                                        className="h-7 text-sm bg-transparent border-[var(--color-border)]"
                                        min={1}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-[var(--color-text-muted)]">사유</label>
                                    <Input
                                        value={editReason}
                                        onChange={(e) => setEditReason(e.target.value)}
                                        className="h-7 text-sm bg-transparent border-[var(--color-border)]"
                                    />
                                </div>
                                <Button
                                    size="sm"
                                    onClick={handleSave}
                                    disabled={isUpdating || !editReason}
                                    className="w-full h-7 text-xs bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]"
                                >
                                    저장
                                </Button>
                            </div>
                        </PopoverContent>
                    </Popover>

                    {/* Delete */}
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 hover:bg-rose-500/10 hover:text-rose-400"
                        onClick={onDelete}
                        disabled={isDeleting}
                    >
                        <Trash2 className="w-3 h-3" />
                    </Button>
                </div>
            </TableCell>
        </TableRow>
    );
}
```

**Step 4: Add missing imports to SettlementTab**

At top of file, ensure these are present:
```typescript
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Pencil, Trash2 } from "lucide-react";
import { useDeleteLedgerEntry, useUpdateLedger } from "@/hooks/useLedger";
import React from "react";
```

**Step 5: TypeScript check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors

**Step 6: Commit**

```bash
git add frontend/src/pages/session/SettlementTab.tsx
git commit -m "feat: merit edit/delete in SettlementTab MeritPanel"
```
