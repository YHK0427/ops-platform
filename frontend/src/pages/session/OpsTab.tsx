import { useOutletContext } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { UploadCloud, AlertTriangle, Users, Check, ChevronsUpDown, X, Plus, Film } from "lucide-react";
import { WarningBanner } from "@/components/WarningBanner";
import { toast } from "sonner";
import { useCrawlerTask, useUploadVideos, useSetFeedbackTargets, useDriveVideos, type DriveVideoItem } from "@/hooks";
import { useMembers } from "@/hooks/useMembers";
import { useState, useMemo } from "react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import type { Session } from "@/hooks/useSessions";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

export default function OpsTab() {
    const { session } = useOutletContext<{ session: Session }>();

    const [uploadTaskId, setUploadTaskId] = useState<string | null>(null);
    const { mutate: uploadVideos, isPending: isUploading } = useUploadVideos();
    const { mutate: fetchDriveVideos, isPending: isLoadingDrive, data: driveVideos } = useDriveVideos();
    const { data: taskStatus } = useCrawlerTask(uploadTaskId);
    const { mutate: setFeedbackTargets, isPending: isSettingTarget } = useSetFeedbackTargets();
    const { data: allMembers } = useMembers();

    // D+1 Warning Logic
    const sessionDate = new Date(session.date);
    const today = new Date();
    const d1 = new Date(sessionDate.getFullYear(), sessionDate.getMonth(), sessionDate.getDate());
    const d2 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const diffDays = (d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24);
    const isNextDay = diffDays === 1;

    // Build memberId → name map
    const memberNameMap = useMemo(() => {
        const map = new Map<number, string>();
        allMembers?.forEach(m => map.set(m.id, m.name));
        session.teams?.forEach((t) => {
            t.members?.forEach((tm) => map.set(tm.id, tm.name));
        });
        return map;
    }, [allMembers, session.teams]);

    const feedbackAssignments = session.assignments?.filter((a) => a.type === "FEEDBACK") ?? [];
    const sessionMemberIds = session.attendances?.map((a) => a.member_id) ?? [];

    // Receiver map: memberId → number of writers pointing to them
    const receiverCountMap = useMemo(() => {
        const map = new Map<number, number>();
        sessionMemberIds.forEach(id => map.set(id, 0));
        feedbackAssignments.forEach((a) => {
            a.target_member_ids?.forEach((tid) => {
                map.set(tid, (map.get(tid) ?? 0) + 1);
            });
        });
        return map;
    }, [feedbackAssignments, sessionMemberIds]);

    const handleCafeUpload = () => {
        uploadVideos({ sessionId: session.id }, {
            onSuccess: (data) => {
                toast.success("업로드 작업이 시작되었습니다.");
                setUploadTaskId(data.task_id);
            },
            onError: () => toast.error("요청 실패"),
        });
    };

    const renderTaskStatus = () => {
        if (!uploadTaskId || !taskStatus) return (
            <div className="bg-[var(--color-base)] rounded-lg p-4 border border-[var(--color-border)] min-h-[100px] flex items-center justify-center text-[var(--color-text-muted)] text-sm">
                Task status will appear here...
            </div>
        );
        return (
            <div className="bg-[var(--color-base)] rounded-lg p-4 border border-[var(--color-border)] min-h-[100px] flex flex-col items-center justify-center text-sm gap-2">
                {taskStatus.status === "in_progress" || taskStatus.status === "queued" ? (
                    <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent)]" />
                ) : taskStatus.status === "complete" ? (
                    <CheckCircle2 className="w-8 h-8 text-green-500" />
                ) : (
                    <XCircle className="w-8 h-8 text-red-500" />
                )}
                <div className="font-mono text-xs text-[var(--color-text-muted)]">Task ID: {uploadTaskId}</div>
                <div className="font-bold">{taskStatus.status.toUpperCase()}</div>
            </div>
        );
    };

    return (
        <div className="space-y-8">
            {isNextDay && (
                <WarningBanner
                    level="warning"
                    title="영상 업로드 마감 경고"
                    message="오늘은 세션 다음 날입니다. 자정 전까지 영상 업로드를 완료해주세요."
                    icon={<AlertTriangle className="w-5 h-5 text-orange-400" />}
                />
            )}

            {/* Video Upload Panel */}
            <div className="bg-[var(--color-surface)] p-6 rounded-xl border border-[var(--color-border)]">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h3 className="font-bold text-lg mb-1">Video Upload</h3>
                        <p className="text-sm text-[var(--color-text-secondary)]">
                            구글 드라이브 영상을 다운로드하여 네이버 카페에 업로드합니다.
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            onClick={() => fetchDriveVideos(session.id)}
                            disabled={isLoadingDrive}
                            className="border-[var(--color-border)] hover:bg-white/5"
                        >
                            {isLoadingDrive
                                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                : <Film className="w-4 h-4 mr-2" />}
                            드라이브 확인
                        </Button>
                        <Button onClick={handleCafeUpload} disabled={isUploading} className="bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]">
                            <UploadCloud className="w-4 h-4 mr-2" />
                            {isUploading ? "Starting..." : "업로드 시작"}
                        </Button>
                    </div>
                </div>

                {/* Drive Video List */}
                {driveVideos !== undefined && (
                    <div className="mb-4 rounded-lg border border-[var(--color-border)] overflow-hidden">
                        <div className="flex items-center gap-2 px-4 py-2 bg-gray-900/40 border-b border-[var(--color-border)]">
                            <Film className="w-4 h-4 text-[var(--color-accent)]" />
                            <span className="text-sm font-medium">드라이브 영상 목록</span>
                            <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/20">
                                총 {driveVideos.length}개
                            </span>
                        </div>
                        {driveVideos.length === 0 ? (
                            <div className="py-8 text-center text-sm text-[var(--color-text-muted)]">
                                드라이브에 영상이 없습니다.
                            </div>
                        ) : (
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)] text-xs">
                                        <th className="text-left px-4 py-2 w-[60px]">순서</th>
                                        <th className="text-left px-4 py-2">파일명</th>
                                        <th className="text-left px-4 py-2 w-[120px]">발표자</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[var(--color-border)]">
                                    {[...driveVideos]
                                        .sort((a, b) => a.order - b.order)
                                        .map((v) => (
                                            <tr key={v.id} className="hover:bg-white/5">
                                                <td className="px-4 py-2 font-mono text-[var(--color-text-muted)] text-xs">
                                                    {v.order === 9999 ? "-" : `${v.order}번째`}
                                                </td>
                                                <td className="px-4 py-2 text-gray-300 font-mono text-xs truncate max-w-[300px]" title={v.name}>
                                                    {v.name}
                                                </td>
                                                <td className="px-4 py-2 font-medium text-gray-200">{v.presenter}</td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}

                {renderTaskStatus()}
            </div>

            {/* Feedback Target Designation Panel */}
            {session.config?.has_feedback !== false && feedbackAssignments.length > 0 && (
                <div className="bg-[var(--color-surface)] p-6 rounded-xl border border-[var(--color-border)]">
                    <div className="flex items-start justify-between mb-6">
                        <div>
                            <h3 className="font-bold text-lg mb-1 flex items-center gap-2">
                                <Users className="w-5 h-5 text-[var(--color-accent)]" />
                                피드백 대상 지정
                            </h3>
                            <p className="text-sm text-[var(--color-text-secondary)]">
                                각 멤버가 피드백을 작성할 대상을 지정합니다. 본인 영상은 크롤러에서 기본 포함됩니다.
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-4">
                        {/* Left: Assignment table */}
                        <div className="rounded-md border border-[var(--color-border)] overflow-hidden">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-gray-900/50 hover:bg-gray-900/50">
                                        <TableHead className="w-[140px]">피드백 작성자</TableHead>
                                        <TableHead>피드백 대상 (추가 지정)</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {feedbackAssignments.map((assignment) => {
                                        const writerId = assignment.member_id;
                                        const writerName = writerId != null
                                            ? (memberNameMap.get(writerId) ?? `ID:${writerId}`)
                                            : "Unknown";
                                        const currentTargetIds = assignment.target_member_ids ?? [];

                                        return (
                                            <FeedbackTargetRow
                                                key={assignment.id}
                                                writerName={writerName}
                                                writerId={writerId}
                                                currentTargetIds={currentTargetIds}
                                                sessionMemberIds={sessionMemberIds}
                                                memberNameMap={memberNameMap}
                                                disabled={isSettingTarget}
                                                onSetTargets={(targetIds) => {
                                                    if (writerId == null) return;
                                                    setFeedbackTargets({
                                                        sessionId: session.id,
                                                        memberId: writerId,
                                                        targetMemberIds: targetIds,
                                                    });
                                                }}
                                            />
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>

                        {/* Right: Receiver status panel */}
                        <div className="rounded-md border border-[var(--color-border)] overflow-hidden">
                            <div className="bg-gray-900/50 px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider border-b border-[var(--color-border)]">
                                피드백 수신 현황
                            </div>
                            <div className="divide-y divide-[var(--color-border)]">
                                {sessionMemberIds.map((id) => {
                                    const count = receiverCountMap.get(id) ?? 0;
                                    const name = memberNameMap.get(id) ?? `ID:${id}`;
                                    const isUnassigned = count === 0;
                                    return (
                                        <div key={id} className={`flex items-center justify-between px-3 py-2 text-sm ${isUnassigned ? "bg-rose-500/5" : ""}`}>
                                            <span className={isUnassigned ? "text-rose-400" : "text-[var(--color-text-primary)]"}>
                                                {name}
                                            </span>
                                            <span className={`text-xs font-mono px-1.5 py-0.5 rounded border ${isUnassigned
                                                ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                                                : "bg-green-500/10 text-green-400 border-green-500/20"
                                            }`}>
                                                {count}명
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

interface FeedbackTargetRowProps {
    writerName: string;
    writerId: number | null;
    currentTargetIds: number[];
    sessionMemberIds: number[];
    memberNameMap: Map<number, string>;
    disabled: boolean;
    onSetTargets: (targetIds: number[]) => void;
}

function FeedbackTargetRow({
    writerName,
    writerId,
    currentTargetIds,
    sessionMemberIds,
    memberNameMap,
    disabled,
    onSetTargets,
}: FeedbackTargetRowProps) {
    const [open, setOpen] = useState(false);

    // Options exclude self and already-selected targets
    const addableOptions = sessionMemberIds
        .filter((id) => id !== writerId && !currentTargetIds.includes(id))
        .map((id) => ({ id, name: memberNameMap.get(id) ?? `ID:${id}` }));

    const handleAdd = (id: number) => {
        onSetTargets([...currentTargetIds, id]);
        setOpen(false);
    };

    const handleRemove = (id: number) => {
        onSetTargets(currentTargetIds.filter((t) => t !== id));
    };

    return (
        <TableRow className="hover:bg-white/5 align-top">
            <TableCell className="font-medium text-gray-300 pt-3">{writerName}</TableCell>
            <TableCell>
                <div className="flex flex-wrap items-center gap-1.5 min-h-[32px]">
                    {/* Current target badges */}
                    {currentTargetIds.map((tid) => (
                        <span
                            key={tid}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/20"
                        >
                            {memberNameMap.get(tid) ?? `ID:${tid}`}
                            <button
                                type="button"
                                onClick={() => handleRemove(tid)}
                                disabled={disabled}
                                className="ml-0.5 hover:text-white disabled:opacity-50 transition-colors"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </span>
                    ))}

                    {/* Add button combobox */}
                    {addableOptions.length > 0 && (
                        <Popover open={open} onOpenChange={setOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={disabled}
                                    className="h-6 px-2 text-xs border-dashed border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-white/5 hover:border-[var(--color-border)]"
                                >
                                    <Plus className="w-3 h-3 mr-1" />
                                    추가
                                    <ChevronsUpDown className="w-3 h-3 ml-1 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[200px] p-0 bg-[var(--color-elevated)] border-[var(--color-border)]">
                                <Command className="bg-transparent">
                                    <CommandInput placeholder="이름 검색..." className="h-8 text-sm" />
                                    <CommandList>
                                        <CommandEmpty className="text-[var(--color-text-muted)]">검색 결과 없음</CommandEmpty>
                                        <CommandGroup>
                                            {addableOptions.map((opt) => (
                                                <CommandItem
                                                    key={opt.id}
                                                    value={opt.name}
                                                    onSelect={() => handleAdd(opt.id)}
                                                    className="text-sm"
                                                >
                                                    <Check className={cn("mr-2 h-3 w-3 opacity-0")} />
                                                    {opt.name}
                                                </CommandItem>
                                            ))}
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                            </PopoverContent>
                        </Popover>
                    )}

                    {currentTargetIds.length === 0 && addableOptions.length === 0 && (
                        <span className="text-xs text-[var(--color-text-muted)]">미지정</span>
                    )}
                </div>
            </TableCell>
        </TableRow>
    );
}
