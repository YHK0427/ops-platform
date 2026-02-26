import { useState, useEffect, useRef } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AttendanceGrid } from "./AttendanceGrid";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FileSearch, Loader2, CheckCircle2, XCircle, Trash2 } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { useScanPPT, useScanExcuses, useCrawlerTask, useMembers } from "@/hooks";
import { ExcuseTextDisplay } from "@/components/ExcuseTextDisplay";
import type { Session } from "@/hooks/useSessions";

export default function PrepTab() {
    const { session } = useOutletContext<{ session: Session }>();
    const navigate = useNavigate();
    const { data: members } = useMembers(); // Fetch members to map names for Individual sessions

    const [scanTaskId, setScanTaskId] = useState<string | null>(null);
    const { mutate: scanPPT, isPending: isScanningPPT } = useScanPPT();
    const { mutate: scanExcuses, isPending: isScanningExcuses } = useScanExcuses();
    const [excuseTaskId, setExcuseTaskId] = useState<string | null>(null);

    const queryClient = useQueryClient();

    // Polling
    const { data: taskStatus } = useCrawlerTask(scanTaskId);
    const { data: excuseTaskStatus } = useCrawlerTask(excuseTaskId);

    // Auto-refresh session data when any task completes
    const prevScanStatus = useRef<string | undefined>(undefined);
    const prevExcuseStatus = useRef<string | undefined>(undefined);

    useEffect(() => {
        if (prevScanStatus.current !== "complete" && taskStatus?.status === "complete") {
            queryClient.invalidateQueries({ queryKey: ["sessions", "detail", session.id] });
        }
        prevScanStatus.current = taskStatus?.status;
    }, [taskStatus?.status]);

    useEffect(() => {
        if (prevExcuseStatus.current !== "complete" && excuseTaskStatus?.status === "complete") {
            queryClient.invalidateQueries({ queryKey: ["sessions", "detail", session.id] });
        }
        prevExcuseStatus.current = excuseTaskStatus?.status;
    }, [excuseTaskStatus?.status]);

    const handleScanPPT = (mode: "REGULAR" | "LATE") => {
        scanPPT({ sessionId: session.id, mode }, {
            onSuccess: (data) => {
                toast.success("PPT 스캔이 시작되었습니다.");
                setScanTaskId(data.task_id);
            },
            onError: () => toast.error("스캔 요청 실패"),
        });
    };

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

    const excusedAttendances = (session.attendances || []).filter(
        (att) => att.excuse_type === "PRE" || att.excuse_type === "POST"
    );

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
                                    <span className="font-mono">Task: {excuseTaskId.slice(0, 8)}...</span>
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
                <AttendanceGrid sessionId={session.id} teams={displayTeams} />
            </section>

            {/* Excuse Summary */}
            {excusedAttendances.length > 0 && (
                <section>
                    <h3 className="font-bold text-lg mb-3">사유서 제출 현황</h3>
                    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
                        {excusedAttendances.map((att) => {
                            const member = members?.find((m) => m.id === att.member_id);
                            return (
                                <div key={att.member_id} className="flex items-center justify-between px-4 py-3">
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm font-medium">
                                            {member?.name ?? `ID:${att.member_id}`}
                                        </span>
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                            att.excuse_type === "PRE"
                                                ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                                : "bg-orange-500/10 text-orange-400 border-orange-500/20"
                                        }`}>
                                            {att.excuse_type === "PRE" ? "사전 통보" : "사후 제출"}
                                        </span>
                                    </div>
                                    {att.excuse_text && (
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button variant="ghost" size="sm" className="h-7 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
                                                    내용 보기
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent
                                                className="w-80 bg-[var(--color-elevated)] border-[var(--color-border)] p-3 text-sm"
                                                align="end"
                                            >
                                                <ExcuseTextDisplay text={att.excuse_text} />
                                            </PopoverContent>
                                        </Popover>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}

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
