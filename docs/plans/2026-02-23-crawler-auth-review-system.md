# Crawler/Auth/Review System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix auth persistence, Naver login status, crawler logic (comment-based feedback scan, board ID config), CafePost cron sync model, and feedback target assignment system.

**Architecture:**
- Frontend: localStorage token restore on mount + NaverSessionCard task polling
- Backend: New `CafePost` mirror table + `Assignment.target_member_ids` array column + cron ARQ task for periodic board sync
- Crawler: `FEEDBACK` type scans video board article **comments** (not posts); `REVIEW`/`HOMEWORK` scan board post titles; all board IDs read from `settings` (already in config.py)

**Tech Stack:** FastAPI/SQLAlchemy async, Alembic, ARQ, React 19, React Query v5, TypeScript

---

## Task 1: Auth token localStorage persistence

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/context/AuthContext.tsx`

**Step 1: Update `api.ts` to persist token in localStorage**

Replace the in-memory only section:

```typescript
// frontend/src/lib/api.ts
const TOKEN_KEY = "ops_access_token";

let _accessToken: string | null = localStorage.getItem(TOKEN_KEY);

export const setToken = (token: string | null) => {
    _accessToken = token;
    if (token) {
        localStorage.setItem(TOKEN_KEY, token);
    } else {
        localStorage.removeItem(TOKEN_KEY);
    }
};

export const getToken = () => _accessToken;
```

**Step 2: Update `AuthContext.tsx` to restore user on mount**

Replace the `useEffect` that just sets `isLoading(false)`:

```typescript
// frontend/src/context/AuthContext.tsx
useEffect(() => {
    const savedToken = getToken(); // reads from localStorage via api.ts
    if (!savedToken) {
        setIsLoading(false);
        return;
    }
    // Token exists: verify with backend
    api.get<AuthUser>("/members/me")
        .then(({ data }) => setUser(data))
        .catch(() => setToken(null)) // invalid token → clear
        .finally(() => setIsLoading(false));
}, []);
```

Add `getToken` to imports: `import api, { setToken, getToken } from "@/lib/api";`

**Step 3: Verify manually**
- Login → F5 refresh → should stay on dashboard
- Logout → F5 → should go to login

**Step 4: Commit**
```bash
git add frontend/src/lib/api.ts frontend/src/context/AuthContext.tsx
git commit -m "fix: persist JWT in localStorage so page refresh doesn't log out"
```

---

## Task 2: Naver login in-progress status display

**Files:**
- Modify: `frontend/src/pages/Dashboard.tsx` — NaverSessionCard section (search "Naver Login" button)

**Step 1: Find the NaverSessionCard block**

In `Dashboard.tsx`, locate the section with `handleLogin` / `handleImport` / `mode` state (around line 80-160).

**Step 2: Add loginTaskId state + polling**

```typescript
// Add state alongside existing mode/loginForm state
const [loginTaskId, setLoginTaskId] = useState<string | null>(null);
const { data: loginTaskData } = useCrawlerTask(loginTaskId);

// When task completes/fails, clear taskId and refetch naver status
useEffect(() => {
    if (!loginTaskData) return;
    if (loginTaskData.status === "complete") {
        setLoginTaskId(null);
        queryClient.invalidateQueries({ queryKey: crawlerKeys.naverSession() });
        toast.success("네이버 로그인 성공!");
    } else if (loginTaskData.status === "failed") {
        setLoginTaskId(null);
        toast.error(`네이버 로그인 실패: ${loginTaskData.result?.reason ?? "알 수 없는 오류"}`);
    }
}, [loginTaskData, queryClient]);
```

**Step 3: Update handleLogin to save task_id**

```typescript
const handleLogin = async () => {
    try {
        const result = await naverLogin.mutateAsync(loginForm);
        setLoginTaskId(result.task_id);
        setMode("none");
    } catch (e) {
        toast.error("로그인 요청 실패");
    }
};
```

**Step 4: Show progress in the card**

In the NaverSessionCard UI, add below the status line:
```tsx
{loginTaskId && (
    <div className="flex items-center gap-2 mt-2 text-xs text-blue-400 animate-pulse">
        <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
        네이버 로그인 중...
        {loginTaskData?.status === "in_progress" && " (진행중)"}
    </div>
)}
```

Also disable the "Naver Login" and "Manual Import" buttons while `loginTaskId` is set.

**Step 5: Add missing imports** — `crawlerKeys` from `@/hooks`, `useQueryClient` from `@tanstack/react-query`

**Step 6: Verify manually**
- Click "Naver Login" → enter credentials → submit → card should show "네이버 로그인 중..." for ~15s

**Step 7: Commit**
```bash
git add frontend/src/pages/Dashboard.tsx
git commit -m "feat: show Naver login in-progress status with task polling"
```

---

## Task 3: Backend — CafePost model + Assignment.target_member_ids

**Files:**
- Modify: `backend/app/models.py`
- Create: `backend/alembic/versions/<timestamp>_add_cafe_posts_and_assignment_targets.py`

**Step 1: Add CafePost model to models.py**

After the `Ledger` class at the end:

```python
class CafePost(Base):
    """네이버 카페 게시판 미러 캐시 (cron 동기화)"""
    __tablename__ = "cafe_posts"

    id = Column(Integer, primary_key=True)
    article_id = Column(Integer, unique=True, nullable=False)  # Naver article ID
    board_type = Column(String(20), nullable=False)            # REVIEW / HOMEWORK / VIDEO
    title = Column(String(500))
    author_nick = Column(String(100))
    member_id = Column(Integer, ForeignKey("members.id"), nullable=True)
    week_num = Column(Integer, nullable=True)
    posted_at = Column(TIMESTAMP(timezone=True), nullable=True)
    is_deleted = Column(Boolean, default=False)
    first_seen_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    last_synced_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("board_type IN ('REVIEW','HOMEWORK','VIDEO')", name="ck_cafe_posts_board_type"),
    )
```

**Step 2: Add target_member_ids to Assignment**

Add column to `Assignment` class after `raw_data`:
```python
target_member_ids = Column(ARRAY(Integer), nullable=True)
# 피드백 대상 member_id 목록. 기본 1명, 결석 시 2명.
# NULL = 미지정 (REVIEW/HOMEWORK 타입에서도 NULL)
```

**Step 3: Generate Alembic migration**

```bash
cd /home/ubuntu/ops-platform/backend
docker compose exec backend alembic revision --autogenerate -m "add_cafe_posts_and_assignment_targets"
```

Verify the generated file includes:
- `CREATE TABLE cafe_posts (...)`
- `ALTER TABLE assignments ADD COLUMN target_member_ids INTEGER[]`

**Step 4: Apply migration**

```bash
docker compose exec backend alembic upgrade head
```

Expected: no errors, `cafe_posts` table created, `assignments.target_member_ids` column added.

**Step 5: Commit**
```bash
git add backend/app/models.py backend/alembic/versions/<new_file>.py
git commit -m "feat: add CafePost mirror table and Assignment.target_member_ids"
```

---

## Task 4: Backend — Crawler fixes

**Files:**
- Modify: `backend/app/services/crawler_homework.py`
- Modify: `backend/app/services/crawler_cafe.py`
- Modify: `backend/app/config.py`

### 4a: Add FEEDBACK board config

`config.py` already has `NAVER_CAFE_MENU_VIDEO`, `NAVER_CAFE_MENU_REVIEW`, `NAVER_CAFE_MENU_HOMEWORK`.
Add: (nothing needed — VIDEO board is used for feedback via comments, not a separate board)

### 4b: Fix crawler_homework.py — use settings, add None check

**Replace entire `BOARD_IDS` dict and function:**

```python
# At top of crawler_homework.py
from app.config import settings

BOARD_TYPE_TO_MENU = {
    "REVIEW":   settings.NAVER_CAFE_MENU_REVIEW,
    "HOMEWORK": settings.NAVER_CAFE_MENU_HOMEWORK,
    # FEEDBACK handled separately via video board comments
}
```

**Add None check at start of `scan_homework_all`:**
```python
req_session = await get_valid_requests_session(db)
if req_session is None:
    logger.error("No valid Naver session — cannot scan homework")
    return 0
```

**Replace `for assign_type, menu_id in BOARD_IDS.items():` with:**
```python
for assign_type, menu_id in BOARD_TYPE_TO_MENU.items():
```

### 4c: Fix `_is_match_week` regex false positive

Current: `rf"(\D|^){week_num}\s*주차"` — week_num=2 matches "20주차" because `\D` matches `2`.

Fix using word boundaries:
```python
def _is_match_week(title: str, week_num: int) -> bool:
    pattern = rf"(?<!\d){week_num}(?!\d)\s*주차|Week\s*{week_num}(?!\d)"
    return bool(re.search(pattern, title, re.IGNORECASE))
```

### 4d: Add FEEDBACK scan via video board comments

Add new function to `crawler_homework.py`:

```python
async def scan_feedback_comments(
    session_id: int,
    week_num: int,
    members: list[Member],
    db: AsyncSession,
) -> int:
    """
    영상 게시판에서 week_num 주차 영상들의 댓글을 스캔,
    댓글 작성자를 멤버 매칭하여 FEEDBACK assignment 업데이트
    """
    from app.services.crawler_cafe import fetch_board_articles, fetch_article_detail
    from app.config import settings

    req_session = await get_valid_requests_session(db)
    if req_session is None:
        logger.error("No valid Naver session — cannot scan feedback")
        return 0

    # 1. 영상 게시판에서 해당 주차 게시글 수집
    video_articles = []
    for page in range(1, 4):
        data = fetch_board_articles(req_session, settings.NAVER_CAFE_MENU_VIDEO, page=page)
        items = data.get("message", {}).get("result", {}).get("articleList", [])
        if not items:
            break
        for item in items:
            if _is_match_week(item.get("subject", ""), week_num):
                video_articles.append(item)

    if not video_articles:
        logger.warning(f"No video articles found for week {week_num}")
        return 0

    # 2. 각 게시글의 댓글 작성자 수집
    commenters: set[int] = set()  # member_ids who left a comment
    for article in video_articles:
        article_id = article.get("articleId") or article.get("article_id")
        if not article_id:
            continue
        try:
            detail = fetch_article_detail(req_session, article_id)
            # 댓글 목록 — Naver API 응답 구조에 맞게 파싱
            comments = (
                detail.get("message", {})
                    .get("result", {})
                    .get("commentList", [])
            )
            for comment in comments:
                nick = comment.get("writer", {}).get("nick", "")
                member = match_member_by_name(nick, members)
                if member:
                    commenters.add(member.id)
        except Exception as e:
            logger.warning(f"Failed to fetch article {article_id}: {e}")

    # 3. 댓글 단 멤버 → PASS, 안 단 멤버 → MISSING
    count = 0
    for member in members:
        status = "PASS" if member.id in commenters else "MISSING"
        await upsert_assignment(db, session_id, member.id, "FEEDBACK", status)
        count += 1
    return count
```

**Update `task_scan_homework` in `worker.py`** to also call `scan_feedback_comments` if session config has `has_feedback: true`.

### 4e: Fix `upsert_assignment` — use flush instead of commit per row

```python
async def upsert_assignment(...):
    ...
    # Change: await db.commit() → await db.flush()
    await db.flush()
    # Caller is responsible for final commit
```

And in `scan_homework_all` / `scan_feedback_comments`, add `await db.commit()` at the end.

**Step: Restart backend to apply changes**
```bash
docker compose restart backend worker
```

**Step: Commit**
```bash
git add backend/app/services/crawler_homework.py backend/app/services/crawler_cafe.py
git commit -m "fix: crawler uses settings board IDs, fixes week regex, adds feedback comment scan"
```

---

## Task 5: Backend — CafePost cron sync

**Files:**
- Modify: `backend/app/services/crawler_cafe.py` — add `sync_board_to_db()`
- Modify: `backend/app/worker.py` — add cron task

**Step 1: Add sync function to crawler_cafe.py**

```python
async def sync_board_to_db(
    board_type: str,
    menu_id: int,
    req_session,
    members: list,
    db,
) -> dict:
    """게시판 내용을 CafePost 테이블과 동기화 (upsert + soft-delete)"""
    from app.models import CafePost
    from datetime import timezone
    from sqlalchemy import select

    fetched_ids: set[int] = set()

    for page in range(1, 6):  # 최대 5페이지 (100개)
        data = fetch_board_articles(req_session, menu_id, page=page)
        items = data.get("message", {}).get("result", {}).get("articleList", [])
        if not items:
            break

        for item in items:
            article_id = item.get("articleId") or item.get("article_id")
            if not article_id:
                continue
            fetched_ids.add(article_id)

            title = item.get("subject", "")
            author_nick = item.get("writer", {}).get("nick", "")
            # 주차 파싱
            week_match = re.search(r"(\d+)\s*주차", title)
            week_num = int(week_match.group(1)) if week_match else None
            # 멤버 매칭
            extracted = extract_name_from_title(title)
            member = match_member_by_name(extracted, members) if extracted else None

            # Upsert
            stmt = select(CafePost).where(CafePost.article_id == article_id)
            result = await db.execute(stmt)
            post = result.scalar_one_or_none()

            if post:
                post.title = title
                post.author_nick = author_nick
                post.week_num = week_num
                post.member_id = member.id if member else post.member_id
                post.is_deleted = False
            else:
                db.add(CafePost(
                    article_id=article_id,
                    board_type=board_type,
                    title=title,
                    author_nick=author_nick,
                    week_num=week_num,
                    member_id=member.id if member else None,
                    is_deleted=False,
                ))

    # 이전에 DB에 있었는데 이번 스캔에 없으면 → 삭제된 것으로 마킹
    stmt = select(CafePost).where(
        CafePost.board_type == board_type,
        CafePost.is_deleted == False,
    )
    result = await db.execute(stmt)
    existing = result.scalars().all()
    for post in existing:
        if post.article_id not in fetched_ids:
            post.is_deleted = True

    await db.commit()
    return {"board_type": board_type, "synced": len(fetched_ids)}
```

**Step 2: Add cron task to worker.py**

```python
from arq import cron
from app.services.crawler_cafe import sync_board_to_db

async def task_sync_cafe_boards(ctx):
    """주기적 게시판 동기화 (30분마다)"""
    async with AsyncSessionLocal() as db:
        from app.services.naver_session import get_valid_requests_session
        req_session = await get_valid_requests_session(db)
        if not req_session:
            return {"status": "skipped", "reason": "No valid naver session"}

        members_result = await db.execute(select(Member).where(Member.is_active == True))
        members = members_result.scalars().all()

        results = []
        for board_type, menu_id in [
            ("REVIEW", settings.NAVER_CAFE_MENU_REVIEW),
            ("HOMEWORK", settings.NAVER_CAFE_MENU_HOMEWORK),
            ("VIDEO", settings.NAVER_CAFE_MENU_VIDEO),
        ]:
            r = await sync_board_to_db(board_type, menu_id, req_session, members, db)
            results.append(r)

        return {"status": "complete", "boards": results}


class WorkerSettings:
    functions = [task_scan_ppt, task_scan_homework, task_upload_videos, task_naver_login, task_sync_cafe_boards]
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    cron_jobs = [
        cron(task_sync_cafe_boards, minute={0, 30}),  # 매 30분
    ]
```

**Step 3: Add CafePost import to models imports in worker.py**
```python
from app.models import Member, Session, CafePost
```

**Step 4: Restart worker**
```bash
docker compose restart worker
```

**Step 5: Commit**
```bash
git add backend/app/services/crawler_cafe.py backend/app/worker.py
git commit -m "feat: add CafePost cron sync task (30min) with upsert and soft-delete"
```

---

## Task 6: Backend — Crawler router: expose sync endpoint + feedback target assignment API

**Files:**
- Modify: `backend/app/routers/crawler.py`
- Modify: `backend/app/routers/sessions.py` (or new assignments router)

**Step 1: Add manual sync trigger endpoint in crawler.py**

```python
@router.post("/sync-boards")
async def trigger_board_sync(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    """수동 게시판 동기화 트리거"""
    job = await arq_pool.enqueue_job("task_sync_cafe_boards")
    return {"task_id": job.job_id}
```

**Step 2: Add feedback target assignment endpoint**

In `backend/app/routers/sessions.py`, add:

```python
@router.patch("/{session_id}/assignments/{member_id}/feedback-targets")
async def set_feedback_targets(
    session_id: int,
    member_id: int,
    target_member_ids: list[int],
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """
    피드백 대상 멤버 지정.
    target_member_ids: 피드백을 달아야 할 멤버 ID 목록 (보통 1명, 결석 시 2명)
    """
    stmt = select(Assignment).where(
        Assignment.session_id == session_id,
        Assignment.member_id == member_id,
        Assignment.type == "FEEDBACK",
    )
    result = await db.execute(stmt)
    assignment = result.scalar_one_or_none()
    if not assignment:
        raise HTTPException(404, "FEEDBACK assignment not found")

    assignment.target_member_ids = target_member_ids
    assignment.target_count = len(target_member_ids)
    await db.commit()
    return {"member_id": member_id, "target_member_ids": target_member_ids}
```

**Step 3: Restart backend**
```bash
docker compose restart backend
```

**Step 4: Commit**
```bash
git add backend/app/routers/crawler.py backend/app/routers/sessions.py
git commit -m "feat: add board sync trigger endpoint and feedback target assignment API"
```

---

## Task 7: Frontend — PostTab manual status improvements

**Files:**
- Modify: `frontend/src/pages/session/PostTab.tsx`

**Current behavior:** Clicking badge toggles PASS ↔ MISSING.
**New behavior:** Cycle PASS → LATE → MISSING → PASS with color coding.

**Step 1: Replace toggle logic**

```typescript
const STATUS_CYCLE: Record<string, string> = {
    PASS: "LATE",
    LATE: "MISSING",
    MISSING: "PASS",
    PENDING: "PASS",
};

const STATUS_STYLE: Record<string, string> = {
    PASS: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    LATE: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    MISSING: "bg-red-500/10 text-red-400 border-red-500/20",
    PENDING: "bg-gray-500/10 text-gray-400 border-gray-500/20",
};

const handleStatusClick = async (assignmentId: number, currentStatus: string) => {
    const next = STATUS_CYCLE[currentStatus] ?? "PASS";
    await updateAssignment.mutateAsync({ assignmentId, status: next });
};
```

**Step 2: Update badge rendering**

```tsx
<button
    onClick={() => a ? handleStatusClick(a.id, a.status) : undefined}
    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border cursor-pointer hover:opacity-80 transition-opacity ${STATUS_STYLE[a?.status ?? "PENDING"]}`}
    title="클릭하여 상태 변경"
>
    {a?.status ?? "PENDING"}
</button>
```

**Step 3: Commit**
```bash
git add frontend/src/pages/session/PostTab.tsx
git commit -m "feat: PostTab assignment status cycles PASS→LATE→MISSING→PASS on click"
```

---

## Task 8: Frontend — Feedback target assignment UI in PrepTab

**Files:**
- Modify: `frontend/src/pages/session/PrepTab.tsx`
- Modify: `frontend/src/hooks/useSessions.ts` (add feedback target mutation)

**Step 1: Add mutation hook to useSessions.ts**

```typescript
export function useSetFeedbackTargets() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({
            sessionId, memberId, targetMemberIds
        }: { sessionId: number; memberId: number; targetMemberIds: number[] }) => {
            const { data } = await api.patch(
                `/sessions/${sessionId}/assignments/${memberId}/feedback-targets`,
                targetMemberIds
            );
            return data;
        },
        onSuccess: (_, vars) => {
            queryClient.invalidateQueries({ queryKey: sessionsKeys.detail(vars.sessionId) });
        },
    });
}
```

**Step 2: Add feedback target UI section to PrepTab**

In the INDIVIDUAL session case (when `cfg.has_feedback !== false`), add a table below the Homework Scan card:

```tsx
{session.type === "INDIVIDUAL" && cfg.has_feedback !== false && (
    <div className="bg-[var(--color-surface)] p-4 rounded-xl border border-[var(--color-border)]">
        <h3 className="font-bold text-lg mb-3">영상 피드백 대상 지정</h3>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
            각 멤버가 댓글 피드백을 남겨야 할 대상 영상의 멤버를 지정합니다.
            기본 1명, 결석자는 2명.
        </p>
        <FeedbackTargetTable session={session} members={members} />
    </div>
)}
```

**Step 3: Create FeedbackTargetTable component (inline in PrepTab or extract)**

Simple table with: 멤버 이름 | 대상 지정 (multiselect combobox or member tag selector)

For MVP, use a simple comma-separated tag display with an "Edit" modal trigger.
Full implementation deferred — add a placeholder "지정 필요" badge per member with an edit pencil icon.

```tsx
// Minimal version
{attendances.map(att => {
    const member = members?.find(m => m.id === att.member_id);
    const feedbackAssignment = session.assignments?.find(
        a => a.member_id === att.member_id && a.type === "FEEDBACK"
    );
    const targets = feedbackAssignment?.target_member_ids ?? [];
    return (
        <div key={att.member_id} className="flex items-center justify-between py-2 border-b border-[var(--color-border)]">
            <span className="text-sm">{member?.name ?? att.member_id}</span>
            <span className="text-xs text-[var(--color-text-muted)]">
                {targets.length > 0
                    ? targets.map(tid => members?.find(m => m.id === tid)?.name).join(", ")
                    : <span className="text-yellow-500">미지정</span>}
            </span>
        </div>
    );
})}
```

**Step 4: Commit**
```bash
git add frontend/src/pages/session/PrepTab.tsx frontend/src/hooks/useSessions.ts
git commit -m "feat: add feedback target assignment display in PrepTab"
```

---

## Task 9: Backend — penalty_engine.py 규정 검증

**Files:**
- Modify: `backend/app/services/penalty_engine.py`
- Modify: `backend/app/services/finalize.py` (check for correct imports)

**Step 1: Verify penalty matrix matches PDF rules**

규정 정리 (PDF p.2):

| 상황 | 사유서 | 벌점 | 디파짓 |
|------|--------|------|--------|
| 지각 10분 미만 | 사전 | -1 | -2,000 |
| 지각 10분 미만 | 사후 | -1 | -3,000 |
| 지각 10분 미만 | 미제출 | -1 | -4,000 |
| 지각 10분 이상 | 사전 | -2 | -2,000 |
| 지각 10분 이상 | 사후 | -2 | -3,000 |
| 지각 10분 이상 | 미제출 | -2 | -4,000 |
| 조퇴 | 사전 | -2 | -2,000 |
| 조퇴 | 사후 | -2 | -3,000 |
| 조퇴 | 미제출 | -2 | -4,000 |
| 결석 | 사전 | -4 | -4,000 |
| 결석 | 사후 | -4 | -6,000 |
| 결석 | 미제출 | -4 | -8,000 |
| PPT 지각 | — | -1 | -1,000 |
| PPT 미제출 | — | -2 | -3,000 |
| 과제/리뷰/영상피드백 미제출 | — | -1 | -1,000 |

현재 `ATTENDANCE_MATRIX` 확인: PRE/POST/None 키에 대해 위 값과 일치하는지 확인.
현재 `PPT_MATRIX`: LATE=(-1,-1000), MISSING=(-2,-3000) ✅
현재 `HOMEWORK_PENALTY`: (-1,-1000) ✅

**Step 2: Check ATTENDANCE_MATRIX has correct PRE mapping**

현재 코드에는 `"PRE"` key가 있는데 실제 DB에는 `excuse_type="PRE"` or `"POST"` or `None` 저장.
사전사유서 = PRE, 사후사유서 = POST, 미제출 = None.

현재 `penalty_engine.py` line 13-33의 값이 위 표와 일치하는지 확인 후 수정.

**Step 3: Verify `check_milestone_after_update` thresholds**

규정: "누적 벌점 10점 단위로(10점, 20점, 30점) 부과 시 벌금 5,000원"
현재 `thresholds = [-10, -20, -30, -40, -50]` — 규정에 명시된 3개(-10,-20,-30) 이상이 있어 허용.

**Step 4: Add target_count to ABSENT feedback penalty**

규정: "단순 결석 시 → 영상 피드백 2개"
현재 시스템은 target_count를 체크하지 않고 모든 멤버에게 동일하게 FEEDBACK 1개로 처리.

In `penalty_engine.py`, when calculating FEEDBACK penalty, check `assignment.target_count`:
```python
# FEEDBACK 특별 처리: target_count >= 2 (결석자)인데 MISSING이면 동일 페널티
# (규정상 결석 시 추가 피드백은 출결 페널티 외 별도 과제 의무)
# → 현재 HOMEWORK_PENALTY 한 번만 적용하는 것이 맞음 (규정: "과제/리뷰/영상피드백 中 하나라도 미제출 -1점")
```

**Note:** target_count 2인 경우에도 FEEDBACK 미제출 페널티는 동일하게 -1점/-1,000원.
결석 페널티(-4점/-4,000~-8,000원)가 이미 별도로 부과되므로 현재 로직이 규정에 맞음.

**Step 5: Commit (if any changes made)**
```bash
git add backend/app/services/penalty_engine.py
git commit -m "fix: verify penalty matrix matches PDF rules"
```

---

## Summary of Changes

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 1 | `frontend/src/lib/api.ts` | localStorage token persistence |
| 2 | `frontend/src/context/AuthContext.tsx` | Mount restore + /members/me verify |
| 3 | `frontend/src/pages/Dashboard.tsx` | Naver login task polling UI |
| 4 | `backend/app/models.py` | CafePost 모델, Assignment.target_member_ids |
| 5 | Alembic migration | DB 스키마 적용 |
| 6 | `backend/app/services/crawler_homework.py` | settings 사용, None 체크, regex 수정, feedback comment scan |
| 7 | `backend/app/services/crawler_cafe.py` | sync_board_to_db 추가 |
| 8 | `backend/app/worker.py` | cron task 30분 |
| 9 | `backend/app/routers/crawler.py` + `sessions.py` | sync trigger, feedback target API |
| 10 | `frontend/src/pages/session/PostTab.tsx` | 3단계 상태 토글 |
| 11 | `frontend/src/pages/session/PrepTab.tsx` + hooks | 피드백 대상 지정 UI |
| 12 | `backend/app/services/penalty_engine.py` | 규정 매트릭스 검증 |
