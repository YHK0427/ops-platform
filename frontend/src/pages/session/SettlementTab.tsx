import React, { useState, useMemo } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { useSettlementPreview, useFinalizeSession } from "@/hooks";
import { useLedger } from "@/hooks/useLedger";
import { useMembers } from "@/hooks/useMembers";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2, ExternalLink, Trophy, Pencil, Trash2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { formatNumber } from "@/lib/utils";
import { toast } from "sonner";
import { GrantMeritDialog } from "@/components/GrantMeritDialog";
import { useDeleteLedgerEntry, useUpdateLedger } from "@/hooks/useLedger";
import type { Session } from "@/hooks/useSessions";

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
    const { data: sessionMerits } = useLedger({ session_id: session.id, type: "MERIT", limit: 50 });
    const { data: allMembers } = useMembers();

    const memberNameMap = useMemo(() => {
        const map = new Map<number, string>();
        allMembers?.forEach(m => map.set(m.id, m.name));
        return map;
    }, [allMembers]);

    // Set of indices that are SKIPPED (unchecked)
    const [skippedIndices, setSkippedIndices] = useState<Set<number>>(new Set());

    const penalties = useMemo(() => previewData?.penalties || [], [previewData]);

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

    const handleToggle = (idx: number, type: string) => {
        if (type === "MILESTONE_FINE") return; // Cannot skip

        const newSkipped = new Set(skippedIndices);
        if (newSkipped.has(idx)) {
            newSkipped.delete(idx); // Key removed = Checked = Applied
        } else {
            newSkipped.add(idx); // Key added = Unchecked = Skipped
        }
        setSkippedIndices(newSkipped);
    };

    const handleFinalize = () => {
        // Build overrides
        const overridesMap = new Map<number, Set<string>>(); // member_id -> Set<type>

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

        if (confirm(`세션을 마감(Finalize) 하시겠습니까?\n\n총 벌점: ${totalScoreDelta}\n총 차감액: ${formatNumber(totalDepositDelta)} KRW\n\n마감 후에는 수정할 수 없으며, 벌점과 벌금이 확정됩니다.`)) {
            finalizeSession({ sessionId: session.id, overrides }, {
                onSuccess: () => {
                    toast.success("세션이 성공적으로 마감되었습니다.");
                },
                onError: (err) => {
                    toast.error(`마감 실패: ${err.message}`);
                }
            });
        }
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
        return (
            <div className="space-y-6 animate-in fade-in zoom-in-95 duration-500">
                <div className="flex flex-col items-center justify-center p-12 text-center bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl">
                    <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
                        <CheckCircle2 className="w-8 h-8 text-green-500" />
                    </div>
                    <h2 className="text-xl font-bold mb-2 text-white">Session Finalized</h2>
                    <p className="text-[var(--color-text-muted)] mb-6">
                        이 세션은 {new Date(session.finalized_at || "").toLocaleString()}에 마감되었습니다.<br />
                        정산 내역은 <span className="text-[var(--color-accent)]">Ledger</span> 메뉴에서 확인할 수 있습니다.
                    </p>
                    <Button
                        onClick={() => navigate("/ledger")}
                        className="bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white"
                    >
                        <ExternalLink className="w-4 h-4 mr-2" />
                        Ledger에서 확인
                    </Button>
                </div>
                <MeritPanel sessionId={session.id} merits={sessionMerits ?? []} memberNameMap={memberNameMap} session={session} />
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold tracking-tight text-white/90">Settlement Preview</h2>
                    <p className="text-sm text-[var(--color-text-secondary)]">
                        이번 세션의 페널티 및 정산 예정 내역입니다. 체크박스를 해제하여 면제할 수 있습니다.
                    </p>
                </div>
                <Button
                    onClick={handleFinalize}
                    disabled={isFinalizing}
                    className="bg-rose-600 hover:bg-rose-700 text-white shadow-[0_0_15px_rgba(244,63,94,0.4)] transition-all hover:scale-105"
                >
                    {isFinalizing ? "Finalizing..." : "Finalize Session"}
                </Button>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <Card className="bg-[var(--color-surface)] border-[var(--color-border)]">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-[var(--color-text-muted)]">
                            Total Score Penalty
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className={`text-2xl font-bold ${totalScoreDelta < 0 ? 'text-rose-400' : 'text-gray-400'}`}>
                            {totalScoreDelta > 0 ? `+${totalScoreDelta}` : totalScoreDelta}
                        </div>
                    </CardContent>
                </Card>
                <Card className="bg-[var(--color-surface)] border-[var(--color-border)]">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-[var(--color-text-muted)]">
                            Total Deposit Penalty
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className={`text-2xl font-bold ${totalDepositDelta < 0 ? 'text-rose-400' : 'text-gray-400'}`}>
                            {formatNumber(totalDepositDelta)} KRW
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="rounded-xl border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)]">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-gray-900/50 hover:bg-gray-900/50">
                            <TableHead className="w-[50px] text-center">Apply</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Member</TableHead>
                            <TableHead>Reason</TableHead>
                            <TableHead className="text-right">Score</TableHead>
                            <TableHead className="text-right">Deposit</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {penalties.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center py-12 text-[var(--color-text-muted)]">
                                    패널티 부과 대상이 없습니다.
                                </TableCell>
                            </TableRow>
                        ) : (
                            penalties.map((penalty, idx) => {
                                const isMilestone = penalty.type === "MILESTONE_FINE";
                                const isSkipped = skippedIndices.has(idx);
                                const isApplied = !isSkipped;

                                return (
                                    <TableRow
                                        key={idx}
                                        className={`transition-colors hover:bg-white/5 ${isMilestone ? 'bg-yellow-500/5' : ''} ${!isApplied ? 'opacity-50' : ''}`}
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
                                        <TableCell className="font-medium text-gray-300">{penalty.member_name}</TableCell>
                                        <TableCell className="text-[var(--color-text-secondary)] text-sm max-w-[300px] truncate" title={penalty.description}>
                                            {penalty.description}
                                        </TableCell>
                                        <TableCell className={`text-right font-mono ${penalty.score_delta < 0 ? 'text-rose-400' : 'text-gray-400'}`}>
                                            {penalty.score_delta}
                                        </TableCell>
                                        <TableCell className={`text-right font-mono ${penalty.deposit_delta < 0 ? 'text-rose-400' : 'text-gray-400'}`}>
                                            {formatNumber(penalty.deposit_delta)}
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-lg bg-yellow-500/5 border border-yellow-500/20 text-yellow-500/90 text-sm">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <p>
                    Finalize 버튼을 누르면 위 내역(체크된 항목)이 <strong>Ledger</strong>에 영구 기록되며, 멤버들의 점수와 보증금이 즉시 차감됩니다.
                    이 작업은 되돌릴 수 없습니다.
                </p>
            </div>

            <MeritPanel sessionId={session.id} merits={sessionMerits ?? []} memberNameMap={memberNameMap} session={session} />
        </div>
    );
}

interface MeritEntry {
    id: number;
    member_id: number;
    score_delta: number;
    description: string;
    created_at: string;
}

function MeritPanel({
    sessionId,
    merits,
    memberNameMap,
    session,
}: {
    sessionId: number;
    merits: MeritEntry[];
    memberNameMap: Map<number, string>;
    session: Session;
}) {
    const { mutate: deleteMerit, isPending: isDeleting } = useDeleteLedgerEntry();
    const { mutate: updateMerit, isPending: isUpdating } = useUpdateLedger();

    return (
        <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
                <div className="flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-yellow-500" />
                    <h3 className="font-semibold text-sm">이 세션 상점 내역</h3>
                    {merits.length > 0 && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
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
                        <Button size="sm" variant="outline" className="h-7 text-xs bg-yellow-500/10 text-yellow-400 border-yellow-500/20 hover:bg-yellow-500/20">
                            <Trophy className="w-3 h-3 mr-1" />
                            상점 부여
                        </Button>
                    }
                />
            </div>
            <Table>
                <TableHeader>
                    <TableRow className="bg-gray-900/30 hover:bg-gray-900/30">
                        <TableHead>멤버</TableHead>
                        <TableHead>사유</TableHead>
                        <TableHead className="text-right w-[80px]">점수</TableHead>
                        <TableHead className="text-right w-[120px] text-[var(--color-text-muted)] font-normal text-xs">일시</TableHead>
                        <TableHead className="w-[72px]" />
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {merits.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={5} className="text-center py-8 text-[var(--color-text-muted)] text-sm">
                                이 세션에 부여된 상점이 없습니다.
                            </TableCell>
                        </TableRow>
                    ) : (
                        merits.map((entry) => (
                            <MeritRow
                                key={entry.id}
                                entry={entry}
                                memberName={memberNameMap.get(entry.member_id) ?? `ID:${entry.member_id}`}
                                onDelete={() => deleteMerit(entry.id)}
                                onUpdate={(data) => updateMerit({ id: entry.id, data })}
                                isDeleting={isDeleting}
                                isUpdating={isUpdating}
                            />
                        ))
                    )}
                </TableBody>
            </Table>
        </div>
    );
}

function MeritRow({
    entry,
    memberName,
    onDelete,
    onUpdate,
    isDeleting,
    isUpdating,
}: {
    entry: MeritEntry;
    memberName: string;
    onDelete: () => void;
    onUpdate: (data: { score_delta?: number; description?: string }) => void;
    isDeleting: boolean;
    isUpdating: boolean;
}) {
    const [editOpen, setEditOpen] = useState(false);
    const [editScore, setEditScore] = useState(entry.score_delta);
    const [editReason, setEditReason] = useState(entry.description);

    React.useEffect(() => {
        setEditScore(entry.score_delta);
        setEditReason(entry.description);
    }, [entry.score_delta, entry.description]);

    const handleSave = () => {
        onUpdate({ score_delta: editScore, description: editReason });
        setEditOpen(false);
    };

    return (
        <TableRow className="group/row hover:bg-white/5">
            <TableCell className="font-medium text-gray-300">{memberName}</TableCell>
            <TableCell className="text-sm text-[var(--color-text-secondary)]">{entry.description}</TableCell>
            <TableCell className="text-right font-mono text-green-400">+{entry.score_delta}</TableCell>
            <TableCell className="text-right text-xs font-mono text-[var(--color-text-muted)]">
                {new Date(entry.created_at).toLocaleDateString()}
            </TableCell>
            <TableCell>
                <div className="flex items-center justify-end gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
                    <Popover open={editOpen} onOpenChange={setEditOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 hover:bg-white/10"
                                disabled={isUpdating}
                            >
                                <Pencil className="w-3 h-3" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 bg-[var(--color-elevated)] border-[var(--color-border)] p-3" align="end">
                            <div className="space-y-3">
                                <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase">상점 수정</p>
                                <div className="space-y-1">
                                    <label className="text-xs text-[var(--color-text-muted)]">점수</label>
                                    <Input
                                        type="number"
                                        value={editScore}
                                        onChange={(e) => setEditScore(Number(e.target.value))}
                                        className="h-7 text-sm bg-transparent border-[var(--color-border)]"
                                        min={1}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-[var(--color-text-muted)]">사유</label>
                                    <Input
                                        value={editReason}
                                        onChange={(e) => setEditReason(e.target.value)}
                                        className="h-7 text-sm bg-transparent border-[var(--color-border)]"
                                    />
                                </div>
                                <Button
                                    size="sm"
                                    onClick={handleSave}
                                    disabled={isUpdating || !editReason}
                                    className="w-full h-7 text-xs bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]"
                                >
                                    저장
                                </Button>
                            </div>
                        </PopoverContent>
                    </Popover>

                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 hover:bg-rose-500/10 hover:text-rose-400"
                        onClick={onDelete}
                        disabled={isDeleting}
                    >
                        <Trash2 className="w-3 h-3" />
                    </Button>
                </div>
            </TableCell>
        </TableRow>
    );
}
