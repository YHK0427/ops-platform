import { useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { UserPlus, Wand2, Save, X, Search, Pencil } from "lucide-react";
import { toast } from "sonner";
import {
    DndContext,
    DragOverlay,
    closestCorners,
    KeyboardSensor,
    MouseSensor,
    TouchSensor,
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

export interface TeamMember {
    id: number;
    name: string;
    is_active: boolean;
    tags?: string[];
}

export interface TeamBuildingEditorProps {
    members: TeamMember[];
    initialTeams: Record<string, number[]>;
    onSave: (teams: Record<string, number[]>) => void;
    onCancel: () => void;
    isSaving?: boolean;
    saveLabel?: string;
    cancelLabel?: string;
    fixedColumns?: boolean; // true면 팀 추가/삭제/이름변경 숨김 (분반 모드)
    autoGenerateFn?: (members: TeamMember[]) => Record<string, number[]>; // 자동 생성 오버라이드
}

// ─── DraggableMember ───────────────────────────────────────────────

function DraggableMember({
    member,
    id,
    isConflict,
    isSelected,
    onToggleSelect,
}: {
    member: TeamMember | undefined;
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
    onRename,
}: {
    id: string;
    title: string;
    items: number[];
    members: TeamMember[];
    selectedIds: Set<number>;
    conflicts: Set<number>;
    onToggleSelect: (id: number) => void;
    onRename?: (newName: string) => void;
}) {
    const { setNodeRef } = useSortable({ id });
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(title);

    const handleSubmitRename = () => {
        const trimmed = editValue.trim();
        if (trimmed && trimmed !== title && onRename) {
            onRename(trimmed);
        } else {
            setEditValue(title);
        }
        setIsEditing(false);
    };

    return (
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-3 md:p-4 flex flex-col h-full min-h-[200px] md:min-h-[300px]">
            <div className="flex justify-between items-center mb-3 md:mb-4 pb-2 border-b border-[var(--color-border)]">
                {isEditing && onRename ? (
                    <input
                        className="font-bold text-sm bg-transparent border-b border-[var(--color-accent)] outline-none text-[var(--color-text-primary)] w-full mr-2"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleSubmitRename}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleSubmitRename();
                            if (e.key === "Escape") { setEditValue(title); setIsEditing(false); }
                        }}
                        autoFocus
                    />
                ) : (
                    <button
                        type="button"
                        className={cn(
                            "flex items-center gap-1.5 font-bold text-sm uppercase tracking-wider text-[var(--color-text-secondary)] outline-none",
                            onRename
                                ? "cursor-pointer hover:text-[var(--color-text-primary)] group/title"
                                : "cursor-default"
                        )}
                        onClick={() => { if (onRename) { setEditValue(title); setIsEditing(true); } }}
                        title={onRename ? "클릭하여 팀명 수정" : undefined}
                        disabled={!onRename}
                    >
                        <span>{title}</span>
                        {onRename && (
                            <Pencil className="w-3 h-3 text-[var(--color-text-muted)] group-hover/title:text-[var(--color-accent)]" />
                        )}
                    </button>
                )}
                <span className="text-xs bg-gray-100 px-2 py-0.5 rounded-full flex-shrink-0">{items.length}</span>
            </div>
            <SortableContext id={id} items={items} strategy={verticalListSortingStrategy}>
                <div ref={setNodeRef} className="flex-1 overflow-y-auto">
                    {items.map((memberId) => (
                        <DraggableMember
                            key={memberId}
                            id={memberId}
                            member={members.find((m) => m.id === memberId)}
                            isConflict={conflicts.has(memberId)}
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
    fixedColumns = false,
    autoGenerateFn,
}: TeamBuildingEditorProps) {
    const [teams, setTeams] = useState<Record<string, number[]>>(initialTeams);
    const [draggedIds, setDraggedIds] = useState<Set<number>>(new Set());
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [searchQuery, setSearchQuery] = useState("");

    // Filter unassigned members by search query
    const filteredUnassigned = useMemo(() => {
        const all = teams["unassigned"] ?? [];
        if (!searchQuery.trim()) return all;
        const q = searchQuery.trim().toLowerCase();
        return all.filter((id) => {
            const m = members.find((m) => m.id === id);
            return m?.name.toLowerCase().includes(q);
        });
    }, [teams, searchQuery, members]);

    // Conflict detection: multiple leaders in same team
    const conflicts = new Set<number>();
    Object.values(teams).forEach((teamMembers) => {
        const leaders = teamMembers.filter((id) =>
            members.find((m) => m.id === id)?.tags?.includes("leader")
        );
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

    // Mouse는 8px 이동으로 활성화, Touch는 150ms 길게 눌러야 활성화 (스크롤과 충돌 방지)
    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const findContainer = (id: string | number, currentTeams: Record<string, number[]>) => {
        if (id in currentTeams) return id as string;
        return Object.keys(currentTeams).find((key) => currentTeams[key].includes(id as number));
    };

    const handleDragStart = (event: DragStartEvent) => {
        const dragId = event.active.id as number;
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
            newTeams[activeContainer] = prev[activeContainer].filter((id) => !draggedIds.has(id));
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
        const existingNums = Object.keys(teams)
            .filter((k) => k !== "unassigned")
            .map((k) => { const m = k.match(/^(\d+)조$/); return m ? parseInt(m[1]) : 0; });
        const nextNum = (existingNums.length > 0 ? Math.max(...existingNums) : 0) + 1;
        setTeams((prev) => ({ ...prev, [`${nextNum}조`]: [] }));
    };

    const handleRemoveTeam = (teamId: string) => {
        setTeams((prev) => {
            const unassigned = [...(prev["unassigned"] ?? []), ...prev[teamId]];
            const next: Record<string, number[]> = { ...prev, unassigned };
            delete next[teamId];
            return next;
        });
    };

    const handleRenameTeam = (oldName: string, newName: string) => {
        if (newName === oldName || newName === "unassigned") return;
        if (newName in teams) {
            toast.error("이미 존재하는 팀 이름입니다.");
            return;
        }
        setTeams((prev) => {
            const entries = Object.entries(prev);
            const result: Record<string, number[]> = {};
            for (const [key, val] of entries) {
                result[key === oldName ? newName : key] = val;
            }
            return result;
        });
    };

    const handleAutoGenerate = () => {
        if (autoGenerateFn) {
            const result = autoGenerateFn(members);
            setTeams(result);
            toast.success("자동 분배 완료");
            return;
        }
        const active = members.filter((m) => m.is_active);
        const shuffled = [...active].sort(() => 0.5 - Math.random());
        const numTeams = Math.ceil(shuffled.length / 4);
        const newTeams: Record<string, number[]> = { unassigned: [] };
        for (let i = 0; i < numTeams; i++) {
            newTeams[`${i + 1}조`] = shuffled.splice(0, 4).map((m) => m.id);
        }
        setTeams(newTeams);
        toast.success(`${numTeams}개 팀 자동 생성 완료`);
    };

    const dropAnimation: DropAnimation = {
        sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0.5" } } }),
    };

    const draggedList = Array.from(draggedIds);
    const draggedNames = draggedList
        .slice(0, 3)
        .map((id) => members.find((m) => m.id === id)?.name ?? String(id));

    return (
        <div className="space-y-4 h-full flex flex-col">
            {/* Toolbar */}
            <div className="flex flex-wrap justify-between items-center gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                    {!fixedColumns && (
                    <Button onClick={handleAddTeam} size="sm" variant="secondary">
                        <UserPlus className="w-4 h-4 mr-1 md:mr-2" />
                        팀 추가
                    </Button>
                    )}
                    {selectedIds.size > 0 && (
                        <span className="text-xs text-[var(--color-accent)] bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 px-2 py-1 rounded-full">
                            {selectedIds.size}명 선택됨 — 드래그로 이동
                        </span>
                    )}
                </div>
                <Button
                    onClick={handleAutoGenerate}
                    variant="outline"
                    size="sm"
                    className="text-[var(--color-accent)] border-[var(--color-accent)]"
                >
                    <Wand2 className="w-4 h-4 mr-1 md:mr-2" />
                    {fixedColumns ? "자동 분배" : "자동 생성"}
                </Button>
            </div>
            {/* 모바일 안내 — 길게 누른 후 드래그해야 함 (스크롤과 충돌 방지) */}
            <p className="md:hidden text-[11px] text-[var(--color-text-muted)] -mt-2">
                💡 모바일: 카드를 <span className="font-medium text-[var(--color-text-secondary)]">길게 누른 뒤</span> 다른 팀으로 끌어다 놓으세요.
            </p>

            {/* DnD Board */}
            <DndContext
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
            >
                <div className="flex-1 overflow-y-auto md:overflow-x-auto md:overflow-y-hidden pb-2">
                    <div className="flex flex-col md:flex-row gap-3 md:gap-4 md:h-full md:min-w-max">
                        {/* Unassigned column */}
                        <div className="w-full md:w-64 md:flex-shrink-0 flex flex-col">
                            <div className="relative mb-2">
                                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                                <input
                                    type="text"
                                    placeholder="이름 검색..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full pl-8 pr-3 py-2 text-sm rounded border border-[var(--color-border)] bg-white text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent)]/50"
                                />
                            </div>
                            <DroppableColumn
                                id="unassigned"
                                title={`미배정 (${(teams["unassigned"] ?? []).length})`}
                                items={filteredUnassigned}
                                members={members}
                                selectedIds={selectedIds}
                                conflicts={conflicts}
                                onToggleSelect={toggleSelect}
                            />
                        </div>
                        <div className="hidden md:block w-px bg-[var(--color-border)] mx-2 opacity-50" />
                        <div className="md:hidden h-px bg-[var(--color-border)] my-1 opacity-50" />
                        {/* Team columns */}
                        {Object.keys(teams)
                            .filter((k) => k !== "unassigned")
                            .map((teamId) => (
                                <div key={teamId} className="w-full md:w-64 md:flex-shrink-0 relative">
                                    <DroppableColumn
                                        id={teamId}
                                        title={teamId}
                                        items={teams[teamId]}
                                        members={members}
                                        selectedIds={selectedIds}
                                        conflicts={conflicts}
                                        onToggleSelect={toggleSelect}
                                        onRename={fixedColumns ? undefined : (newName) => handleRenameTeam(teamId, newName)}
                                    />
                                    {!fixedColumns && (
                                    <button
                                        type="button"
                                        onClick={() => handleRemoveTeam(teamId)}
                                        className="absolute top-2 right-2 text-[var(--color-text-muted)] hover:text-rose-500 transition-colors p-1"
                                        title="팀 삭제"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                    )}
                                </div>
                            ))}
                    </div>
                </div>

                <DragOverlay dropAnimation={dropAnimation}>
                    {draggedList.length > 0 ? (
                        <div className="p-3 bg-[var(--color-elevated)] rounded border border-[var(--color-accent)]/40 text-sm shadow-xl opacity-90 w-60">
                            {draggedList.length > 1 ? (
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold bg-[var(--color-accent)] text-white px-1.5 py-0.5 rounded-full">
                                        {draggedList.length}
                                    </span>
                                    <span className="text-[var(--color-text-secondary)] text-xs">
                                        {draggedNames.join(", ")}{draggedList.length > 3 ? " ..." : ""}
                                    </span>
                                </div>
                            ) : (
                                <span>{members.find((m) => m.id === draggedList[0])?.name ?? draggedList[0]}</span>
                            )}
                        </div>
                    ) : null}
                </DragOverlay>
            </DndContext>

            {/* Footer */}
            <div className="flex justify-between pt-2 border-t border-[var(--color-border)]">
                <Button variant="outline" onClick={onCancel} disabled={isSaving}>
                    {cancelLabel}
                </Button>
                <Button
                    onClick={() => onSave(teams)}
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
