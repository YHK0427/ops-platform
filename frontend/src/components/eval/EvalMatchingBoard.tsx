import { useState, useCallback, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Wand2, Save, Search, Users, Settings2, X, RotateCcw } from "lucide-react";
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

// ── Types ────────────────────────────────────────────────────────────────────

export interface MatchingUser {
    id: number;
    display_name: string;
    username: string;
}

export interface MatchingMember {
    id: number;
    name: string;
}

export interface EvalMatchingBoardProps {
    users: MatchingUser[];
    members: MatchingMember[];
    initialBoard: Record<string, number[]>;
    onSave: (assignments: { evaluator_user_id: number; presenter_member_id: number }[]) => void;
    onCancel?: () => void;
    isSaving?: boolean;
    saveLabel?: string;
    cancelLabel?: string;
}

// ── ID helpers (composite unique IDs for dnd-kit) ───────────────────────────

function poolId(memberId: number): string {
    return `p${memberId}`;
}
function evalId(userId: number, memberId: number): string {
    return `e${userId}_${memberId}`;
}
function parseId(id: string | number): { source: "pool" | "eval"; memberId: number; userId?: number } {
    const s = String(id);
    if (s.startsWith("p")) return { source: "pool", memberId: Number(s.slice(1)) };
    if (s.startsWith("e")) {
        const [uPart, mPart] = s.slice(1).split("_");
        return { source: "eval", userId: Number(uPart), memberId: Number(mPart) };
    }
    return { source: "pool", memberId: Number(s) };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function assignmentsToBoard(
    assignments: { evaluator_user_id: number | null; presenter_member_id: number; eval_type: string }[],
    userIds: number[],
    _memberIds: number[]
): Record<string, number[]> {
    const board: Record<string, number[]> = {};
    for (const uid of userIds) board[String(uid)] = [];

    for (const a of assignments) {
        if (a.eval_type !== "AUDIENCE" || !a.evaluator_user_id) continue;
        const key = String(a.evaluator_user_id);
        if (key in board) {
            board[key].push(a.presenter_member_id);
        }
    }
    return board;
}

export function boardToAssignments(
    board: Record<string, number[]>
): { evaluator_user_id: number; presenter_member_id: number }[] {
    const result: { evaluator_user_id: number; presenter_member_id: number }[] = [];
    for (const [key, memberIds] of Object.entries(board)) {
        const userId = Number(key);
        if (isNaN(userId)) continue;
        for (const memberId of memberIds) {
            result.push({ evaluator_user_id: userId, presenter_member_id: memberId });
        }
    }
    return result;
}

// ── PoolMember ───────────────────────────────────────────────────────────────

function PoolMember({
    member,
    uniqueId,
    count,
    isSelected,
    evaluatorNames,
    onClick,
}: {
    member: MatchingMember;
    uniqueId: string;
    count: number;
    isSelected: boolean;
    evaluatorNames: string[];
    onClick: () => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: uniqueId });
    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                "p-2 rounded border text-sm mb-1.5 cursor-grab active:cursor-grabbing transition-all shadow-sm select-none",
                isSelected
                    ? "bg-[var(--color-accent)]/10 border-[var(--color-accent)]/40 ring-1 ring-[var(--color-accent)]/30"
                    : "bg-[var(--color-elevated)] border-[var(--color-border)] hover:border-[var(--color-accent)]/50"
            )}
            {...attributes}
            {...listeners}
            onClick={(e) => {
                e.stopPropagation();
                onClick();
            }}
        >
            <div className="flex items-center justify-between gap-1.5">
                <span className="font-medium truncate">{member.name}</span>
                <span
                    className={cn(
                        "text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0",
                        count > 0
                            ? "bg-[var(--color-accent)]/20 text-[var(--color-accent)]"
                            : "bg-[var(--color-hover)] text-[var(--color-text-muted)]"
                    )}
                >
                    {count}명
                </span>
            </div>
            {isSelected && evaluatorNames.length > 0 && (
                <div className="mt-1.5 pt-1.5 border-t border-[var(--color-accent)]/20 flex flex-wrap gap-1">
                    {evaluatorNames.map((name, i) => (
                        <span
                            key={i}
                            className="text-[10px] bg-[var(--color-hover)] text-[var(--color-text-secondary)] px-1.5 py-0.5 rounded"
                        >
                            {name}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── EvalMember ───────────────────────────────────────────────────────────────

function EvalMember({
    member,
    uniqueId,
    onRemove,
    isHighlighted,
}: {
    member: MatchingMember | undefined;
    uniqueId: string;
    onRemove: () => void;
    isHighlighted?: boolean;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: uniqueId });
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
                "p-2 rounded border text-sm mb-1.5 cursor-grab active:cursor-grabbing transition-all shadow-sm flex items-center justify-between gap-1 select-none group",
                isHighlighted
                    ? "bg-[var(--color-accent)]/15 border-[var(--color-accent)]/40 ring-1 ring-[var(--color-accent)]/20"
                    : "bg-[var(--color-elevated)] border-[var(--color-border)] hover:border-[var(--color-accent)]/50"
            )}
            {...attributes}
            {...listeners}
        >
            <span className="font-medium truncate">{member?.name ?? uniqueId}</span>
            <button
                className="w-4 h-4 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-rose-500/20 text-rose-500 transition-opacity flex-shrink-0"
                onClick={(e) => {
                    e.stopPropagation();
                    onRemove();
                }}
                onPointerDown={(e) => e.stopPropagation()}
            >
                <X className="w-3 h-3" />
            </button>
        </div>
    );
}

// ── EvalColumn ───────────────────────────────────────────────────────────────

function EvalColumn({
    id,
    title,
    subtitle,
    itemIds,
    members,
    onRemove,
    isHighlighted,
    selectedMemberId,
}: {
    id: string;
    title: string;
    subtitle?: string;
    itemIds: string[];
    members: MatchingMember[];
    onRemove: (memberId: number) => void;
    isHighlighted?: boolean;
    selectedMemberId?: number | null;
}) {
    const { setNodeRef } = useSortable({ id });

    return (
        <div
            className={cn(
                "rounded-lg p-3 flex flex-col h-full min-h-[250px] border transition-all",
                isHighlighted
                    ? "bg-[var(--color-accent)]/5 border-[var(--color-accent)]/40 ring-1 ring-[var(--color-accent)]/20"
                    : "bg-[var(--color-surface)] border-[var(--color-border)]"
            )}
        >
            <div className="flex justify-between items-center mb-3 pb-2 border-b border-[var(--color-border)]">
                <div className="min-w-0">
                    <h3 className="font-bold text-xs uppercase tracking-wider text-[var(--color-text-secondary)] truncate">
                        {title}
                    </h3>
                    {subtitle && (
                        <span className="text-[10px] text-[var(--color-text-muted)]">{subtitle}</span>
                    )}
                </div>
                <span className="text-xs bg-[var(--color-hover)] px-2 py-0.5 rounded-full flex-shrink-0">
                    {itemIds.length}
                </span>
            </div>
            <SortableContext id={id} items={itemIds} strategy={verticalListSortingStrategy}>
                <div ref={setNodeRef} className="flex-1 overflow-y-auto">
                    {itemIds.map((uid) => {
                        const parsed = parseId(uid);
                        return (
                            <EvalMember
                                key={uid}
                                uniqueId={uid}
                                member={members.find((m) => m.id === parsed.memberId)}
                                onRemove={() => onRemove(parsed.memberId)}
                                isHighlighted={selectedMemberId != null && parsed.memberId === selectedMemberId}
                            />
                        );
                    })}
                    {itemIds.length === 0 && (
                        <div className="h-full flex items-center justify-center text-[var(--color-text-muted)] text-xs border-2 border-dashed border-[var(--color-border)] rounded min-h-[60px]">
                            여기로 드래그
                        </div>
                    )}
                </div>
            </SortableContext>
        </div>
    );
}

// ── PoolColumn ───────────────────────────────────────────────────────────────

function PoolColumn({
    members,
    poolItemIds,
    assignCounts,
    selectedMemberId,
    evaluatorNamesMap,
    onMemberClick,
}: {
    members: MatchingMember[];
    poolItemIds: string[];
    assignCounts: Map<number, number>;
    selectedMemberId: number | null;
    evaluatorNamesMap: Map<number, string[]>;
    onMemberClick: (memberId: number) => void;
}) {
    const { setNodeRef } = useSortable({ id: "pool" });

    return (
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-3 flex flex-col h-full min-h-[250px]">
            <div className="flex justify-between items-center mb-3 pb-2 border-b border-[var(--color-border)]">
                <h3 className="font-bold text-xs uppercase tracking-wider text-[var(--color-text-secondary)]">
                    기수 목록
                </h3>
                <span className="text-xs bg-[var(--color-hover)] px-2 py-0.5 rounded-full">
                    {members.length}
                </span>
            </div>
            <SortableContext id="pool" items={poolItemIds} strategy={verticalListSortingStrategy}>
                <div ref={setNodeRef} className="flex-1 overflow-y-auto">
                    {poolItemIds.map((pid) => {
                        const mid = parseId(pid).memberId;
                        const member = members.find((m) => m.id === mid);
                        if (!member) return null;
                        return (
                            <PoolMember
                                key={pid}
                                uniqueId={pid}
                                member={member}
                                count={assignCounts.get(mid) ?? 0}
                                isSelected={selectedMemberId === mid}
                                evaluatorNames={evaluatorNamesMap.get(mid) ?? []}
                                onClick={() => onMemberClick(mid)}
                            />
                        );
                    })}
                </div>
            </SortableContext>
        </div>
    );
}

// ── Evaluator Selector Popover ──────────────────────────────────────────────

function EvaluatorSelector({
    users,
    enabledIds,
    onToggle,
}: {
    users: MatchingUser[];
    enabledIds: Set<number>;
    onToggle: (id: number) => void;
}) {
    const [open, setOpen] = useState(false);

    return (
        <div className="relative">
            <Button
                variant="outline"
                size="sm"
                onClick={() => setOpen(!open)}
                className="text-[var(--color-text-secondary)] border-[var(--color-border)]"
            >
                <Users className="w-3.5 h-3.5 mr-1.5" />
                평가자 ({enabledIds.size}/{users.length})
            </Button>
            {open && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                    <div className="absolute top-full left-0 mt-1 z-50 w-64 max-h-72 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-white shadow-xl p-2">
                        <div className="flex justify-between items-center px-2 pb-2 mb-1 border-b border-[var(--color-border)]">
                            <span className="text-xs text-[var(--color-text-muted)] font-medium">평가 참여 운영진</span>
                            <button
                                className="text-[10px] text-[var(--color-accent)] hover:underline"
                                onClick={() => {
                                    const allEnabled = enabledIds.size === users.length;
                                    users.forEach((u) => {
                                        const isEnabled = enabledIds.has(u.id);
                                        if (allEnabled ? isEnabled : !isEnabled) onToggle(u.id);
                                    });
                                }}
                            >
                                {enabledIds.size === users.length ? "전체 해제" : "전체 선택"}
                            </button>
                        </div>
                        {users.map((u) => (
                            <label
                                key={u.id}
                                className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-[var(--color-hover)] cursor-pointer"
                            >
                                <div
                                    className={cn(
                                        "w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors",
                                        enabledIds.has(u.id)
                                            ? "bg-[var(--color-accent)] border-[var(--color-accent)]"
                                            : "border-[var(--color-border)]"
                                    )}
                                    onClick={() => onToggle(u.id)}
                                >
                                    {enabledIds.has(u.id) && (
                                        <span className="text-white text-[9px] font-bold">✓</span>
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <span className="text-sm text-[var(--color-text-primary)] truncate block">{u.display_name}</span>
                                    <span className="text-[10px] text-[var(--color-text-muted)]">{u.username}</span>
                                </div>
                            </label>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

// ── Main Board ───────────────────────────────────────────────────────────────

export function EvalMatchingBoard({
    users,
    members,
    initialBoard,
    onSave,
    onCancel,
    isSaving = false,
    saveLabel = "저장",
    cancelLabel = "취소",
}: EvalMatchingBoardProps) {
    const [board, setBoard] = useState<Record<string, number[]>>(() => {
        const b: Record<string, number[]> = {};
        for (const u of users) {
            const key = String(u.id);
            b[key] = initialBoard[key] ?? [];
        }
        return b;
    });

    const [activeDragId, setActiveDragId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);

    // Per-member: how many evaluators each member gets
    const [perMember, setPerMember] = useState(3);

    // Track drag to avoid false clicks after drag
    const dragOccurred = useRef(false);

    // Enabled evaluators
    const [enabledUserIds, setEnabledUserIds] = useState<Set<number>>(() => {
        const ids = new Set<number>();
        for (const u of users) {
            const key = String(u.id);
            if (initialBoard[key]?.length > 0) ids.add(u.id);
        }
        if (ids.size === 0) {
            for (const u of users) ids.add(u.id);
        }
        return ids;
    });

    const enabledUsers = useMemo(
        () => users.filter((u) => enabledUserIds.has(u.id)),
        [users, enabledUserIds]
    );

    const toggleEvaluator = useCallback((userId: number) => {
        setEnabledUserIds((prev) => {
            const next = new Set(prev);
            if (next.has(userId)) {
                next.delete(userId);
                setBoard((prevBoard) => {
                    const key = String(userId);
                    return { ...prevBoard, [key]: [] };
                });
            } else {
                next.add(userId);
                setBoard((prevBoard) => {
                    const key = String(userId);
                    if (key in prevBoard) return prevBoard;
                    return { ...prevBoard, [key]: [] };
                });
            }
            return next;
        });
    }, []);

    // Assignment count per member
    const assignCounts = useMemo(() => {
        const counts = new Map<number, number>();
        for (const u of enabledUsers) {
            for (const mid of (board[String(u.id)] ?? [])) {
                counts.set(mid, (counts.get(mid) ?? 0) + 1);
            }
        }
        return counts;
    }, [board, enabledUsers]);

    // Evaluator names per member (for pool display)
    const evaluatorNamesMap = useMemo(() => {
        const map = new Map<number, string[]>();
        for (const u of enabledUsers) {
            for (const mid of (board[String(u.id)] ?? [])) {
                if (!map.has(mid)) map.set(mid, []);
                map.get(mid)!.push(u.display_name);
            }
        }
        return map;
    }, [board, enabledUsers]);

    // Reorder evaluator columns: those containing selected member come first
    const orderedEnabledUsers = useMemo(() => {
        if (selectedMemberId == null) return enabledUsers;
        const withMember = enabledUsers.filter((u) =>
            (board[String(u.id)] ?? []).includes(selectedMemberId)
        );
        const without = enabledUsers.filter(
            (u) => !(board[String(u.id)] ?? []).includes(selectedMemberId)
        );
        return [...withMember, ...without];
    }, [enabledUsers, selectedMemberId, board]);

    // Pool: always all members, filtered by search
    const poolItemIds = useMemo(() => {
        let filtered = members;
        if (searchQuery.trim()) {
            const q = searchQuery.trim().toLowerCase();
            filtered = members.filter((m) => m.name.toLowerCase().includes(q));
        }
        return filtered.map((m) => poolId(m.id));
    }, [members, searchQuery]);

    // Evaluator column item IDs (composite)
    const evalColumnIds = useCallback(
        (userId: number): string[] =>
            (board[String(userId)] ?? []).map((mid) => evalId(userId, mid)),
        [board]
    );

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    // Find which container (column ID) an item belongs to
    const findContainer = useCallback(
        (itemId: string | number): string | undefined => {
            const s = String(itemId);
            if (s === "pool") return "pool";
            for (const u of enabledUsers) {
                if (String(u.id) === s) return s;
            }
            const parsed = parseId(s);
            if (parsed.source === "pool") return "pool";
            if (parsed.source === "eval" && parsed.userId !== undefined) return String(parsed.userId);
            return undefined;
        },
        [enabledUsers]
    );

    const handleDragStart = (event: DragStartEvent) => {
        dragOccurred.current = true;
        setActiveDragId(String(event.active.id));
    };

    const handleDragOver = (event: DragOverEvent) => {
        const { active, over } = event;
        if (!over) return;

        const activeContainer = findContainer(active.id);
        let overContainer = findContainer(over.id);

        const overStr = String(over.id);
        if (overStr === "pool" || enabledUsers.some((u) => String(u.id) === overStr)) {
            overContainer = overStr;
        }

        if (!activeContainer || !overContainer) return;
        if (activeContainer === overContainer) return;

        const dragParsed = parseId(String(active.id));
        const memberId = dragParsed.memberId;

        // Pool → Evaluator: COPY
        if (activeContainer === "pool" && overContainer !== "pool") {
            const destKey = overContainer;
            setBoard((prev) => {
                const destItems = prev[destKey] ?? [];
                if (destItems.includes(memberId)) return prev;
                return { ...prev, [destKey]: [...destItems, memberId] };
            });
            return;
        }

        // Evaluator → Evaluator: MOVE
        if (activeContainer !== "pool" && overContainer !== "pool") {
            const srcKey = activeContainer;
            const destKey = overContainer;
            setBoard((prev) => {
                const destItems = prev[destKey] ?? [];
                if (destItems.includes(memberId)) {
                    return {
                        ...prev,
                        [srcKey]: prev[srcKey].filter((id) => id !== memberId),
                    };
                }
                return {
                    ...prev,
                    [srcKey]: prev[srcKey].filter((id) => id !== memberId),
                    [destKey]: [...destItems, memberId],
                };
            });
            return;
        }

        // Evaluator → Pool: REMOVE from evaluator
        if (activeContainer !== "pool" && overContainer === "pool") {
            const srcKey = activeContainer;
            setBoard((prev) => ({
                ...prev,
                [srcKey]: prev[srcKey].filter((id) => id !== memberId),
            }));
        }
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over) {
            const activeContainer = findContainer(active.id);
            const overContainer = findContainer(over.id);
            if (
                activeContainer &&
                overContainer &&
                activeContainer === overContainer &&
                activeContainer !== "pool"
            ) {
                const key = activeContainer;
                const activeParsed = parseId(String(active.id));
                const overParsed = parseId(String(over.id));
                const items = board[key] ?? [];
                const ai = items.indexOf(activeParsed.memberId);
                const oi = items.indexOf(overParsed.memberId);
                if (ai !== -1 && oi !== -1 && ai !== oi) {
                    setBoard((prev) => ({
                        ...prev,
                        [key]: arrayMove(prev[key], ai, oi),
                    }));
                }
            }
        }
        setActiveDragId(null);
        // Reset drag flag after a short delay so click handler can check it
        setTimeout(() => {
            dragOccurred.current = false;
        }, 100);
    };

    const handleMemberClick = useCallback((memberId: number) => {
        if (dragOccurred.current) return;
        setSelectedMemberId((prev) => (prev === memberId ? null : memberId));
    }, []);

    const removeMember = useCallback((userId: number, memberId: number) => {
        setBoard((prev) => {
            const key = String(userId);
            return {
                ...prev,
                [key]: (prev[key] ?? []).filter((id) => id !== memberId),
            };
        });
    }, []);

    const handleReset = () => {
        const newBoard: Record<string, number[]> = {};
        for (const u of users) newBoard[String(u.id)] = [];
        setBoard(newBoard);
        setSelectedMemberId(null);
        toast.success("배정이 초기화되었습니다.");
    };

    const handleAutoAssign = () => {
        if (enabledUsers.length === 0) {
            toast.error("평가자를 1명 이상 선택해주세요.");
            return;
        }
        if (perMember > enabledUsers.length) {
            toast.error(`평가자 수(${enabledUsers.length}명)보다 많을 수 없습니다.`);
            return;
        }

        const newBoard: Record<string, number[]> = {};
        for (const u of users) newBoard[String(u.id)] = [];

        // Track load per evaluator for balanced distribution
        const evalLoad = new Map<number, number>();
        for (const u of enabledUsers) evalLoad.set(u.id, 0);

        // Shuffle members for randomness
        const shuffled = [...members].sort(() => 0.5 - Math.random());

        // For each member, assign perMember evaluators (pick those with lowest load)
        for (const member of shuffled) {
            const sorted = [...enabledUsers].sort(
                (a, b) => (evalLoad.get(a.id) ?? 0) - (evalLoad.get(b.id) ?? 0)
            );
            for (let i = 0; i < perMember && i < sorted.length; i++) {
                const u = sorted[i];
                newBoard[String(u.id)].push(member.id);
                evalLoad.set(u.id, (evalLoad.get(u.id) ?? 0) + 1);
            }
        }

        setBoard(newBoard);
        setSelectedMemberId(null);

        const perEval =
            enabledUsers.length > 0
                ? Math.round(((members.length * perMember) / enabledUsers.length) * 10) / 10
                : 0;
        toast.success(`자동 배정 완료 (기수당 ${perMember}명 평가, 운영진당 평균 ${perEval}명)`);
    };

    const handleSave = () => {
        onSave(boardToAssignments(board));
    };

    const dropAnimation: DropAnimation = {
        sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0.5" } } }),
    };

    const activeMember = activeDragId
        ? members.find((m) => m.id === parseId(activeDragId).memberId)
        : null;

    // Stats
    const totalAssigned = enabledUsers.reduce(
        (sum, u) => sum + (board[String(u.id)]?.length ?? 0),
        0
    );
    const unassignedCount = members.filter((m) => !assignCounts.has(m.id)).length;

    return (
        <div className="space-y-3 h-full flex flex-col">
            {/* Toolbar */}
            <div className="flex justify-between items-center flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                    <EvaluatorSelector
                        users={users}
                        enabledIds={enabledUserIds}
                        onToggle={toggleEvaluator}
                    />
                    <div className="flex items-center gap-1.5 text-xs">
                        <Settings2 className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                        <span className="text-[var(--color-text-muted)]">기수당</span>
                        <input
                            type="number"
                            min={1}
                            max={enabledUsers.length || members.length}
                            value={perMember}
                            onChange={(e) => setPerMember(Math.max(1, Number(e.target.value) || 1))}
                            className="w-12 px-1.5 py-0.5 text-center text-sm rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]/50"
                        />
                        <span className="text-[var(--color-text-muted)]">명 평가</span>
                    </div>
                    <Button
                        onClick={handleAutoAssign}
                        variant="outline"
                        size="sm"
                        className="text-[var(--color-accent)] border-[var(--color-accent)]"
                    >
                        <Wand2 className="w-3.5 h-3.5 mr-1.5" />
                        자동 배정
                    </Button>
                    <Button
                        onClick={handleReset}
                        variant="outline"
                        size="sm"
                        className="text-rose-500 border-rose-500/30 hover:bg-rose-500/10"
                    >
                        <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                        초기화
                    </Button>
                </div>
                <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
                    <span>평가자 {enabledUsers.length}명</span>
                    <span>기수 {members.length}명</span>
                    <span>배정 {totalAssigned}건</span>
                    {unassignedCount > 0 && (
                        <span className="text-amber-600">미배정 {unassignedCount}명</span>
                    )}
                </div>
            </div>

            {/* DnD Board */}
            <DndContext
                sensors={sensors}
                collisionDetection={closestCorners}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
            >
                <div className="flex-1 overflow-x-auto overflow-y-hidden pb-2">
                    <div className="flex gap-3 h-full min-w-max">
                        {/* Pool column */}
                        <div className="w-52 flex-shrink-0 flex flex-col">
                            <div className="relative mb-2">
                                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                                <input
                                    type="text"
                                    placeholder="이름 검색..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full pl-8 pr-3 py-1.5 text-sm rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent)]/50"
                                />
                            </div>
                            <PoolColumn
                                members={members}
                                poolItemIds={poolItemIds}
                                assignCounts={assignCounts}
                                selectedMemberId={selectedMemberId}
                                evaluatorNamesMap={evaluatorNamesMap}
                                onMemberClick={handleMemberClick}
                            />
                        </div>
                        <div className="w-px bg-[var(--color-border)] opacity-50" />
                        {/* Evaluator columns — reordered when member selected */}
                        {orderedEnabledUsers.map((user) => (
                            <div key={user.id} className="w-52 flex-shrink-0">
                                <EvalColumn
                                    id={String(user.id)}
                                    title={user.display_name}
                                    subtitle={user.username}
                                    itemIds={evalColumnIds(user.id)}
                                    members={members}
                                    onRemove={(memberId) => removeMember(user.id, memberId)}
                                    isHighlighted={
                                        selectedMemberId != null &&
                                        (board[String(user.id)] ?? []).includes(selectedMemberId)
                                    }
                                    selectedMemberId={selectedMemberId}
                                />
                            </div>
                        ))}
                    </div>
                </div>

                <DragOverlay dropAnimation={dropAnimation}>
                    {activeMember ? (
                        <div className="p-2.5 bg-[var(--color-elevated)] rounded border border-[var(--color-accent)]/40 text-sm shadow-xl opacity-90 w-48">
                            <span className="font-medium">{activeMember.name}</span>
                        </div>
                    ) : null}
                </DragOverlay>
            </DndContext>

            {/* Footer */}
            <div className="flex justify-between pt-2 border-t border-[var(--color-border)]">
                {onCancel ? (
                    <Button variant="outline" onClick={onCancel} disabled={isSaving} size="sm">
                        {cancelLabel}
                    </Button>
                ) : (
                    <div />
                )}
                <Button
                    onClick={handleSave}
                    disabled={isSaving}
                    size="sm"
                    className="bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]"
                >
                    <Save className="w-3.5 h-3.5 mr-1.5" />
                    {isSaving ? "저장 중..." : saveLabel}
                </Button>
            </div>
        </div>
    );
}
