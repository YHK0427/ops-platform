# Drive Video List + Merit Edit/Delete

**Date:** 2026-02-24

## Feature 1: Drive Video List (OpsTab)

### Backend
- New endpoint: `GET /crawler/drive-videos?session_id=X`
- Loads session to get `week_num`, calls `list_drive_videos(week_num)` via `asyncio.to_thread()`
- Returns: `[{id, name, presenter, order}]` where `order` is parsed from `(N번째)`

### Frontend
- OpsTab header: `[드라이브 확인 ↻]` button alongside `[업로드 시작]`
- Inline panel appears below: table (순서 / 파일명 / 발표자) + "총 N개" badge
- States: loading (spinner), empty ("드라이브에 영상이 없습니다"), list

### Hook
- `useDriveVideos(sessionId)` — mutation (on-demand), not auto-query

## Feature 2: Merit Edit/Delete (SettlementTab MeritPanel)

### Backend
- New endpoint: `DELETE /ledger/{ledger_id}`
- Reverses `amount_krw` effect on `member.current_deposit`
- Reverses `score_delta` effect on `total_plus/minus_score` + `net_score`
- Then deletes the row

### Frontend
- MeritPanel rows: pencil + trash buttons on hover
- Edit: small popover (score input + reason input) → calls existing PATCH
- Delete: immediate (no confirm), toast on success
- `useDeleteLedgerEntry` hook calling `DELETE /ledger/{id}`
