import { useOutletContext } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Search, Loader2, CheckCircle2, XCircle, Check, X, MessageSquare, ExternalLink } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import api from "@/lib/api";
import { toast } from "sonner";
import { useScanHomework } from "@/hooks/useCrawler";
import { useSessionTask } from "@/hooks/useSessionTask";
import type { Session } from "@/hooks/useSessions";
import { useMembers } from "@/hooks/useMembers";

const CAFE_ID = "21496489";

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

const STATUS_COLOR: Record<string, string> = {
    PASS:    "#16a34a",
    MISSING: "#dc2626",
    EXEMPT:  "#94A3B8",
    PENDING: "#2563eb",
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
        <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3">
                <div>
                    <h2 className="text-xl font-bold tracking-tight text-[var(--color-text-primary)]">과제 검사</h2>
                    <p className="text-sm text-[var(--color-text-muted)]">PPT, 리뷰, 피드백 제출 현황을 스캔하고 관리합니다.</p>
                </div>
                <Button
                    onClick={handleScanHomework}
                    disabled={isPolling}
                    size="sm"
                    className="bg-[var(--color-primary)] hover:bg-rose-600 text-white shadow-md shadow-rose-100 self-start md:self-auto"
                >
                    {isPolling ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                    {isPolling ? "스캔 중..." : "과제 스캔"}
                </Button>
            </div>

            {/* Task Progress */}
            {taskStatus && (
                <div className="bg-gray-50 p-4 rounded-lg border border-[var(--color-border)]">
                    <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                        {isPolling ? (
                            <Loader2 className="w-4 h-4 animate-spin text-[var(--color-primary)]" />
                        ) : taskStatus.status === "complete" ? (
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                        ) : (
                            <XCircle className="w-4 h-4 text-red-500" />
                        )}
                        <span>작업 상태: {taskStatus.status} (ID: {taskStatus.task_id})</span>
                        {taskStatus.result && <span className="text-[var(--color-text-muted)] ml-2 text-xs truncate max-w-[300px]">{JSON.stringify(taskStatus.result)}</span>}
                    </div>
                </div>
            )}

            <Card className="bg-[var(--color-surface)] border-[var(--color-border)]">
                <CardHeader className="p-4 md:p-6">
                    <CardTitle className="text-lg">과제 현황</CardTitle>
                    <CardDescription>드롭다운으로 상태를 직접 변경할 수 있습니다.</CardDescription>
                </CardHeader>
                <CardContent className="p-3 md:p-6 md:pt-0">
                    {/* Desktop 테이블 */}
                    <div className="hidden md:block rounded-md border border-[var(--color-border)] overflow-hidden">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-gray-50 hover:bg-gray-50">
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
                                    <TableRow key={m.id} className="hover:bg-gray-50 transition-colors">
                                        <TableCell className="font-medium text-[var(--color-text-secondary)]">
                                            {m.name}
                                            {session.type === "TEAM" && (
                                                <span className="text-xs text-gray-600 ml-1">({m.teamName})</span>
                                            )}
                                        </TableCell>

                                        {activeTypes.map((type) => {
                                            const assignment = getAssignment(m.id, type);
                                            const status = assignment?.status || "—";
                                            const feedbackDetail = type === "FEEDBACK" ? assignment?.raw_data?.feedback_detail : undefined;
                                            const articleId = (type === "PPT" || type === "REVIEW") ? assignment?.raw_data?.article_id : undefined;
                                            const menuId = (type === "PPT" || type === "REVIEW") ? assignment?.raw_data?.menu_id : undefined;

                                            return (
                                                <TableCell key={type} className="text-center">
                                                    <div className="flex flex-col items-center gap-1">
                                                        {assignment ? (
                                                            <div className="flex items-center gap-1">
                                                                <Select
                                                                    value={status}
                                                                    onValueChange={(val) => handleStatusChange(assignment.id, val)}
                                                                >
                                                                    <SelectTrigger
                                                                        className="h-7 w-[100px] text-xs border-[var(--color-border)] bg-transparent font-medium"
                                                                        style={{ color: STATUS_COLOR[status] ?? "#94A3B8" }}
                                                                    >
                                                                        <SelectValue />
                                                                    </SelectTrigger>
                                                                    <SelectContent className="bg-white border-[var(--color-border)]">
                                                                        {STATUS_OPTIONS.map((opt) => (
                                                                            <SelectItem key={opt} value={opt} className="text-xs" style={{ color: STATUS_COLOR[opt] }}>
                                                                                {STATUS_LABEL[opt] ?? opt}
                                                                            </SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>
                                                                {articleId && menuId && (
                                                                    <a
                                                                        href={`https://cafe.naver.com/f-e/cafes/${CAFE_ID}/articles/${articleId}?menuid=${menuId}&referrerAllArticles=false`}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        className="p-0.5 rounded hover:bg-gray-100 text-[var(--color-text-muted)] hover:text-green-500 transition-colors"
                                                                        title="카페 게시글 확인"
                                                                    >
                                                                        <ExternalLink className="w-3 h-3" />
                                                                    </a>
                                                                )}
                                                            </div>
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
                                                                                    ? "bg-green-500/10 text-green-600"
                                                                                    : "bg-red-500/10 text-red-500"
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
                                                                                    <p className="font-medium text-[var(--color-text-secondary)] text-xs border-b border-[var(--color-border)] pb-1">
                                                                                        {m.name} → {d.is_self ? "본인" : d.name} 영상 댓글
                                                                                    </p>
                                                                                    {d.comments!.map((text, i) => (
                                                                                        <p key={i} className="text-[var(--color-text-muted)] text-xs whitespace-pre-wrap break-words leading-relaxed">
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

                    {/* Mobile 카드 */}
                    <div className="md:hidden space-y-2">
                        {rows.map((m) => (
                            <div key={m.id} className="rounded-lg border border-[var(--color-border)] bg-white overflow-hidden">
                                <div className="px-3 py-2 bg-gray-50 border-b border-[var(--color-border)] flex items-center gap-2">
                                    <span className="font-medium text-sm text-[var(--color-text-primary)]">{m.name}</span>
                                    {session.type === "TEAM" && (
                                        <span className="text-[10px] text-gray-600">({m.teamName})</span>
                                    )}
                                </div>
                                <div className="divide-y divide-[var(--color-border)]">
                                    {activeTypes.map((type) => {
                                        const assignment = getAssignment(m.id, type);
                                        const status = assignment?.status || "—";
                                        const feedbackDetail = type === "FEEDBACK" ? assignment?.raw_data?.feedback_detail : undefined;
                                        const articleId = (type === "PPT" || type === "REVIEW") ? assignment?.raw_data?.article_id : undefined;
                                        const menuId = (type === "PPT" || type === "REVIEW") ? assignment?.raw_data?.menu_id : undefined;

                                        return (
                                            <div key={type} className="px-3 py-2 space-y-1.5">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs text-[var(--color-text-muted)] w-16 flex-shrink-0">
                                                        {TYPE_LABEL[type] ?? type}
                                                    </span>
                                                    {assignment ? (
                                                        <>
                                                            <Select
                                                                value={status}
                                                                onValueChange={(val) => handleStatusChange(assignment.id, val)}
                                                            >
                                                                <SelectTrigger
                                                                    className="h-7 flex-1 text-xs border-[var(--color-border)] bg-transparent font-medium"
                                                                    style={{ color: STATUS_COLOR[status] ?? "#94A3B8" }}
                                                                >
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent className="bg-white border-[var(--color-border)]">
                                                                    {STATUS_OPTIONS.map((opt) => (
                                                                        <SelectItem key={opt} value={opt} className="text-xs" style={{ color: STATUS_COLOR[opt] }}>
                                                                            {STATUS_LABEL[opt] ?? opt}
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                            {articleId && menuId && (
                                                                <a
                                                                    href={`https://cafe.naver.com/f-e/cafes/${CAFE_ID}/articles/${articleId}?menuid=${menuId}&referrerAllArticles=false`}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="p-1 rounded hover:bg-gray-100 text-[var(--color-text-muted)] hover:text-green-500"
                                                                    title="카페 게시글 확인"
                                                                >
                                                                    <ExternalLink className="w-3.5 h-3.5" />
                                                                </a>
                                                            )}
                                                        </>
                                                    ) : (
                                                        <span className="text-gray-600 text-xs">—</span>
                                                    )}
                                                </div>
                                                {feedbackDetail && feedbackDetail.length > 0 && (
                                                    <div className="flex flex-wrap gap-1 pl-16">
                                                        {feedbackDetail.map((d) => {
                                                            const hasComments = d.comments && d.comments.length > 0;
                                                            const label = d.is_self ? "본인" : d.name;
                                                            const chip = (
                                                                <span
                                                                    className={`inline-flex items-center gap-0.5 text-[10px] leading-none px-1 py-0.5 rounded ${
                                                                        hasComments ? "cursor-pointer hover:opacity-80" : ""
                                                                    } ${
                                                                        d.commented
                                                                            ? "bg-green-500/10 text-green-600"
                                                                            : "bg-red-500/10 text-red-500"
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
                                                                        className="w-72 max-h-60 overflow-y-auto bg-[var(--color-elevated)] border-[var(--color-border)] p-3 text-sm"
                                                                        align="start"
                                                                    >
                                                                        <div className="space-y-2">
                                                                            <p className="font-medium text-[var(--color-text-secondary)] text-xs border-b border-[var(--color-border)] pb-1">
                                                                                {m.name} → {d.is_self ? "본인" : d.name} 영상 댓글
                                                                            </p>
                                                                            {d.comments!.map((text, i) => (
                                                                                <p key={i} className="text-[var(--color-text-muted)] text-xs whitespace-pre-wrap break-words leading-relaxed">
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
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
