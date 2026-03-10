import { useOutletContext } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Search, Loader2, CheckCircle2, XCircle, Check, X, MessageSquare } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import api from "@/lib/api";
import { toast } from "sonner";
import { useScanHomework } from "@/hooks/useCrawler";
import { useSessionTask } from "@/hooks/useSessionTask";
import type { Session } from "@/hooks/useSessions";
import { useMembers } from "@/hooks/useMembers";

const TYPE_LABEL: Record<string, string> = {
    PPT: "PPT 게시판",
    REVIEW: "리뷰",
    FEEDBACK: "피드백",
};

const STATUS_OPTIONS = ["PASS", "MISSING", "EXEMPT", "PENDING"] as const;

const STATUS_LABEL: Record<string, string> = {
    PASS:    "제출완료",
    MISSING: "미제출(확정)",
    EXEMPT:  "면제",
    PENDING: "미확인",
};

const STATUS_STYLE: Record<string, string> = {
    PASS:    "text-green-500",
    MISSING: "text-red-500",
    EXEMPT:  "text-gray-400",
    PENDING: "text-blue-400",
};

export function PostTab() {
    const { session } = useOutletContext<{ session: Session }>();
    const sessionId = session.id;

    const queryClient = useQueryClient();
    const scanHomeworkMutation = useScanHomework();
    const { setTaskId, taskStatus } = useSessionTask(session.id, "homework-scan");
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
    // PPT_EMAIL은 PREP 탭에서 관리, 여기는 post-session 과제만
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


    const handleStatusChange = async (assignmentId: number, newStatus: string) => {
        try {
            await api.patch(`/assignments/${assignmentId}`, { status: newStatus });
            await queryClient.invalidateQueries({ queryKey: ["sessions", "detail", sessionId] });
        } catch (e) {
            toast.error("상태 변경 실패");
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-bold tracking-tight text-white/90">과제 검사</h2>
                    <p className="text-sm text-[var(--color-text-muted)]">PPT, 리뷰, 피드백 제출 현황을 스캔하고 관리합니다.</p>
                </div>
                <Button
                    onClick={handleScanHomework}
                    disabled={isPolling}
                    className="bg-[var(--color-primary)] hover:bg-rose-600 text-white shadow-[0_0_15px_rgba(244,63,94,0.4)]"
                >
                    {isPolling ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                    {isPolling ? "스캔 중..." : "과제 스캔"}
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
                        <span>작업 상태: {taskStatus.status} (ID: {taskStatus.task_id})</span>
                        {taskStatus.result && <span className="text-gray-500 ml-2 text-xs truncate max-w-[300px]">{JSON.stringify(taskStatus.result)}</span>}
                    </div>
                </div>
            )}

            <Card className="bg-[var(--color-surface)] border-[var(--color-border)]">
                <CardHeader>
                    <CardTitle className="text-lg">과제 현황</CardTitle>
                    <CardDescription>드롭다운으로 상태를 직접 변경할 수 있습니다.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border border-[var(--color-border)] overflow-hidden">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-gray-900/50 hover:bg-gray-900/50">
                                    <TableHead>멤버</TableHead>
                                    {activeTypes.map((type) => (
                                        <TableHead key={type} className="text-center w-[120px]">
                                            {TYPE_LABEL[type] ?? type}
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
                                            const assignment = getAssignment(m.id, type);
                                            const status = assignment?.status || "—";
                                            const feedbackDetail = type === "FEEDBACK" ? assignment?.raw_data?.feedback_detail : undefined;

                                            return (
                                                <TableCell key={type} className="text-center">
                                                    <div className="flex flex-col items-center gap-1">
                                                        {assignment ? (
                                                            <Select
                                                                value={status}
                                                                onValueChange={(val) => handleStatusChange(assignment.id, val)}
                                                            >
                                                                <SelectTrigger className={`h-7 w-[100px] text-xs border-[var(--color-border)] bg-transparent ${STATUS_STYLE[status] ?? "text-gray-500"}`}>
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent className="bg-[var(--color-elevated)] border-[var(--color-border)]">
                                                                    {STATUS_OPTIONS.map((opt) => (
                                                                        <SelectItem key={opt} value={opt} className={`text-xs ${STATUS_STYLE[opt]}`}>
                                                                            {STATUS_LABEL[opt] ?? opt}
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        ) : (
                                                            <span className="text-gray-600 text-xs">—</span>
                                                        )}
                                                        {feedbackDetail && feedbackDetail.length > 0 && (
                                                            <div className="flex flex-wrap justify-center gap-1 mt-0.5">
                                                                {feedbackDetail.map((d) => {
                                                                    const hasComments = d.comments && d.comments.length > 0;
                                                                    const label = d.is_self ? "본인" : d.name;
                                                                    const chip = (
                                                                        <span
                                                                            className={`inline-flex items-center gap-0.5 text-[10px] leading-none px-1 py-0.5 rounded ${
                                                                                hasComments ? "cursor-pointer hover:opacity-80" : ""
                                                                            } ${
                                                                                d.commented
                                                                                    ? "bg-green-500/10 text-green-400"
                                                                                    : "bg-red-500/10 text-red-400"
                                                                            }`}
                                                                        >
                                                                            {d.commented ? <Check className="w-2.5 h-2.5" /> : <X className="w-2.5 h-2.5" />}
                                                                            {label}
                                                                            {hasComments && <MessageSquare className="w-2.5 h-2.5 ml-0.5 opacity-60" />}
                                                                        </span>
                                                                    );

                                                                    if (!hasComments) return <span key={d.member_id}>{chip}</span>;

                                                                    return (
                                                                        <Popover key={d.member_id}>
                                                                            <PopoverTrigger asChild>
                                                                                {chip}
                                                                            </PopoverTrigger>
                                                                            <PopoverContent
                                                                                className="w-80 max-h-60 overflow-y-auto bg-[var(--color-elevated)] border-[var(--color-border)] p-3 text-sm"
                                                                                align="center"
                                                                            >
                                                                                <div className="space-y-2">
                                                                                    <p className="font-medium text-gray-300 text-xs border-b border-gray-700 pb-1">
                                                                                        {m.name} → {d.is_self ? "본인" : d.name} 영상 댓글
                                                                                    </p>
                                                                                    {d.comments!.map((text, i) => (
                                                                                        <p key={i} className="text-gray-400 text-xs whitespace-pre-wrap break-words leading-relaxed">
                                                                                            {text}
                                                                                        </p>
                                                                                    ))}
                                                                                </div>
                                                                            </PopoverContent>
                                                                        </Popover>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                    </div>
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
