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
