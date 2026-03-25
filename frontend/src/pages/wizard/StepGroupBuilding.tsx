import { useState } from "react";
import type { StepProps } from "./types";
import { useMembers } from "@/hooks";
import { useQuery } from "@tanstack/react-query";
import { TeamBuildingEditor } from "@/components/TeamBuildingEditor";
import type { TeamMember } from "@/components/TeamBuildingEditor";
import api from "@/lib/api";
import { cn } from "@/lib/utils";

export function StepGroupBuilding({ state, onChange, onNext, onBack }: StepProps) {
    const { data: members } = useMembers();
    const { data: staffList } = useQuery({
        queryKey: ["staff-list"],
        queryFn: async () => {
            const { data } = await api.get<{ id: number; display_name: string; department: string | null }[]>("/auth/staff-list");
            return data;
        },
    });

    // Staff group state
    const [staffAssign, setStaffAssign] = useState<Record<number, string | null>>(() => {
        const map: Record<number, string | null> = {};
        for (const [gk, ids] of Object.entries(state.staff_groups)) {
            for (const uid of ids) {
                map[uid] = gk;
            }
        }
        return map;
    });

    const activeMembers = (members ?? []).filter((m: TeamMember) => m.is_active);

    const initialTeams = Object.keys(state.groups).length > 0
        ? state.groups
        : { unassigned: activeMembers.map((m: TeamMember) => m.id), "1분반": [], "2분반": [] };

    const autoGenerateFn = (allMembers: TeamMember[]) => {
        const active = allMembers.filter((m) => m.is_active);
        const shuffled = [...active].sort(() => 0.5 - Math.random());
        const half = Math.ceil(shuffled.length / 2);
        return {
            unassigned: [],
            "1분반": shuffled.slice(0, half).map((m) => m.id),
            "2분반": shuffled.slice(half).map((m) => m.id),
        };
    };

    const handleSave = (groups: Record<string, number[]>) => {
        // Build staff_groups
        const sg: Record<string, number[]> = { "1": [], "2": [] };
        for (const [uid, gk] of Object.entries(staffAssign)) {
            if (gk === "1" || gk === "2") {
                sg[gk].push(Number(uid));
            }
        }
        onChange({ groups, staff_groups: sg });
        onNext();
    };

    const toggleStaff = (userId: number, group: string) => {
        setStaffAssign((prev) => ({
            ...prev,
            [userId]: prev[userId] === group ? null : group,
        }));
    };

    return (
        <div className="space-y-6 max-w-[90vw] mx-auto h-[80vh] flex flex-col">
            <h2 className="text-xl font-bold">분반 나누기</h2>

            {/* Staff assignment */}
            {staffList && staffList.length > 0 && (
                <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] flex-shrink-0">
                    <h3 className="font-bold text-sm mb-2 text-[var(--color-text-secondary)]">운영진 배치</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-1.5">
                        {staffList.map((u) => (
                            <div key={u.id} className="flex items-center gap-2">
                                <span className="text-sm truncate min-w-0 flex-1">
                                    {u.display_name}
                                    {u.department && (
                                        <span className="text-[10px] text-[var(--color-text-muted)] ml-1">{u.department}</span>
                                    )}
                                </span>
                                <div className="flex gap-0.5 flex-shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => toggleStaff(u.id, "1")}
                                        className={cn(
                                            "px-2 py-0.5 rounded text-[11px] font-medium border transition-all",
                                            staffAssign[u.id] === "1"
                                                ? "bg-blue-500 text-white border-blue-500"
                                                : "bg-white text-blue-500 border-blue-300 hover:bg-blue-50"
                                        )}
                                    >
                                        1
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => toggleStaff(u.id, "2")}
                                        className={cn(
                                            "px-2 py-0.5 rounded text-[11px] font-medium border transition-all",
                                            staffAssign[u.id] === "2"
                                                ? "bg-emerald-500 text-white border-emerald-500"
                                                : "bg-white text-emerald-500 border-emerald-300 hover:bg-emerald-50"
                                        )}
                                    >
                                        2
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex-1 min-h-0">
                <TeamBuildingEditor
                    members={members ?? []}
                    initialTeams={initialTeams}
                    onSave={handleSave}
                    onCancel={onBack}
                    saveLabel="다음: 확인"
                    cancelLabel="이전"
                    fixedColumns
                    autoGenerateFn={autoGenerateFn}
                />
            </div>
        </div>
    );
}
