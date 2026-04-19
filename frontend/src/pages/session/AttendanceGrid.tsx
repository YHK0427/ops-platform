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
import { useState, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { toast } from "sonner";
import { RefreshCw, CheckCircle2, FileText, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ExcuseTextDisplay } from "@/components/ExcuseTextDisplay";
import { PresenterOrderPanel } from "@/components/PresenterOrderPanel";

interface AttendanceGridProps {
    sessionId: number;
    teams: any[];
    assignments?: any[];     // session.assignments
    sessionType?: string;    // "INDIVIDUAL" | "TEAM"
    staffGroups?: Record<string, { display_name: string }[]>;  // {"1": [...], "2": [...]}
}

export function AttendanceGrid({ sessionId, teams, assignments, sessionType, staffGroups }: AttendanceGridProps) {
    const queryClient = useQueryClient();
    const [updating, setUpdating] = useState<Record<string, boolean>>({});
    const [viewMode, setViewMode] = useState<"default" | "order">("default");

    const handleStatusChange = async (memberId: number, status: string) => {
        setUpdating(prev => ({ ...prev, [memberId]: true }));
        try {
            await api.patch(`/sessions/${sessionId}/attendance/${memberId}`, {
                status: status
            });
            await queryClient.invalidateQueries({ queryKey: ["sessions", "detail", sessionId] });
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

    const handleNoteChange = async (memberId: number, note: string) => {
        try {
            await api.patch(`/sessions/${sessionId}/attendance/${memberId}`, { note: note || null });
            await queryClient.invalidateQueries({ queryKey: ["sessions", "detail", sessionId] });
        } catch (error) {
            console.error(error);
            toast.error("메모 저장 실패");
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

    // 발표 순서 뷰 데이터 구성
    const presenterOrderItems = teams.flatMap((team: any) =>
        team.members
            .filter((m: any) => m.attendance?.status !== "ABSENT" && m.attendance?.status !== "EXCUSED")
            .map((m: any) => ({
                id: m.member_id,
                name: m.name,
                group_num: m.attendance?.group_num ?? null,
                presenter_order: m.attendance?.presenter_order ?? null,
            }))
    );
    const absentOrderItems = teams.flatMap((team: any) =>
        team.members
            .filter((m: any) => m.attendance?.status === "ABSENT" || m.attendance?.status === "EXCUSED")
            .map((m: any) => ({
                id: m.member_id,
                name: m.name,
                status: m.attendance.status as "ABSENT" | "EXCUSED",
            }))
    );
    const hasGroups = teams.some((t: any) => t.name?.includes("분반"));

    const teamOrderItems = sessionType === "TEAM" ? teams.map((t: any) => ({
        id: t.id,
        name: t.name,
        memberNames: t.members.map((m: any) => m.name),
    })) : undefined;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                {/* 뷰 토글 */}
                <div className="flex gap-1 p-0.5 bg-[var(--color-hover)] rounded-lg">
                    <button
                        onClick={() => setViewMode("default")}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                            viewMode === "default" ? "bg-white shadow text-[var(--color-text-primary)]" : "text-[var(--color-text-muted)]"
                        }`}
                    >
                        출석 관리
                    </button>
                    <button
                        onClick={() => setViewMode("order")}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                            viewMode === "order" ? "bg-white shadow text-[var(--color-accent)]" : "text-[var(--color-text-muted)]"
                        }`}
                    >
                        발표 순서
                    </button>
                </div>
                {viewMode === "default" && (
                    <button
                        onClick={handleBatchPresent}
                        className="bg-[var(--color-primary)] text-white px-4 py-2 rounded-md text-sm font-bold hover:bg-rose-600 transition-colors flex items-center shadow-md shadow-rose-100"
                    >
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        일괄 출석 처리
                    </button>
                )}
            </div>

            {viewMode === "order" ? (
                <PresenterOrderPanel
                    sessionId={sessionId}
                    items={presenterOrderItems}
                    absentItems={absentOrderItems}
                    hasGroups={hasGroups}
                    isTeamSession={sessionType === "TEAM"}
                    teamItems={teamOrderItems}
                />
            ) : (
            <>
            {teams.map((team) => {
                const groupColor = team.name === "1분반" ? "border-blue-400" : team.name === "2분반" ? "border-emerald-400" : "border-[var(--color-border)]";
                const groupDot = team.name === "1분반" ? "bg-blue-500" : team.name === "2분반" ? "bg-emerald-500" : "bg-gray-400";
                const showGroupHeader = teams.length > 1;

                return (
                <div key={team.name} className="space-y-1">
                    {showGroupHeader && (() => {
                        const groupKey = team.name === "1분반" ? "1" : team.name === "2분반" ? "2" : null;
                        const staff = groupKey && staffGroups ? staffGroups[groupKey] ?? [] : [];
                        return (
                        <div className="flex items-center gap-2 px-1">
                            <div className={`w-2.5 h-2.5 rounded-full ${groupDot}`} />
                            <span className="font-bold text-sm text-[var(--color-text-secondary)]">
                                {team.name}
                            </span>
                            <span className="text-xs text-[var(--color-text-muted)]">
                                ({team.members.length}명)
                            </span>
                            {staff.length > 0 && (
                                <span className="text-[11px] text-[var(--color-text-muted)] ml-1">
                                    · 운영진: {staff.map((s) => s.display_name).join(", ")}
                                </span>
                            )}
                        </div>
                        );
                    })()}

                    {/* Desktop table - hidden on mobile */}
                    <div className={`hidden md:block rounded-xl border overflow-hidden bg-[var(--color-surface)] ${showGroupHeader ? groupColor : "border-[var(--color-border)]"}`}>
                <Table>
                    <TableHeader>
                        <TableRow>
                            {!showGroupHeader && <TableHead className="w-[100px]">팀</TableHead>}
                            <TableHead>멤버</TableHead>
                            <TableHead className="w-[180px]">출결</TableHead>
                            <TableHead className="w-[150px]">메모</TableHead>
                            <TableHead className="w-[200px]">사유서</TableHead>
                            <TableHead className="w-[220px]">PPT 이메일</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {team.members.map((member: any) => (
                                <TableRow key={member.member_id}>
                                    {!showGroupHeader && (
                                    <TableCell className="font-medium text-[var(--color-text-secondary)]">
                                        {team.name}
                                    </TableCell>
                                    )}
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
                                        <NoteInput
                                            defaultValue={member.attendance?.note || ""}
                                            onSave={(note) => handleNoteChange(member.member_id, note)}
                                        />
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
                        ))}
                    </TableBody>
                </Table>
                    </div>

                    {/* Mobile list - hidden on desktop */}
                    <div className="md:hidden space-y-1.5">
                        {team.members.map((member: any) => (
                            <MobileAttendanceRow
                                key={member.member_id}
                                member={member}
                                team={team}
                                sessionType={sessionType}
                                assignments={assignments}
                                updating={updating}
                                onStatusChange={handleStatusChange}
                                onExcuseChange={handleExcuseChange}
                                onPptEmailChange={handlePptEmailChange}
                                onNoteChange={handleNoteChange}
                            />
                        ))}
                    </div>
                </div>
                );
            })}
            </>
            )}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Mobile row – one per member, tap to expand excuse / PPT controls  */
/* ------------------------------------------------------------------ */

const STATUS_COLOR_MAP: Record<string, string> = {
    PRESENT: "bg-green-500",
    LATE_UNDER10: "bg-yellow-500",
    LATE_OVER10: "bg-orange-500",
    ABSENT: "bg-red-500",
    EARLY_LEAVE: "bg-purple-500",
    EXCUSED: "bg-blue-500",
    PENDING: "bg-gray-300",
};

const STATUS_TEXT_COLOR_MAP: Record<string, string> = {
    PRESENT: "#16a34a",
    LATE_UNDER10: "#ca8a04",
    LATE_OVER10: "#ea580c",
    ABSENT: "#dc2626",
    EARLY_LEAVE: "#9333ea",
    EXCUSED: "#2563eb",
    PENDING: "#94A3B8",
};

const PPT_BUTTONS = [
    { value: "PASS", label: "제출", color: "text-green-600 border-green-500/40 bg-green-500/10", activeColor: "bg-green-500/30 border-green-500 text-green-700 ring-1 ring-green-400/30" },
    { value: "LATE", label: "지각", color: "text-orange-600 border-orange-500/40 bg-orange-500/10", activeColor: "bg-orange-500/30 border-orange-500 text-orange-700 ring-1 ring-orange-400/30" },
    { value: "MISSING", label: "미제출", color: "text-red-500 border-red-500/40 bg-red-500/10", activeColor: "bg-red-500/30 border-red-500 text-red-700 ring-1 ring-red-400/30" },
    { value: "EXEMPT", label: "면제", color: "text-blue-600 border-blue-500/40 bg-blue-500/10", activeColor: "bg-blue-500/30 border-blue-500 text-blue-700 ring-1 ring-blue-400/30" },
];

interface MobileAttendanceRowProps {
    member: any;
    team: any;
    sessionType?: string;
    assignments?: any[];
    updating: Record<string, boolean>;
    onStatusChange: (memberId: number, status: string) => void;
    onExcuseChange: (memberId: number, excuseType: string) => void;
    onPptEmailChange: (assignmentId: number, newStatus: string) => void;
    onNoteChange: (memberId: number, note: string) => void;
}

function MobileAttendanceRow({
    member,
    team,
    sessionType,
    assignments,
    updating,
    onStatusChange,
    onExcuseChange,
    onPptEmailChange,
    onNoteChange,
}: MobileAttendanceRowProps) {
    const [expanded, setExpanded] = useState(false);

    const status = member.attendance?.status || "PENDING";
    const dotColor = STATUS_COLOR_MAP[status] || "bg-gray-300";
    const textColor = STATUS_TEXT_COLOR_MAP[status] || "#94A3B8";

    // Resolve PPT assignment for this member
    let pptAssignment: any = null;
    let isToggleable = true;
    if (assignments) {
        if (sessionType === "TEAM" && team.id) {
            pptAssignment = assignments.find((a: any) => a.type === "PPT_EMAIL" && a.team_id === team.id);
            isToggleable = team.members[0]?.member_id === member.member_id;
        } else {
            pptAssignment = assignments.find((a: any) => a.type === "PPT_EMAIL" && a.member_id === member.member_id);
        }
    }

    return (
        <div className="border border-[var(--color-border-subtle)] rounded-lg overflow-hidden">
            {/* Main row: name + attendance + excuse */}
            <div
                className="flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-[var(--color-hover)]"
                onClick={() => setExpanded(!expanded)}
            >
                <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
                    <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                        {member.name}
                    </span>
                    {!member.is_active && (
                        <span className="text-[10px] bg-red-500/10 text-red-500 px-1 rounded shrink-0">비활성</span>
                    )}
                    {updating[member.member_id] && (
                        <RefreshCw className="w-3 h-3 animate-spin text-[var(--color-text-muted)] shrink-0" />
                    )}
                    {/* 사유서 아이콘 (excuse_text 있을 때) */}
                    {member.attendance?.excuse_text && (
                        <Popover>
                            <PopoverTrigger asChild>
                                <button onClick={(e) => e.stopPropagation()} className="text-blue-600 hover:text-blue-500">
                                    <FileText className="w-3.5 h-3.5" />
                                </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-72 bg-[var(--color-elevated)] border-[var(--color-border)] p-3 text-sm" align="start">
                                <ExcuseTextDisplay text={member.attendance.excuse_text} />
                            </PopoverContent>
                        </Popover>
                    )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                    {/* 사유서 유형 */}
                    <div onClick={(e) => e.stopPropagation()}>
                        <Select
                            value={member.attendance?.excuse_type || "NONE"}
                            onValueChange={(val) => onExcuseChange(member.member_id, val)}
                            disabled={updating[member.member_id]}
                        >
                            <SelectTrigger className="h-7 w-16 text-[10px] text-[var(--color-text-secondary)] border-[var(--color-border)] bg-white">
                                <SelectValue placeholder="-" />
                            </SelectTrigger>
                            <SelectContent className="bg-white text-[var(--color-text-primary)] border-[var(--color-border)]">
                                <SelectItem value="NONE">-</SelectItem>
                                <SelectItem value="PRE">사전</SelectItem>
                                <SelectItem value="POST">사후</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {/* 출결 셀렉트 */}
                    <div onClick={(e) => e.stopPropagation()}>
                        <Select
                            value={status}
                            onValueChange={(val) => onStatusChange(member.member_id, val)}
                            disabled={updating[member.member_id]}
                        >
                            <SelectTrigger
                                className="w-[80px] h-7 text-xs font-bold border-[var(--color-border)] bg-white"
                                style={{ color: textColor }}
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-white border-[var(--color-border)]">
                                <SelectItem value="PENDING" className="text-gray-500">미처리</SelectItem>
                                <SelectItem value="PRESENT" style={{ color: "#16a34a" }}>출석</SelectItem>
                                <SelectItem value="LATE_UNDER10" style={{ color: "#ca8a04" }}>지각(&lt;10)</SelectItem>
                                <SelectItem value="LATE_OVER10" style={{ color: "#ea580c" }}>지각(&gt;10)</SelectItem>
                                <SelectItem value="EARLY_LEAVE" style={{ color: "#9333ea" }}>조퇴</SelectItem>
                                <SelectItem value="ABSENT" style={{ color: "#dc2626" }}>결석</SelectItem>
                                <SelectItem value="EXCUSED" style={{ color: "#2563eb" }}>공결</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <ChevronDown
                        className={`w-3.5 h-3.5 text-[var(--color-text-muted)] transition-transform ${expanded ? "rotate-180" : ""}`}
                    />
                </div>
            </div>

            {/* Expanded section: PPT + 메모 */}
            {expanded && (
                <div className="px-3 py-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-hover)]/50 space-y-2">
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-[var(--color-text-muted)] w-10 shrink-0">PPT</span>
                        {(() => {
                            if (!pptAssignment) return <span className="text-[var(--color-text-muted)] text-xs">-</span>;

                            const pptKey = `ppt_${pptAssignment.id}`;
                            const isUpdating = updating[pptKey];
                            const currentStatus = pptAssignment.status;

                            if (!isToggleable) {
                                const active = PPT_BUTTONS.find(b => b.value === currentStatus);
                                if (currentStatus === "PENDING") return <span className="text-[var(--color-text-muted)] text-[10px]">미검사</span>;
                                return (
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${active?.activeColor || "text-[var(--color-text-muted)]"}`}>
                                        {active?.label || currentStatus}
                                    </span>
                                );
                            }

                            return (
                                <div className="flex items-center gap-1 flex-wrap">
                                    {PPT_BUTTONS.map(btn => {
                                        const isActive = currentStatus === btn.value;
                                        return (
                                            <button
                                                key={btn.value}
                                                disabled={isUpdating}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onPptEmailChange(pptAssignment.id, isActive ? "PENDING" : btn.value);
                                                }}
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
                    </div>
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <span className="text-xs text-[var(--color-text-muted)] w-10 shrink-0">메모</span>
                        <NoteInput
                            defaultValue={member.attendance?.note || ""}
                            onSave={(note) => onNoteChange(member.member_id, note)}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  NoteInput – blur 시 자동 저장되는 메모 입력                          */
/* ------------------------------------------------------------------ */

function NoteInput({ defaultValue, onSave }: { defaultValue: string; onSave: (note: string) => void }) {
    const [value, setValue] = useState(defaultValue);
    const savedRef = useRef(defaultValue);

    const handleBlur = useCallback(() => {
        const trimmed = value.trim();
        if (trimmed !== savedRef.current) {
            savedRef.current = trimmed;
            onSave(trimmed);
        }
    }, [value, onSave]);

    return (
        <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            placeholder="메모"
            className="h-7 w-full text-xs border border-[var(--color-border)] rounded px-2 bg-white text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
        />
    );
}
