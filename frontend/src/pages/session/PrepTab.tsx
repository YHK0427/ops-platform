import { useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { AttendanceGrid } from "./AttendanceGrid";
import { Button } from "@/components/ui/button";
import { FileSearch, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useScanPPT, useScanHomework, useCrawlerTask, useMembers } from "@/hooks";
import type { Session } from "@/hooks/useSessions";

export default function PrepTab() {
    const { session } = useOutletContext<{ session: Session }>();
    const navigate = useNavigate();
    const { data: members } = useMembers(); // Fetch members to map names for Individual sessions

    const [scanTaskId, setScanTaskId] = useState<string | null>(null);
    const { mutate: scanPPT, isPending: isScanningPPT } = useScanPPT();
    const { mutate: scanHomework, isPending: isScanningHomework } = useScanHomework();

    // Polling
    const { data: taskStatus } = useCrawlerTask(scanTaskId);

    const handleScanPPT = (mode: "REGULAR" | "LATE") => {
        scanPPT({ sessionId: session.id, mode }, {
            onSuccess: (data) => {
                toast.success("PPT 스캔이 시작되었습니다.");
                setScanTaskId(data.task_id);
            },
            onError: () => toast.error("스캔 요청 실패"),
        });
    };

    const handleScanHomework = () => {
        scanHomework({ sessionId: session.id }, {
            onSuccess: (data) => {
                toast.success("과제 스캔이 시작되었습니다.");
                setScanTaskId(data.task_id);
            },
            onError: () => toast.error("스캔 요청 실패"),
        });
    };

    // Render task status
    const renderTaskStatus = () => {
        if (!scanTaskId || !taskStatus) return null;

        return (
            <div className="mt-4 p-3 bg-black/20 rounded-lg flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                    {taskStatus.status === "in_progress" || taskStatus.status === "queued" ? (
                        <Loader2 className="w-4 h-4 animate-spin text-[var(--color-accent)]" />
                    ) : taskStatus.status === "complete" ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                    ) : (
                        <XCircle className="w-4 h-4 text-red-500" />
                    )}
                    <span className="font-mono">Task ID: {scanTaskId.slice(0, 8)}...</span>
                </div>
                <span className={`font-bold ${taskStatus.status === "complete" ? "text-green-500" :
                    taskStatus.status === "failed" ? "text-red-500" : "text-[var(--color-accent)]"
                    }`}>
                    {taskStatus.status.toUpperCase()}
                </span>
            </div>
        );
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
                name: session.type === "TEAM" ? "Unassigned / All Members" : "Individual",
                members: virtualMembers
            }];
        }
    }

    const cfg = session.config || {};

    return (
        <div className="space-y-8">
            {/* Action Panel */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {cfg.has_ppt !== false && (
                    <div className="bg-[var(--color-surface)] p-4 rounded-xl border border-[var(--color-border)]">
                        <div className="mb-4">
                            <h3 className="font-bold text-lg">Presentation Scan</h3>
                            <p className="text-sm text-[var(--color-text-secondary)]">구글 드라이브 발표자료 스캔</p>
                        </div>
                        <div className="flex flex-col gap-2">
                            <div className="flex gap-2">
                                <Button variant="outline" onClick={() => handleScanPPT("REGULAR")} disabled={isScanningPPT}>
                                    <FileSearch className="w-4 h-4 mr-2" />
                                    Regular Scan
                                </Button>
                                <Button variant="outline" className="text-orange-400 border-orange-400/20 hover:bg-orange-400/10" onClick={() => handleScanPPT("LATE")} disabled={isScanningPPT}>
                                    <FileSearch className="w-4 h-4 mr-2" />
                                    Late Scan
                                </Button>
                            </div>
                            {renderTaskStatus()}
                        </div>
                    </div>
                )}

                <div className="bg-[var(--color-surface)] p-4 rounded-xl border border-[var(--color-border)]">
                    <div className="mb-4">
                        <h3 className="font-bold text-lg">Homework Scan</h3>
                        <p className="text-sm text-[var(--color-text-secondary)]">과제 제출 여부 확인</p>
                    </div>
                    <Button variant="outline" onClick={handleScanHomework} disabled={isScanningHomework}>
                        <FileSearch className="w-4 h-4 mr-2" />
                        Scan Homework
                    </Button>
                </div>
            </div>

            {/* Attendance Grid */}
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
                <AttendanceGrid sessionId={session.id} sessionDate={session.date} teams={displayTeams} />
            </section>

            {/* Feedback Target Assignment (INDIVIDUAL sessions with has_feedback) */}
            {session.type === "INDIVIDUAL" && cfg.has_feedback !== false && (
                <section>
                    <h3 className="font-bold text-lg mb-3">영상 피드백 대상 지정</h3>
                    <p className="text-sm text-[var(--color-text-secondary)] mb-4">
                        각 멤버가 댓글 피드백을 남겨야 할 대상 영상의 멤버를 지정합니다.
                        기본 1명, 결석자는 2명.
                    </p>
                    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
                        {(session.attendances || []).map((att) => {
                            const member = members?.find((m) => m.id === att.member_id);
                            const feedbackAssignment = session.assignments?.find(
                                (a) => a.member_id === att.member_id && a.type === "FEEDBACK"
                            );
                            const targets = feedbackAssignment?.target_member_ids ?? [];
                            return (
                                <div key={att.member_id} className="flex items-center justify-between px-4 py-3">
                                    <span className="text-sm font-medium">{member?.name ?? `ID:${att.member_id}`}</span>
                                    <span className="text-xs text-[var(--color-text-muted)]">
                                        {targets.length > 0
                                            ? targets.map((tid) => members?.find((m) => m.id === tid)?.name ?? `ID:${tid}`).join(", ")
                                            : <span className="text-yellow-500 font-medium">미지정</span>
                                        }
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}
        </div>
    );
}
