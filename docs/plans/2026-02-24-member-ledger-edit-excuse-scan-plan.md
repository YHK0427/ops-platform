# Member Ledger Edit + PrepTab Excuse Scan Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** (1) Add inline edit/delete to each ledger row in MemberDetail; (2) Replace PrepTab's Homework Scan panel with an excuse letter scanner that reads a Naver Cafe board and updates attendance records.

**Architecture:** Feature 1 is pure frontend — extract `LedgerRow` sub-component with hover-reveal Popover (edit) and trash (delete) buttons, reusing existing `useUpdateLedger`/`useDeleteLedgerEntry` hooks. Feature 2 spans backend (new `crawler_excuse.py` service, ARQ task, endpoint) and frontend (new hook + PrepTab panel replacement). The excuse scanner stores `excuse_type` and `excuse_text` directly on `Attendance` records so the PrepTab can display them from the already-loaded session data.

**Tech Stack:** FastAPI + SQLAlchemy async (backend), ARQ (worker), React 19 + TanStack Query v5 + shadcn/ui Popover (frontend)

---

### Task 1: Backend — `crawler_excuse.py` service + config

**Files:**
- Modify: `backend/app/config.py`
- Create: `backend/app/services/crawler_excuse.py`

**Context:**
The project already has `NAVER_CAFE_MENU_REVIEW`, `NAVER_CAFE_MENU_HOMEWORK`, `NAVER_CAFE_MENU_VIDEO` in `config.py`. Add `NAVER_CAFE_MENU_EXCUSE` the same way. The `.env` already has this value set.

The crawler pattern is established in `crawler_homework.py`: get a requests session, loop board pages, match members, fetch article details. Here we also extract the **article body** from the detail response (`message.result.article.contentHtml`) and strip HTML tags.

**Step 1: Add config field**

In `backend/app/config.py`, add after `NAVER_CAFE_MENU_HOMEWORK`:

```python
NAVER_CAFE_MENU_EXCUSE: int = 0
```

**Step 2: Create `backend/app/services/crawler_excuse.py`**

```python
import logging
import re
from html.parser import HTMLParser

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Attendance, Member
from app.services.crawler_cafe import (
    extract_name_from_title,
    fetch_article_detail,
    fetch_board_articles,
    match_member_by_name,
)
from app.services.naver_session import get_valid_requests_session

logger = logging.getLogger(__name__)


class _HTMLStripper(HTMLParser):
    def __init__(self):
        super().__init__()
        self._parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self._parts.append(data)

    def get_text(self) -> str:
        return " ".join(self._parts).strip()


def _strip_html(html: str) -> str:
    s = _HTMLStripper()
    s.feed(html)
    return s.get_text()


def _is_match_week(title: str, week_num: int) -> bool:
    pattern = rf"(?<!\d){week_num}(?!\d)\s*주차|Week\s*{week_num}(?!\d)"
    return bool(re.search(pattern, title, re.IGNORECASE))


async def scan_excuses(
    session_id: int,
    week_num: int,
    members: list[Member],
    mode: str,  # "PRE" or "POST"
    db: AsyncSession,
) -> int:
    """
    사유서 게시판(NAVER_CAFE_MENU_EXCUSE)을 스캔하여 Attendance 레코드 업데이트.
    - PRE 모드: 해당 주차 글을 찾아 매칭된 멤버의 excuse_type="PRE", excuse_text=본문 저장
    - POST 모드: 결석/지각 중 excuse_type 미설정 멤버의 글만 처리, excuse_type="POST" 저장
    """
    req_session = await get_valid_requests_session(db)
    if req_session is None:
        logger.error("No valid Naver session — skipping excuse scan")
        return 0

    menu_id = settings.NAVER_CAFE_MENU_EXCUSE
    if not menu_id:
        logger.error("NAVER_CAFE_MENU_EXCUSE not configured")
        return 0

    # POST 모드: 대상 멤버 사전 필터링 (PRESENT 아니고 excuse_type 미설정)
    target_member_ids: set[int] | None = None
    if mode == "POST":
        stmt = select(Attendance).where(
            Attendance.session_id == session_id,
            Attendance.status != "PRESENT",
            Attendance.excuse_type.is_(None),
        )
        result = await db.execute(stmt)
        target_member_ids = {a.member_id for a in result.scalars().all()}
        if not target_member_ids:
            logger.info("POST mode: no unexcused absent members found")
            return 0

    # 게시판 스캔 (최대 3페이지)
    articles = []
    for page in range(1, 4):
        data = fetch_board_articles(req_session, menu_id, page=page)
        items = data.get("message", {}).get("result", {}).get("articleList", [])
        if not items:
            break
        articles.extend(items)

    count = 0
    for article in articles:
        title = article.get("subject", "")
        writer_nick = article.get("writer", {}).get("nick", "")

        if not _is_match_week(title, week_num):
            continue

        # 멤버 매칭 (제목 → 닉네임 순서로 시도)
        extracted = extract_name_from_title(title)
        member = match_member_by_name(extracted, members) if extracted else None
        if not member and writer_nick:
            member = match_member_by_name(writer_nick, members)
        if not member:
            logger.warning(f"No member match for article: {title}")
            continue

        # POST 모드: 대상 멤버만 처리
        if target_member_ids is not None and member.id not in target_member_ids:
            continue

        # 게시글 본문 추출
        article_id = article.get("articleId") or article.get("article_id")
        excuse_text = ""
        if article_id:
            try:
                detail = fetch_article_detail(req_session, int(article_id))
                content_html = (
                    detail.get("message", {})
                          .get("result", {})
                          .get("article", {})
                          .get("contentHtml", "")
                )
                excuse_text = _strip_html(content_html)
            except Exception as e:
                logger.warning(f"Failed to fetch article detail {article_id}: {e}")

        # Attendance 업데이트
        stmt = select(Attendance).where(
            Attendance.session_id == session_id,
            Attendance.member_id == member.id,
        )
        result = await db.execute(stmt)
        attendance = result.scalar_one_or_none()
        if attendance:
            attendance.excuse_type = mode
            attendance.excuse_text = excuse_text
            count += 1
        else:
            logger.warning(f"No attendance record for member {member.id} in session {session_id}")

    await db.commit()
    return count
```

**Step 3: Restart backend and verify**

```bash
cd /home/ubuntu/ops-platform
docker compose restart backend
sleep 5
docker compose logs backend --tail 10
```
Expected: "Application startup complete", no import errors.

**Step 4: Commit**

```bash
git add backend/app/config.py backend/app/services/crawler_excuse.py
git commit -m "feat: crawler_excuse service + NAVER_CAFE_MENU_EXCUSE config"
```

---

### Task 2: Backend — schema + endpoint + worker task

**Files:**
- Modify: `backend/app/schemas/crawler.py`
- Modify: `backend/app/routers/crawler.py`
- Modify: `backend/app/worker.py`

**Context:**
Follows the exact same ARQ job pattern as `scan-homework`:
- Add `ScanExcusesRequest` schema
- Add `POST /crawler/scan-excuses` router endpoint
- Add `task_scan_excuses` worker function registered in `WorkerSettings.functions`

**Step 1: Add schema to `backend/app/schemas/crawler.py`**

Append at end of file:
```python
class ScanExcusesRequest(BaseModel):
    session_id: int
    mode: str  # "PRE" or "POST"
```

**Step 2: Add endpoint to `backend/app/routers/crawler.py`**

First, add `ScanExcusesRequest` to the existing import from `app.schemas.crawler` (it's a long import list at the top).

Then append after the `/scan-homework` endpoint:

```python
@router.post("/scan-excuses", response_model=CrawlerTaskResponse)
async def start_scan_excuses(
    request: Request,
    body: ScanExcusesRequest,
    _: str = Depends(get_current_user),
):
    """사유서 게시판 스캔 태스크 시작 (PRE/POST 모드)"""
    pool = getattr(request.app.state, "arq_pool", None)
    if not pool:
        raise HTTPException(status_code=503, detail="ARQ pool not initialized")

    job = await pool.enqueue_job(
        "task_scan_excuses",
        session_id=body.session_id,
        mode=body.mode,
    )
    return CrawlerTaskResponse(task_id=job.job_id, status="queued")
```

**Step 3: Add worker task to `backend/app/worker.py`**

Add import at top (with other crawler service imports):
```python
from app.services.crawler_excuse import scan_excuses
```

Add task function after `task_scan_homework`:
```python
async def task_scan_excuses(ctx, session_id: int, mode: str):
    """사유서 스캔 태스크 (PRE or POST 모드)"""
    async with AsyncSessionLocal() as db:
        session = await db.get(Session, session_id)
        if not session:
            return {"status": "failed", "reason": "Session not found"}

        result = await db.execute(select(Member).where(Member.is_active == True))
        members = result.scalars().all()

        count = await scan_excuses(session.id, session.week_num, members, mode, db)
        return {"status": "complete", "excuse_count": count, "mode": mode}
```

Add `task_scan_excuses` to `WorkerSettings.functions` list:
```python
class WorkerSettings:
    functions = [task_scan_ppt, task_scan_homework, task_scan_excuses, task_upload_videos, task_naver_login, task_sync_cafe_boards]
    ...
```

**Step 4: Restart backend + worker and verify**

```bash
docker compose restart backend worker
sleep 5
docker compose logs backend --tail 5
docker compose logs worker --tail 5
```
Expected: no errors.

**Step 5: Commit**

```bash
git add backend/app/schemas/crawler.py backend/app/routers/crawler.py backend/app/worker.py
git commit -m "feat: POST /crawler/scan-excuses endpoint + task_scan_excuses worker"
```

---

### Task 3: Frontend — `useScanExcuses` hook + Session type update

**Files:**
- Modify: `frontend/src/hooks/useCrawler.ts`
- Modify: `frontend/src/hooks/useSessions.ts`

**Context:**
Add `useScanExcuses` to `useCrawler.ts` following the same pattern as `useScanPPT`.
Also update the `Session` type's `attendances` field to include `excuse_text` (currently missing — the backend already serializes it, but the TypeScript type doesn't declare it).

**Step 1: Add `useScanExcuses` to `frontend/src/hooks/useCrawler.ts`**

Append after `useDriveVideos`:
```typescript
export function useScanExcuses() {
    return useMutation({
        mutationFn: async ({ sessionId, mode }: { sessionId: number; mode: "PRE" | "POST" }) => {
            const { data } = await api.post<CrawlerTaskResponse>("/crawler/scan-excuses", {
                session_id: sessionId,
                mode,
            });
            return data;
        },
    });
}
```

**Step 2: Update `Session` type in `frontend/src/hooks/useSessions.ts`**

Find (lines 24-28):
```typescript
    attendances?: {
        member_id: number;
        status: string;
        excuse_type?: string;
    }[];
```

Replace with:
```typescript
    attendances?: {
        member_id: number;
        status: string;
        excuse_type?: string | null;
        excuse_text?: string | null;
    }[];
```

**Step 3: TypeScript check**

```bash
docker exec ops-platform-frontend-dev-1 npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

**Step 4: Commit**

```bash
git add frontend/src/hooks/useCrawler.ts frontend/src/hooks/useSessions.ts
git commit -m "feat: useScanExcuses hook + Session.attendances excuse_text type"
```

---

### Task 4: Frontend — MemberDetail ledger edit/delete

**Files:**
- Modify: `frontend/src/pages/MemberDetail.tsx`

**Context:**
Currently the ledger table (lines 205–245) has 5 read-only columns: Date, Type, Description, Amount, Balance.
The pattern to follow is `MeritRow` in `SettlementTab.tsx` (lines 336–432):
- `group/row` + `group-hover/row:opacity-100` for hover-reveal
- Pencil → Popover with inputs + save button
- Trash → immediate delete, no confirm

**Current imports to know:**
- `Pencil` is already imported from lucide-react
- `Dialog`, `DialogContent`, etc. are already imported
- `Input`, `Label`, `Select*`, `Button`, `Table*` are imported
- Missing: `useEffect` from react, `Popover*` from shadcn, `Trash2` from lucide, `useUpdateLedger`/`useDeleteLedgerEntry` from hooks

**Step 1: Update imports in `MemberDetail.tsx`**

Change:
```typescript
import { useState } from "react";
```
To:
```typescript
import { useState, useEffect } from "react";
```

Change the lucide-react import (currently includes `Pencil`), add `Trash2`:
```typescript
import {
    ArrowLeft,
    CreditCard,
    History,
    Loader2,
    ShieldAlert,
    Trophy,
    Pencil,
    Trash2,
} from "lucide-react";
```

Change the hooks import line:
```typescript
import { useMember, useLedger, useDeactivateMember, useReactivateMember, useCreateTransaction, useUpdateLedger, useDeleteLedgerEntry } from "@/hooks";
```

Add Popover imports (after the existing Dialog imports):
```typescript
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
```

**Step 2: Add mutation hooks inside `MemberDetail` component**

After the existing `const { mutate: createTransaction, isPending: isCreatingTx } = useCreateTransaction();` line, add:
```typescript
const { mutate: updateEntry, isPending: isUpdating } = useUpdateLedger();
const { mutate: deleteEntry, isPending: isDeleting } = useDeleteLedgerEntry();
```

**Step 3: Replace the table `<TableHeader>` and `<TableBody>` content**

Find the `<TableHeader>` block (lines 206–213):
```tsx
                        <TableHeader className="bg-[var(--color-surface)]">
                            <TableRow className="border-b-[var(--color-border)] hover:bg-transparent">
                                <TableHead className="w-[120px] text-[var(--color-text-muted)]">Date</TableHead>
                                <TableHead className="text-[var(--color-text-muted)]">Type</TableHead>
                                <TableHead className="text-[var(--color-text-muted)]">Description</TableHead>
                                <TableHead className="text-right text-[var(--color-text-muted)]">Amount</TableHead>
                                <TableHead className="text-right text-[var(--color-text-muted)]">Balance</TableHead>
                            </TableRow>
                        </TableHeader>
```

Replace with (add Actions column):
```tsx
                        <TableHeader className="bg-[var(--color-surface)]">
                            <TableRow className="border-b-[var(--color-border)] hover:bg-transparent">
                                <TableHead className="w-[120px] text-[var(--color-text-muted)]">Date</TableHead>
                                <TableHead className="text-[var(--color-text-muted)]">Type</TableHead>
                                <TableHead className="text-[var(--color-text-muted)]">Description</TableHead>
                                <TableHead className="text-right text-[var(--color-text-muted)]">Amount</TableHead>
                                <TableHead className="text-right text-[var(--color-text-muted)]">Balance</TableHead>
                                <TableHead className="w-[72px]" />
                            </TableRow>
                        </TableHeader>
```

Find the `<TableBody>` block (lines 215–244):
```tsx
                            <TableBody>
                                {ledger?.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-24 text-center text-[var(--color-text-muted)]">
                                            내역이 없습니다.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    ledger?.map((entry) => (
                                        <TableRow key={entry.id} className="border-b-[var(--color-border-subtle)] hover:bg-[var(--color-hover)]">
                                            <TableCell className="text-xs font-mono text-[var(--color-text-muted)]">
                                                {new Date(entry.created_at).toLocaleDateString()}
                                            </TableCell>
                                            <TableCell>
                                                <LedgerTypeBadge type={entry.type} />
                                            </TableCell>
                                            <TableCell className="text-sm text-[var(--color-text-secondary)]">
                                                {entry.description}
                                            </TableCell>
                                            <TableCell className={`text-right font-mono text-sm ${entry.amount_krw > 0 ? "text-green-400" : "text-rose-400"}`}>
                                                {entry.amount_krw > 0 ? "+" : ""}{entry.amount_krw.toLocaleString()}
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-sm text-[var(--color-text-muted)]">
                                                {entry.deposit_after.toLocaleString()}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
```

Replace with:
```tsx
                            <TableBody>
                                {ledger?.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="h-24 text-center text-[var(--color-text-muted)]">
                                            내역이 없습니다.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    ledger?.map((entry) => (
                                        <LedgerRow
                                            key={entry.id}
                                            entry={entry}
                                            onDelete={() => deleteEntry(entry.id)}
                                            onUpdate={(data) => updateEntry({ id: entry.id, data })}
                                            isDeleting={isDeleting}
                                            isUpdating={isUpdating}
                                        />
                                    ))
                                )}
                            </TableBody>
```

**Step 4: Add `LedgerRow` sub-component after `MemberDetail` function and before `LedgerTypeBadge`**

Add this between the closing `}` of `MemberDetail` and the `function LedgerTypeBadge`:

```tsx
function LedgerRow({
    entry,
    onDelete,
    onUpdate,
    isDeleting,
    isUpdating,
}: {
    entry: LedgerEntry;
    onDelete: () => void;
    onUpdate: (data: { amount_krw?: number; description?: string }) => void;
    isDeleting: boolean;
    isUpdating: boolean;
}) {
    const [editOpen, setEditOpen] = useState(false);
    const [editAmount, setEditAmount] = useState(entry.amount_krw);
    const [editDesc, setEditDesc] = useState(entry.description);

    useEffect(() => {
        setEditAmount(entry.amount_krw);
        setEditDesc(entry.description);
    }, [entry.amount_krw, entry.description]);

    const handleSave = () => {
        onUpdate({ amount_krw: editAmount, description: editDesc });
        setEditOpen(false);
    };

    return (
        <TableRow className="group/row border-b-[var(--color-border-subtle)] hover:bg-[var(--color-hover)]">
            <TableCell className="text-xs font-mono text-[var(--color-text-muted)]">
                {new Date(entry.created_at).toLocaleDateString()}
            </TableCell>
            <TableCell>
                <LedgerTypeBadge type={entry.type} />
            </TableCell>
            <TableCell className="text-sm text-[var(--color-text-secondary)]">
                {entry.description}
            </TableCell>
            <TableCell className={`text-right font-mono text-sm ${entry.amount_krw > 0 ? "text-green-400" : "text-rose-400"}`}>
                {entry.amount_krw > 0 ? "+" : ""}{entry.amount_krw.toLocaleString()}
            </TableCell>
            <TableCell className="text-right font-mono text-sm text-[var(--color-text-muted)]">
                {entry.deposit_after.toLocaleString()}
            </TableCell>
            <TableCell>
                <div className="flex items-center justify-end gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
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
                        <PopoverContent
                            className="w-64 bg-[var(--color-elevated)] border-[var(--color-border)] p-3"
                            align="end"
                        >
                            <div className="space-y-3">
                                <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase">원장 수정</p>
                                <div className="space-y-1">
                                    <label className="text-xs text-[var(--color-text-muted)]">금액 (KRW)</label>
                                    <Input
                                        type="number"
                                        value={editAmount}
                                        onChange={(e) => setEditAmount(Number(e.target.value))}
                                        className="h-7 text-sm bg-transparent border-[var(--color-border)]"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-[var(--color-text-muted)]">사유</label>
                                    <Input
                                        value={editDesc}
                                        onChange={(e) => setEditDesc(e.target.value)}
                                        className="h-7 text-sm bg-transparent border-[var(--color-border)]"
                                    />
                                </div>
                                <Button
                                    size="sm"
                                    onClick={handleSave}
                                    disabled={isUpdating || !editDesc}
                                    className="w-full h-7 text-xs bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]"
                                >
                                    저장
                                </Button>
                            </div>
                        </PopoverContent>
                    </Popover>

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

**Step 5: TypeScript check**

```bash
docker exec ops-platform-frontend-dev-1 npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

**Step 6: Commit**

```bash
git add frontend/src/pages/MemberDetail.tsx
git commit -m "feat: ledger edit/delete per row in MemberDetail"
```

---

### Task 5: Frontend — PrepTab excuse scan panel

**Files:**
- Modify: `frontend/src/pages/session/PrepTab.tsx`

**Context:**
Remove the Homework Scan panel and replace with an Excuse Scan panel. Keep the PPT scan as-is (separate `scanTaskId` state). The excuse scan gets its own `excuseTaskId` state + `useCrawlerTask` polling.

After scanning, the panel shows a summary derived from `session.attendances` — members where `excuse_type` is set, with their name (from `members` data already loaded), a PRE/POST badge, and a Popover to view `excuse_text`.

`session.attendances` now includes `excuse_text` (added to type in Task 3).
`members` is already fetched at the top of PrepTab via `useMembers()`.

**Step 1: Update imports**

Change the hooks import line from:
```typescript
import { useScanPPT, useScanHomework, useCrawlerTask, useMembers } from "@/hooks";
```
To:
```typescript
import { useScanPPT, useScanExcuses, useCrawlerTask, useMembers } from "@/hooks";
```

Add Popover to the component imports. After the existing `import { Button } from "@/components/ui/button";`, add:
```typescript
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
```

**Step 2: Replace state and handlers**

Remove these lines from the component:
```typescript
const { mutate: scanHomework, isPending: isScanningHomework } = useScanHomework();
```
and the `handleScanHomework` function.

Add after `const { mutate: scanPPT, isPending: isScanningPPT } = useScanPPT();`:
```typescript
const { mutate: scanExcuses, isPending: isScanningExcuses } = useScanExcuses();
const [excuseTaskId, setExcuseTaskId] = useState<string | null>(null);
```

Add after `const { data: taskStatus } = useCrawlerTask(scanTaskId);`:
```typescript
const { data: excuseTaskStatus } = useCrawlerTask(excuseTaskId);
```

Add this handler after `handleScanPPT`:
```typescript
const handleScanExcuses = (mode: "PRE" | "POST") => {
    scanExcuses({ sessionId: session.id, mode }, {
        onSuccess: (data) => {
            toast.success(`${mode === "PRE" ? "사전" : "사후"}사유서 스캔이 시작되었습니다.`);
            setExcuseTaskId(data.task_id);
        },
        onError: () => toast.error("스캔 요청 실패"),
    });
};
```

**Step 3: Replace Homework Scan panel with Excuse Scan panel**

Find and remove the entire Homework Scan `<div>` block:
```tsx
                <div className="bg-[var(--color-surface)] p-4 rounded-xl border border-[var(--color-border)]">
                    <div className="mb-4">
                        <h3 className="font-bold text-lg">Homework Scan</h3>
                        <p className="text-sm text-[var(--color-text-secondary)]">과제 제출 여부 확인</p>
                    </div>
                    <Button variant="outline" onClick={handleScanHomework} disabled={isScanningHomework}>
                        <FileSearch className="w-4 h-4 mr-2" />
                        Scan Homework
                    </Button>
                </div>
```

Replace with:
```tsx
                <div className="bg-[var(--color-surface)] p-4 rounded-xl border border-[var(--color-border)]">
                    <div className="mb-4">
                        <h3 className="font-bold text-lg">사유서 스캔</h3>
                        <p className="text-sm text-[var(--color-text-secondary)]">네이버 카페 사유서 게시판 스캔</p>
                    </div>
                    <div className="flex flex-col gap-2">
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                onClick={() => handleScanExcuses("PRE")}
                                disabled={isScanningExcuses}
                            >
                                <FileSearch className="w-4 h-4 mr-2" />
                                사전사유서 받아오기
                            </Button>
                            <Button
                                variant="outline"
                                className="text-orange-400 border-orange-400/20 hover:bg-orange-400/10"
                                onClick={() => handleScanExcuses("POST")}
                                disabled={isScanningExcuses}
                            >
                                <FileSearch className="w-4 h-4 mr-2" />
                                사후사유서 받아오기
                            </Button>
                        </div>
                        {excuseTaskId && excuseTaskStatus && (
                            <div className="mt-2 p-3 bg-black/20 rounded-lg flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2">
                                    {excuseTaskStatus.status === "in_progress" || excuseTaskStatus.status === "queued" ? (
                                        <Loader2 className="w-4 h-4 animate-spin text-[var(--color-accent)]" />
                                    ) : excuseTaskStatus.status === "complete" ? (
                                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                                    ) : (
                                        <XCircle className="w-4 h-4 text-red-500" />
                                    )}
                                    <span className="font-mono">Task: {excuseTaskId.slice(0, 8)}...</span>
                                </div>
                                <span className={`font-bold ${excuseTaskStatus.status === "complete" ? "text-green-500" :
                                    excuseTaskStatus.status === "failed" ? "text-red-500" : "text-[var(--color-accent)]"
                                    }`}>
                                    {excuseTaskStatus.status.toUpperCase()}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
```

**Step 4: Add excuse summary section**

Add a new `<section>` after the Attendance Check section (after the `</section>` closing the AttendanceGrid) and before the Feedback Target section:

```tsx
            {/* Excuse Summary */}
            {(() => {
                const excusedAttendances = (session.attendances || []).filter(
                    (att) => att.excuse_type === "PRE" || att.excuse_type === "POST"
                );
                if (excusedAttendances.length === 0) return null;
                return (
                    <section>
                        <h3 className="font-bold text-lg mb-3">사유서 제출 현황</h3>
                        <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
                            {excusedAttendances.map((att) => {
                                const member = members?.find((m) => m.id === att.member_id);
                                return (
                                    <div key={att.member_id} className="flex items-center justify-between px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            <span className="text-sm font-medium">
                                                {member?.name ?? `ID:${att.member_id}`}
                                            </span>
                                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                                att.excuse_type === "PRE"
                                                    ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                                    : "bg-orange-500/10 text-orange-400 border-orange-500/20"
                                            }`}>
                                                {att.excuse_type === "PRE" ? "사전 통보" : "사후 제출"}
                                            </span>
                                        </div>
                                        {att.excuse_text && (
                                            <Popover>
                                                <PopoverTrigger asChild>
                                                    <Button variant="ghost" size="sm" className="h-7 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
                                                        내용 보기
                                                    </Button>
                                                </PopoverTrigger>
                                                <PopoverContent
                                                    className="w-80 bg-[var(--color-elevated)] border-[var(--color-border)] p-3 text-sm"
                                                    align="end"
                                                >
                                                    <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase mb-2">사유서 내용</p>
                                                    <p className="text-[var(--color-text-secondary)] whitespace-pre-wrap break-words leading-relaxed">
                                                        {att.excuse_text}
                                                    </p>
                                                </PopoverContent>
                                            </Popover>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                );
            })()}
```

**Step 5: Verify `useScanExcuses` is exported from `@/hooks`**

Check `frontend/src/hooks/index.ts` (barrel export). If `useScanExcuses` is not re-exported, add it. Look for how `useScanHomework` is exported and follow the same pattern.

**Step 6: TypeScript check**

```bash
docker exec ops-platform-frontend-dev-1 npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

**Step 7: Commit**

```bash
git add frontend/src/pages/session/PrepTab.tsx
git commit -m "feat: replace homework scan with excuse scan panel in PrepTab"
```
