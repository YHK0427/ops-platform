import { useState, useCallback } from "react";
import { GripVertical, UserMinus } from "lucide-react";
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
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

function DraggableRow({ id, name, index, isTeam, subtext }: {
    id: number; name: string; index: number; isTeam?: boolean; subtext?: string;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
    return (
        <div
            ref={setNodeRef}
            style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
            className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-[var(--color-border)] last:border-b-0 cursor-grab active:cursor-grabbing hover:bg-gray-50"
            {...attributes}
            {...listeners}
        >
            <GripVertical className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <span className="text-xs text-gray-500 w-6 text-right tabular-nums font-bold">{index + 1}</span>
            <div>
                <span className={`text-sm ${isTeam ? "font-bold" : "font-medium"}`}>{name}</span>
                {subtext && <span className="text-xs text-gray-400 ml-2">{subtext}</span>}
            </div>
        </div>
    );
}

export function PresenterOrderPanel({ sessionId, items, absentItems, hasGroups, isTeamSession, teamItems }: PresenterOrderPanelProps) {
    const queryClient = useQueryClient();
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
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
                <p className="text-xs text-gray-500">드래그하여 팀 발표 순서를 조정하세요.</p>
                <div className="rounded-lg border border-[var(--color-border)] overflow-hidden">
                    <div className="px-4 py-2 bg-gray-50 border-b border-[var(--color-border)] text-xs font-bold text-gray-600 uppercase tracking-wider">
                        팀 발표 순서
                    </div>
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleTeamDragEnd}>
                        <SortableContext items={teams.map(t => t.id)} strategy={verticalListSortingStrategy}>
                            {teams.map((team, idx) => (
                                <DraggableRow key={team.id} id={team.id} name={team.name} index={idx} isTeam subtext={team.memberNames.join(", ")} />
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
            <p className="text-xs text-gray-500">드래그하여 발표 순서를 조정하세요. 순서는 자동 저장됩니다.</p>
            <div className={hasGroups ? "grid grid-cols-1 md:grid-cols-2 gap-4" : ""}>
                {Object.entries(groupedItems).map(([groupKey, list]) => (
                    <div key={groupKey} className="rounded-lg border border-[var(--color-border)] overflow-hidden">
                        <div className="px-4 py-2 bg-gray-50 border-b border-[var(--color-border)] text-xs font-bold text-gray-600 uppercase tracking-wider">
                            {groupKey}
                        </div>
                        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd(groupKey)}>
                            <SortableContext items={list.map(i => i.id)} strategy={verticalListSortingStrategy}>
                                {list.map((item, idx) => (
                                    <DraggableRow key={item.id} id={item.id} name={item.name} index={idx} />
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
