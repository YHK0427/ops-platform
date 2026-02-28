# PPT Email Submission Tracking + Tab Locking

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Separate PPT email submission (pre-session) from board PPT upload (post-session), add manual toggle in PREP tab, and lock non-PREP tabs during PREP status.

**Architecture:** New `PPT_EMAIL` assignment type controlled by `has_ppt_email` config flag. TEAM sessions get one PPT_EMAIL per team (team submits together), INDIVIDUAL sessions get one per member. Existing `PPT` type remains for future board upload. Tab locking is frontend-only via SessionLayout.

**Tech Stack:** FastAPI, SQLAlchemy, PostgreSQL (ALTER TABLE), React, TypeScript

---

### Task 1: Backend — Schema & Model Updates

**Files:**
- Modify: `backend/app/schemas/session.py:11-15`
- Modify: `backend/app/models.py` (Assignment type constraint)
- Modify: `backend/app/schemas/assignment.py`

**Step 1: Update SessionConfig schema**

In `backend/app/schemas/session.py`, rename `has_ppt` to `has_ppt_email`:

```python
class SessionConfig(BaseModel):
    has_ppt_email: bool = True   # was has_ppt
    has_review: bool = True
    has_feedback: bool = True
    is_holiday: bool = False
```

**Step 2: Update Assignment type constraint in model**

In `backend/app/models.py`, update the CHECK constraint to include `PPT_EMAIL`:

```python
CheckConstraint(
    "type IN ('PPT','PPT_EMAIL','REVIEW','FEEDBACK','HOMEWORK')",
    name="ck_assignments_type",
),
```

**Step 3: DB migration — run ALTER TABLE**

```sql
ALTER TABLE assignments DROP CONSTRAINT IF EXISTS ck_assignments_type;
ALTER TABLE assignments ADD CONSTRAINT ck_assignments_type
  CHECK (type IN ('PPT','PPT_EMAIL','REVIEW','FEEDBACK','HOMEWORK'));
```

**Step 4: Migrate existing config JSONB — rename has_ppt → has_ppt_email**

```sql
UPDATE sessions
SET config = config - 'has_ppt' || jsonb_build_object('has_ppt_email', COALESCE(config->>'has_ppt', 'true')::boolean)
WHERE config ? 'has_ppt';
```

**Step 5: Commit**

```
feat: add PPT_EMAIL assignment type and rename has_ppt config
```

---

### Task 2: Backend — Router Updates (Assignment Creation)

**Files:**
- Modify: `backend/app/routers/sessions.py`

**Step 1: Update create_session default config**

In `create_session` (line ~79-81), change default config:

```python
config_data = body.config.model_dump() if body.config else {
    "has_ppt_email": True, "has_review": True, "has_feedback": True, "is_holiday": False
}
```

**Step 2: Update INDIVIDUAL SETUP→PREP assignment creation**

In the SETUP→PREP transition block (lines ~206-234), change `has_ppt` → `has_ppt_email` and type `PPT` → `PPT_EMAIL`:

```python
if current == "SETUP" and target == "PREP" and session.type == "INDIVIDUAL":
    cfg = session.config or {}
    members_result = await db.execute(
        select(Member).where(Member.is_active == True)
    )
    active_members = members_result.scalars().all()
    for member in active_members:
        if cfg.get("has_ppt_email", True):
            db.add(Assignment(
                session_id=session_id,
                member_id=member.id,
                type="PPT_EMAIL",
                status="PENDING",
            ))
        # ... has_review, has_feedback unchanged
```

**Step 3: Update TEAM confirm_teams assignment creation**

In `confirm_teams` (lines ~606-615), change PPT assignment to PPT_EMAIL:

```python
# 팀별 PPT 이메일 제출 과제 1개 생성
if session.config.get("has_ppt_email", True):
    ppt_email = Assignment(
        session_id=session_id,
        team_id=team.id,
        member_id=None,  # 팀 과제
        type="PPT_EMAIL",
        status="PENDING",
    )
    db.add(ppt_email)
```

Also update the PREP reconfirm block (line ~576-583) which deletes team-level assignments — this already handles `team_id IS NOT NULL` so PPT_EMAIL (team-level) will be properly deleted and recreated. No change needed.

**Step 4: Update SETTLEMENT transition — EXCUSED auto-EXEMPT for PPT_EMAIL**

In the POST→SETTLEMENT block (lines ~237-263), add EXCUSED → EXEMPT for PPT_EMAIL before the generic PENDING → MISSING:

```python
if target == "SETTLEMENT":
    # 결석/공결 멤버의 REVIEW는 면제(EXEMPT) 처리
    absent_stmt = select(Attendance.member_id).where(
        Attendance.session_id == session_id,
        Attendance.status.in_(("ABSENT", "EXCUSED")),
    )
    absent_result = await db.execute(absent_stmt)
    absent_ids = {row[0] for row in absent_result.all()}

    # 공결 멤버만 별도 조회 (PPT_EMAIL EXEMPT용)
    excused_stmt = select(Attendance.member_id).where(
        Attendance.session_id == session_id,
        Attendance.status == "EXCUSED",
    )
    excused_result = await db.execute(excused_stmt)
    excused_ids = {row[0] for row in excused_result.all()}

    if absent_ids:
        # REVIEW: ABSENT + EXCUSED → EXEMPT
        await db.execute(
            update(Assignment)
            .where(
                Assignment.session_id == session_id,
                Assignment.status == "PENDING",
                Assignment.type == "REVIEW",
                Assignment.member_id.in_(absent_ids),
            )
            .values(status="EXEMPT")
        )

    if excused_ids:
        # PPT_EMAIL: EXCUSED만 → EXEMPT (ABSENT은 제출 의무)
        # INDIVIDUAL: member_id로 직접 매칭
        await db.execute(
            update(Assignment)
            .where(
                Assignment.session_id == session_id,
                Assignment.status == "PENDING",
                Assignment.type == "PPT_EMAIL",
                Assignment.member_id.in_(excused_ids),
            )
            .values(status="EXEMPT")
        )
        # TEAM: team_id 기반 — 팀원 전원이 공결인 경우만 EXEMPT
        # (팀 중 1명이라도 비공결이면 제출 의무 있음)
        # 팀별로 체크
        team_result = await db.execute(
            select(Assignment).where(
                Assignment.session_id == session_id,
                Assignment.type == "PPT_EMAIL",
                Assignment.team_id.isnot(None),
                Assignment.status == "PENDING",
            )
        )
        for team_ppt in team_result.scalars().all():
            # 해당 팀의 멤버 ID 조회
            from app.models import TeamMember
            tm_result = await db.execute(
                select(TeamMember.member_id).where(TeamMember.team_id == team_ppt.team_id)
            )
            team_member_ids = {row[0] for row in tm_result.all()}
            # 팀원 전원이 공결이면 EXEMPT
            if team_member_ids and team_member_ids.issubset(excused_ids):
                team_ppt.status = "EXEMPT"

    # 나머지 PENDING → MISSING
    await db.execute(
        update(Assignment)
        .where(Assignment.session_id == session_id, Assignment.status == "PENDING")
        .values(status="MISSING")
    )
```

**Step 5: Commit**

```
feat: wire PPT_EMAIL assignments in session lifecycle
```

---

### Task 3: Backend — Penalty Engine

**Files:**
- Modify: `backend/app/services/penalty_engine.py`

**Step 1: Add PPT_EMAIL matrix and update calculate_all**

Add matrix (same values as existing PPT_MATRIX):

```python
PPT_EMAIL_MATRIX = {
    "PASS":    (0, 0),
    "LATE":    (-1, -1000),
    "MISSING": (-2, -3000),
}
```

In `calculate_all()`, after the PPT block, add PPT_EMAIL handling:

```python
# [PPT_EMAIL] (이메일 제출 - EXCUSED만 면제)
ppt_email = assignments.get("PPT_EMAIL")
if ppt_email and not is_excused:
    s_d, d_d = PPT_EMAIL_MATRIX.get(ppt_email.status, (0, 0))
    if s_d != 0 or d_d != 0:
        penalties.append(PenaltyItem(
            type="PPT_EMAIL",
            member=member,
            score_delta=s_d,
            deposit_delta=d_d,
            description=f"PPT이메일 {ppt_email.status}"
        ))
```

For TEAM sessions, PPT_EMAIL has `member_id=NULL` (team-level). The current query filters by `member_id=member.id`, so team PPT_EMAIL won't appear in `assignments` dict. Need to handle team assignments separately:

After the member loop, add team PPT_EMAIL handling:

```python
# TEAM PPT_EMAIL: member_id=NULL이므로 별도 처리
if self.session.type == "TEAM":
    team_ppt_stmt = select(Assignment).where(
        Assignment.session_id == self.session.id,
        Assignment.type == "PPT_EMAIL",
        Assignment.member_id.is_(None),
    )
    team_ppt_result = await self.db.execute(team_ppt_stmt)
    team_ppts = {a.team_id: a for a in team_ppt_result.scalars().all()}

    # 각 팀의 멤버들에게 팀 PPT_EMAIL 페널티 적용
    from app.models import TeamMember, Team
    for team_id, ppt_a in team_ppts.items():
        if ppt_a.status in ("PASS", "EXEMPT"):
            continue
        s_d, d_d = PPT_EMAIL_MATRIX.get(ppt_a.status, (0, 0))
        if s_d == 0 and d_d == 0:
            continue
        # 팀 멤버 조회
        tm_stmt = select(TeamMember.member_id).where(TeamMember.team_id == team_id)
        tm_result = await self.db.execute(tm_stmt)
        for (mid,) in tm_result.all():
            member_obj = next((m for m in members if m.id == mid), None)
            if not member_obj:
                continue
            # EXCUSED 멤버는 면제
            att_stmt2 = select(Attendance).where(
                Attendance.session_id == self.session.id,
                Attendance.member_id == mid,
            )
            att_res2 = await self.db.execute(att_stmt2)
            att2 = att_res2.scalar_one_or_none()
            if att2 and att2.status == "EXCUSED":
                continue
            penalties.append(PenaltyItem(
                type="PPT_EMAIL",
                member=member_obj,
                score_delta=s_d,
                deposit_delta=d_d,
                description=f"PPT이메일 {ppt_a.status} (팀)"
            ))
```

**Step 2: Update PenaltyItem type and finalize skip_types**

In `backend/app/schemas/session.py` `SessionFinalizeOverride`, ensure `PPT_EMAIL` is a valid skip_type (no code change needed — it's a freeform `list[str]`).

In `backend/app/services/finalize.py`, ensure the skip_types filter handles `PPT_EMAIL` (check existing implementation).

**Step 3: Commit**

```
feat: add PPT_EMAIL penalty calculation to penalty engine
```

---

### Task 4: Frontend — Config Rename & Tab Locking

**Files:**
- Modify: `frontend/src/pages/wizard/types.ts:11`
- Modify: `frontend/src/pages/wizard/StepBasic.tsx:87-94`
- Modify: `frontend/src/pages/wizard/StepConfirmation.tsx:24`
- Modify: `frontend/src/pages/SessionWizard.tsx`
- Modify: `frontend/src/pages/session/SessionLayout.tsx`
- Modify: `frontend/src/pages/session/PrepTab.tsx` (has_ppt reference)
- Modify: `frontend/src/pages/session/PostTab.tsx` (has_ppt reference)

**Step 1: Update WizardState type**

```typescript
// types.ts
has_ppt_email: boolean;  // was has_ppt
```

**Step 2: Update StepBasic checkbox**

```tsx
<input
    type="checkbox"
    checked={state.has_ppt_email}
    onChange={(e) => onChange({ has_ppt_email: e.target.checked })}
/>
<span className="text-sm">PPT 이메일 제출</span>
```

**Step 3: Update StepConfirmation config payload**

```typescript
config: {
    has_ppt_email: state.has_ppt_email,
    has_review: state.has_review,
    // ...
}
```

**Step 4: Update SessionWizard default state**

```typescript
has_ppt_email: true,  // was has_ppt: true
```

**Step 5: Update PrepTab — change `cfg.has_ppt` to `cfg.has_ppt_email`**

The Presentation Scan section uses `cfg.has_ppt !== false`. Update to `cfg.has_ppt_email !== false`.

**Step 6: Update PostTab — change any `has_ppt` references**

Search and replace `has_ppt` → `has_ppt_email` in PostTab if present.

**Step 7: Add tab locking in SessionLayout**

In `SessionLayout.tsx`, conditionally disable non-PREP tabs when status is PREP:

```tsx
const isLocked = (tabId: string) =>
    typedSession.status === "PREP" && tabId !== "prep";

// In the tab rendering:
{tabs.map((tab) => {
    const locked = isLocked(tab.id);
    return locked ? (
        <span
            key={tab.id}
            className="px-4 py-3 text-sm font-medium border-b-2 border-transparent text-gray-600 cursor-not-allowed"
        >
            {tab.label}
        </span>
    ) : (
        <NavLink
            key={tab.id}
            to={tab.id}
            className={({ isActive }) =>
                cn(
                    "px-4 py-3 text-sm font-medium border-b-2 transition-colors",
                    isActive
                        ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                        : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-highlight)]"
                )
            }
        >
            {tab.label}
        </NavLink>
    );
})}
```

**Step 8: Commit**

```
feat: rename has_ppt to has_ppt_email and add PREP tab locking
```

---

### Task 5: Frontend — PPT Email Toggle in AttendanceGrid

**Files:**
- Modify: `frontend/src/pages/session/AttendanceGrid.tsx`

**Step 1: Add PPT email status toggle column**

Add a new column "PPT 이메일" to the table. For each member row:
- **INDIVIDUAL session:** find the `PPT_EMAIL` assignment by `member_id` from `session.assignments`, show status toggle
- **TEAM session:** find the `PPT_EMAIL` assignment by `team_id`, show toggle only on first team member row, others show read-only status

The AttendanceGrid needs access to session assignments and type. Update props:

```typescript
interface AttendanceGridProps {
    sessionId: number;
    teams: any[];
    assignments?: any[];     // session.assignments
    sessionType?: string;    // "INDIVIDUAL" | "TEAM"
}
```

Add PPT email status change handler:

```typescript
const handlePptEmailChange = async (assignmentId: number, currentStatus: string) => {
    const PPT_CYCLE: Record<string, string> = {
        PENDING: "PASS",
        PASS: "LATE",
        LATE: "EXEMPT",
        EXEMPT: "PENDING",
    };
    const next = PPT_CYCLE[currentStatus] || "PENDING";
    setUpdating(prev => ({ ...prev, [`ppt_${assignmentId}`]: true }));
    try {
        await api.patch(`/assignments/${assignmentId}`, { status: next });
        await queryClient.invalidateQueries({ queryKey: ["sessions", "detail", sessionId] });
    } catch (error) {
        console.error(error);
        toast.error("PPT 이메일 상태 변경 실패");
    } finally {
        setUpdating(prev => ({ ...prev, [`ppt_${assignmentId}`]: false }));
    }
};
```

Add table column:

```tsx
<TableHead className="w-[140px]">PPT 이메일</TableHead>
```

For each member row, find the PPT_EMAIL assignment and render toggle badge:

```tsx
<TableCell>
    {(() => {
        // Find PPT_EMAIL assignment for this member
        let pptAssignment: any = null;
        let isToggleable = true;

        if (sessionType === "TEAM") {
            // Team: find by team's team_id
            const teamObj = teams.find(t => t.members.some((m: any) => m.member_id === member.member_id));
            if (teamObj) {
                pptAssignment = assignments?.find((a: any) => a.type === "PPT_EMAIL" && a.team_id === teamObj.id);
                // Only first member in team gets the toggle
                const firstMember = teamObj.members[0];
                isToggleable = firstMember?.member_id === member.member_id;
            }
        } else {
            pptAssignment = assignments?.find((a: any) => a.type === "PPT_EMAIL" && a.member_id === member.member_id);
        }

        if (!pptAssignment) return <span className="text-gray-600 text-xs">-</span>;

        const statusColors: Record<string, string> = {
            PENDING: "bg-gray-500/10 text-gray-400 border-gray-500/20",
            PASS: "bg-green-500/10 text-green-400 border-green-500/20",
            LATE: "bg-orange-500/10 text-orange-400 border-orange-500/20",
            MISSING: "bg-red-500/10 text-red-400 border-red-500/20",
            EXEMPT: "bg-gray-500/10 text-gray-500 border-gray-500/20",
        };
        const statusLabels: Record<string, string> = {
            PENDING: "미제출",
            PASS: "제출",
            LATE: "지각제출",
            MISSING: "미제출(확정)",
            EXEMPT: "면제",
        };

        return (
            <button
                onClick={() => isToggleable && handlePptEmailChange(pptAssignment.id, pptAssignment.status)}
                disabled={!isToggleable || updating[`ppt_${pptAssignment.id}`]}
                className={`px-2 py-1 rounded text-xs font-medium border cursor-pointer disabled:cursor-not-allowed ${statusColors[pptAssignment.status] || statusColors.PENDING}`}
            >
                {statusLabels[pptAssignment.status] || pptAssignment.status}
            </button>
        );
    })()}
</TableCell>
```

**Step 2: Update PrepTab to pass new props**

In `PrepTab.tsx`, pass assignments and sessionType to AttendanceGrid:

```tsx
<AttendanceGrid
    sessionId={session.id}
    teams={displayTeams}
    assignments={session.assignments}
    sessionType={session.type}
/>
```

**Step 3: Commit**

```
feat: add PPT email toggle column in PREP attendance grid
```

---

### Task 6: Build, Test & Final Commit

**Step 1: Rebuild backend + worker**

```bash
docker compose up -d --build backend worker
```

**Step 2: Rebuild frontend**

```bash
docker compose up -d --build frontend
```

**Step 3: Verify**

- Create new session → check config has `has_ppt_email`
- SETUP→PREP → check PPT_EMAIL assignments created
- PREP tab → verify PPT email toggle column visible
- Toggle PPT_EMAIL status → verify update works
- Verify tabs locked during PREP status
- Verify tabs unlocked in other statuses

**Step 4: Final commit if any remaining changes**
