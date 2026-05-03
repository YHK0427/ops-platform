import { useOutletContext } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { UploadCloud, AlertTriangle, Users, Shuffle, RotateCcw, StopCircle, ClipboardCopy } from "lucide-react";
import { WarningBanner } from "@/components/WarningBanner";
import { toast } from "sonner";
import { useSetFeedbackTargets, useRandomAssignFeedback, useActiveUploadTask, useUpdateSessionConfig, useCancelUpload, useUploadResult } from "@/hooks";
import { useMembers } from "@/hooks/useMembers";
import { useState, useMemo, useEffect } from "react";
import { Loader2, CheckCircle2, XCircle, UserMinus } from "lucide-react";
import type { Session } from "@/hooks/useSessions";
import { useSessionTask } from "@/hooks/useSessionTask";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { VideoUploadPanel } from "@/components/VideoUploadPanel";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

export default function OpsTab() {
    const { session } = useOutletContext<{ session: Session }>();

    const { taskId: uploadTaskId, setTaskId: setUploadTaskId, taskStatus } = useSessionTask(session.id, "video-upload");
    const { mutate: setFeedbackTargets, isPending: isSettingTarget } = useSetFeedbackTargets();
    const { mutate: randomAssign, isPending: isRandomAssigning } = useRandomAssignFeedback();
    const { mutate: updateConfig } = useUpdateSessionConfig();
    const { data: allMembers } = useMembers();
    const { data: activeTask } = useActiveUploadTask(session.id);
    const { mutate: cancelUpload, isPending: isCancelling } = useCancelUpload();
    const { refetch: refetchResult } = useUploadResult(session.id);

    // Auto-discover active upload task from other admins
    useEffect(() => {
        if (!uploadTaskId && activeTask?.task_id && activeTask.status && ["queued", "in_progress"].includes(activeTask.status)) {
            setUploadTaskId(activeTask.task_id);
        }
    }, [activeTask, uploadTaskId]);

    // 태스크 완료 시 이전 결과 갱신
    useEffect(() => {
        if (taskStatus?.status === "complete" || taskStatus?.status === "failed") {
            refetchResult();
        }
    }, [taskStatus?.status]);

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

    const [hoveredPresenterId, setHoveredPresenterId] = useState<number | null>(null);
    const feedbackAssignments = session.assignments?.filter((a) => a.type === "FEEDBACK") ?? [];
    const sessionMemberIds = session.attendances?.map((a) => a.member_id) ?? [];

    // 결석/공결 멤버 ID
    const absentMemberIds = useMemo(() => {
        return new Set(
            (session.attendances ?? [])
                .filter((a) => a.status === "ABSENT" || a.status === "EXCUSED")
                .map((a) => a.member_id)
        );
    }, [session.attendances]);

    // 분반 맵 (has_groups일 때만 사용)
    const memberGroupMap = useMemo(() => {
        if (!session.config?.has_groups) return undefined;
        const map = new Map<number, number | null>();
        (session.attendances ?? []).forEach((a: any) => {
            map.set(a.member_id, a.group_num ?? null);
        });
        return map;
    }, [session.attendances, session.config?.has_groups]);

    // 발표자 (피드백 수신 가능) 목록 — config에 저장, 없으면 출석 멤버 기본값
    const presenterIds: number[] = useMemo(() => {
        const saved = session.config?.feedback_presenters as number[] | undefined;
        if (saved && saved.length > 0) return saved;
        // 기본값: 결석/공결 제외
        return sessionMemberIds.filter((id) => !absentMemberIds.has(id));
    }, [session.config?.feedback_presenters, sessionMemberIds, absentMemberIds]);

    const presenterIdSet = useMemo(() => new Set(presenterIds), [presenterIds]);

    // 발표자 목록 저장
    const savePresenters = useCallback((newIds: number[]) => {
        updateConfig({ sessionId: session.id, config: { feedback_presenters: newIds } });
    }, [updateConfig, session.id]);

    // 발표자 추가 (자기 자신 피드백은 크롤러가 자동 포함하므로 여기서 지정하지 않음)
    const addPresenter = useCallback((memberId: number) => {
        savePresenters([...presenterIds, memberId]);
    }, [presenterIds, savePresenters]);

    const removePresenter = useCallback((memberId: number) => {
        savePresenters(presenterIds.filter((id) => id !== memberId));
    }, [presenterIds, savePresenters]);

    // Receiver map: memberId → number of writers pointing to them (발표자만)
    const receiverCountMap = useMemo(() => {
        const map = new Map<number, number>();
        presenterIds.forEach(id => map.set(id, 0));
        feedbackAssignments.forEach((a) => {
            a.target_member_ids?.forEach((tid) => {
                if (presenterIdSet.has(tid)) {
                    map.set(tid, (map.get(tid) ?? 0) + 1);
                }
            });
        });
        return map;
    }, [feedbackAssignments, presenterIds, presenterIdSet]);

    // 랜덤 배정: 백엔드 벌크 API 호출
    const handleRandomAssign = useCallback(() => {
        randomAssign({ sessionId: session.id, extraCountNormal: 1, extraCountAbsent: 2 });
    }, [randomAssign, session.id]);

    // 초기화: 벌크 API에 0/0으로 호출 → 전원 빈 배열
    const handleResetAssign = useCallback(() => {
        randomAssign({ sessionId: session.id, extraCountNormal: 0, extraCountAbsent: 0 });
    }, [randomAssign, session.id]);

    // 피드백 배정 → 가나다순 클립보드 복사 (Notion 표 붙여넣기 호환)
    const handleCopyAssignments = useCallback(async () => {
        const writerRows = feedbackAssignments
            .filter(a => a.member_id != null)
            .map(a => {
                const writerName = memberNameMap.get(a.member_id!) ?? "";
                const targetNames = (a.target_member_ids ?? [])
                    .map(tid => memberNameMap.get(tid) ?? "")
                    .filter(n => n)
                    .sort((x, y) => x.localeCompare(y, "ko"));
                return { writerName, targetNames };
            })
            .sort((a, b) => a.writerName.localeCompare(b.writerName, "ko"));

        if (writerRows.length === 0) {
            toast.error("복사할 피드백 배정이 없습니다.");
            return;
        }

        // text/plain: 줄바꿈 구분 (각 줄 = 한 셀)
        const plain = writerRows.map(({ targetNames }) => targetNames.join(", ")).join("\n");

        // text/html: 한 열짜리 표 → Notion/Sheets에서 표에 붙여넣으면 셀마다 분배됨
        const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const html =
            `<meta charset="utf-8"><table><tbody>` +
            writerRows.map(({ targetNames }) =>
                `<tr><td>${escape(targetNames.join(", "))}</td></tr>`
            ).join("") +
            `</tbody></table>`;

        try {
            if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
                const item = new ClipboardItem({
                    "text/html": new Blob([html], { type: "text/html" }),
                    "text/plain": new Blob([plain], { type: "text/plain" }),
                });
                await navigator.clipboard.write([item]);
            } else {
                await navigator.clipboard.writeText(plain);
            }
            toast.success(`${writerRows.length}명의 피드백 대상이 복사되었습니다.`);
        } catch {
            toast.error("클립보드 복사 실패");
        }
    }, [feedbackAssignments, memberNameMap]);


    const handleCancelUpload = () => {
        cancelUpload({ sessionId: session.id }, {
            onSuccess: () => toast.info("업로드를 중단하고 있습니다..."),
            onError: () => toast.error("중단 요청 실패"),
        });
    };

    const renderTaskStatus = () => {
        if (!uploadTaskId || !taskStatus) return null;

        const isActive = taskStatus.status === "in_progress" || taskStatus.status === "queued";
        const progress = taskStatus.progress;
        const result = taskStatus.result;

        return (
            <div className="bg-[var(--color-base)] rounded-lg border border-[var(--color-border)] overflow-hidden">
                {/* Header */}
                <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
                    {isActive ? (
                        <Loader2 className="w-4 h-4 animate-spin text-[var(--color-accent)]" />
                    ) : taskStatus.status === "complete" ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                    ) : (
                        <XCircle className="w-4 h-4 text-red-500" />
                    )}
                    <span className="text-sm font-medium">
                        {isActive ? "업로드 진행 중..." : taskStatus.status === "complete" ? "업로드 완료" : "업로드 실패"}
                    </span>
                    <span className="ml-auto flex items-center gap-2">
                        <span className="text-xs text-[var(--color-text-muted)]">
                            {uploadTaskId.slice(0, 8)}
                        </span>
                        {isActive && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleCancelUpload}
                                disabled={isCancelling}
                                className="h-6 px-2 text-xs border-red-300 text-red-500 hover:bg-red-50 hover:text-red-600"
                            >
                                <StopCircle className="w-3 h-3 mr-1" />
                                {isCancelling ? "중단 중..." : "중단"}
                            </Button>
                        )}
                    </span>
                </div>

                {/* Per-video progress */}
                {progress && progress.length > 0 && (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-[var(--color-text-muted)] text-xs border-b border-[var(--color-border)]">
                                <th className="text-left px-4 py-1.5 w-[50px]">순서</th>
                                <th className="text-left px-4 py-1.5">발표자</th>
                                <th className="text-right px-4 py-1.5 w-[80px]">용량</th>
                                <th className="text-left px-4 py-1.5 w-[120px]">상태</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--color-border)]">
                            {progress.map((item: any, idx: number) => (
                                <tr key={idx} className="hover:bg-gray-50">
                                    <td className="px-4 py-1.5 text-xs tabular-nums text-[var(--color-text-muted)]">
                                        {item.order === 9999 ? "-" : item.order}
                                    </td>
                                    <td className="px-4 py-1.5 text-[var(--color-text-secondary)] text-xs">{item.presenter}</td>
                                    <td className="px-4 py-1.5 text-right text-xs tabular-nums text-[var(--color-text-muted)]">
                                        {item.size_mb ? `${item.size_mb} MB` : "-"}
                                    </td>
                                    <td className="px-4 py-1.5">
                                        <VideoStatusBadge status={item.status} error={item.error} />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}

                {/* Final result summary */}
                {taskStatus.status === "complete" && result && Array.isArray(result) && (
                    <div className="px-4 py-2.5 border-t border-[var(--color-border)] text-xs">
                        <span className="text-green-600">{result.filter((r: any) => r.success).length}</span>
                        <span className="text-[var(--color-text-muted)]">/{result.length} 업로드 성공</span>
                        {result.some((r: any) => !r.success) && (
                            <span className="text-rose-500 ml-2">
                                ({result.filter((r: any) => !r.success).length}건 실패)
                            </span>
                        )}
                    </div>
                )}

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
                    icon={<AlertTriangle className="w-5 h-5 text-orange-600" />}
                />
            )}


            {/* 영상 직접 업로드 Panel */}
            <div className="bg-[var(--color-surface)] p-6 rounded-xl border border-[var(--color-border)]">
                {(() => {
                    const isTeamSession = session.type === "TEAM";

                    // 팀 세션: 팀당 1개 슬롯 (첫 멤버 id를 파일 저장 앵커로 사용)
                    const teamPresenters = isTeamSession
                        ? [...(session.teams ?? [])]
                            .filter(t => (t.members?.length ?? 0) > 0)
                            .sort((a, b) => ((a as any).presenter_order ?? 999) - ((b as any).presenter_order ?? 999))
                            .map((t, idx) => {
                                const firstMember = t.members![0];
                                const memberNames = t.members!.map(m => m.name);
                                return {
                                    member_id: firstMember.id,
                                    member_name: t.name,
                                    sub_label: memberNames.join(", "),
                                    group_num: null,
                                    presenter_order: (t as any).presenter_order ?? idx + 1,
                                    member_names: memberNames,
                                };
                            })
                        : [];

                    const individualPresenters = !isTeamSession
                        ? (session.attendances ?? [])
                            .filter((a: any) => a.status !== "ABSENT" && a.status !== "EXCUSED")
                            .map((a: any) => ({
                                member_id: a.member_id,
                                member_name: memberNameMap.get(a.member_id) ?? `#${a.member_id}`,
                                group_num: a.group_num ?? null,
                                presenter_order: a.presenter_order ?? null,
                            }))
                        : [];

                    const absentForIndividual = !isTeamSession
                        ? (session.attendances ?? [])
                            .filter((a: any) => a.status === "ABSENT" || a.status === "EXCUSED")
                            .map((a: any) => ({
                                member_id: a.member_id,
                                member_name: memberNameMap.get(a.member_id) ?? `#${a.member_id}`,
                                status: a.status as "ABSENT" | "EXCUSED",
                            }))
                        : [];

                    return (
                        <VideoUploadPanel
                            sessionId={session.id}
                            sessionTitle={session.title}
                            weekNum={session.week_num}
                            presenters={isTeamSession ? teamPresenters : individualPresenters}
                            absentMembers={absentForIndividual}
                            hasGroups={!isTeamSession && !!session.config?.has_groups}
                            onNaverUploadStarted={(taskId) => setUploadTaskId(taskId)}
                            naverProgress={taskStatus?.progress ?? null}
                            naverStatus={taskStatus?.status ?? null}
                            naverResult={Array.isArray(taskStatus?.result) ? taskStatus.result : null}
                        />
                    );
                })()}
            </div>

            {/* 네이버 카페 업로드 진행 상태 (별도 섹션 — 어디서 시작했든 동일하게 표시) */}
            {uploadTaskId && (
                <div className="bg-[var(--color-surface)] p-4 md:p-6 rounded-xl border border-[var(--color-border)]">
                    <h3 className="font-bold text-base md:text-lg mb-3 flex items-center gap-2">
                        <UploadCloud className="w-4 h-4 text-[var(--color-accent)]" />
                        네이버 카페 업로드 진행 상태
                    </h3>
                    {renderTaskStatus()}
                </div>
            )}

            {/* Feedback Target Designation Panel */}
            {session.config?.has_feedback !== false && feedbackAssignments.length > 0 && (
                <div className="bg-[var(--color-surface)] p-3 md:p-4 rounded-xl border border-[var(--color-border)]">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-3">
                        <div>
                            <h3 className="font-bold text-sm mb-0.5 flex items-center gap-2">
                                <Users className="w-4 h-4 text-[var(--color-accent)]" />
                                피드백 대상 지정
                            </h3>
                            <p className="text-xs text-[var(--color-text-secondary)]">
                                각 멤버가 피드백을 작성할 대상을 지정합니다. 본인 영상은 기본 포함됩니다.
                            </p>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleResetAssign}
                                disabled={isSettingTarget || isRandomAssigning}
                                className="h-7 px-3 text-xs border-[var(--color-border)] hover:bg-gray-50 text-[var(--color-text-muted)] hover:text-rose-500"
                            >
                                <RotateCcw className="w-3.5 h-3.5 mr-1" />
                                초기화
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleCopyAssignments}
                                className="h-7 px-3 text-xs border-[var(--color-border)] hover:bg-gray-50"
                            >
                                <ClipboardCopy className="w-3.5 h-3.5 mr-1" />
                                복사
                            </Button>
                            <Button
                                size="sm"
                                onClick={handleRandomAssign}
                                disabled={isSettingTarget || isRandomAssigning}
                                className="h-7 px-3 text-xs bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]"
                            >
                                <Shuffle className="w-3.5 h-3.5 mr-1" />
                                랜덤 배정
                            </Button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
                        {/* Left: Assignment table */}
                        <div className="rounded-md border border-[var(--color-border)] overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-gray-50 hover:bg-gray-50">
                                        <TableHead className="w-[140px] md:w-[200px]">피드백 작성자</TableHead>
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
                                        const isAbsent = writerId != null && absentMemberIds.has(writerId);

                                        return (
                                            <FeedbackTargetRow
                                                key={assignment.id}
                                                writerName={writerName}
                                                writerId={writerId}
                                                currentTargetIds={currentTargetIds}
                                                sessionMemberIds={presenterIds}
                                                memberNameMap={memberNameMap}
                                                memberGroupMap={memberGroupMap}
                                                disabled={isSettingTarget}
                                                isAbsent={isAbsent}
                                                highlightTargetId={hoveredPresenterId}
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

                        {/* Right: Receiver status panel (editable presenter list) */}
                        <div className="rounded-md border border-[var(--color-border)] overflow-hidden">
                            <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider border-b border-[var(--color-border)]">
                                발표자 (피드백 수신)
                            </div>
                            <div className="divide-y divide-[var(--color-border)]">
                                {presenterIds.map((id) => {
                                    const count = receiverCountMap.get(id) ?? 0;
                                    const name = memberNameMap.get(id) ?? `ID:${id}`;
                                    const isUnassigned = count === 0;
                                    return (
                                        <div
                                            key={id}
                                            className={`flex items-center justify-between px-3 py-1.5 text-xs cursor-default transition-all duration-200 ${
                                                isUnassigned ? "bg-rose-500/5" : ""
                                            } ${hoveredPresenterId === id ? "bg-violet-500/10 shadow-sm" : ""}`}
                                            onMouseEnter={() => setHoveredPresenterId(id)}
                                            onMouseLeave={() => setHoveredPresenterId(null)}
                                        >
                                            <span className={`flex items-center gap-1 whitespace-nowrap ${
                                                hoveredPresenterId === id
                                                    ? "text-violet-600 font-medium"
                                                    : isUnassigned ? "text-rose-500" : "text-[var(--color-text-primary)]"
                                            }`}>
                                                {name}
                                                {memberGroupMap && <GroupBadge groupNum={memberGroupMap.get(id)} />}
                                            </span>
                                            <div className="flex items-center gap-1.5">
                                                <span className={`tabular-nums px-1.5 py-0.5 rounded border ${isUnassigned
                                                    ? "bg-rose-500/10 text-rose-500 border-rose-500/20"
                                                    : "bg-green-500/10 text-green-600 border-green-500/20"
                                                }`}>
                                                    {count}명
                                                </span>
                                                <button
                                                    onClick={() => removePresenter(id)}
                                                    className="text-[var(--color-text-muted)] hover:text-rose-500 transition-colors"
                                                    title="발표자에서 제거"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            {/* Add presenter */}
                            <PresenterAddButton
                                sessionMemberIds={sessionMemberIds}
                                presenterIdSet={presenterIdSet}
                                memberNameMap={memberNameMap}
                                absentMemberIds={absentMemberIds}
                                onAdd={addPresenter}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function VideoStatusBadge({ status, error }: { status: VideoProgress["status"]; error?: string | null }) {
    const config: Record<string, { label: string; className: string; icon?: React.ReactNode }> = {
        pending:     { label: "대기",       className: "bg-gray-100 text-gray-500 border-gray-200" },
        downloading: { label: "다운로드 중", className: "bg-blue-500/10 text-blue-600 border-blue-500/20", icon: <Download className="w-3 h-3 animate-pulse" /> },
        uploading:   { label: "업로드 중",   className: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20", icon: <Upload className="w-3 h-3 animate-pulse" /> },
        done:        { label: "완료",       className: "bg-green-500/10 text-green-600 border-green-500/20", icon: <CheckCircle2 className="w-3 h-3" /> },
        failed:      { label: "실패",       className: "bg-red-500/10 text-red-500 border-red-500/20", icon: <XCircle className="w-3 h-3" /> },
        cancelled:   { label: "취소",       className: "bg-orange-500/10 text-orange-500 border-orange-500/20", icon: <StopCircle className="w-3 h-3" /> },
    };
    const c = config[status] ?? config.pending;
    return (
        <span
            className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border ${c.className}`}
            title={error ?? undefined}
        >
            {c.icon}
            {c.label}
        </span>
    );
}

interface FeedbackTargetRowProps {
    writerName: string;
    writerId: number | null;
    currentTargetIds: number[];
    sessionMemberIds: number[];
    memberNameMap: Map<number, string>;
    memberGroupMap?: Map<number, number | null>;
    disabled: boolean;
    isAbsent?: boolean;
    highlightTargetId?: number | null;
    onSetTargets: (targetIds: number[]) => void;
}

function GroupBadge({ groupNum }: { groupNum?: number | null }) {
    if (!groupNum) return null;
    const colors = groupNum === 1
        ? "bg-blue-500/10 text-blue-600 border-blue-500/20"
        : "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
    return (
        <span className={`text-[10px] px-1 rounded border font-medium ${colors}`}>
            {groupNum}분반
        </span>
    );
}

function FeedbackTargetRow({
    writerName,
    writerId,
    currentTargetIds,
    sessionMemberIds,
    memberNameMap,
    memberGroupMap,
    disabled,
    isAbsent,
    highlightTargetId,
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

    const isRowHighlighted = highlightTargetId != null && currentTargetIds.includes(highlightTargetId);

    return (
        <TableRow className={cn(
            "align-top transition-all duration-200",
            isRowHighlighted
                ? "bg-violet-500/10 shadow-sm"
                : "hover:bg-gray-50",
            isAbsent && !isRowHighlighted && "bg-rose-500/5",
        )}>
            <TableCell className="font-medium py-1.5 text-sm whitespace-nowrap">
                <div className="flex items-center gap-1.5">
                    <span className={isRowHighlighted ? "text-violet-500" : isAbsent ? "text-rose-500" : "text-[var(--color-text-secondary)]"}>{writerName}</span>
                    {memberGroupMap && writerId != null && <GroupBadge groupNum={memberGroupMap.get(writerId)} />}
                    {isAbsent && (
                        <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-medium bg-rose-500/10 text-rose-500 border border-rose-500/20">
                            <UserMinus className="w-2.5 h-2.5" />
                            결석 · 2개
                        </span>
                    )}
                </div>
            </TableCell>
            <TableCell className="py-1.5">
                <div className="flex flex-wrap items-center gap-1 min-h-[24px]">
                    {/* Current target badges */}
                    {currentTargetIds.map((tid) => {
                        const isHighlighted = highlightTargetId === tid;
                        return (
                        <span
                            key={tid}
                            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium transition-all duration-200 ${
                                isHighlighted
                                    ? "bg-violet-500/25 text-violet-600 border border-violet-400/50 shadow-sm scale-105"
                                    : "bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/20"
                            }`}
                        >
                            {memberNameMap.get(tid) ?? `ID:${tid}`}
                            {memberGroupMap && <GroupBadge groupNum={memberGroupMap.get(tid)} />}
                            <button
                                type="button"
                                onClick={() => handleRemove(tid)}
                                disabled={disabled}
                                className="ml-0.5 hover:text-[var(--color-text-primary)] disabled:opacity-50 transition-colors"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </span>
                        );
                    })}

                    {/* Add button combobox */}
                    {addableOptions.length > 0 && (
                        <Popover open={open} onOpenChange={setOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={disabled}
                                    className="h-6 px-2 text-xs border-dashed border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-gray-50 hover:border-[var(--color-border)]"
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

function PresenterAddButton({
    sessionMemberIds,
    presenterIdSet,
    memberNameMap,
    absentMemberIds,
    onAdd,
}: {
    sessionMemberIds: number[];
    presenterIdSet: Set<number>;
    memberNameMap: Map<number, string>;
    absentMemberIds: Set<number>;
    onAdd: (id: number) => void;
}) {
    const [open, setOpen] = useState(false);
    const addable = sessionMemberIds
        .filter((id) => !presenterIdSet.has(id))
        .map((id) => ({
            id,
            name: memberNameMap.get(id) ?? `ID:${id}`,
            isAbsent: absentMemberIds.has(id),
        }));

    if (addable.length === 0) return null;

    return (
        <div className="px-3 py-2 border-t border-[var(--color-border)]">
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        size="sm"
                        className="w-full h-7 text-xs border-dashed border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-gray-50"
                    >
                        <Plus className="w-3 h-3 mr-1" />
                        발표자 추가
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[200px] p-0 bg-[var(--color-elevated)] border-[var(--color-border)]">
                    <Command className="bg-transparent">
                        <CommandInput placeholder="이름 검색..." className="h-8 text-sm" />
                        <CommandList>
                            <CommandEmpty className="text-[var(--color-text-muted)]">검색 결과 없음</CommandEmpty>
                            <CommandGroup>
                                {addable.map((opt) => (
                                    <CommandItem
                                        key={opt.id}
                                        value={opt.name}
                                        onSelect={() => { onAdd(opt.id); setOpen(false); }}
                                        className="text-sm"
                                    >
                                        <Check className={cn("mr-2 h-3 w-3 opacity-0")} />
                                        {opt.name}
                                        {opt.isAbsent && (
                                            <span className="ml-auto text-[10px] text-rose-500">결석</span>
                                        )}
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
        </div>
    );
}
