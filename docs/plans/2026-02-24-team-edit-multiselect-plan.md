# Team Edit (PREP) + Multi-Select DnD Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow TEAM-type sessions in PREP status to re-edit team composition via the existing drag-and-drop UI, enhanced with multi-member selection and batch drag.

**Architecture:** (1) Backend relaxes `confirm_teams` to accept PREP status — skips status transition and uses upsert for individual assignments. (2) Core DnD logic extracted into shared `TeamBuildingEditor` component with multi-select. (3) New `TeamEditPage` at `/sessions/:id/team-edit` uses that component. (4) PrepTab gets a "팀 수정" button; `StepTeamBuilding` becomes a thin wrapper.

**Tech Stack:** FastAPI + SQLAlchemy async (backend), React 19 + @dnd-kit/core + @dnd-kit/sortable + TanStack Query v5 (frontend)

---

### Task 1: Backend — allow PREP-state team re-confirmation

**Files:**
- Modify: `backend/app/routers/sessions.py` (lines 503–588)

**Context:**
`confirm_teams` currently: (a) rejects non-SETUP status, (b) deletes ALL assignments, (c) creates teams + PPT/REVIEW/FEEDBACK assignments, (d) transitions session to PREP.

In PREP re-edit mode we must: keep existing individual assignments (they may have PASS/FAIL from scanning), only delete PPT assignments (tied to teams via `team_id`), and skip the status transition.

**Step 1: Edit the status check and add branching**

Replace lines 512–513 and the full assignment/team creation block (lines 517–588) with the version below.

Find:
```python
    if session.status != "SETUP":
        raise HTTPException(status_code=400, detail="SETUP 상태에서만 팀 확정 가능")
    if session.type == "INDIVIDUAL":
        raise HTTPException(status_code=400, detail="INDIVIDUAL 세션에는 팀빌딩 불가")

    # 기존 팀/과제 삭제 후 재생성 (SETUP 상태이므로 데이터 없을 것이나 안전하게 삭제)
    # 주의: 출결 레코드는 삭제하지 않음
    from sqlalchemy import delete
    await db.execute(delete(Assignment).where(Assignment.session_id == session_id))

    # 2. Teams 삭제 (session_id 기준, cascade로 team_members도 삭제됨)
    await db.execute(delete(Team).where(Team.session_id == session_id))
```

Replace with:
```python
    if session.status not in ("SETUP", "PREP"):
        raise HTTPException(status_code=400, detail="SETUP 또는 PREP 상태에서만 팀 수정 가능")
    if session.type == "INDIVIDUAL":
        raise HTTPException(status_code=400, detail="INDIVIDUAL 세션에는 팀빌딩 불가")

    is_reconfirm = session.status == "PREP"

    from sqlalchemy import delete, select as sa_select
    if is_reconfirm:
        # PREP 재편집: PPT 과제(팀 단위)만 삭제, 개인 과제는 유지
        await db.execute(
            delete(Assignment).where(
                Assignment.session_id == session_id,
                Assignment.team_id.isnot(None),
            )
        )
    else:
        # SETUP 최초 확정: 모든 과제 삭제
        await db.execute(delete(Assignment).where(Assignment.session_id == session_id))

    # 기존 팀 삭제 (cascade로 team_members도 삭제됨)
    await db.execute(delete(Team).where(Team.session_id == session_id))
```

**Step 2: Update individual assignment creation to use upsert in PREP mode**

Find (lines ~560–585):
```python
    for mid in all_assigned_member_ids:
        # REVIEW
        if session.config.get("has_review", True):
            db.add(Assignment(
                session_id=session_id,
                member_id=mid,
                type="REVIEW",
                status="PENDING"
            ))
        # FEEDBACK
        if session.config.get("has_feedback", True):
            db.add(Assignment(
                session_id=session_id,
                member_id=mid,
                type="FEEDBACK",
                status="PENDING",
                target_count=1 # 기본 1개
            ))
        # HOMEWORK (예: 질문/답변 등) -> has_homework? config에는 없음.
        # spec_infra.md 의 example .env에는 없음.
        # models.py JSONB default에는 'is_holiday' 등이 있음.
        # 여기선 config 키를 확인.
        # (models.py: '{"has_ppt":true,"has_review":true,"has_feedback":true,"is_holiday":false}')
        # HOMEWORK는 명시되어 있지 않으나 Assignment type ENUM에는 있음.
        # 일단 REVIEW, FEEDBACK만 생성.

    # 5. 상태 전환
    session.status = "PREP"
    await db.commit()
```

Replace with:
```python
    if is_reconfirm:
        # PREP 재편집: 이미 존재하는 개인 과제는 유지, 새 멤버만 생성
        existing_result = await db.execute(
            sa_select(Assignment.member_id, Assignment.type).where(
                Assignment.session_id == session_id,
                Assignment.member_id.isnot(None),
            )
        )
        existing_pairs = {(row.member_id, row.type) for row in existing_result}

        for mid in all_assigned_member_ids:
            if session.config.get("has_review", True) and (mid, "REVIEW") not in existing_pairs:
                db.add(Assignment(session_id=session_id, member_id=mid, type="REVIEW", status="PENDING"))
            if session.config.get("has_feedback", True) and (mid, "FEEDBACK") not in existing_pairs:
                db.add(Assignment(session_id=session_id, member_id=mid, type="FEEDBACK", status="PENDING", target_count=1))
    else:
        # SETUP 최초 확정: 전원 개인 과제 생성
        for mid in all_assigned_member_ids:
            if session.config.get("has_review", True):
                db.add(Assignment(session_id=session_id, member_id=mid, type="REVIEW", status="PENDING"))
            if session.config.get("has_feedback", True):
                db.add(Assignment(session_id=session_id, member_id=mid, type="FEEDBACK", status="PENDING", target_count=1))

        # SETUP에서만 상태 전환
        session.status = "PREP"

    await db.commit()
```

**Step 3: Restart backend and verify**

```bash
cd /home/ubuntu/ops-platform
docker compose restart backend
sleep 5
docker compose logs backend --tail 15
```
Expected: "Application startup complete", no errors.

**Step 4: Commit**

```bash
git add backend/app/routers/sessions.py
git commit -m "feat: allow team re-edit in PREP status (no status transition, upsert assignments)"
```

---

### Task 2: Frontend — `TeamBuildingEditor` shared component with multi-select DnD

**Files:**
- Create: `frontend/src/components/TeamBuildingEditor.tsx`

**Context:**
All DnD logic is extracted from `StepTeamBuilding.tsx` into this component. Key additions:
- `selectedIds: Set<number>` — currently selected member IDs (click to toggle)
- `PointerSensor` gets `activationConstraint: { distance: 8 }` so click events register before drag
- Drag start: if dragged item is selected → drag all selected; else drag only that item
- Drag over: move all `draggedIds` at once from source container to target
- Drag end: clear selection
- DragOverlay: shows count badge when >1 item dragged

**Step 1: Create `frontend/src/components/TeamBuildingEditor.tsx`**

```tsx
import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { UserPlus, Wand2, Save, X } from "lucide-react";
import { toast } from "sonner";
import {
    DndContext,
    DragOverlay,
    closestCorners,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    defaultDropAnimationSideEffects,
} from "@dnd-kit/core";
import type { DragStartEvent, DragOverEvent, DragEndEvent, DropAnimation } from "@dnd-kit/core";
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";

export interface Member {
    id: number;
    name: string;
    is_active: boolean;
    tags?: string[];
}

export interface TeamBuildingEditorProps {
    members: Member[];
    initialTeams: Record<string, number[]>;
    onSave: (teams: Record<string, number[]>) => void;
    onCancel: () => void;
    isSaving?: boolean;
    saveLabel?: string;
    cancelLabel?: string;
}

// ─── DraggableMember ───────────────────────────────────────────────

function DraggableMember({
    member,
    id,
    isConflict,
    isSelected,
    onToggleSelect,
}: {
    member: Member | undefined;
    id: number;
    isConflict?: boolean;
    isSelected: boolean;
    onToggleSelect: (id: number) => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                "p-3 rounded border text-sm mb-2 cursor-grab active:cursor-grabbing transition-all shadow-sm flex justify-between items-center select-none",
                isSelected
                    ? "bg-[var(--color-accent)]/15 border-[var(--color-accent)]/60"
                    : isConflict
                    ? "bg-yellow-500/5 border-yellow-500/50 hover:border-yellow-500"
                    : "bg-[var(--color-elevated)] border-[var(--color-border)] hover:border-[var(--color-accent)]/50"
            )}
            {...attributes}
            {...listeners}
            onClick={(e) => {
                e.stopPropagation();
                onToggleSelect(id);
            }}
        >
            <div className="flex items-center gap-2">
                <div className={cn(
                    "w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center",
                    isSelected
                        ? "bg-[var(--color-accent)] border-[var(--color-accent)]"
                        : "border-[var(--color-border)]"
                )}>
                    {isSelected && <span className="text-white text-[8px] font-bold">✓</span>}
                </div>
                <span className="font-medium">{member?.name ?? id}</span>
                {member?.tags?.includes("leader") && (
                    <span className="text-[10px] px-1 bg-[var(--color-accent)]/20 text-[var(--color-accent)] rounded border border-[var(--color-accent)]/30">L</span>
                )}
            </div>
        </div>
    );
}

// ─── DroppableColumn ───────────────────────────────────────────────

function DroppableColumn({
    id,
    title,
    items,
    members,
    selectedIds,
    conflicts,
    onToggleSelect,
}: {
    id: string;
    title: string;
    items: number[];
    members: Member[];
    selectedIds: Set<number>;
    conflicts?: Set<number>;
    onToggleSelect: (id: number) => void;
}) {
    const { setNodeRef } = useSortable({ id });

    return (
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4 flex flex-col h-full min-h-[300px]">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-[var(--color-border)]">
                <h3 className="font-bold text-sm uppercase tracking-wider text-[var(--color-text-secondary)]">{title}</h3>
                <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full">{items.length}</span>
            </div>
            <SortableContext id={id} items={items} strategy={verticalListSortingStrategy}>
                <div ref={setNodeRef} className="flex-1 overflow-y-auto">
                    {items.map((memberId) => (
                        <DraggableMember
                            key={memberId}
                            id={memberId}
                            member={members.find((m) => m.id === memberId)}
                            isConflict={conflicts?.has(memberId)}
                            isSelected={selectedIds.has(memberId)}
                            onToggleSelect={onToggleSelect}
                        />
                    ))}
                    {items.length === 0 && (
                        <div className="h-full flex items-center justify-center text-[var(--color-text-muted)] text-xs border-2 border-dashed border-[var(--color-border)] rounded">
                            여기로 드래그
                        </div>
                    )}
                </div>
            </SortableContext>
        </div>
    );
}

// ─── TeamBuildingEditor ────────────────────────────────────────────

export function TeamBuildingEditor({
    members,
    initialTeams,
    onSave,
    onCancel,
    isSaving = false,
    saveLabel = "저장",
    cancelLabel = "취소",
}: TeamBuildingEditorProps) {
    const [teams, setTeams] = useState<Record<string, number[]>>(initialTeams);
    const [draggedIds, setDraggedIds] = useState<Set<number>>(new Set());
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

    // Conflict detection: multiple leaders in same team
    const conflicts = new Set<number>();
    members.forEach(() => {});
    Object.values(teams).forEach((teamMembers) => {
        const leaders = teamMembers.filter((id) => members.find((m) => m.id === id)?.tags?.includes("leader"));
        if (leaders.length > 1) leaders.forEach((id) => conflicts.add(id));
    });

    const toggleSelect = useCallback((id: number) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const findContainer = (id: string | number, currentTeams: Record<string, number[]>) => {
        if (id in currentTeams) return id as string;
        return Object.keys(currentTeams).find((key) => currentTeams[key].includes(id as number));
    };

    const handleDragStart = (event: DragStartEvent) => {
        const dragId = event.active.id as number;
        // If dragging a selected item, drag all selected; else drag only this item
        const ids = selectedIds.has(dragId) ? new Set(selectedIds) : new Set([dragId]);
        setDraggedIds(ids);
    };

    const handleDragOver = (event: DragOverEvent) => {
        const { active, over } = event;
        if (!over || draggedIds.size === 0) return;

        const activeContainer = findContainer(active.id, teams);
        const overContainer = findContainer(over.id as string | number, teams);

        if (!activeContainer || !overContainer || activeContainer === overContainer) return;

        setTeams((prev) => {
            const newTeams = { ...prev };
            // Remove all dragged IDs from source
            newTeams[activeContainer] = prev[activeContainer].filter((id) => !draggedIds.has(id));
            // Add all dragged IDs to target (at drop position)
            const overItems = [...prev[overContainer].filter((id) => !draggedIds.has(id))];
            const overIndex = overItems.indexOf(over.id as number);
            const insertAt = overIndex >= 0 ? overIndex + 1 : overItems.length;
            overItems.splice(insertAt, 0, ...draggedIds);
            newTeams[overContainer] = overItems;
            return newTeams;
        });
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && draggedIds.size === 1) {
            // Single item: handle reorder within same container
            const activeContainer = findContainer(active.id, teams);
            const overContainer = findContainer(over.id as string | number, teams);
            if (activeContainer && overContainer && activeContainer === overContainer) {
                const activeIndex = teams[activeContainer].indexOf(active.id as number);
                const overIndex = teams[activeContainer].indexOf(over.id as number);
                if (activeIndex !== overIndex) {
                    setTeams((prev) => ({
                        ...prev,
                        [activeContainer]: arrayMove(prev[activeContainer], activeIndex, overIndex),
                    }));
                }
            }
        }

        setDraggedIds(new Set());
        setSelectedIds(new Set());
    };

    const handleAddTeam = () => {
        const teamCount = Object.keys(teams).filter((k) => k.startsWith("Team")).length;
        const newTeamId = `Team ${String.fromCharCode(65 + teamCount)}`;
        setTeams((prev) => ({ ...prev, [newTeamId]: [] }));
    };

    const handleRemoveTeam = (teamId: string) => {
        setTeams((prev) => {
            const unassigned = [...(prev["unassigned"] || []), ...prev[teamId]];
            const next = { ...prev, unassigned };
            delete next[teamId];
            return next;
        });
    };

    const handleAutoGenerate = () => {
        const active = members.filter((m) => m.is_active);
        const shuffled = [...active].sort(() => 0.5 - Math.random());
        const numTeams = Math.ceil(shuffled.length / 4);
        const newTeams: Record<string, number[]> = { unassigned: [] };
        for (let i = 0; i < numTeams; i++) {
            const name = `Team ${String.fromCharCode(65 + i)}`;
            newTeams[name] = shuffled.splice(0, 4).map((m) => m.id);
        }
        setTeams(newTeams);
        toast.success(`${numTeams}개 팀 자동 생성 완료`);
    };

    const handleSave = () => {
        onSave(teams);
    };

    const dropAnimation: DropAnimation = {
        sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0.5" } } }),
    };

    const draggedNames = Array.from(draggedIds)
        .slice(0, 3)
        .map((id) => members.find((m) => m.id === id)?.name ?? String(id));

    return (
        <div className="space-y-4 h-full flex flex-col">
            {/* Toolbar */}
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <Button onClick={handleAddTeam} size="sm" variant="secondary">
                        <UserPlus className="w-4 h-4 mr-2" />
                        팀 추가
                    </Button>
                    {selectedIds.size > 0 && (
                        <span className="text-xs text-[var(--color-accent)] bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 px-2 py-1 rounded-full">
                            {selectedIds.size}명 선택됨 — 드래그로 이동
                        </span>
                    )}
                </div>
                <Button onClick={handleAutoGenerate} variant="outline" className="text-[var(--color-accent)] border-[var(--color-accent)]">
                    <Wand2 className="w-4 h-4 mr-2" />
                    자동 생성
                </Button>
            </div>

            {/* DnD Board */}
            <DndContext
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
            >
                <div className="flex-1 overflow-x-auto pb-2">
                    <div className="flex gap-4 h-full min-w-max">
                        {/* Unassigned column */}
                        <div className="w-64 flex-shrink-0">
                            <DroppableColumn
                                id="unassigned"
                                title="미배정"
                                items={teams["unassigned"] || []}
                                members={members}
                                selectedIds={selectedIds}
                                conflicts={conflicts}
                                onToggleSelect={toggleSelect}
                            />
                        </div>
                        <div className="w-px bg-[var(--color-border)] mx-2 opacity-50" />
                        {/* Team columns */}
                        {Object.keys(teams)
                            .filter((k) => k !== "unassigned")
                            .map((teamId) => (
                                <div key={teamId} className="w-64 flex-shrink-0 relative">
                                    <DroppableColumn
                                        id={teamId}
                                        title={teamId.toUpperCase()}
                                        items={teams[teamId]}
                                        members={members}
                                        selectedIds={selectedIds}
                                        conflicts={conflicts}
                                        onToggleSelect={toggleSelect}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => handleRemoveTeam(teamId)}
                                        className="absolute top-2 right-2 text-[var(--color-text-muted)] hover:text-rose-400 transition-colors text-xs"
                                        title="팀 삭제"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ))}
                    </div>
                </div>

                <DragOverlay dropAnimation={dropAnimation}>
                    {draggedIds.size > 0 ? (
                        <div className="p-3 bg-[var(--color-elevated)] rounded border border-[var(--color-accent)]/40 text-sm shadow-xl opacity-90 w-60">
                            {draggedIds.size > 1 ? (
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold bg-[var(--color-accent)] text-white px-1.5 py-0.5 rounded-full">{draggedIds.size}</span>
                                    <span className="text-[var(--color-text-secondary)] text-xs">{draggedNames.join(", ")}{draggedIds.size > 3 ? " ..." : ""}</span>
                                </div>
                            ) : (
                                <span>{members.find((m) => m.id === Array.from(draggedIds)[0])?.name ?? Array.from(draggedIds)[0]}</span>
                            )}
                        </div>
                    ) : null}
                </DragOverlay>
            </DndContext>

            {/* Footer actions */}
            <div className="flex justify-between pt-2 border-t border-[var(--color-border)]">
                <Button variant="outline" onClick={onCancel} disabled={isSaving}>
                    {cancelLabel}
                </Button>
                <Button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]"
                >
                    <Save className="w-4 h-4 mr-2" />
                    {isSaving ? "저장 중..." : saveLabel}
                </Button>
            </div>
        </div>
    );
}
```

**Step 2: TypeScript check**

```bash
docker exec ops-platform-frontend-dev-1 npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors from the new file.

**Step 3: Commit**

```bash
git add frontend/src/components/TeamBuildingEditor.tsx
git commit -m "feat: TeamBuildingEditor shared component with multi-select DnD"
```

---

### Task 3: Frontend — `TeamEditPage` + route registration

**Files:**
- Create: `frontend/src/pages/session/TeamEditPage.tsx`
- Modify: `frontend/src/App.tsx`

**Context:**
`TeamEditPage` reads the current session from the outlet context (same pattern as PrepTab), converts existing teams to the `Record<string, number[]>` format for the editor, then calls `PATCH /sessions/:id/teams` on save.

**Step 1: Create `frontend/src/pages/session/TeamEditPage.tsx`**

```tsx
import { useOutletContext, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMembers } from "@/hooks/useMembers";
import { TeamBuildingEditor } from "@/components/TeamBuildingEditor";
import { toast } from "sonner";
import api from "@/lib/api";
import type { Session } from "@/hooks/useSessions";
import { sessionsKeys } from "@/hooks/useSessions";

export default function TeamEditPage() {
    const { session } = useOutletContext<{ session: Session }>();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { data: allMembers } = useMembers();

    // Convert session.teams → Record<string, number[]>
    // Include all active members that are NOT in any team in "unassigned"
    const initialTeams: Record<string, number[]> = { unassigned: [] };
    const assignedIds = new Set<number>();
    (session.teams ?? []).forEach((team) => {
        initialTeams[team.name] = team.members.map((m) => m.id);
        team.members.forEach((m) => assignedIds.add(m.id));
    });
    // Put active members not in any team into unassigned
    (allMembers ?? [])
        .filter((m) => m.is_active && !assignedIds.has(m.id))
        .forEach((m) => initialTeams["unassigned"].push(m.id));

    const { mutate: saveTeams, isPending } = useMutation({
        mutationFn: async (teams: Record<string, number[]>) => {
            const teamsList = Object.entries(teams)
                .filter(([key, members]) => key !== "unassigned" && members.length > 0)
                .map(([name, memberIds]) => ({
                    name,
                    members: memberIds.map((id) => ({ member_id: id })),
                }));
            await api.patch(`/sessions/${session.id}/teams`, { teams: teamsList });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: sessionsKeys.detail(session.id) });
            toast.success("팀 구성이 저장되었습니다.");
            navigate(`/sessions/${session.id}/prep`);
        },
        onError: () => {
            toast.error("팀 저장 실패");
        },
    });

    return (
        <div className="p-6 h-full flex flex-col">
            <div className="mb-4">
                <h2 className="text-xl font-bold">팀 수정</h2>
                <p className="text-sm text-[var(--color-text-secondary)]">
                    멤버를 클릭해 여러 명을 선택한 후 함께 드래그하여 팀 간 이동할 수 있습니다.
                </p>
            </div>
            <div className="flex-1 min-h-0">
                <TeamBuildingEditor
                    members={allMembers ?? []}
                    initialTeams={initialTeams}
                    onSave={saveTeams}
                    onCancel={() => navigate(`/sessions/${session.id}/prep`)}
                    isSaving={isPending}
                    saveLabel="팀 저장"
                    cancelLabel="← 돌아가기"
                />
            </div>
        </div>
    );
}
```

**Step 2: Register the route in `frontend/src/App.tsx`**

Add import at top (near other session page imports):
```typescript
import TeamEditPage from "@/pages/session/TeamEditPage";
```

Inside the `<Route path="/sessions/:id" element={<SessionLayout />}>` block, add after the `settlement` route:
```tsx
<Route path="team-edit" element={<TeamEditPage />} />
```

The routes block becomes:
```tsx
<Route path="/sessions/:id" element={<SessionLayout />}>
  <Route index element={<Navigate to="prep" replace />} />
  <Route path="prep" element={<PrepTab />} />
  <Route path="ops" element={<OpsTab />} />
  <Route path="post" element={<PostTab />} />
  <Route path="settlement" element={<SettlementTab />} />
  <Route path="team-edit" element={<TeamEditPage />} />
</Route>
```

**Step 3: TypeScript check**

```bash
docker exec ops-platform-frontend-dev-1 npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors.

**Step 4: Commit**

```bash
git add frontend/src/pages/session/TeamEditPage.tsx frontend/src/App.tsx
git commit -m "feat: TeamEditPage + /sessions/:id/team-edit route"
```

---

### Task 4: Frontend — PrepTab button + StepTeamBuilding refactor

**Files:**
- Modify: `frontend/src/pages/session/PrepTab.tsx`
- Modify: `frontend/src/pages/wizard/StepTeamBuilding.tsx`

**Context:**
PrepTab needs a "팀 수정" button visible only for TEAM sessions in PREP status.
`StepTeamBuilding` becomes a thin wrapper around `TeamBuildingEditor`, keeping its `StepProps` interface intact.

**Step 1: Add "팀 수정" button to PrepTab**

In `frontend/src/pages/session/PrepTab.tsx`:

Add `useNavigate` to the react-router-dom import:
```typescript
import { useOutletContext, useNavigate } from "react-router-dom";
```

Add `navigate` inside the component (after `const { session }` line):
```typescript
const navigate = useNavigate();
```

Find the Attendance Check section header:
```tsx
            <section>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-lg">Attendance Check</h3>
                </div>
```

Replace with:
```tsx
            <section>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-lg">Attendance Check</h3>
                    {session.type === "TEAM" && session.status === "PREP" && (
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => navigate(`/sessions/${session.id}/team-edit`)}
                            className="border-[var(--color-border)] hover:bg-white/5"
                        >
                            팀 수정
                        </Button>
                    )}
                </div>
```

Also add `Button` to the existing import:
```typescript
import { Button } from "@/components/ui/button";
```
(Check: Button is not currently imported in PrepTab. Add it.)

**Step 2: Refactor `StepTeamBuilding` to thin wrapper**

Replace the entire content of `frontend/src/pages/wizard/StepTeamBuilding.tsx` with:

```tsx
import type { StepProps } from "./types";
import { useMembers } from "@/hooks";
import { TeamBuildingEditor } from "@/components/TeamBuildingEditor";
import { ArrowRight } from "lucide-react";

export function StepTeamBuilding({ state, onChange, onNext, onBack }: StepProps) {
    const { data: members } = useMembers();

    const initialTeams = Object.keys(state.teams).length > 0
        ? state.teams
        : { unassigned: (members ?? []).filter((m) => m.is_active).map((m) => m.id) };

    return (
        <div className="space-y-6 max-w-[90vw] mx-auto h-[80vh] flex flex-col">
            <h2 className="text-xl font-bold">Team Building</h2>
            <div className="flex-1 min-h-0">
                <TeamBuildingEditor
                    members={members ?? []}
                    initialTeams={initialTeams}
                    onSave={(teams) => {
                        onChange({ teams });
                        onNext();
                    }}
                    onCancel={onBack}
                    saveLabel="다음: 확인"
                    cancelLabel="이전"
                />
            </div>
        </div>
    );
}
```

**Step 3: TypeScript check**

```bash
docker exec ops-platform-frontend-dev-1 npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors.

**Step 4: Commit**

```bash
git add frontend/src/pages/session/PrepTab.tsx frontend/src/pages/wizard/StepTeamBuilding.tsx
git commit -m "feat: team edit button in PrepTab, refactor StepTeamBuilding to use TeamBuildingEditor"
```
