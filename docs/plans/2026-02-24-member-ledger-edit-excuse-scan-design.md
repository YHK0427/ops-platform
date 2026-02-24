# Member Ledger Edit + PrepTab Excuse Scan — Design

**Date:** 2026-02-24

---

## Feature 1: MemberDetail Ledger Edit/Delete

**Goal:** Each ledger row in MemberDetail shows hover-reveal edit (Popover) and delete (immediate) buttons, matching the SettlementTab MeritRow pattern.

**Scope:** `frontend/src/pages/MemberDetail.tsx` only. No backend changes.

**Design:**
- Extract `LedgerRow` sub-component.
- `group/row` + `group-hover/row:opacity-100` Tailwind pattern for hover-reveal.
- Pencil → Popover with `amount_krw` (number input) + `description` (text input) + Save button → calls `useUpdateLedger`.
- Trash → immediate `useDeleteLedgerEntry(entry.id)` call. No confirm dialog.
- Add 6th column "Actions" in `<TableHead>`. Change colSpan in empty state from 5 → 6.
- Hooks `useUpdateLedger` and `useDeleteLedgerEntry` already exist in `useLedger.ts`.

---

## Feature 2: PrepTab Excuse Scan

**Goal:** Replace the "Homework Scan" panel in PrepTab with an excuse scan panel that fetches PRE/POST excuse letters from a dedicated Naver Cafe board and updates attendance records.

### Backend

**`config.py`**
- Add `NAVER_CAFE_MENU_EXCUSE: int` field (`.env` already has this value).

**`services/crawler_excuse.py`** (new file)
- `scan_excuses(session_id, week_num, members, mode, db)` function.
- PRE mode:
  - Scan `NAVER_CAFE_MENU_EXCUSE` board for articles matching week_num.
  - Match article author to member by title name extraction + nick fallback.
  - Fetch article detail for each matched article; extract body text from `message.result.article.contentHtml` (strip HTML tags).
  - Upsert attendance: set `excuse_type = "PRE"`, `excuse_text = body`.
- POST mode:
  - Query session attendances where `status != PRESENT` and `excuse_type IS NULL`.
  - Scan excuse board for week_num articles whose author matches one of those members.
  - Fetch article detail; extract body.
  - Upsert attendance: set `excuse_type = "POST"`, `excuse_text = body`.
- Returns count of matched members.

**`schemas/crawler.py`**
- Add `ScanExcusesRequest(session_id: int, mode: str)` — mode is "PRE" or "POST".

**`routers/crawler.py`**
- Add `POST /crawler/scan-excuses` → enqueues `task_scan_excuses` ARQ job with `(session_id, mode)`.

**`worker.py`**
- Add `task_scan_excuses(ctx, session_id, mode)` — loads session + members, calls `scan_excuses`, returns summary.
- Register in `WorkerSettings.functions`.

### Frontend

**`hooks/useCrawler.ts`**
- Add `useScanExcuses()` mutation hook → `POST /crawler/scan-excuses`.

**`PrepTab.tsx`**
- Remove "Homework Scan" panel entirely (the `<div>` block with `handleScanHomework`).
- Remove `isScanningHomework`, `handleScanHomework` (keep PPT scan as-is).
- Add separate `excuseTaskId` state + `useCrawlerTask(excuseTaskId)` for polling.
- Add "사유서 스캔" panel in the grid (replacing Homework Scan position):
  - [사전사유서 받아오기] button → mode "PRE"
  - [사후사유서 받아오기] button → mode "POST"
  - Task status indicator below buttons (shared for both PRE/POST, last triggered).
- Below the panel, show excuse summary list derived from `session.attendances`:
  - Filter to attendances where `excuse_type` is set (PRE or POST).
  - Each row: member name + PRE/POST badge + Popover button ("내용 보기") showing `excuse_text`.
  - If no excuses yet: empty state message.
