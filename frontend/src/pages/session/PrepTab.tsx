import { useOutletContext, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AttendanceGrid } from "./AttendanceGrid";
import { Button } from "@/components/ui/button";
import { FileSearch, Loader2, CheckCircle2, XCircle, Trash2, Download } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { useScanExcuses, useMembers } from "@/hooks";
import { useSessionTask } from "@/hooks/useSessionTask";
import type { Session } from "@/hooks/useSessions";

export default function PrepTab() {
    const { session } = useOutletContext<{ session: Session }>();
    const navigate = useNavigate();
    const { data: members } = useMembers();

    const { mutate: scanExcuses, isPending: isScanningExcuses } = useScanExcuses();

    const queryClient = useQueryClient();

    const { taskId: excuseTaskId, setTaskId: setExcuseTaskId, taskStatus: excuseTaskStatus } = useSessionTask(session.id, "excuse-scan");

    const handleClearExcuses = async () => {
        if (!confirm("사유서 데이터(사전/사후 구분, 사유서 내용)를 모두 초기화합니다. 계속하시겠습니까?")) return;
        try {
            const { data } = await api.delete(`/sessions/${session.id}/excuses`);
            toast.success(`${data.cleared}건의 사유서가 초기화되었습니다.`);
            await queryClient.invalidateQueries({ queryKey: ["sessions", "detail", session.id] });
        } catch {
            toast.error("사유서 초기화 실패");
        }
    };

    const handleScanExcuses = (mode: "PRE" | "POST") => {
        scanExcuses({ sessionId: session.id, mode }, {
            onSuccess: (data) => {
                toast.success(`${mode === "PRE" ? "사전" : "사후"}사유서 스캔이 시작되었습니다.`);
                setExcuseTaskId(data.task_id);
            },
            onError: () => toast.error("스캔 요청 실패"),
        });
    };

    // Construct teams map with Attendance Injection
    let displayTeams: any[] = [];
    const attendanceMap = new Map();
    if (session.attendances) {
        session.attendances.forEach((att: any) => attendanceMap.set(att.member_id, att));
    }

    if (session.teams && session.teams.length > 0) {
        displayTeams = session.teams.map((team: any) => ({
            ...team,
            members: team.members.map((member: any) => ({
                ...member,
                member_id: member.id, // Fix: AttendanceGrid expects member_id, but API returns id
                attendance: attendanceMap.get(member.id) || null // Inject attendance
            }))
        }));
    } else {
        // Fallback or INDIVIDUAL: Create virtual team
        if (members && session.attendances) {
            const virtualMembers = session.attendances.map((att: any) => {
                const member = members.find((m: any) => m.id === att.member_id);
                return {
                    member_id: att.member_id,
                    name: member?.name || "Unknown",
                    is_active: member?.is_active ?? true,
                    attendance: att
                };
            }).sort((a: any, b: any) => a.name.localeCompare(b.name));

            // 분반이 있으면 그룹별로 나누기
            if (session.type === "INDIVIDUAL" && session.config?.has_groups) {
                const group1 = virtualMembers.filter((m: any) => m.attendance?.group_num === 1);
                const group2 = virtualMembers.filter((m: any) => m.attendance?.group_num === 2);
                const unassigned = virtualMembers.filter((m: any) => !m.attendance?.group_num);

                displayTeams = [];
                if (group1.length > 0) displayTeams.push({ name: "1분반", members: group1 });
                if (group2.length > 0) displayTeams.push({ name: "2분반", members: group2 });
                if (unassigned.length > 0) displayTeams.push({ name: "미배정", members: unassigned });
            } else {
                displayTeams = [{
                    name: session.type === "TEAM" ? "미배정 / 전체 멤버" : "개인",
                    members: virtualMembers
                }];
            }
        }
    }

    const cfg = session.config || {};

    // 분반 운영진 데이터 (has_groups일 때만)
    const { data: groupData } = useQuery({
        queryKey: ["sessions", session.id, "groups"],
        queryFn: async () => {
            const { data } = await api.get(`/sessions/${session.id}/groups`);
            return data as { staff_groups: Record<string, { user_id: number; display_name: string }[]> };
        },
        enabled: !!cfg.has_groups,
    });
    const staffGroups = groupData?.staff_groups;

    return (
        <div className="space-y-8">
            {/* Action Panel */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {cfg.has_ppt_email !== false && (
                    <div className="bg-[var(--color-surface)] p-4 rounded-xl border border-[var(--color-border)] relative">
                        {/* 비활성 오버레이 — IMAP 연동 미완료 */}
                        <div className="absolute inset-0 bg-white/80 rounded-xl z-10 flex items-center justify-center backdrop-blur-[1px]">
                            <span className="text-sm text-[var(--color-text-muted)] bg-gray-50 px-3 py-1.5 rounded-lg border border-[var(--color-border)]">
                                미구현
                            </span>
                        </div>
                        <div className="mb-4">
                            <h3 className="font-bold text-lg">PPT 이메일 스캔</h3>
                            <p className="text-sm text-[var(--color-text-secondary)]">네이버 이메일에서 PPT 제출 확인</p>
                        </div>
                        <div className="flex flex-col gap-2">
                            <div className="flex gap-2">
                                <Button variant="outline" disabled>
                                    <FileSearch className="w-4 h-4 mr-2" />
                                    PPT 이메일 스캔
                                </Button>
                                <Button variant="outline" disabled className="text-blue-600/50 border-blue-500/10">
                                    <Download className="w-4 h-4 mr-2" />
                                    전체 PPT 다운로드
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                <div className="bg-[var(--color-surface)] p-4 rounded-xl border border-[var(--color-border)]">
                    <div className="mb-4">
                        <h3 className="font-bold text-lg">사유서 스캔</h3>
                        <p className="text-sm text-[var(--color-text-secondary)]">네이버 카페 사유서 게시판 스캔</p>
                    </div>
                    <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleScanExcuses("PRE")}
                                disabled={isScanningExcuses}
                            >
                                <FileSearch className="w-4 h-4 mr-1.5" />
                                사전사유서
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="text-orange-600 border-orange-500/20 hover:bg-orange-400/10"
                                onClick={() => handleScanExcuses("POST")}
                                disabled={isScanningExcuses}
                            >
                                <FileSearch className="w-4 h-4 mr-1.5" />
                                사후사유서
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="text-red-500 border-red-500/20 hover:bg-red-400/10"
                                onClick={handleClearExcuses}
                            >
                                <Trash2 className="w-4 h-4 mr-1.5" />
                                삭제
                            </Button>
                        </div>
                        {excuseTaskId && excuseTaskStatus && (
                            <div className="mt-2 p-3 bg-gray-50 rounded-lg flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2">
                                    {excuseTaskStatus.status === "in_progress" || excuseTaskStatus.status === "queued" ? (
                                        <Loader2 className="w-4 h-4 animate-spin text-[var(--color-accent)]" />
                                    ) : excuseTaskStatus.status === "complete" ? (
                                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                                    ) : (
                                        <XCircle className="w-4 h-4 text-red-500" />
                                    )}
                                    <span className="font-mono">작업: {excuseTaskId.slice(0, 8)}...</span>
                                </div>
                                <span className={`font-bold ${excuseTaskStatus.status === "complete" ? "text-green-500" :
                                    excuseTaskStatus.status === "failed" ? "text-red-500" : "text-[var(--color-accent)]"
                                    }`}>
                                    {excuseTaskStatus.status.toUpperCase()}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Attendance Grid */}
            <section>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-lg">출석 체크</h3>
                    {session.type === "TEAM" && session.status === "PREP" && (
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => navigate(`/sessions/${session.id}/team-edit`)}
                            className="border-[var(--color-border)] hover:bg-gray-50"
                        >
                            팀 수정
                        </Button>
                    )}
                    {session.type === "INDIVIDUAL" && session.config?.has_groups && ["SETUP", "PREP"].includes(session.status) && (
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => navigate(`/sessions/${session.id}/group-edit`)}
                            className="border-[var(--color-border)] hover:bg-gray-50"
                        >
                            분반 수정
                        </Button>
                    )}
                </div>
                <AttendanceGrid sessionId={session.id} teams={displayTeams} assignments={session.assignments} sessionType={session.type} staffGroups={staffGroups} />
            </section>

        </div>
    );
}
