import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Search, Loader2, CheckCircle2, XCircle } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { useScanHomework, useCrawlerTask } from "@/hooks/useCrawler";
import type { Session } from "@/hooks/useSessions";
import { useMembers } from "@/hooks/useMembers";

const STATUS_CYCLE: Record<string, string> = {
    PENDING: "PASS",
    PASS:    "LATE",
    LATE:    "MISSING",
    MISSING: "PASS",
    FAIL:    "PASS",
};

export function PostTab() {
    const { session } = useOutletContext<{ session: Session }>();
    const sessionId = session.id;

    const queryClient = useQueryClient();
    const scanHomeworkMutation = useScanHomework();
    const [taskId, setTaskId] = useState<string | null>(null);
    const { data: taskStatus } = useCrawlerTask(taskId);
    const { data: members } = useMembers();

    const isPolling = taskStatus?.status === "queued" || taskStatus?.status === "in_progress";

    // Build row list: TEAM uses teams.members, INDIVIDUAL uses attendances
    const rows: { id: number; name: string; teamName: string; teamId: number | null }[] =
        session.type === "TEAM"
            ? (session.teams || []).flatMap((t) =>
                  t.members.map((m) => ({ id: m.id, name: m.name, teamName: t.name, teamId: t.id }))
              )
            : (session.attendances || []).map((a) => {
                  const member = members?.find((m) => m.id === a.member_id);
                  return {
                      id: a.member_id,
                      name: member?.name ?? `ID:${a.member_id}`,
                      teamName: "Individual",
                      teamId: null,
                  };
              });

    // Active assignment types based on session config
    const cfg = session.config || {};
    const activeTypes: string[] = [];
    if (cfg.has_ppt !== false) activeTypes.push("PPT");
    if (cfg.has_review !== false) activeTypes.push("REVIEW");
    if (cfg.has_feedback !== false) activeTypes.push("FEEDBACK");

    const handleScanHomework = () => {
        scanHomeworkMutation.mutate({ sessionId }, {
            onSuccess: (data) => {
                setTaskId(data.task_id);
                toast.info("과제 스캔이 시작되었습니다.");
            },
            onError: () => {
                toast.error("스캔 시작 실패");
            }
        });
    };

    // Helper to find member-level assignment (REVIEW, FEEDBACK, HOMEWORK)
    const getAssignment = (memberId: number, type: string) => {
        return session.assignments?.find((a: any) => a.member_id === memberId && a.type === type);
    };

    // Helper to find team-level PPT assignment (member_id=null, team_id=team.id)
    const getTeamPPTAssignment = (teamId: number) => {
        return session.assignments?.find((a: any) => a.team_id === teamId && a.type === "PPT");
    };

    const handleToggleStatus = async (assignment: any) => {
        if (!assignment) {
            toast.error("과제 데이터가 없습니다. (세션 상태 확인 필요)");
            return;
        }

        const currentStatus = assignment.status;
        const newStatus = STATUS_CYCLE[currentStatus] ?? "PASS";

        try {
            await api.patch(`/assignments/${assignment.id}`, { status: newStatus });
            await queryClient.invalidateQueries({ queryKey: ["sessions", "detail", sessionId] });
            toast.success(`상태 변경: ${newStatus}`);
        } catch (e) {
            toast.error("상태 변경 실패");
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-bold tracking-tight text-white/90">Post-Session Management</h2>
                    <p className="text-sm text-[var(--color-text-muted)]">과제, 리뷰, 피드백 제출 현황을 스캔하고 관리합니다.</p>
                </div>
                <Button
                    onClick={handleScanHomework}
                    disabled={isPolling}
                    className="bg-[var(--color-primary)] hover:bg-rose-600 text-white shadow-[0_0_15px_rgba(244,63,94,0.4)]"
                >
                    {isPolling ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                    {isPolling ? "Scanning..." : "Scan Homework"}
                </Button>
            </div>

            {/* Task Progress */}
            {taskStatus && (
                <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
                    <div className="flex items-center gap-2 text-sm text-gray-300">
                        {isPolling ? (
                            <Loader2 className="w-4 h-4 animate-spin text-[var(--color-primary)]" />
                        ) : taskStatus.status === "complete" ? (
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                        ) : (
                            <XCircle className="w-4 h-4 text-red-500" />
                        )}
                        <span>Task Status: {taskStatus.status} (ID: {taskStatus.task_id})</span>
                        {taskStatus.result && <span className="text-gray-500 ml-2 text-xs truncate max-w-[300px]">{JSON.stringify(taskStatus.result)}</span>}
                    </div>
                </div>
            )}

            <Card className="bg-[var(--color-surface)] border-[var(--color-border)]">
                <CardHeader>
                    <CardTitle className="text-lg">Assignment Status</CardTitle>
                    <CardDescription>배지를 클릭해 수동 변경: PENDING → PASS → LATE → MISSING (스캔 없이도 수동 설정 가능)</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border border-[var(--color-border)] overflow-hidden">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-gray-900/50 hover:bg-gray-900/50">
                                    <TableHead>Member</TableHead>
                                    {activeTypes.map((type) => (
                                        <TableHead key={type} className="text-center w-[120px]">
                                            {type.charAt(0) + type.slice(1).toLowerCase()}
                                        </TableHead>
                                    ))}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.map((m) => (
                                    <TableRow key={m.id} className="hover:bg-white/5 transition-colors">
                                        <TableCell className="font-medium text-gray-300">
                                            {m.name}
                                            {session.type === "TEAM" && (
                                                <span className="text-xs text-gray-600 ml-1">({m.teamName})</span>
                                            )}
                                        </TableCell>

                                        {activeTypes.map((type) => {
                                            // TEAM PPT는 팀 단위 과제 (member_id=null, team_id 기준 조회)
                                            const assignment = type === "PPT" && session.type === "TEAM"
                                                ? getTeamPPTAssignment(m.teamId!)
                                                : getAssignment(m.id, type);
                                            const status = assignment?.status || "—";

                                            return (
                                                <TableCell key={type} className="text-center">
                                                    <Badge
                                                        variant="outline"
                                                        title={assignment ? "클릭해서 상태 변경" : "과제 데이터 없음"}
                                                        className={`cursor-pointer hover:opacity-80 transition-opacity select-none ${
                                                            status === "PASS" ? "bg-green-500/10 text-green-500 border-green-500/50" :
                                                            status === "MISSING" ? "bg-red-500/10 text-red-500 border-red-500/50" :
                                                            status === "LATE" ? "bg-yellow-500/10 text-yellow-500 border-yellow-500/50" :
                                                            status === "PENDING" ? "bg-blue-900/30 text-blue-400 border-blue-700 hover:bg-blue-800/30" :
                                                            "bg-gray-800 text-gray-500 border-gray-800"
                                                        }`}
                                                        onClick={() => handleToggleStatus(assignment)}
                                                    >
                                                        {status}
                                                    </Badge>
                                                </TableCell>
                                            );
                                        })}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
