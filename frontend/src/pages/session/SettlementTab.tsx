import { useState, useMemo } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { useSettlementPreview, useFinalizeSession, useRemoveStagedMerit, useLedger, useUpdateLedger, useDeleteLedgerEntry, translateDescription, LEDGER_TYPE_LABELS } from "@/hooks";
import type { LedgerEntry } from "@/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertTriangle, CheckCircle2, ExternalLink, Trophy, Trash2, Pencil, X, Check, Lock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { formatNumber } from "@/lib/utils";
import { toast } from "sonner";
import { GrantMeritDialog } from "@/components/GrantMeritDialog";
import { ExcelExportButton } from "@/components/ExcelExportButton";
import type { Session, MeritPreviewItem } from "@/hooks/useSessions";

const PENALTY_TYPE_LABEL: Record<string, string> = {
    ATTENDANCE:     "출결",
    PPT:            "PPT",
    PPT_EMAIL:      "PPT이메일",
    HOMEWORK:       "과제미제출",
    MILESTONE_FINE: "누적 벌점",
};

export default function SettlementTab() {
    const { session } = useOutletContext<{ session: Session }>();
    const navigate = useNavigate();
    const { data: previewData, isLoading } = useSettlementPreview(session.id);
    const { mutate: finalizeSession, isPending: isFinalizing } = useFinalizeSession();
    // Penalty Filters
    const [filterMember, setFilterMember] = useState<string>("all");
    const [filterType, setFilterType] = useState<string>("all");

    // Merit Filter
    const [meritFilterMember, setMeritFilterMember] = useState<string>("all");

    // 마감 확인 모달
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [meritConfirmed, setMeritConfirmed] = useState(false);

    // Set of penalty indices that are SKIPPED (unchecked)
    const [skippedIndices, setSkippedIndices] = useState<Set<number>>(new Set());
    // Set of merit indices that are SKIPPED (unchecked)
    const [skippedMeritIndices, setSkippedMeritIndices] = useState<Set<number>>(new Set());

    const penalties = useMemo(() => previewData?.penalties || [], [previewData]);
    const merits = useMemo(() => previewData?.merits || [], [previewData]);

    // Unique member list from penalties
    const penaltyMembers = useMemo(() => {
        const seen = new Map<number, string>();
        penalties.forEach(p => { if (!seen.has(p.member_id)) seen.set(p.member_id, p.member_name); });
        return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
    }, [penalties]);

    // Unique member list from merits
    const meritMembers = useMemo(() => {
        const seen = new Map<number, string>();
        merits.forEach(m => { if (!seen.has(m.member_id)) seen.set(m.member_id, m.member_name); });
        return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
    }, [merits]);

    // Unique type list from penalties
    const penaltyTypes = useMemo(() => {
        const seen = new Set<string>();
        penalties.forEach(p => seen.add(p.type));
        return Array.from(seen);
    }, [penalties]);

    const filteredPenalties = useMemo(() => {
        return penalties.map((p, idx) => ({ ...p, _idx: idx })).filter(p => {
            if (filterMember !== "all" && p.member_id !== Number(filterMember)) return false;
            if (filterType !== "all" && p.type !== filterType) return false;
            return true;
        });
    }, [penalties, filterMember, filterType]);

    const filteredMerits = useMemo(() => {
        return merits.map((m, idx) => ({ ...m, _idx: idx })).filter(m => {
            if (meritFilterMember !== "all" && m.member_id !== Number(meritFilterMember)) return false;
            return true;
        });
    }, [merits, meritFilterMember]);

    const { totalScoreDelta, totalDepositDelta } = useMemo(() => {
        let score = 0;
        let deposit = 0;
        penalties.forEach((p, idx) => {
            if (!skippedIndices.has(idx)) {
                score += p.score_delta;
                deposit += p.deposit_delta;
            }
        });
        return { totalScoreDelta: score, totalDepositDelta: deposit };
    }, [penalties, skippedIndices]);

    const totalMeritScore = useMemo(() => {
        let score = 0;
        merits.forEach((m, idx) => {
            if (!skippedMeritIndices.has(idx)) {
                score += m.score_delta;
            }
        });
        return score;
    }, [merits, skippedMeritIndices]);

    const handleToggle = (idx: number, type: string) => {
        if (type === "MILESTONE_FINE") return;

        const newSkipped = new Set(skippedIndices);
        if (newSkipped.has(idx)) {
            newSkipped.delete(idx);
        } else {
            newSkipped.add(idx);
        }
        setSkippedIndices(newSkipped);
    };

    const handleMeritToggle = (idx: number) => {
        const newSkipped = new Set(skippedMeritIndices);
        if (newSkipped.has(idx)) {
            newSkipped.delete(idx);
        } else {
            newSkipped.add(idx);
        }
        setSkippedMeritIndices(newSkipped);
    };

    const doFinalize = () => {
        // Build penalty overrides
        const overridesMap = new Map<number, Set<string>>();
        skippedIndices.forEach(idx => {
            const p = penalties[idx];
            if (!overridesMap.has(p.member_id)) {
                overridesMap.set(p.member_id, new Set());
            }
            overridesMap.get(p.member_id)?.add(p.type);
        });
        const overrides = Array.from(overridesMap.entries()).map(([member_id, types]) => ({
            member_id,
            skip_types: Array.from(types)
        }));

        const skip_merit_indices = Array.from(skippedMeritIndices);

        finalizeSession({ sessionId: session.id, overrides, skip_merit_indices }, {
            onSuccess: () => {
                toast.success("세션이 성공적으로 마감되었습니다.");
                setConfirmOpen(false);
            },
            onError: (err) => {
                toast.error(`마감 실패: ${err.message}`);
            }
        });
    };

    if (isLoading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-64 w-full" />
            </div>
        );
    }

    if (session.status === "FINALIZED") {
        return <FinalizedView session={session} navigate={navigate} />;
    }

    return (
        <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                    <h2 className="text-lg md:text-xl font-bold tracking-tight text-[var(--color-text-primary)]">정산 미리보기</h2>
                    <p className="text-xs md:text-sm text-[var(--color-text-secondary)]">
                        이번 세션의 페널티 및 정산 예정 내역입니다. 체크박스를 해제하여 면제할 수 있습니다.
                    </p>
                </div>
                <Button
                    onClick={() => { setMeritConfirmed(false); setConfirmOpen(true); }}
                    disabled={isFinalizing}
                    className="bg-rose-600 hover:bg-rose-700 text-white shadow-md shadow-rose-100 transition-all hover:scale-105 self-start md:self-auto"
                >
                    {isFinalizing ? "마감 처리 중..." : "세션 마감"}
                </Button>
            </div>

            <Dialog open={confirmOpen} onOpenChange={(o) => { if (!o) setConfirmOpen(false); }}>
                <DialogContent className="sm:max-w-[440px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Lock className="w-5 h-5 text-rose-600" /> 세션 마감 확인
                        </DialogTitle>
                    </DialogHeader>

                    {/* 상점 적용 강조 안내 */}
                    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
                        <div className="flex items-start gap-2.5">
                            <Trophy className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                            <div>
                                <p className="text-sm font-extrabold text-amber-900">
                                    오프/오피 등 상점을 모두 부여하셨나요?
                                </p>
                                <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                                    Listen Up·BP·발전왕·번개 등 빠뜨린 상점이 없는지 마감 전에 꼭 확인하세요.
                                </p>
                            </div>
                        </div>
                        <label className="flex items-center gap-2 mt-3 pt-3 border-t border-amber-200 cursor-pointer select-none">
                            <Checkbox checked={meritConfirmed} onCheckedChange={(v) => setMeritConfirmed(!!v)} />
                            <span className="text-sm font-bold text-amber-900">상점을 모두 적용했습니다</span>
                        </label>
                    </div>

                    {/* 정산 요약 */}
                    <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-lg bg-gray-50 border border-gray-200 p-2.5">
                            <p className="text-[11px] text-gray-500">총 벌점</p>
                            <p className="text-base font-bold text-gray-900">{totalScoreDelta}</p>
                        </div>
                        <div className="rounded-lg bg-gray-50 border border-gray-200 p-2.5">
                            <p className="text-[11px] text-gray-500">총 차감액</p>
                            <p className="text-base font-bold text-gray-900">{formatNumber(totalDepositDelta)}원</p>
                        </div>
                        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5">
                            <p className="text-[11px] text-emerald-600">총 상점</p>
                            <p className="text-base font-bold text-emerald-700">+{totalMeritScore}</p>
                        </div>
                    </div>
                    <p className="text-xs text-gray-500 leading-relaxed">
                        마감하면 위 내역이 <strong className="text-gray-700">장부에 영구 기록</strong>되고 멤버 점수·디파짓에 즉시 반영됩니다.
                        마감 후에도 <strong className="text-gray-700">장부에서 세션에 연결해 상점·벌점을 추가·수정</strong>할 수 있어요.
                    </p>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmOpen(false)}>취소</Button>
                        <Button
                            onClick={doFinalize}
                            disabled={!meritConfirmed || isFinalizing}
                            className="bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50"
                        >
                            {isFinalizing ? "마감 처리 중..." : "세션 마감"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <div className="grid grid-cols-3 gap-2 md:gap-4">
                <Card className="bg-[var(--color-surface)] border-[var(--color-border)]">
                    <CardHeader className="pb-1 md:pb-2 p-3 md:p-6">
                        <CardTitle className="text-[11px] md:text-sm font-medium text-[var(--color-text-muted)]">
                            총 벌점
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 md:p-6 pt-0">
                        <div className={`text-lg md:text-2xl font-bold ${totalScoreDelta < 0 ? 'text-rose-500' : 'text-[var(--color-text-muted)]'}`}>
                            {totalScoreDelta > 0 ? `+${totalScoreDelta}` : totalScoreDelta}
                        </div>
                    </CardContent>
                </Card>
                <Card className="bg-[var(--color-surface)] border-[var(--color-border)]">
                    <CardHeader className="pb-1 md:pb-2 p-3 md:p-6">
                        <CardTitle className="text-[11px] md:text-sm font-medium text-[var(--color-text-muted)]">
                            총 차감액
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 md:p-6 pt-0">
                        <div className={`text-lg md:text-2xl font-bold ${totalDepositDelta < 0 ? 'text-rose-500' : 'text-[var(--color-text-muted)]'}`}>
                            {formatNumber(totalDepositDelta)}원
                        </div>
                    </CardContent>
                </Card>
                <Card className="bg-[var(--color-surface)] border-[var(--color-border)]">
                    <CardHeader className="pb-1 md:pb-2 p-3 md:p-6">
                        <CardTitle className="text-[11px] md:text-sm font-medium text-[var(--color-text-muted)]">
                            총 상점
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 md:p-6 pt-0">
                        <div className={`text-lg md:text-2xl font-bold ${totalMeritScore > 0 ? 'text-green-600' : 'text-[var(--color-text-muted)]'}`}>
                            +{totalMeritScore}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Penalty filters */}
            <div className="flex flex-wrap items-center gap-2 md:gap-3 mb-2">
                <Select value={filterMember} onValueChange={setFilterMember}>
                    <SelectTrigger className="w-[140px] md:w-[160px] h-8 text-xs bg-[var(--color-surface)] border-[var(--color-border)]">
                        <SelectValue placeholder="멤버 필터" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">전체 멤버</SelectItem>
                        {penaltyMembers.map(([id, name]) => (
                            <SelectItem key={id} value={String(id)}>{name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Select value={filterType} onValueChange={setFilterType}>
                    <SelectTrigger className="w-[140px] md:w-[160px] h-8 text-xs bg-[var(--color-surface)] border-[var(--color-border)]">
                        <SelectValue placeholder="유형 필터" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">전체 유형</SelectItem>
                        {penaltyTypes.map(t => (
                            <SelectItem key={t} value={t}>{PENALTY_TYPE_LABEL[t] ?? t}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <span className="text-xs text-[var(--color-text-muted)] ml-auto">
                    {filteredPenalties.length} / {penalties.length}건
                </span>
            </div>

            {/* Penalty table — 행이 많아지면 세로 스크롤(헤더 고정) */}
            <div className="rounded-xl border border-[var(--color-border)] overflow-auto max-h-[55vh] bg-[var(--color-surface)]">
                <Table>
                    <TableHeader className="sticky top-0 z-10">
                        <TableRow className="bg-gray-50 hover:bg-gray-50">
                            <TableHead className="w-[50px] text-center">적용</TableHead>
                            <TableHead>유형</TableHead>
                            <TableHead>멤버</TableHead>
                            <TableHead>사유</TableHead>
                            <TableHead className="text-right">점수</TableHead>
                            <TableHead className="text-right">디파짓</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredPenalties.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center py-12 text-[var(--color-text-muted)]">
                                    {penalties.length === 0 ? "패널티 부과 대상이 없습니다." : "필터 조건에 맞는 항목이 없습니다."}
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredPenalties.map((penalty) => {
                                const idx = penalty._idx;
                                const isMilestone = penalty.type === "MILESTONE_FINE";
                                const isSkipped = skippedIndices.has(idx);
                                const isApplied = !isSkipped;

                                return (
                                    <TableRow
                                        key={idx}
                                        className={`transition-colors hover:bg-gray-50 ${isMilestone ? 'bg-yellow-500/5' : ''} ${!isApplied ? 'opacity-50' : ''}`}
                                    >
                                        <TableCell className="text-center">
                                            <Checkbox
                                                checked={isApplied}
                                                disabled={isMilestone}
                                                onCheckedChange={() => handleToggle(idx, penalty.type)}
                                                className={isMilestone ? "opacity-50 cursor-not-allowed" : ""}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                {isMilestone && <span className="text-yellow-500">⚠</span>}
                                                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${isMilestone
                                                    ? "bg-yellow-500/10 text-yellow-500 border-yellow-500/20"
                                                    : "bg-red-500/10 text-red-500 border-red-500/20"
                                                    }`}>
                                                    {PENALTY_TYPE_LABEL[penalty.type] ?? penalty.type}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="font-medium text-[var(--color-text-secondary)]">{penalty.member_name}</TableCell>
                                        <TableCell className="text-[var(--color-text-secondary)] text-sm max-w-[300px] truncate" title={penalty.description}>
                                            {penalty.description}
                                        </TableCell>
                                        <TableCell className={`text-right ${penalty.score_delta < 0 ? 'text-rose-500' : 'text-[var(--color-text-muted)]'}`}>
                                            {penalty.score_delta}
                                        </TableCell>
                                        <TableCell className={`text-right ${penalty.deposit_delta < 0 ? 'text-rose-500' : 'text-[var(--color-text-muted)]'}`}>
                                            {formatNumber(penalty.deposit_delta)}
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Merit section */}
            <StagedMeritPanel
                sessionId={session.id}
                merits={merits}
                filteredMerits={filteredMerits}
                meritMembers={meritMembers}
                meritFilterMember={meritFilterMember}
                onMeritFilterChange={setMeritFilterMember}
                session={session}
                skippedMeritIndices={skippedMeritIndices}
                onToggle={handleMeritToggle}
            />

            <div className="flex items-start gap-3 p-4 rounded-lg bg-yellow-500/5 border border-yellow-500/20 text-yellow-500/90 text-sm">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <p>
                    마감 버튼을 누르면 위 내역(체크된 항목)이 <strong>장부</strong>에 영구 기록되며, 멤버들의 점수와 디파짓이 즉시 반영됩니다.
                    이 작업은 되돌릴 수 없습니다.
                </p>
            </div>
        </div>
    );
}

// ── Staged Merit Panel (before finalize) ─────────────────────────────────────

function StagedMeritPanel({
    sessionId,
    merits,
    filteredMerits,
    meritMembers,
    meritFilterMember,
    onMeritFilterChange,
    session,
    skippedMeritIndices,
    onToggle,
}: {
    sessionId: number;
    merits: MeritPreviewItem[];
    filteredMerits: (MeritPreviewItem & { _idx: number })[];
    meritMembers: [number, string][];
    meritFilterMember: string;
    onMeritFilterChange: (v: string) => void;
    session: Session;
    skippedMeritIndices: Set<number>;
    onToggle: (idx: number) => void;
}) {
    const { mutate: removeStagedMerit, isPending: isRemoving } = useRemoveStagedMerit();

    // Count auto (streak) merits to calculate manual index offset
    const autoCount = merits.filter(m => m.source === "streak").length;

    const handleRemoveManual = (meritIdx: number) => {
        const manualIndex = meritIdx - autoCount;
        if (manualIndex < 0) return;
        removeStagedMerit({ sessionId, index: manualIndex });
    };

    return (
        <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
            <div className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b border-[var(--color-border)]">
                <div className="flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-yellow-500" />
                    <h3 className="font-semibold text-sm">상점</h3>
                    {merits.length > 0 && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-yellow-500/10 text-yellow-600 border border-yellow-500/20">
                            {merits.length}건
                        </span>
                    )}
                </div>
                <GrantMeritDialog
                    sessionId={sessionId}
                    teams={session.type === "TEAM" && session.teams ? session.teams.map((t: any) => ({
                        name: t.name,
                        memberIds: t.members.map((m: any) => m.id),
                    })) : undefined}
                    trigger={
                        <Button size="sm" variant="outline" className="h-7 text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/20">
                            <Trophy className="w-3 h-3 mr-1" />
                            상점 추가
                        </Button>
                    }
                />
            </div>

            {/* Merit filter */}
            {merits.length > 0 && (
                <div className="px-4 md:px-6 py-3 border-b border-[var(--color-border)] flex flex-wrap items-center gap-2 md:gap-3">
                    <Select value={meritFilterMember} onValueChange={onMeritFilterChange}>
                        <SelectTrigger className="w-[140px] md:w-[160px] h-8 text-xs bg-[var(--color-surface)] border-[var(--color-border)]">
                            <SelectValue placeholder="멤버 필터" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">전체 멤버</SelectItem>
                            {meritMembers.map(([id, name]) => (
                                <SelectItem key={id} value={String(id)}>{name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <span className="text-xs text-[var(--color-text-muted)] ml-auto">
                        {filteredMerits.length} / {merits.length}건
                    </span>
                </div>
            )}

            <div className="overflow-auto max-h-[50vh]">
            <Table>
                <TableHeader className="sticky top-0 z-10">
                    <TableRow className="bg-gray-50 hover:bg-gray-50">
                        <TableHead className="w-[50px] text-center">적용</TableHead>
                        <TableHead className="w-[80px]">구분</TableHead>
                        <TableHead>멤버</TableHead>
                        <TableHead>사유</TableHead>
                        <TableHead className="text-right w-[80px]">점수</TableHead>
                        <TableHead className="w-[50px]" />
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {filteredMerits.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={6} className="text-center py-8 text-[var(--color-text-muted)] text-sm">
                                {merits.length === 0 ? "상점 항목이 없습니다." : "필터 조건에 맞는 항목이 없습니다."}
                            </TableCell>
                        </TableRow>
                    ) : (
                        filteredMerits.map((merit) => {
                            const idx = merit._idx;
                            const isSkipped = skippedMeritIndices.has(idx);
                            const isApplied = !isSkipped;
                            const isManual = merit.source === "manual";

                            return (
                                <TableRow
                                    key={idx}
                                    className={`transition-colors hover:bg-gray-50 ${!isApplied ? 'opacity-50' : ''}`}
                                >
                                    <TableCell className="text-center">
                                        <Checkbox
                                            checked={isApplied}
                                            onCheckedChange={() => onToggle(idx)}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border bg-green-500/10 text-green-600 border-green-500/20">
                                            상점
                                        </span>
                                    </TableCell>
                                    <TableCell className="font-medium text-[var(--color-text-secondary)]">{merit.member_name}</TableCell>
                                    <TableCell className="text-sm text-[var(--color-text-secondary)] max-w-[300px] truncate" title={merit.description}>
                                        {merit.description}
                                    </TableCell>
                                    <TableCell className="text-right text-green-600">+{merit.score_delta}</TableCell>
                                    <TableCell>
                                        {isManual && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-6 w-6 p-0 hover:bg-rose-500/10 hover:text-rose-500"
                                                onClick={() => handleRemoveManual(idx)}
                                                disabled={isRemoving}
                                            >
                                                <Trash2 className="w-3 h-3" />
                                            </Button>
                                        )}
                                    </TableCell>
                                </TableRow>
                            );
                        })
                    )}
                </TableBody>
            </Table>
            </div>
        </div>
    );
}

// ── Finalized View (마감 완료 후 장부 수정 UI) ──────────────────────────

function FinalizedView({ session, navigate }: { session: Session; navigate: (path: string) => void }) {
    const { data: ledgerData, isLoading: ledgerLoading } = useLedger({ session_id: session.id, limit: 100 });
    const { mutate: updateEntry } = useUpdateLedger();
    const { mutate: deleteEntry } = useDeleteLedgerEntry();
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editValues, setEditValues] = useState<{ score_delta?: number; amount_krw?: number; description?: string }>({});

    const entries = useMemo(() => {
        if (!ledgerData) return [];
        const list = Array.isArray(ledgerData) ? ledgerData : (ledgerData as any).items ?? [];
        return list as LedgerEntry[];
    }, [ledgerData]);

    const startEdit = (entry: LedgerEntry) => {
        setEditingId(entry.id);
        setEditValues({ score_delta: entry.score_delta, amount_krw: entry.amount_krw, description: entry.description });
    };

    const cancelEdit = () => { setEditingId(null); setEditValues({}); };

    const saveEdit = () => {
        if (editingId == null) return;
        updateEntry({ id: editingId, data: editValues }, { onSuccess: () => cancelEdit() });
    };

    const handleDelete = (id: number) => {
        if (!confirm("이 항목을 삭제하시겠습니까? 멤버의 잔액과 점수가 자동으로 조정됩니다.")) return;
        deleteEntry(id);
    };

    return (
        <div className="space-y-4 md:space-y-6 animate-in fade-in zoom-in-95 duration-500">
            <div className="flex flex-col items-center justify-center p-6 md:p-8 text-center bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl">
                <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mb-3">
                    <CheckCircle2 className="w-6 h-6 text-green-500" />
                </div>
                <h2 className="text-base md:text-lg font-bold mb-1 text-[var(--color-text-primary)]">세션 마감 완료</h2>
                <p className="text-xs md:text-sm text-[var(--color-text-muted)] mb-4">
                    {new Date(session.finalized_at || "").toLocaleString()} 마감 · 아래에서 개별 항목을 수정/삭제할 수 있습니다.
                </p>
                <div className="flex gap-2 md:gap-3 flex-wrap justify-center">
                    <Button variant="outline" size="sm" onClick={() => navigate("/ledger")}>
                        <ExternalLink className="w-4 h-4 mr-2" />
                        장부에서 확인
                    </Button>
                    <ExcelExportButton weekNum={session.week_num} />
                </div>
            </div>

            {ledgerLoading ? (
                <Skeleton className="h-64 w-full" />
            ) : entries.length === 0 ? (
                <p className="text-center text-[var(--color-text-muted)] py-8">이 세션에 장부 항목이 없습니다.</p>
            ) : (
                <div className="rounded-xl border border-[var(--color-border)] overflow-x-auto bg-[var(--color-surface)]">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-gray-50 hover:bg-gray-50">
                                <TableHead>유형</TableHead>
                                <TableHead>멤버</TableHead>
                                <TableHead>사유</TableHead>
                                <TableHead className="text-right">점수</TableHead>
                                <TableHead className="text-right">금액</TableHead>
                                <TableHead className="text-right">잔액</TableHead>
                                <TableHead className="w-[80px]" />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {entries.map((entry) => {
                                const isEditing = editingId === entry.id;
                                return (
                                    <TableRow key={entry.id} className="hover:bg-gray-50">
                                        <TableCell>
                                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${
                                                entry.type === "MERIT"
                                                    ? "bg-green-500/10 text-green-600 border-green-500/20"
                                                    : "bg-red-500/10 text-red-500 border-red-500/20"
                                            }`}>
                                                {LEDGER_TYPE_LABELS[entry.type] ?? entry.type}
                                            </span>
                                        </TableCell>
                                        <TableCell className="font-medium text-[var(--color-text-secondary)]">
                                            {entry.member_name ?? `#${entry.member_id}`}
                                        </TableCell>
                                        <TableCell className="max-w-[200px]">
                                            {isEditing ? (
                                                <Input
                                                    value={editValues.description ?? ""}
                                                    onChange={(e) => setEditValues(v => ({ ...v, description: e.target.value }))}
                                                    className="h-7 text-xs"
                                                />
                                            ) : (
                                                <span className="text-sm text-[var(--color-text-secondary)] truncate block" title={entry.description}>
                                                    {translateDescription(entry.description)}
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {isEditing ? (
                                                <Input
                                                    type="number"
                                                    value={editValues.score_delta ?? 0}
                                                    onChange={(e) => setEditValues(v => ({ ...v, score_delta: Number(e.target.value) }))}
                                                    className="h-7 text-xs w-20 ml-auto"
                                                />
                                            ) : (
                                                <span className={entry.score_delta < 0 ? "text-rose-500" : entry.score_delta > 0 ? "text-green-600" : ""}>
                                                    {entry.score_delta > 0 ? `+${entry.score_delta}` : entry.score_delta}
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {isEditing ? (
                                                <Input
                                                    type="number"
                                                    value={editValues.amount_krw ?? 0}
                                                    onChange={(e) => setEditValues(v => ({ ...v, amount_krw: Number(e.target.value) }))}
                                                    className="h-7 text-xs w-24 ml-auto"
                                                />
                                            ) : (
                                                <span className={entry.amount_krw < 0 ? "text-rose-500" : ""}>
                                                    {formatNumber(entry.amount_krw)}
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right text-[var(--color-text-muted)]">
                                            {formatNumber(entry.deposit_after)}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex gap-1 justify-end">
                                                {isEditing ? (
                                                    <>
                                                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-green-600 hover:bg-green-500/10" onClick={saveEdit}>
                                                            <Check className="w-3.5 h-3.5" />
                                                        </Button>
                                                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 hover:bg-gray-200" onClick={cancelEdit}>
                                                            <X className="w-3.5 h-3.5" />
                                                        </Button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 hover:bg-blue-500/10 hover:text-blue-500" onClick={() => startEdit(entry)}>
                                                            <Pencil className="w-3 h-3" />
                                                        </Button>
                                                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 hover:bg-rose-500/10 hover:text-rose-500" onClick={() => handleDelete(entry.id)}>
                                                            <Trash2 className="w-3 h-3" />
                                                        </Button>
                                                    </>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
}
