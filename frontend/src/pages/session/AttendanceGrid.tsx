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

interface AttendanceGridProps {
    sessionId: number;
    teams: any[];
}

export function AttendanceGrid({ sessionId, teams }: AttendanceGridProps) {
    const queryClient = useQueryClient();
    const [updating, setUpdating] = useState<Record<number, boolean>>({});

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
                    className="bg-[var(--color-primary)] text-white px-4 py-2 rounded-md text-sm font-bold hover:bg-rose-600 transition-colors flex items-center shadow-[0_0_15px_rgba(244,63,94,0.4)]"
                >
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    일괄 출석 (PENDING → PRESENT)
                </button>
            </div>

            <div className="rounded-xl border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)]">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[100px]">Team</TableHead>
                            <TableHead>Member</TableHead>
                            <TableHead className="w-[180px]">Status</TableHead>
                            <TableHead className="w-[200px]">Excuse Details</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {teams.flatMap(team =>
                            team.members.map((member: any) => (
                                <TableRow key={member.member_id}>
                                    <TableCell className="font-medium text-gray-300">
                                        {team.name}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <span className={member.is_active ? "text-white" : "text-gray-500"}>
                                                {member.name}
                                            </span>
                                            {!member.is_active && <span className="text-[10px] bg-red-500/10 text-red-500 px-1 rounded">Inactive</span>}
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
                                                    className={`h-8 w-[160px] border-gray-600 bg-gray-800 ${(member.attendance?.status === "PRESENT") ? "text-green-400 font-bold" :
                                                        (member.attendance?.status === "LATE_UNDER10") ? "text-yellow-400 font-bold" :
                                                            (member.attendance?.status === "LATE_OVER10") ? "text-orange-400 font-bold" :
                                                                (member.attendance?.status === "ABSENT") ? "text-red-400 font-bold" :
                                                                    (member.attendance?.status === "EARLY_LEAVE") ? "text-purple-400 font-bold" :
                                                                        (member.attendance?.status === "EXCUSED") ? "text-blue-400 font-bold" :
                                                                            "text-gray-400"
                                                        }`}
                                                >
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent className="bg-gray-800 text-white border-gray-700">
                                                    <SelectItem value="PENDING">미처리 (PENDING)</SelectItem>
                                                    <SelectItem value="PRESENT">출석 (PRESENT)</SelectItem>
                                                    <SelectItem value="LATE_UNDER10">지각 (10분 미만)</SelectItem>
                                                    <SelectItem value="LATE_OVER10">지각 (10분 초과)</SelectItem>
                                                    <SelectItem value="EARLY_LEAVE">조퇴</SelectItem>
                                                    <SelectItem value="ABSENT">결석 (ABSENT)</SelectItem>
                                                    <SelectItem value="EXCUSED">공결 (EXCUSED)</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            {updating[member.member_id] && (
                                                <div className="absolute right-8 top-2">
                                                    <RefreshCw className="w-3 h-3 animate-spin text-gray-400" />
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
                                                <SelectTrigger className="h-8 w-[100px] text-xs text-white border-gray-600 bg-gray-800">
                                                    <SelectValue placeholder="유형" />
                                                </SelectTrigger>
                                                <SelectContent className="bg-gray-800 text-white border-gray-700">
                                                    <SelectItem value="NONE">-</SelectItem>
                                                    <SelectItem value="PRE">사전 통보</SelectItem>
                                                    <SelectItem value="POST">사후 제출</SelectItem>
                                                </SelectContent>
                                            </Select>

                                            {/* Excuse Text Popover */}
                                            {member.attendance?.excuse_text && (
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-400 hover:text-blue-300 hover:bg-blue-400/10">
                                                            <FileText className="w-3.5 h-3.5" />
                                                        </Button>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-80 bg-[var(--color-elevated)] border-[var(--color-border)] p-3 text-sm" align="end">
                                                        <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase mb-2">사유서 내용</p>
                                                        <p className="text-[var(--color-text-secondary)] whitespace-pre-wrap break-words leading-relaxed text-xs">
                                                            {member.attendance.excuse_text}
                                                        </p>
                                                    </PopoverContent>
                                                </Popover>
                                            )}
                                        </div>
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
