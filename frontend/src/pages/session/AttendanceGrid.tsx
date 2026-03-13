import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { toast } from "sonner";
import { RefreshCw, CheckCircle2, FileText } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ExcuseTextDisplay } from "@/components/ExcuseTextDisplay";

interface AttendanceGridProps {
    sessionId: number;
    teams: any[];
    assignments?: any[];     // session.assignments
    sessionType?: string;    // "INDIVIDUAL" | "TEAM"
}

export function AttendanceGrid({ sessionId, teams, assignments, sessionType }: AttendanceGridProps) {
    const queryClient = useQueryClient();
    const [updating, setUpdating] = useState<Record<string, boolean>>({});

    const handleStatusChange = async (memberId: number, status: string) => {
        setUpdating(prev => ({ ...prev, [memberId]: true }));
        try {
            await api.patch(`/sessions/${sessionId}/attendance/${memberId}`, {
                status: status
            });
            await queryClient.invalidateQueries({ queryKey: ["sessions", "detail", sessionId] });
            // toast.success("출결 상태가 변경되었습니다."); // Removed per user request
        } catch (error) {
            console.error(error);
            toast.error("출결 변경 실패");
        } finally {
            setUpdating(prev => ({ ...prev, [memberId]: false }));
        }
    };

    const handleExcuseChange = async (memberId: number, excuseType: string) => {
        setUpdating(prev => ({ ...prev, [memberId]: true }));
        try {
            await api.patch(`/sessions/${sessionId}/attendance/${memberId}`, {
                excuse_type: excuseType === "NONE" ? null : excuseType
            });
            await queryClient.invalidateQueries({ queryKey: ["sessions", "detail", sessionId] });
            toast.success("사유서가 업데이트되었습니다.");
        } catch (error: any) {
            console.error(error);
            toast.error(error?.response?.data?.detail ?? "사유서 업데이트 실패");
        } finally {
            setUpdating(prev => ({ ...prev, [memberId]: false }));
        }
    };

    const handlePptEmailChange = async (assignmentId: number, newStatus: string) => {
        const key = `ppt_${assignmentId}`;
        setUpdating(prev => ({ ...prev, [key]: true }));
        try {
            await api.patch(`/assignments/${assignmentId}`, { status: newStatus });
            await queryClient.invalidateQueries({ queryKey: ["sessions", "detail", sessionId] });
        } catch (error) {
            console.error(error);
            toast.error("PPT 이메일 상태 변경 실패");
        } finally {
            setUpdating(prev => ({ ...prev, [key]: false }));
        }
    };

    const handleBatchPresent = async () => {
        const pendingMembers = teams.flatMap(t => t.members).filter((m: any) => !m.attendance?.status || m.attendance?.status === "PENDING");
        if (pendingMembers.length === 0) {
            toast.info("처리할 대상(PENDING)이 없습니다.");
            return;
        }

        if (!confirm(`${pendingMembers.length}명의 미처리 인원을 '출석'으로 일괄 처리하시겠습니까?`)) return;

        // Optimistic UI update or bulk loading state could be added here
        // For simplicity, we just trigger notifications
        let successCount = 0;

        // Parallel requests (could be batched if backend supported it, but concurrent is fine for <50)
        await Promise.all(pendingMembers.map(async (m: any) => {
            setUpdating(prev => ({ ...prev, [m.member_id]: true }));
            try {
                await api.patch(`/sessions/${sessionId}/attendance/${m.member_id}`, {
                    status: "PRESENT"
                });
                successCount++;
            } catch (err) {
                console.error(err);
            } finally {
                setUpdating(prev => ({ ...prev, [m.member_id]: false }));
            }
        }));

        if (successCount > 0) {
            toast.success(`${successCount}명 일괄 출석 처리 완료`);
            await queryClient.invalidateQueries({ queryKey: ["sessions", "detail", sessionId] });
        } else {
            toast.error("일괄 처리 실패");
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                <button
                    onClick={handleBatchPresent}
                    className="bg-[var(--color-primary)] text-white px-4 py-2 rounded-md text-sm font-bold hover:bg-rose-600 transition-colors flex items-center shadow-md shadow-rose-100"
                >
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    일괄 출석 처리
                </button>
            </div>

            <div className="rounded-xl border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)]">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[100px]">팀</TableHead>
                            <TableHead>멤버</TableHead>
                            <TableHead className="w-[180px]">출결</TableHead>
                            <TableHead className="w-[200px]">사유서</TableHead>
                            <TableHead className="w-[220px]">PPT 이메일</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {teams.flatMap(team =>
                            team.members.map((member: any) => (
                                <TableRow key={member.member_id}>
                                    <TableCell className="font-medium text-[var(--color-text-secondary)]">
                                        {team.name}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <span className={member.is_active ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-muted)]"}>
                                                {member.name}
                                            </span>
                                            {!member.is_active && <span className="text-[10px] bg-red-500/10 text-red-500 px-1 rounded">비활성</span>}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="relative">
                                            <Select
                                                value={member.attendance?.status || "PENDING"}
                                                onValueChange={(val) => handleStatusChange(member.member_id, val)}
                                                disabled={updating[member.member_id]}
                                            >
                                                <SelectTrigger
                                                    className="h-8 w-[160px] border-[var(--color-border)] bg-white font-bold"
                                                    style={{
                                                        color: member.attendance?.status === "PRESENT" ? "#16a34a"
                                                            : member.attendance?.status === "LATE_UNDER10" ? "#ca8a04"
                                                            : member.attendance?.status === "LATE_OVER10" ? "#ea580c"
                                                            : member.attendance?.status === "ABSENT" ? "#dc2626"
                                                            : member.attendance?.status === "EARLY_LEAVE" ? "#9333ea"
                                                            : member.attendance?.status === "EXCUSED" ? "#2563eb"
                                                            : "#94A3B8"
                                                    }}
                                                >
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent className="bg-white border-[var(--color-border)]">
                                                    <SelectItem value="PENDING" className="text-gray-500">미처리</SelectItem>
                                                    <SelectItem value="PRESENT" style={{ color: "#16a34a" }}>출석</SelectItem>
                                                    <SelectItem value="LATE_UNDER10" style={{ color: "#ca8a04" }}>지각 (10분 미만)</SelectItem>
                                                    <SelectItem value="LATE_OVER10" style={{ color: "#ea580c" }}>지각 (10분 초과)</SelectItem>
                                                    <SelectItem value="EARLY_LEAVE" style={{ color: "#9333ea" }}>조퇴</SelectItem>
                                                    <SelectItem value="ABSENT" style={{ color: "#dc2626" }}>결석</SelectItem>
                                                    <SelectItem value="EXCUSED" style={{ color: "#2563eb" }}>공결</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            {updating[member.member_id] && (
                                                <div className="absolute right-8 top-2">
                                                    <RefreshCw className="w-3 h-3 animate-spin text-[var(--color-text-muted)]" />
                                                </div>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            {/* Excuse Type (PRE/POST) */}
                                            <Select
                                                value={member.attendance?.excuse_type || "NONE"}
                                                onValueChange={(val) => handleExcuseChange(member.member_id, val)}
                                                disabled={updating[member.member_id]}
                                            >
                                                <SelectTrigger className="h-8 w-[100px] text-xs text-[var(--color-text-primary)] border-[var(--color-border)] bg-white">
                                                    <SelectValue placeholder="유형" />
                                                </SelectTrigger>
                                                <SelectContent className="bg-white text-[var(--color-text-primary)] border-[var(--color-border)]">
                                                    <SelectItem value="NONE">-</SelectItem>
                                                    <SelectItem value="PRE">사전 통보</SelectItem>
                                                    <SelectItem value="POST">사후 제출</SelectItem>
                                                </SelectContent>
                                            </Select>

                                            {/* Excuse Text Popover */}
                                            {member.attendance?.excuse_text && (
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:text-blue-500 hover:bg-blue-400/10">
                                                            <FileText className="w-3.5 h-3.5" />
                                                        </Button>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-80 bg-[var(--color-elevated)] border-[var(--color-border)] p-3 text-sm" align="end">
                                                        <ExcuseTextDisplay text={member.attendance.excuse_text} />
                                                    </PopoverContent>
                                                </Popover>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        {(() => {
                                            if (!assignments) return <span className="text-[var(--color-text-muted)] text-xs">-</span>;

                                            let pptAssignment: any = null;
                                            let isToggleable = true;

                                            if (sessionType === "TEAM" && team.id) {
                                                pptAssignment = assignments.find((a: any) => a.type === "PPT_EMAIL" && a.team_id === team.id);
                                                isToggleable = team.members[0]?.member_id === member.member_id;
                                            } else {
                                                pptAssignment = assignments.find((a: any) => a.type === "PPT_EMAIL" && a.member_id === member.member_id);
                                            }

                                            if (!pptAssignment) return <span className="text-[var(--color-text-muted)] text-xs">-</span>;

                                            const pptKey = `ppt_${pptAssignment.id}`;
                                            const isUpdating = updating[pptKey];
                                            const currentStatus = pptAssignment.status;

                                            const buttons = [
                                                { value: "PASS", label: "제출", color: "text-green-600 border-green-500/40 bg-green-500/10", activeColor: "bg-green-500/30 border-green-500 text-green-700 ring-1 ring-green-400/30" },
                                                { value: "LATE", label: "지각", color: "text-orange-600 border-orange-500/40 bg-orange-500/10", activeColor: "bg-orange-500/30 border-orange-500 text-orange-700 ring-1 ring-orange-400/30" },
                                                { value: "MISSING", label: "미제출", color: "text-red-500 border-red-500/40 bg-red-500/10", activeColor: "bg-red-500/30 border-red-500 text-red-700 ring-1 ring-red-400/30" },
                                                { value: "EXEMPT", label: "면제", color: "text-blue-600 border-blue-500/40 bg-blue-500/10", activeColor: "bg-blue-500/30 border-blue-500 text-blue-700 ring-1 ring-blue-400/30" },
                                            ];

                                            if (!isToggleable) {
                                                const active = buttons.find(b => b.value === currentStatus);
                                                if (currentStatus === "PENDING") return <span className="text-[var(--color-text-muted)] text-[10px]">미검사</span>;
                                                return (
                                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${active?.activeColor || "text-[var(--color-text-muted)]"}`}>
                                                        {active?.label || currentStatus}
                                                    </span>
                                                );
                                            }

                                            return (
                                                <div className="flex items-center gap-1 whitespace-nowrap">
                                                    {buttons.map(btn => {
                                                        const isActive = currentStatus === btn.value;
                                                        return (
                                                            <button
                                                                key={btn.value}
                                                                disabled={isUpdating}
                                                                onClick={() => handlePptEmailChange(pptAssignment.id, isActive ? "PENDING" : btn.value)}
                                                                className={`px-1.5 py-0.5 rounded text-[10px] font-medium border transition-all ${
                                                                    isActive ? btn.activeColor : `${btn.color} opacity-40 hover:opacity-80`
                                                                }`}
                                                                title={isActive ? "클릭하면 미검사로 초기화" : btn.label}
                                                            >
                                                                {btn.label}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            );
                                        })()}
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
