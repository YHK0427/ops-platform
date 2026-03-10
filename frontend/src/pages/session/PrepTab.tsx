import { useOutletContext, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
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

            displayTeams = [{
                name: session.type === "TEAM" ? "미배정 / 전체 멤버" : "개인",
                members: virtualMembers
            }];
        }
    }

    const cfg = session.config || {};

    return (
        <div className="space-y-8">
            {/* Action Panel */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {cfg.has_ppt_email !== false && (
                    <div className="bg-[var(--color-surface)] p-4 rounded-xl border border-[var(--color-border)] relative">
                        {/* 비활성 오버레이 — IMAP 연동 미완료 */}
                        <div className="absolute inset-0 bg-black/50 rounded-xl z-10 flex items-center justify-center backdrop-blur-[1px]">
                            <span className="text-sm text-gray-400 bg-black/60 px-3 py-1.5 rounded-lg border border-gray-700">
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
                                <Button variant="outline" disabled className="text-blue-400/50 border-blue-400/10">
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
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                onClick={() => handleScanExcuses("PRE")}
                                disabled={isScanningExcuses}
                            >
                                <FileSearch className="w-4 h-4 mr-2" />
                                사전사유서 받아오기
                            </Button>
                            <Button
                                variant="outline"
                                className="text-orange-400 border-orange-400/20 hover:bg-orange-400/10"
                                onClick={() => handleScanExcuses("POST")}
                                disabled={isScanningExcuses}
                            >
                                <FileSearch className="w-4 h-4 mr-2" />
                                사후사유서 받아오기
                            </Button>
                            <Button
                                variant="outline"
                                className="text-red-400 border-red-400/20 hover:bg-red-400/10"
                                onClick={handleClearExcuses}
                            >
                                <Trash2 className="w-4 h-4 mr-2" />
                                전체 삭제
                            </Button>
                        </div>
                        {excuseTaskId && excuseTaskStatus && (
                            <div className="mt-2 p-3 bg-black/20 rounded-lg flex items-center justify-between text-sm">
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
                            className="border-[var(--color-border)] hover:bg-white/5"
                        >
                            팀 수정
                        </Button>
                    )}
                </div>
                <AttendanceGrid sessionId={session.id} teams={displayTeams} assignments={session.assignments} sessionType={session.type} />
            </section>

        </div>
    );
}
