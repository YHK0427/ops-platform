import { useState } from "react";
import { GripVertical, UserMinus, ChevronUp, ChevronDown } from "lucide-react";
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    TouchSensor,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import api from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface OrderItem {
    id: number;
    name: string;
    group_num?: number | null;
    presenter_order?: number | null;
}

interface AbsentItem {
    id: number;
    name: string;
    status: "ABSENT" | "EXCUSED";
}

interface PresenterOrderPanelProps {
    sessionId: number;
    items: OrderItem[];
    absentItems?: AbsentItem[];
    hasGroups: boolean;
    isTeamSession: boolean;
    teamItems?: { id: number; name: string; memberNames: string[] }[];
}

function DraggableRow({ id, name, index, isTeam, subtext, isFirst, isLast, onMoveUp, onMoveDown }: {
    id: number; name: string; index: number; isTeam?: boolean; subtext?: string;
    isFirst: boolean; isLast: boolean;
    onMoveUp: () => void; onMoveDown: () => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
    return (
        <div
            ref={setNodeRef}
            style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
            className="flex items-center gap-2 md:gap-3 px-2 md:px-4 py-2.5 bg-white border-b border-[var(--color-border)] last:border-b-0 hover:bg-gray-50"
        >
            {/* 드래그 핸들 — touch-action:none 이 여기에만 적용되어 페이지 스크롤은 유지 */}
            <button
                type="button"
                className="flex items-center justify-center h-10 w-10 -ml-1 rounded text-gray-400 hover:bg-gray-100 active:bg-gray-200 cursor-grab active:cursor-grabbing touch-none select-none flex-shrink-0"
                style={{ touchAction: "none" }}
                aria-label="드래그하여 순서 변경"
                {...attributes}
                {...listeners}
            >
                <GripVertical className="w-5 h-5" />
            </button>
            <span className="text-xs text-gray-500 w-5 text-right tabular-nums font-bold flex-shrink-0">{index + 1}</span>
            <div className="flex-1 min-w-0">
                <span className={`text-sm ${isTeam ? "font-bold" : "font-medium"}`}>{name}</span>
                {subtext && <span className="text-xs text-gray-400 ml-2 truncate">{subtext}</span>}
            </div>
            {/* 모바일 — 위/아래 버튼 (드래그 대안). 데스크톱엔 숨김 */}
            <div className="flex md:hidden items-center gap-1 flex-shrink-0">
                <button
                    type="button"
                    onClick={onMoveUp}
                    disabled={isFirst}
                    className="w-9 h-9 flex items-center justify-center rounded border border-[var(--color-border)] bg-white active:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="위로 이동"
                >
                    <ChevronUp className="w-4 h-4" />
                </button>
                <button
                    type="button"
                    onClick={onMoveDown}
                    disabled={isLast}
                    className="w-9 h-9 flex items-center justify-center rounded border border-[var(--color-border)] bg-white active:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="아래로 이동"
                >
                    <ChevronDown className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}

export function PresenterOrderPanel({ sessionId, items, absentItems, hasGroups, isTeamSession, teamItems }: PresenterOrderPanelProps) {
    const queryClient = useQueryClient();
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    // 분반별 state (분반 번호 오름차순 고정)
    const buildGroups = () => {
        if (isTeamSession) return {};
        const groups: Record<string, OrderItem[]> = {};
        if (hasGroups) {
            const sortedItems = [...items].sort((a, b) =>
                (a.group_num ?? 999) - (b.group_num ?? 999)
            );
            for (const item of sortedItems) {
                const key = item.group_num ? `${item.group_num}분반` : "미배정";
                (groups[key] ??= []).push(item);
            }
        } else {
            groups["전체"] = [...items];
        }
        // presenter_order 기준 정렬 (저장된 순서 복원)
        for (const key of Object.keys(groups)) {
            groups[key].sort((a, b) => (a.presenter_order ?? 999) - (b.presenter_order ?? 999));
        }
        return groups;
    };

    const [groupedItems, setGroupedItems] = useState(buildGroups);
    const [teams, setTeams] = useState(teamItems ?? []);

    const saveOrder = (order: { member_id: number; presenter_order: number }[]) => {
        api.patch(`/sessions/${sessionId}/presenter-order`, order).then(() => {
            // API 완료 후 세션 데이터 조용히 갱신 → 영상 업로드 등 다른 곳에도 반영
            queryClient.invalidateQueries({ queryKey: ["sessions", "detail", sessionId] });
        }).catch(() => {
            toast.error("순서 저장 실패");
        });
    };

    const handleDragEnd = (groupKey: string) => (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        setGroupedItems(prev => {
            const list = [...(prev[groupKey] ?? [])];
            const oldIdx = list.findIndex(i => i.id === active.id);
            const newIdx = list.findIndex(i => i.id === over.id);
            if (oldIdx === -1 || newIdx === -1) return prev;

            const reordered = arrayMove(list, oldIdx, newIdx);
            // 저장
            saveOrder(reordered.map((item, idx) => ({ member_id: item.id, presenter_order: idx + 1 })));
            return { ...prev, [groupKey]: reordered };
        });
    };

    // 모바일 위/아래 버튼으로 순서 변경
    const moveItem = (groupKey: string, fromIdx: number, toIdx: number) => {
        setGroupedItems(prev => {
            const list = [...(prev[groupKey] ?? [])];
            if (fromIdx < 0 || fromIdx >= list.length || toIdx < 0 || toIdx >= list.length) return prev;
            const reordered = arrayMove(list, fromIdx, toIdx);
            saveOrder(reordered.map((item, idx) => ({ member_id: item.id, presenter_order: idx + 1 })));
            return { ...prev, [groupKey]: reordered };
        });
    };

    const moveTeam = (fromIdx: number, toIdx: number) => {
        setTeams(prev => {
            if (fromIdx < 0 || fromIdx >= prev.length || toIdx < 0 || toIdx >= prev.length) return prev;
            return arrayMove(prev, fromIdx, toIdx);
        });
    };

    const handleTeamDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        setTeams(prev => {
            const oldIdx = prev.findIndex(t => t.id === active.id);
            const newIdx = prev.findIndex(t => t.id === over.id);
            if (oldIdx === -1 || newIdx === -1) return prev;
            return arrayMove(prev, oldIdx, newIdx);
            // TODO: 팀 순서 저장 (현재 Attendance 기반이라 팀용 별도 필요)
        });
    };

    // 팀 세션
    if (isTeamSession && teams.length > 0) {
        return (
            <div className="space-y-2">
                <p className="text-xs text-gray-500 hidden md:block">드래그하여 팀 발표 순서를 조정하세요.</p>
                <p className="text-xs text-gray-500 md:hidden">왼쪽 그립(⋮⋮)을 길게 눌러 드래그하거나 ▲▼ 버튼으로 순서 조정.</p>
                <div className="rounded-lg border border-[var(--color-border)] overflow-hidden">
                    <div className="px-4 py-2 bg-gray-50 border-b border-[var(--color-border)] text-xs font-bold text-gray-600 uppercase tracking-wider">
                        팀 발표 순서
                    </div>
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleTeamDragEnd}>
                        <SortableContext items={teams.map(t => t.id)} strategy={verticalListSortingStrategy}>
                            {teams.map((team, idx) => (
                                <DraggableRow
                                    key={team.id} id={team.id} name={team.name} index={idx} isTeam
                                    subtext={team.memberNames.join(", ")}
                                    isFirst={idx === 0}
                                    isLast={idx === teams.length - 1}
                                    onMoveUp={() => moveTeam(idx, idx - 1)}
                                    onMoveDown={() => moveTeam(idx, idx + 1)}
                                />
                            ))}
                        </SortableContext>
                    </DndContext>
                </div>
            </div>
        );
    }

    // 개인 세션
    return (
        <div className="space-y-2">
            <p className="text-xs text-gray-500 hidden md:block">드래그하여 발표 순서를 조정하세요. 순서는 자동 저장됩니다.</p>
            <p className="text-xs text-gray-500 md:hidden">왼쪽 그립(⋮⋮)을 길게 눌러 드래그하거나 ▲▼ 버튼으로 순서 조정. 자동 저장.</p>
            <div className={hasGroups ? "grid grid-cols-1 md:grid-cols-2 gap-4" : ""}>
                {Object.entries(groupedItems).map(([groupKey, list]) => (
                    <div key={groupKey} className="rounded-lg border border-[var(--color-border)] overflow-hidden">
                        <div className="px-4 py-2 bg-gray-50 border-b border-[var(--color-border)] text-xs font-bold text-gray-600 uppercase tracking-wider">
                            {groupKey}
                        </div>
                        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd(groupKey)}>
                            <SortableContext items={list.map(i => i.id)} strategy={verticalListSortingStrategy}>
                                {list.map((item, idx) => (
                                    <DraggableRow
                                        key={item.id} id={item.id} name={item.name} index={idx}
                                        isFirst={idx === 0}
                                        isLast={idx === list.length - 1}
                                        onMoveUp={() => moveItem(groupKey, idx, idx - 1)}
                                        onMoveDown={() => moveItem(groupKey, idx, idx + 1)}
                                    />
                                ))}
                            </SortableContext>
                        </DndContext>
                    </div>
                ))}
            </div>

            {/* 결석/공결 제외 안내 */}
            {absentItems && absentItems.length > 0 && (
                <div className="rounded-lg border border-[var(--color-border)] bg-gray-50/50 px-4 py-2.5 mt-3">
                    <div className="flex items-center gap-2 mb-1.5">
                        <UserMinus className="w-3.5 h-3.5 text-gray-500" />
                        <span className="text-xs font-medium text-gray-500">
                            발표 순서에서 제외 ({absentItems.length}명)
                        </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {absentItems.map(m => (
                            <span
                                key={m.id}
                                className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border ${
                                    m.status === "ABSENT"
                                        ? "bg-rose-500/10 text-rose-500 border-rose-500/20"
                                        : "bg-blue-500/10 text-blue-600 border-blue-500/20"
                                }`}
                            >
                                {m.name}
                                <span className="text-[9px] opacity-80">
                                    {m.status === "ABSENT" ? "결석" : "공결"}
                                </span>
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
