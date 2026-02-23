import { useState, useMemo } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { useSettlementPreview, useFinalizeSession } from "@/hooks";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { formatNumber } from "@/lib/utils";
import { toast } from "sonner";
import type { Session } from "@/hooks/useSessions";

const PENALTY_TYPE_LABEL: Record<string, string> = {
    ATTENDANCE:    "출결",
    PPT:           "PPT",
    HOMEWORK:      "과제미제출",
    MILESTONE_FINE: "마일스톤",
};

export default function SettlementTab() {
    const { session } = useOutletContext<{ session: Session }>();
    const navigate = useNavigate();
    const { data: previewData, isLoading } = useSettlementPreview(session.id);
    const { mutate: finalizeSession, isPending: isFinalizing } = useFinalizeSession();

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
            <div className="flex flex-col items-center justify-center p-12 text-center bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl animate-in fade-in zoom-in-95 duration-500">
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
        </div>
    );
}
