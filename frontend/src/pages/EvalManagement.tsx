import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
    Plus,
    Loader2,
    Trash2,
    LockOpen,
    Lock,
    Eye,
    EyeOff,
    ClipboardEdit,
    CheckCircle2,
    Circle,
    Copy,
    MessageSquareHeart,
    ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

import {
    useEvalRounds,
    useCreateRound,
    useUpdateRound,
    useDeleteRound,
    useEvalAssignments,
    useReplaceAudienceAssignments,
    useCopyAssignments,
    useMyAssignments,
    useEvalResults,
    useMemberResult,
    useEvalReflections,
    type EvalRound,
    type EvalAssignment,
    type MemberResultSummary,
} from "@/hooks/useEvaluation";
import { useSessions } from "@/hooks";
import { useAdminUsers } from "@/hooks";
import { useMembers } from "@/hooks";
import EvalResultCard from "@/components/eval/EvalResultCard";
import {
    EvalMatchingBoard,
    assignmentsToBoard,
} from "@/components/eval/EvalMatchingBoard";

// ── Tab definitions ──────────────────────────────────────────────────────────

type TabKey = "rounds" | "assignments" | "status" | "results";

const TABS: { key: TabKey; label: string; adminOnly?: boolean }[] = [
    { key: "rounds", label: "라운드 관리" },
    { key: "assignments", label: "배정 관리", adminOnly: true },
    { key: "status", label: "제출 현황", adminOnly: true },
    { key: "results", label: "결과 분석" },
];

const ROUND_TYPE_LABELS: Record<string, string> = {
    INITIAL: "초기",
    FINAL: "후기",
    COMBINED: "통합",
};

const ROUND_TYPE_COLORS: Record<string, string> = {
    INITIAL: "bg-blue-500/15 text-blue-600 border-blue-500/30",
    FINAL: "bg-purple-500/15 text-purple-600 border-purple-500/30",
    COMBINED: "bg-amber-500/15 text-amber-600 border-amber-500/30",
};

// ══════════════════════════════════════════════════════════════════════════════
// Main Component
// ══════════════════════════════════════════════════════════════════════════════

// ── My Audience Evals Banner ─────────────────────────────────────────────────

function MyAudienceEvalsBanner() {
    const navigate = useNavigate();
    const { data: rounds } = useEvalRounds();

    // Only show open rounds
    const openRounds = useMemo(() => rounds?.filter((r) => r.is_open) ?? [], [rounds]);

    if (!openRounds.length) return null;

    return (
        <div className="space-y-3">
            <h2 className="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider flex items-center gap-2">
                <ClipboardEdit className="w-4 h-4" />
                내 청중 평가
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
                {openRounds.map((round) => (
                    <MyRoundCard key={round.id} round={round} navigate={navigate} />
                ))}
            </div>
        </div>
    );
}

function MyRoundCard({ round, navigate }: { round: EvalRound; navigate: ReturnType<typeof useNavigate> }) {
    const { data: myAssignments } = useMyAssignments(round.id);

    const total = myAssignments?.length ?? 0;
    const submitted = myAssignments?.filter((a) => a.submitted).length ?? 0;
    const pending = total - submitted;

    if (total === 0) return null;

    return (
        <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
                "rounded-xl border p-4 flex items-center justify-between gap-3 cursor-pointer transition-all",
                pending > 0
                    ? "border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5 hover:bg-[var(--color-accent)]/10"
                    : "border-emerald-500/30 bg-emerald-500/5"
            )}
            onClick={() => navigate(`/eval/${round.id}/audience`)}
        >
            <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-sm text-[var(--color-text-primary)] truncate">{round.title}</h3>
                    <span className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border",
                        ROUND_TYPE_COLORS[round.round_type] ?? ""
                    )}>
                        {ROUND_TYPE_LABELS[round.round_type] ?? round.round_type}
                    </span>
                </div>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                    {pending > 0
                        ? `${pending}명 평가 남음 (${submitted}/${total} 완료)`
                        : `${total}명 모두 평가 완료`}
                </p>
            </div>
            <Button
                size="sm"
                className={cn(
                    "shrink-0",
                    pending > 0
                        ? "bg-[var(--color-accent)] hover:bg-[var(--color-accent)]/80 text-white"
                        : "bg-emerald-600 hover:bg-emerald-700 text-white"
                )}
            >
                <ClipboardEdit className="w-3.5 h-3.5 mr-1.5" />
                {pending > 0 ? "평가하기" : "확인하기"}
            </Button>
        </motion.div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// Main Component
// ══════════════════════════════════════════════════════════════════════════════

export default function EvalManagement() {
    const { user } = useAuth();
    // 평가 라운드 관리 권한 = admin 또는 회장단(백엔드 require_admin_or_chairman과 동일)
    const isAdmin = user?.role === "admin" || user?.department === "회장단";
    const [activeTab, setActiveTab] = useState<TabKey>("rounds");
    const [selectedRoundId, setSelectedRoundId] = useState<number | null>(null);

    const visibleTabs = useMemo(
        () => (isAdmin ? TABS : TABS.filter((t) => !t.adminOnly)),
        [isAdmin]
    );

    return (
        <div className="flex flex-col h-full">
            <PageHeader title="성장리포트" subtitle="발표 성장 평가 관리" />

            <div className="p-6 space-y-6">
                {/* My audience evals banner - visible to ALL ops users */}
                <MyAudienceEvalsBanner />

                {/* Tab buttons */}
                <div className="flex gap-2">
                    {visibleTabs.map((tab) => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            className={cn(
                                "relative px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                                activeTab === tab.key
                                    ? "text-[var(--color-text-primary)] bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/30"
                                    : "text-[var(--color-text-secondary)] bg-[var(--color-hover)] border border-[var(--color-border)] hover:bg-gray-100"
                            )}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Tab content */}
                <AnimatePresence mode="wait">
                    <motion.div
                        key={activeTab}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.15 }}
                    >
                        {activeTab === "rounds" && (
                            <RoundsTab
                                isAdmin={isAdmin}
                                selectedRoundId={selectedRoundId}
                                onSelectRound={(id) => {
                                    setSelectedRoundId(id);
                                    if (isAdmin) setActiveTab("assignments");
                                }}
                            />
                        )}
                        {activeTab === "assignments" && isAdmin && (
                            <AssignmentsTab
                                selectedRoundId={selectedRoundId}
                                onSelectRound={setSelectedRoundId}
                            />
                        )}
                        {activeTab === "status" && isAdmin && (
                            <SubmissionStatusTab
                                selectedRoundId={selectedRoundId}
                                onSelectRound={setSelectedRoundId}
                            />
                        )}
                        {activeTab === "results" && (
                            <ResultsTab
                                selectedRoundId={selectedRoundId}
                                onSelectRound={setSelectedRoundId}
                            />
                        )}
                    </motion.div>
                </AnimatePresence>
            </div>
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// Tab 1: Rounds
// ══════════════════════════════════════════════════════════════════════════════

function RoundsTab({
    isAdmin,
    onSelectRound,
}: {
    isAdmin: boolean;
    selectedRoundId: number | null;
    onSelectRound: (id: number) => void;
}) {
    const navigate = useNavigate();
    const { data: rounds, isLoading } = useEvalRounds();
    const [showCreate, setShowCreate] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<EvalRound | null>(null);

    const updateRound = useUpdateRound();
    const deleteRound = useDeleteRound();

    function getStatusLabel(round: EvalRound) {
        if (round.results_open) return "결과공개";
        if (round.is_open) return "접수중";
        if (round.closed_at) return "마감";
        return "준비중";
    }

    function getStatusColor(round: EvalRound) {
        if (round.results_open) return "bg-emerald-500/15 text-emerald-600 border-emerald-500/30";
        if (round.is_open) return "bg-blue-500/15 text-blue-600 border-blue-500/30";
        if (round.closed_at) return "bg-slate-500/15 text-slate-600 border-slate-500/30";
        return "bg-gray-50 text-[var(--color-text-muted)] border-[var(--color-border)]";
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                    평가 라운드 목록
                </h2>
                {isAdmin && (
                    <Button
                        size="sm"
                        className="bg-[var(--color-accent)] hover:bg-[var(--color-accent)]/80 text-white"
                        onClick={() => setShowCreate(true)}
                    >
                        <Plus className="w-4 h-4 mr-1.5" />
                        새 라운드
                    </Button>
                )}
            </div>

            {isLoading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-muted)]" />
                </div>
            ) : !rounds?.length ? (
                <div className="text-center py-12 text-[var(--color-text-muted)]">
                    아직 생성된 라운드가 없습니다.
                </div>
            ) : (
                <div className="grid gap-3">
                    {rounds.map((round) => (
                        <motion.div
                            key={round.id}
                            layout
                            className="rounded-xl border border-[var(--color-border)] bg-white backdrop-blur-md p-4"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="space-y-1.5 flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h3 className="font-semibold text-sm text-[var(--color-text-primary)]">
                                            {round.title}
                                        </h3>
                                        <span
                                            className={cn(
                                                "inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border",
                                                ROUND_TYPE_COLORS[round.round_type] ?? ""
                                            )}
                                        >
                                            {ROUND_TYPE_LABELS[round.round_type] ?? round.round_type}
                                        </span>
                                        <span
                                            className={cn(
                                                "inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border",
                                                getStatusColor(round)
                                            )}
                                        >
                                            {getStatusLabel(round)}
                                        </span>
                                    </div>
                                    <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-3 flex-wrap">
                                        <span>
                                            전체 배정: {round.total_assignments ?? 0}건
                                        </span>
                                        <span>
                                            제출: {round.submitted_count ?? 0}건
                                        </span>
                                        {round.created_at && (
                                            <span>
                                                생성: {new Date(round.created_at).toLocaleDateString("ko-KR")}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-1.5 shrink-0">
                                    {/* Admin: Open/close toggle */}
                                    {isAdmin && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8"
                                            title={round.is_open ? "접수 마감" : "접수 열기"}
                                            onClick={() =>
                                                updateRound.mutate({
                                                    roundId: round.id,
                                                    is_open: !round.is_open,
                                                })
                                            }
                                        >
                                            {round.is_open ? (
                                                <Lock className="w-3.5 h-3.5 text-yellow-600" />
                                            ) : (
                                                <LockOpen className="w-3.5 h-3.5 text-green-600" />
                                            )}
                                        </Button>
                                    )}

                                    {/* Admin: Results visibility toggle */}
                                    {isAdmin && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8"
                                            title={round.results_open ? "결과 비공개" : "결과 공개"}
                                            onClick={() =>
                                                updateRound.mutate({
                                                    roundId: round.id,
                                                    results_open: !round.results_open,
                                                })
                                            }
                                        >
                                            {round.results_open ? (
                                                <EyeOff className="w-3.5 h-3.5 text-emerald-600" />
                                            ) : (
                                                <Eye className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                                            )}
                                        </Button>
                                    )}

                                    {/* Audience eval — all users */}
                                    {round.is_open && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 text-xs text-[var(--color-accent)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
                                            onClick={() => navigate(`/eval/${round.id}/audience`)}
                                        >
                                            <ClipboardEdit className="w-3.5 h-3.5 mr-1" />
                                            청중 평가
                                        </Button>
                                    )}

                                    {/* Admin: View assignments */}
                                    {isAdmin && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                                            onClick={() => onSelectRound(round.id)}
                                        >
                                            배정 보기
                                        </Button>
                                    )}

                                    {/* Admin: Delete */}
                                    {isAdmin && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-rose-500/60 hover:text-rose-500"
                                            onClick={() => setDeleteTarget(round)}
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </div>
            )}

            {/* Create dialog — admin only */}
            {isAdmin && <CreateRoundDialog open={showCreate} onOpenChange={setShowCreate} />}

            {/* Delete confirmation — admin only */}
            {isAdmin && <AlertDialog
                open={!!deleteTarget}
                onOpenChange={(open) => !open && setDeleteTarget(null)}
            >
                <AlertDialogContent className="bg-white border-[var(--color-border)]">
                    <AlertDialogHeader>
                        <AlertDialogTitle>라운드 삭제</AlertDialogTitle>
                        <AlertDialogDescription>
                            "{deleteTarget?.title}" 라운드를 삭제합니다. 모든 배정과 응답이 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="border-[var(--color-border)]">
                            취소
                        </AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-rose-600 hover:bg-rose-700"
                            onClick={() => {
                                if (deleteTarget) {
                                    deleteRound.mutate(deleteTarget.id);
                                    setDeleteTarget(null);
                                }
                            }}
                        >
                            삭제
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>}
        </div>
    );
}

// ── Create Round Dialog ──────────────────────────────────────────────────────

function CreateRoundDialog({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { data: sessions } = useSessions();
    const { data: users } = useAdminUsers();
    const { data: membersData } = useMembers(true);
    const { data: rounds } = useEvalRounds();
    const createRound = useCreateRound();
    const replaceAssignments = useReplaceAudienceAssignments();

    const [step, setStep] = useState<1 | 2>(1);
    const [sessionId, setSessionId] = useState<string>("");
    const [roundType, setRoundType] = useState<string>("INITIAL");
    const [title, setTitle] = useState("");
    const [isCreating, setIsCreating] = useState(false);

    // 가장 최근 라운드의 배정을 가져와서 보드 프리로드
    const latestRoundId = useMemo(
        () => (rounds && rounds.length > 0 ? rounds[0].id : null),
        [rounds]
    );
    const { data: prevAssignments } = useEvalAssignments(latestRoundId ?? 0);

    // 분반 데이터 (세션 연결 시)
    const numericSessionId = sessionId && sessionId !== "none" ? Number(sessionId) : null;
    const { data: groupData } = useQuery({
        queryKey: ["sessions", numericSessionId, "groups"],
        queryFn: async () => {
            const { data } = await api.get(`/sessions/${numericSessionId}/groups`);
            return data as {
                groups: Record<string, { member_id: number; group_num: number | null }[]>;
                staff_groups: Record<string, { user_id: number }[]>;
            };
        },
        enabled: !!numericSessionId,
    });

    const { memberGroupMap, userGroupMap } = useMemo(() => {
        if (!groupData) return { memberGroupMap: undefined, userGroupMap: undefined };
        const mgm = new Map<number, number | null>();
        for (const [gk, arr] of Object.entries(groupData.groups)) {
            const gn = gk === "1" ? 1 : gk === "2" ? 2 : null;
            for (const m of arr) mgm.set(m.member_id, gn);
        }
        const ugm = new Map<number, number | null>();
        for (const [gk, arr] of Object.entries(groupData.staff_groups)) {
            const gn = gk === "1" ? 1 : gk === "2" ? 2 : null;
            for (const s of arr) ugm.set(s.user_id, gn);
        }
        return { memberGroupMap: mgm.size > 0 ? mgm : undefined, userGroupMap: ugm.size > 0 ? ugm : undefined };
    }, [groupData]);

    const activeUsers = useMemo(
        () =>
            (users?.filter((u) => u.is_active) ?? []).map((u) => ({
                id: u.id,
                display_name: u.display_name,
                username: u.username,
            })),
        [users]
    );
    const matchingMembers = useMemo(
        () => (membersData ?? []).map((m) => ({ id: m.id, name: m.name })),
        [membersData]
    );
    const initialBoard = useMemo(() => {
        // 이전 라운드 배정이 있으면 프리로드
        if (prevAssignments && prevAssignments.length > 0) {
            return assignmentsToBoard(
                prevAssignments,
                activeUsers.map((u) => u.id),
                matchingMembers.map((m) => m.id)
            );
        }
        // 없으면 빈 보드
        const b: Record<string, number[]> = {};
        for (const u of activeUsers) b[String(u.id)] = [];
        return b;
    }, [activeUsers, matchingMembers, prevAssignments]);

    function handleClose() {
        onOpenChange(false);
        setStep(1);
        setSessionId("");
        setTitle("");
        setRoundType("INITIAL");
    }

    function handleNext() {
        if (!title.trim()) {
            toast.error("제목을 입력해주세요.");
            return;
        }
        setStep(2);
    }

    async function handleCreate(
        assignments: { evaluator_user_id: number; presenter_member_id: number }[]
    ) {
        setIsCreating(true);
        try {
            const round = await createRound.mutateAsync({
                session_id: sessionId && sessionId !== "none" ? Number(sessionId) : null,
                round_type: roundType,
                title: title.trim(),
            });
            // 보드에 있는 배정으로 덮어쓰기 (auto-copy 결과 대체)
            await replaceAssignments.mutateAsync({
                roundId: round.id,
                assignments,
            });
            handleClose();
        } catch {
            // errors handled by mutation onError
        } finally {
            setIsCreating(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else onOpenChange(v); }}>
            <DialogContent
                className={cn(
                    "bg-white border-[var(--color-border)]",
                    step === 2 && "max-w-6xl w-[95vw] h-[85vh] flex flex-col"
                )}
            >
                {step === 1 ? (
                    <>
                        <DialogHeader>
                            <DialogTitle>새 평가 라운드</DialogTitle>
                            <DialogDescription>
                                평가 라운드를 생성합니다. 활성 멤버 전원에게 자기평가가 자동 배정됩니다.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-4 py-2">
                            <div className="space-y-2">
                                <Label>라운드 유형</Label>
                                <Select value={roundType} onValueChange={setRoundType}>
                                    <SelectTrigger className="bg-[var(--color-surface)] border-[var(--color-border)]">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="INITIAL">초기 평가</SelectItem>
                                        <SelectItem value="FINAL">후기 평가</SelectItem>
                                        <SelectItem value="COMBINED">통합 평가</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label>제목</Label>
                                <Input
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder="예: 33기 초기 발표 평가"
                                    className="bg-[var(--color-surface)] border-[var(--color-border)]"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label className="text-[var(--color-text-muted)]">
                                    연결 세션 (선택)
                                </Label>
                                <Select value={sessionId} onValueChange={setSessionId}>
                                    <SelectTrigger className="bg-[var(--color-surface)] border-[var(--color-border)]">
                                        <SelectValue placeholder="세션 없음" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">세션 없음</SelectItem>
                                        {sessions?.map((s) => (
                                            <SelectItem key={s.id} value={String(s.id)}>
                                                {s.title} ({s.date})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <DialogFooter>
                            <Button
                                variant="outline"
                                onClick={handleClose}
                                className="border-[var(--color-border)]"
                            >
                                취소
                            </Button>
                            <Button
                                onClick={handleNext}
                                className="bg-[var(--color-accent)] hover:bg-[var(--color-accent)]/80 text-white"
                            >
                                다음
                            </Button>
                        </DialogFooter>
                    </>
                ) : (
                    <>
                        <DialogHeader>
                            <DialogTitle>청중 평가 배정 — {title}</DialogTitle>
                            <DialogDescription>
                                운영진별로 평가할 기수를 배정하세요. 드래그하여 이동하거나 자동 배정을 사용할 수 있습니다.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="flex-1 overflow-hidden min-h-0">
                            <EvalMatchingBoard
                                users={activeUsers}
                                members={matchingMembers}
                                initialBoard={initialBoard}
                                onSave={handleCreate}
                                onCancel={() => setStep(1)}
                                isSaving={isCreating}
                                saveLabel="생성"
                                cancelLabel="이전"
                                memberGroupMap={memberGroupMap}
                                userGroupMap={userGroupMap}
                            />
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// Tab 2: Assignments
// ══════════════════════════════════════════════════════════════════════════════

function AssignmentsTab({
    selectedRoundId,
    onSelectRound,
}: {
    selectedRoundId: number | null;
    onSelectRound: (id: number | null) => void;
}) {
    const navigate = useNavigate();
    const { data: rounds } = useEvalRounds();
    const { data: assignments, isLoading } = useEvalAssignments(selectedRoundId ?? 0);
    const { data: users } = useAdminUsers();
    const { data: membersData } = useMembers(true);

    const replaceAssignments = useReplaceAudienceAssignments();
    const copyAssignments = useCopyAssignments();

    // 현재 라운드 외 다른 라운드 목록 (복사 소스용)
    const otherRounds = useMemo(
        () => (rounds ?? []).filter((r) => r.id !== selectedRoundId),
        [rounds, selectedRoundId]
    );

    const activeUsers = useMemo(
        () =>
            (users?.filter((u) => u.is_active) ?? []).map((u) => ({
                id: u.id,
                display_name: u.display_name,
                username: u.username,
            })),
        [users]
    );
    const matchingMembers = useMemo(
        () => (membersData ?? []).map((m) => ({ id: m.id, name: m.name })),
        [membersData]
    );

    // Build board from existing assignments
    const board = useMemo(() => {
        if (!users || !membersData || !assignments) return null;
        return assignmentsToBoard(
            assignments,
            activeUsers.map((u) => u.id),
            matchingMembers.map((m) => m.id)
        );
    }, [users, membersData, assignments, activeUsers, matchingMembers]);

    // 분반 데이터 (선택된 라운드에 세션이 연결되어 있으면)
    const selectedRound = useMemo(
        () => (rounds ?? []).find((r) => r.id === selectedRoundId),
        [rounds, selectedRoundId]
    );
    const linkedSessionId = selectedRound?.session_id ?? null;
    const { data: groupData } = useQuery({
        queryKey: ["sessions", linkedSessionId, "groups"],
        queryFn: async () => {
            const { data } = await api.get(`/sessions/${linkedSessionId}/groups`);
            return data as {
                groups: Record<string, { member_id: number; group_num: number | null }[]>;
                staff_groups: Record<string, { user_id: number }[]>;
            };
        },
        enabled: !!linkedSessionId,
    });

    const { memberGroupMap, userGroupMap } = useMemo(() => {
        if (!groupData) return { memberGroupMap: undefined, userGroupMap: undefined };
        const mgm = new Map<number, number | null>();
        for (const [gk, arr] of Object.entries(groupData.groups)) {
            const gn = gk === "1" ? 1 : gk === "2" ? 2 : null;
            for (const m of arr) mgm.set(m.member_id, gn);
        }
        const ugm = new Map<number, number | null>();
        for (const [gk, arr] of Object.entries(groupData.staff_groups)) {
            const gn = gk === "1" ? 1 : gk === "2" ? 2 : null;
            for (const s of arr) ugm.set(s.user_id, gn);
        }
        return { memberGroupMap: mgm.size > 0 ? mgm : undefined, userGroupMap: ugm.size > 0 ? ugm : undefined };
    }, [groupData]);

    // 제출 완료된 배정 페어 (잠금 대상)
    const submittedPairs = useMemo(() => {
        const pairs = new Set<string>();
        for (const a of assignments ?? []) {
            if (a.eval_type === "AUDIENCE" && a.submitted_at && a.evaluator_user_id) {
                pairs.add(`${a.evaluator_user_id}_${a.presenter_member_id}`);
            }
        }
        return pairs;
    }, [assignments]);

    function handleSaveMatching(
        newAssignments: { evaluator_user_id: number; presenter_member_id: number }[]
    ) {
        if (!selectedRoundId) return;
        replaceAssignments.mutate({ roundId: selectedRoundId, assignments: newAssignments });
    }

    return (
        <div className="space-y-4">
            {/* Round selector + navigation */}
            <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                    <Label className="text-[var(--color-text-muted)] text-xs shrink-0">라운드</Label>
                    <Select
                        value={selectedRoundId ? String(selectedRoundId) : ""}
                        onValueChange={(v) => onSelectRound(v ? Number(v) : null)}
                    >
                        <SelectTrigger className="w-64 bg-[var(--color-surface)] border-[var(--color-border)]">
                            <SelectValue placeholder="라운드 선택..." />
                        </SelectTrigger>
                        <SelectContent>
                            {rounds?.map((r) => (
                                <SelectItem key={r.id} value={String(r.id)}>
                                    {r.title} ({ROUND_TYPE_LABELS[r.round_type] ?? r.round_type})
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {selectedRoundId && (
                    <Button
                        size="sm"
                        className="bg-[var(--color-accent)] hover:bg-[var(--color-accent)]/80 text-white"
                        onClick={() => navigate(`/eval/${selectedRoundId}/audience`)}
                    >
                        <ClipboardEdit className="w-3.5 h-3.5 mr-1.5" />
                        청중 평가하기
                    </Button>
                )}

                {/* 이전 라운드에서 배정 복사 */}
                {selectedRoundId && otherRounds.length > 0 && (
                    <Select
                        onValueChange={(sourceId) => {
                            if (!selectedRoundId) return;
                            copyAssignments.mutate({
                                roundId: selectedRoundId,
                                sourceRoundId: Number(sourceId),
                            });
                        }}
                    >
                        <SelectTrigger
                            className="w-auto h-8 gap-1.5 px-3 text-xs border-[var(--color-border)] bg-transparent"
                            disabled={copyAssignments.isPending}
                        >
                            <Copy className="w-3.5 h-3.5" />
                            {copyAssignments.isPending ? "복사 중..." : "배정 복사"}
                        </SelectTrigger>
                        <SelectContent>
                            {otherRounds.map((r) => (
                                <SelectItem key={r.id} value={String(r.id)}>
                                    {r.title} ({ROUND_TYPE_LABELS[r.round_type] ?? r.round_type})
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
            </div>

            {/* Content */}
            {!selectedRoundId ? (
                <div className="text-center py-12 text-[var(--color-text-muted)]">
                    라운드를 선택해주세요.
                </div>
            ) : isLoading || !board ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-muted)]" />
                </div>
            ) : (
                <div className="h-[60vh]">
                    <EvalMatchingBoard
                        key={selectedRoundId}
                        users={activeUsers}
                        members={matchingMembers}
                        initialBoard={board}
                        submittedPairs={submittedPairs}
                        onSave={handleSaveMatching}
                        isSaving={replaceAssignments.isPending}
                        saveLabel="저장"
                        memberGroupMap={memberGroupMap}
                        userGroupMap={userGroupMap}
                    />
                </div>
            )}
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// Tab 3: Submission Status
// ══════════════════════════════════════════════════════════════════════════════

function SubmissionStatusTab({
    selectedRoundId,
    onSelectRound,
}: {
    selectedRoundId: number | null;
    onSelectRound: (id: number | null) => void;
}) {
    const { data: rounds } = useEvalRounds();
    const { data: assignments, isLoading } = useEvalAssignments(selectedRoundId ?? 0);

    // Split into self (member) and audience (ops user) assignments
    const { selfAssignments, audienceByEvaluator } = useMemo(() => {
        if (!assignments) return { selfAssignments: [] as EvalAssignment[], audienceByEvaluator: new Map<string, EvalAssignment[]>() };

        const self = assignments.filter((a) => a.eval_type === "SELF");
        const audience = assignments.filter((a) => a.eval_type === "AUDIENCE");

        const byEvaluator = new Map<string, EvalAssignment[]>();
        for (const a of audience) {
            const name = a.evaluator_display_name ?? `User #${a.evaluator_user_id}`;
            if (!byEvaluator.has(name)) byEvaluator.set(name, []);
            byEvaluator.get(name)!.push(a);
        }

        return { selfAssignments: self, audienceByEvaluator: byEvaluator };
    }, [assignments]);

    const selfSubmitted = selfAssignments.filter((a) => a.submitted_at).length;
    const audienceTotal = assignments?.filter((a) => a.eval_type === "AUDIENCE").length ?? 0;
    const audienceSubmitted = assignments?.filter((a) => a.eval_type === "AUDIENCE" && a.submitted_at).length ?? 0;

    return (
        <div className="space-y-4">
            {/* Round selector */}
            <div className="flex items-center gap-2">
                <Label className="text-[var(--color-text-muted)] text-xs shrink-0">라운드</Label>
                <Select
                    value={selectedRoundId ? String(selectedRoundId) : ""}
                    onValueChange={(v) => onSelectRound(v ? Number(v) : null)}
                >
                    <SelectTrigger className="w-64 bg-[var(--color-surface)] border-[var(--color-border)]">
                        <SelectValue placeholder="라운드 선택..." />
                    </SelectTrigger>
                    <SelectContent>
                        {rounds?.map((r) => (
                            <SelectItem key={r.id} value={String(r.id)}>
                                {r.title} ({ROUND_TYPE_LABELS[r.round_type] ?? r.round_type})
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {!selectedRoundId ? (
                <div className="text-center py-12 text-[var(--color-text-muted)]">
                    라운드를 선택해주세요.
                </div>
            ) : isLoading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-muted)]" />
                </div>
            ) : (
                <div className="grid gap-6 lg:grid-cols-2">
                    {/* Self eval (members) */}
                    <div className="rounded-xl border border-[var(--color-border)] bg-white p-4">
                        <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--color-border)]">
                            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">자기 평가 (기수)</h3>
                            <span className={cn(
                                "text-xs font-medium px-2 py-0.5 rounded-full",
                                selfSubmitted === selfAssignments.length && selfAssignments.length > 0
                                    ? "bg-emerald-500/15 text-emerald-600"
                                    : "bg-[var(--color-hover)] text-[var(--color-text-muted)]"
                            )}>
                                {selfSubmitted}/{selfAssignments.length}
                            </span>
                        </div>
                        {selfAssignments.length === 0 ? (
                            <p className="text-xs text-[var(--color-text-muted)] text-center py-4">배정 없음</p>
                        ) : (
                            <div className="space-y-1 max-h-[400px] overflow-y-auto">
                                {selfAssignments.map((a) => (
                                    <div
                                        key={a.id}
                                        className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-[var(--color-hover)]"
                                    >
                                        {a.submitted_at ? (
                                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                        ) : (
                                            <Circle className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0" />
                                        )}
                                        <span className="text-sm text-[var(--color-text-secondary)] truncate flex-1">
                                            {a.presenter_name ?? `멤버 #${a.presenter_member_id}`}
                                        </span>
                                        {a.submitted_at && (
                                            <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
                                                {new Date(a.submitted_at).toLocaleDateString("ko-KR")}
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Audience eval (ops users) */}
                    <div className="rounded-xl border border-[var(--color-border)] bg-white p-4">
                        <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--color-border)]">
                            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">청중 평가 (운영진)</h3>
                            <span className={cn(
                                "text-xs font-medium px-2 py-0.5 rounded-full",
                                audienceSubmitted === audienceTotal && audienceTotal > 0
                                    ? "bg-emerald-500/15 text-emerald-600"
                                    : "bg-[var(--color-hover)] text-[var(--color-text-muted)]"
                            )}>
                                {audienceSubmitted}/{audienceTotal}
                            </span>
                        </div>
                        {audienceByEvaluator.size === 0 ? (
                            <p className="text-xs text-[var(--color-text-muted)] text-center py-4">배정 없음</p>
                        ) : (
                            <div className="space-y-3 max-h-[400px] overflow-y-auto">
                                {[...audienceByEvaluator.entries()].map(([evaluatorName, evalAssignments]) => {
                                    const submitted = evalAssignments.filter((a) => a.submitted_at).length;
                                    const total = evalAssignments.length;
                                    const allDone = submitted === total;
                                    return (
                                        <div key={evaluatorName}>
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-xs font-semibold text-[var(--color-text-secondary)]">
                                                    {evaluatorName}
                                                </span>
                                                <span className={cn(
                                                    "text-[10px] font-medium px-1.5 py-0.5 rounded",
                                                    allDone
                                                        ? "bg-emerald-500/15 text-emerald-600"
                                                        : "bg-[var(--color-hover)] text-[var(--color-text-muted)]"
                                                )}>
                                                    {submitted}/{total}
                                                </span>
                                            </div>
                                            <div className="space-y-0.5 pl-1">
                                                {evalAssignments.map((a) => (
                                                    <div
                                                        key={a.id}
                                                        className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-[var(--color-hover)]"
                                                    >
                                                        {a.submitted_at ? (
                                                            <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                                                        ) : (
                                                            <Circle className="w-3 h-3 text-[var(--color-text-muted)] shrink-0" />
                                                        )}
                                                        <span className="text-xs text-[var(--color-text-muted)] truncate">
                                                            {a.presenter_name ?? `멤버 #${a.presenter_member_id}`}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// Tab 4: Results
// ══════════════════════════════════════════════════════════════════════════════

function ResultsTab({
    selectedRoundId,
    onSelectRound,
}: {
    selectedRoundId: number | null;
    onSelectRound: (id: number | null) => void;
}) {
    const { data: rounds } = useEvalRounds();
    const { data: results, isLoading } = useEvalResults(selectedRoundId ?? 0);
    const selectedRound = rounds?.find((r) => r.id === selectedRoundId);
    const [expandedId, setExpandedId] = useState<number | null>(null);

    return (
        <div className="space-y-4">
            {/* Round selector */}
            <div className="flex items-center gap-2">
                <Label className="text-[var(--color-text-muted)] text-xs shrink-0">라운드</Label>
                <Select
                    value={selectedRoundId ? String(selectedRoundId) : ""}
                    onValueChange={(v) => {
                        onSelectRound(v ? Number(v) : null);
                        setExpandedId(null);
                    }}
                >
                    <SelectTrigger className="w-64 bg-[var(--color-surface)] border-[var(--color-border)]">
                        <SelectValue placeholder="라운드 선택..." />
                    </SelectTrigger>
                    <SelectContent>
                        {rounds?.map((r) => (
                            <SelectItem key={r.id} value={String(r.id)}>
                                {r.title} ({ROUND_TYPE_LABELS[r.round_type] ?? r.round_type})
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* 결과 비공개 멤버 설정 (당일 결석자 등) */}
            {selectedRoundId && selectedRound && results && results.length > 0 && (
                <HiddenMembersPanel round={selectedRound} members={results} />
            )}

            {/* 성장 회고 모아보기 — FINAL 라운드에서만 의미 있음 */}
            {selectedRoundId && selectedRound?.round_type === "FINAL" && (
                <GrowthReflectionsSection roundId={selectedRoundId} />
            )}

            {/* Content */}
            {!selectedRoundId ? (
                <div className="text-center py-12 text-[var(--color-text-muted)]">
                    라운드를 선택해주세요.
                </div>
            ) : isLoading ? (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-muted)]" />
                </div>
            ) : !results?.length ? (
                <div className="text-center py-12 text-[var(--color-text-muted)]">
                    아직 결과 데이터가 없습니다.
                </div>
            ) : (
                <div className="space-y-2">
                    {results.map((r) => (
                        <ResultRow
                            key={r.member_id}
                            result={r}
                            roundId={selectedRoundId}
                            expanded={expandedId === r.member_id}
                            onToggle={() =>
                                setExpandedId(expandedId === r.member_id ? null : r.member_id)
                            }
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function HiddenMembersPanel({
    round,
    members,
}: {
    round: EvalRound;
    members: { member_id: number; member_name: string }[];
}) {
    const [open, setOpen] = useState(false);
    const [sel, setSel] = useState<Set<number>>(() => new Set(round.hidden_member_ids ?? []));
    const updateRound = useUpdateRound();

    // 라운드 변경 시 선택 동기화
    const baseKey = `${round.id}:${(round.hidden_member_ids ?? []).join(",")}`;
    const [syncedKey, setSyncedKey] = useState(baseKey);
    if (syncedKey !== baseKey) {
        setSyncedKey(baseKey);
        setSel(new Set(round.hidden_member_ids ?? []));
    }

    const hiddenCount = round.hidden_member_ids?.length ?? 0;
    const toggle = (id: number) => {
        setSel((prev) => {
            const n = new Set(prev);
            n.has(id) ? n.delete(id) : n.add(id);
            return n;
        });
    };
    const save = () => {
        updateRound.mutate(
            { roundId: round.id, hidden_member_ids: [...sel] },
            { onSuccess: () => setOpen(false) },
        );
    };

    return (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
            <button
                onClick={() => setOpen((o) => !o)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-sm"
            >
                <span className="flex items-center gap-2 text-[var(--color-text-secondary)]">
                    <EyeOff className="w-4 h-4" />
                    결과 비공개 멤버 (결석자 등)
                    {hiddenCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full bg-rose-500/15 text-rose-600 text-[11px] font-semibold">{hiddenCount}명 비공개</span>
                    )}
                </span>
                <ChevronDown className={cn("w-4 h-4 transition-transform", open && "rotate-180")} />
            </button>
            {open && (
                <div className="px-4 pb-3 border-t border-[var(--color-border-subtle)] pt-3">
                    <p className="text-xs text-[var(--color-text-muted)] mb-3">
                        체크한 멤버는 결과를 공개해도 본인에게 결과가 보이지 않습니다.
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-60 overflow-auto mb-3">
                        {members.map((m) => {
                            const checked = sel.has(m.member_id);
                            return (
                                <label
                                    key={m.member_id}
                                    className={cn(
                                        "flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer text-sm transition-colors",
                                        checked
                                            ? "border-rose-300 bg-rose-50 text-rose-700"
                                            : "border-[var(--color-border)] hover:bg-[var(--color-hover)]"
                                    )}
                                >
                                    <input type="checkbox" checked={checked} onChange={() => toggle(m.member_id)} className="accent-rose-500" />
                                    {m.member_name}
                                </label>
                            );
                        })}
                    </div>
                    <div className="flex justify-end gap-2">
                        <button onClick={() => setSel(new Set())} className="px-3 py-1.5 rounded-lg text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]">전체 해제</button>
                        <button
                            onClick={save}
                            disabled={updateRound.isPending}
                            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-500 text-white hover:bg-rose-600 disabled:opacity-50"
                        >
                            {updateRound.isPending ? "저장 중..." : "저장"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function GrowthReflectionsSection({ roundId }: { roundId: number }) {
    const { data: reflections, isLoading } = useEvalReflections(roundId);
    const [open, setOpen] = useState(false);
    const [copying, setCopying] = useState(false);

    const submittedCount = reflections?.length ?? 0;

    const handleCopyAll = async () => {
        if (!reflections?.length) return;
        const text = reflections
            .map((r) => `▶ ${r.member_name}\n${r.growth_reflection.trim()}`)
            .join("\n\n──────────────\n\n");
        setCopying(true);
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
            } else {
                // HTTP/non-secure context (개발 서버 등) 폴백
                const ta = document.createElement("textarea");
                ta.value = text;
                ta.style.position = "fixed";
                ta.style.left = "-9999px";
                ta.setAttribute("readonly", "");
                document.body.appendChild(ta);
                ta.select();
                const ok = document.execCommand("copy");
                document.body.removeChild(ta);
                if (!ok) throw new Error("execCommand copy failed");
            }
            toast.success(`${submittedCount}건 클립보드에 복사됨`);
        } catch {
            toast.error("복사에 실패했습니다");
        } finally {
            setCopying(false);
        }
    };

    return (
        <div className="rounded-xl border border-rose-200 bg-rose-50/30">
            <button
                onClick={() => setOpen((v) => !v)}
                className="w-full flex items-center gap-3 px-5 py-3 hover:bg-rose-50/60 transition-colors text-left"
            >
                <div className="w-8 h-8 rounded-lg bg-rose-100 flex items-center justify-center shrink-0">
                    <MessageSquareHeart className="w-4 h-4 text-rose-500" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-[var(--color-text-primary)]">
                        성장 회고 모아보기
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                        자기평가 서술형 응답 — Q. 유니브피티 활동을 통해 가장 크게 성장했다고 느끼는 점
                    </p>
                </div>
                <span className="text-xs text-[var(--color-text-muted)] shrink-0">
                    {isLoading ? "..." : `${submittedCount}건`}
                </span>
                <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
                    <ChevronDown className="w-5 h-5 text-[var(--color-text-muted)]" />
                </motion.div>
            </button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: "easeInOut" }}
                        className="overflow-hidden border-t border-rose-200"
                    >
                        <div className="px-5 py-4 space-y-4">
                            <div className="flex items-center justify-end">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleCopyAll}
                                    disabled={!submittedCount || copying}
                                    className="h-7 text-xs"
                                >
                                    <Copy className="w-3 h-3 mr-1.5" />
                                    전체 복사
                                </Button>
                            </div>
                            {isLoading ? (
                                <div className="flex justify-center py-6">
                                    <Loader2 className="w-5 h-5 animate-spin text-[var(--color-text-muted)]" />
                                </div>
                            ) : !submittedCount ? (
                                <p className="text-sm text-[var(--color-text-muted)] text-center py-6">
                                    아직 성장 회고 응답이 없습니다.
                                </p>
                            ) : (
                                <div className="space-y-3">
                                    {reflections!.map((r) => (
                                        <div
                                            key={r.member_id}
                                            className="rounded-lg border border-[var(--color-border)] bg-white p-4"
                                        >
                                            <p className="text-sm font-bold text-[var(--color-text-primary)] mb-2">
                                                {r.member_name}
                                            </p>
                                            <p className="text-sm text-[var(--color-text-secondary)] leading-[1.9] whitespace-pre-wrap [word-break:keep-all]">
                                                {r.growth_reflection}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

function ResultRow({
    result,
    roundId,
    expanded,
    onToggle,
}: {
    result: MemberResultSummary;
    roundId: number;
    expanded: boolean;
    onToggle: () => void;
}) {
    // Fetch detail only when expanded
    const { data: detail } = useMemberResult(
        expanded ? roundId : 0,
        expanded ? result.member_id : 0
    );

    // Build score objects for the card, defaulting null -> 0
    const toScoreObj = (scores: Record<string, number | null>) => ({
        PLANNING: scores.PLANNING ?? 0,
        DESIGN: scores.DESIGN ?? 0,
        SPEECH: scores.SPEECH ?? 0,
    });

    return (
        <EvalResultCard
            memberName={result.member_name}
            selfScores={toScoreObj(result.self_scores)}
            audienceScores={toScoreObj(result.audience_scores)}
            combinedScores={toScoreObj(result.combined_scores)}
            stage={detail?.stage ?? ""}
            type={detail?.type ?? ""}
            detail={detail ?? undefined}
            expanded={expanded}
            onToggle={onToggle}
        />
    );
}
