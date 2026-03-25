import { useMemo, useState, useEffect } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMembers } from "@/hooks/useMembers";
import { TeamBuildingEditor } from "@/components/TeamBuildingEditor";
import type { TeamMember } from "@/components/TeamBuildingEditor";
import { toast } from "sonner";
import api from "@/lib/api";
import type { Session } from "@/hooks/useSessions";
import { sessionsKeys } from "@/hooks/useSessions";
import { cn } from "@/lib/utils";

export default function GroupEditPage() {
    const { session } = useOutletContext<{ session: Session }>();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { data: allMembers, isLoading: membersLoading } = useMembers();

    // Fetch group data including staff
    const { data: groupData } = useQuery({
        queryKey: ["sessions", session.id, "groups"],
        queryFn: async () => {
            const { data } = await api.get(`/sessions/${session.id}/groups`);
            return data as {
                groups: Record<string, any[]>;
                staff_groups: Record<string, any[]>;
                users: { id: number; display_name: string; department: string | null }[];
            };
        },
    });

    // Staff group state: user_id → "1" | "2" | null
    const [staffAssign, setStaffAssign] = useState<Record<number, string | null>>({});

    useEffect(() => {
        if (!groupData) return;
        const map: Record<number, string | null> = {};
        for (const gk of ["1", "2"]) {
            for (const s of groupData.staff_groups[gk] ?? []) {
                map[s.user_id] = gk;
            }
        }
        setStaffAssign(map);
    }, [groupData]);

    const { mutate: saveGroups, isPending } = useMutation({
        mutationFn: async (groups: Record<string, number[]>) => {
            const payload: Record<string, number[]> = {};
            for (const [key, ids] of Object.entries(groups)) {
                if (key === "unassigned" || ids.length === 0) continue;
                const num = key.replace(/분반/, "").trim();
                payload[num] = ids;
            }
            // Build staff_groups from local state
            const staffPayload: Record<string, number[]> = { "1": [], "2": [] };
            for (const [uid, gk] of Object.entries(staffAssign)) {
                if (gk === "1" || gk === "2") {
                    staffPayload[gk].push(Number(uid));
                }
            }
            await api.patch(`/sessions/${session.id}/groups`, { groups: payload, staff_groups: staffPayload });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: sessionsKeys.detail(session.id) });
            queryClient.invalidateQueries({ queryKey: ["sessions", session.id, "groups"] });
            toast.success("분반이 저장되었습니다.");
            navigate(`/sessions/${session.id}/prep`);
        },
        onError: () => {
            toast.error("분반 저장 실패");
        },
    });

    const initialTeams = useMemo(() => {
        const result: Record<string, number[]> = { unassigned: [], "1분반": [], "2분반": [] };
        const attendanceMap = new Map<number, number | null>();
        (session.attendances ?? []).forEach((att: any) => {
            attendanceMap.set(att.member_id, att.group_num);
        });

        (allMembers ?? [])
            .filter((m: any) => m.is_active)
            .forEach((m: any) => {
                const groupNum = attendanceMap.get(m.id);
                if (groupNum === 1) result["1분반"].push(m.id);
                else if (groupNum === 2) result["2분반"].push(m.id);
                else result["unassigned"].push(m.id);
            });

        return result;
    }, [session.attendances, allMembers]);

    const autoGenerateFn = (members: TeamMember[]) => {
        const active = members.filter((m) => m.is_active);
        const shuffled = [...active].sort(() => 0.5 - Math.random());
        const half = Math.ceil(shuffled.length / 2);
        return {
            unassigned: [],
            "1분반": shuffled.slice(0, half).map((m) => m.id),
            "2분반": shuffled.slice(half).map((m) => m.id),
        };
    };

    if (membersLoading) return <div className="p-6 text-[var(--color-text-secondary)]">멤버 목록 로딩 중...</div>;

    const users = groupData?.users ?? [];

    return (
        <div className="p-6 h-full flex flex-col">
            <div className="mb-4">
                <h2 className="text-xl font-bold">분반 수정</h2>
                <p className="text-sm text-[var(--color-text-secondary)]">
                    멤버를 드래그하여 분반 간 이동할 수 있습니다. 운영진 배치는 아래에서 설정하세요.
                </p>
            </div>

            {/* Staff assignment */}
            {users.length > 0 && (
                <div className="mb-4 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
                    <h3 className="font-bold text-sm mb-2 text-[var(--color-text-secondary)]">운영진 배치</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-1.5">
                        {users.map((u: any) => (
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
                                        onClick={() => setStaffAssign((prev) => ({ ...prev, [u.id]: prev[u.id] === "1" ? null : "1" }))}
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
                                        onClick={() => setStaffAssign((prev) => ({ ...prev, [u.id]: prev[u.id] === "2" ? null : "2" }))}
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
                    members={allMembers ?? []}
                    initialTeams={initialTeams}
                    onSave={saveGroups}
                    onCancel={() => navigate(`/sessions/${session.id}/prep`)}
                    isSaving={isPending}
                    saveLabel="분반 저장"
                    cancelLabel="← 돌아가기"
                    fixedColumns
                    autoGenerateFn={autoGenerateFn}
                />
            </div>
        </div>
    );
}
