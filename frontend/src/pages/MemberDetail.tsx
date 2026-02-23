import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
    ArrowLeft,
    CreditCard,
    History,
    ShieldAlert,
    Trophy,
    Pencil
} from "lucide-react";
import { useMember, useLedger, useDeactivateMember, useCreateTransaction } from "@/hooks";
import type { LedgerEntry } from "@/hooks";
import { PageHeader } from "@/components/PageHeader";
import { ScoreDisplay } from "@/components/ScoreDisplay";
import { StatusBadge } from "@/components/StatusBadge";
import { MemberEditSheet } from "@/components/MemberEditSheet";
import { GrantMeritDialog } from "@/components/GrantMeritDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";

export default function MemberDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const memberId = Number(id);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [isDepositOpen, setIsDepositOpen] = useState(false);
    const [txType, setTxType] = useState("DEPOSIT_RECHARGE");
    const [txAmount, setTxAmount] = useState(0);
    const [txDesc, setTxDesc] = useState("");

    const { data: member, isLoading: isLoadingMember } = useMember(memberId);
    const { data: ledger, isLoading: isLoadingLedger } = useLedger({ member_id: memberId });
    const deactivateMutation = useDeactivateMember();
    const { mutate: createTransaction, isPending: isCreatingTx } = useCreateTransaction();

    if (isLoadingMember || isLoadingLedger) {
        return (
            <div className="flex h-full items-center justify-center">
                <span className="inline-block w-8 h-8 border-2 border-[var(--color-border)] border-t-[var(--color-accent)] rounded-full animate-spin" />
            </div>
        );
    }

    if (!member) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)]">
                <p>Member not found</p>
                <Button variant="link" onClick={() => navigate("/members")}>Go back</Button>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            <PageHeader
                title={member.name}
                subtitle={member.email}
                actions={
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => navigate("/members")}>
                            <ArrowLeft className="w-4 h-4 mr-2" /> Back
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setIsEditOpen(true)}>
                            <Pencil className="w-4 h-4 mr-2" /> Edit
                        </Button>
                        {member.is_active ? (
                            <Dialog>
                                <DialogTrigger asChild>
                                    <Button variant="destructive" size="sm">
                                        <ShieldAlert className="w-4 h-4 mr-2" /> Deactivate
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="bg-[var(--color-elevated)] border-[var(--color-border)] text-[var(--color-text-primary)]">
                                    <DialogHeader>
                                        <DialogTitle>Deactivate Member</DialogTitle>
                                        <DialogDescription>
                                            Are you sure you want to deactivate {member.name}?
                                            The remaining deposit of <strong>{(member.current_deposit || 0).toLocaleString()} KRW</strong> will be refunded.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <DialogFooter>
                                        <Button variant="outline" onClick={() => { }}>Cancel</Button>
                                        <Button
                                            variant="destructive"
                                            onClick={() => {
                                                deactivateMutation.mutate(member.id, {
                                                    onSuccess: () => navigate("/members")
                                                });
                                            }}
                                            disabled={deactivateMutation.isPending}
                                        >
                                            {deactivateMutation.isPending ? "Deactivating..." : "Confirm Deactivate"}
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        ) : (
                            <div className="px-3 py-1 bg-red-500/10 text-red-500 text-sm rounded cursor-not-allowed">
                                Inactive
                            </div>
                        )}

                        <MemberEditSheet
                            member={member}
                            open={isEditOpen}
                            onOpenChange={setIsEditOpen}
                        />
                    </div>
                }
            />

            <div className="flex-1 overflow-y-auto p-6 space-y-8">
                {/* Top Stats */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Deposit Card */}
                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 flex flex-col justify-between">
                        <div className="flex items-start justify-between mb-4">
                            <div className="flex items-center gap-3 text-[var(--color-text-secondary)]">
                                <CreditCard className="w-5 h-5" />
                                <span className="text-sm font-medium">Deposit Balance</span>
                            </div>
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setIsDepositOpen(true)}>Manage</Button>
                        </div>
                        <div>
                            <span className={`text-3xl font-mono font-bold ${(member.current_deposit || 0) < 10000 ? "text-rose-400" : "text-white"}`}>
                                ₩{(member.current_deposit || 0).toLocaleString()}
                            </span>
                            {(member.current_deposit || 0) < 10000 && (
                                <p className="text-xs text-rose-400 mt-1">⚠️ 최소 유지 금액(10,000원) 미만입니다.</p>
                            )}
                        </div>
                    </div>

                    {/* Score Card */}
                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
                        <div className="flex items-start justify-between mb-4">
                            <div className="flex items-center gap-3 text-[var(--color-text-secondary)]">
                                <Trophy className="w-5 h-5" />
                                <span className="text-sm font-medium">Total Score</span>
                            </div>
                            <GrantMeritDialog
                                preselectedMemberId={member.id}
                                trigger={
                                    <Button size="sm" variant="outline" className="h-7 text-xs bg-[var(--color-accent)]/10 text-[var(--color-accent)] border-[var(--color-accent)]/20 hover:bg-[var(--color-accent)]/20">
                                        Grant Merit
                                    </Button>
                                }
                            />
                        </div>
                        <div className="flex items-center gap-6">
                            <ScoreDisplay
                                totalPlus={member.total_plus_score || 0}
                                totalMinus={member.total_minus_score || 0}
                                netScore={member.net_score || 0}
                                className="scale-125 origin-left"
                            />
                        </div>
                        <div className="mt-4 pt-4 border-t border-[var(--color-border)] text-xs text-[var(--color-text-muted)] flex justify-between">
                            <span>Tags:</span>
                            <div className="flex gap-2">
                                {member.tags.map(t => <span key={t} className="px-1.5 py-0.5 bg-white/5 rounded border border-white/10">{t}</span>)}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Ledger History */}
                <div className="space-y-4">
                    <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
                        <History className="w-4 h-4" />
                        <h3 className="text-sm font-bold uppercase tracking-wider">Transaction History</h3>
                    </div>

                    <div className="rounded-xl border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)]/50">
                        <Table>
                            <TableHeader className="bg-[var(--color-surface)]">
                                <TableRow className="border-b-[var(--color-border)] hover:bg-transparent">
                                    <TableHead className="w-[120px] text-[var(--color-text-muted)]">Date</TableHead>
                                    <TableHead className="text-[var(--color-text-muted)]">Type</TableHead>
                                    <TableHead className="text-[var(--color-text-muted)]">Description</TableHead>
                                    <TableHead className="text-right text-[var(--color-text-muted)]">Amount</TableHead>
                                    <TableHead className="text-right text-[var(--color-text-muted)]">Balance</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {ledger?.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-24 text-center text-[var(--color-text-muted)]">
                                            내역이 없습니다.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    ledger?.map((entry) => (
                                        <TableRow key={entry.id} className="border-b-[var(--color-border-subtle)] hover:bg-[var(--color-hover)]">
                                            <TableCell className="text-xs font-mono text-[var(--color-text-muted)]">
                                                {new Date(entry.created_at).toLocaleDateString()}
                                            </TableCell>
                                            <TableCell>
                                                <LedgerTypeBadge type={entry.type} />
                                            </TableCell>
                                            <TableCell className="text-sm text-[var(--color-text-secondary)]">
                                                {entry.description}
                                            </TableCell>
                                            <TableCell className={`text-right font-mono text-sm ${entry.amount_krw > 0 ? "text-green-400" : "text-rose-400"}`}>
                                                {entry.amount_krw > 0 ? "+" : ""}{entry.amount_krw.toLocaleString()}
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-sm text-[var(--color-text-muted)]">
                                                {entry.deposit_after.toLocaleString()}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </div>
            </div>

            {/* Deposit Management Dialog */}
            <Dialog open={isDepositOpen} onOpenChange={setIsDepositOpen}>
                <DialogContent className="sm:max-w-[400px] bg-[var(--color-elevated)] border-[var(--color-border)] text-[var(--color-text-primary)]">
                    <DialogHeader>
                        <DialogTitle>보증금 관리 — {member.name}</DialogTitle>
                        <DialogDescription>현재 잔액: ₩{(member.current_deposit || 0).toLocaleString()}</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label className="text-right">유형</Label>
                            <Select value={txType} onValueChange={setTxType}>
                                <SelectTrigger className="col-span-3">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="DEPOSIT_RECHARGE">DEPOSIT_RECHARGE (충전)</SelectItem>
                                    <SelectItem value="DEPOSIT_ADJUST">DEPOSIT_ADJUST (조정)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label className="text-right">금액 (KRW)</Label>
                            <Input
                                type="number"
                                className="col-span-3"
                                value={txAmount}
                                onChange={(e) => setTxAmount(parseInt(e.target.value) || 0)}
                                placeholder="양수=충전, 음수=차감"
                            />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label className="text-right">사유</Label>
                            <Input
                                className="col-span-3"
                                value={txDesc}
                                onChange={(e) => setTxDesc(e.target.value)}
                                placeholder="예: 신규 등록 보증금"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            disabled={isCreatingTx || !txDesc}
                            onClick={() => createTransaction(
                                { member_id: member.id, type: txType, amount_krw: txAmount, score_delta: 0, description: txDesc },
                                { onSuccess: () => { setIsDepositOpen(false); setTxAmount(0); setTxDesc(""); } }
                            )}
                        >
                            {isCreatingTx ? "처리 중..." : "적용"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function LedgerTypeBadge({ type }: { type: LedgerEntry["type"] }) {
    const styles: Record<string, string> = {
        DEPOSIT: "bg-blue-500/10 text-blue-400 border-blue-500/20",
        WITHDRAWAL: "bg-orange-500/10 text-orange-400 border-orange-500/20",
        FINE: "bg-rose-500/10 text-rose-400 border-rose-500/20",
        MERIT: "bg-green-500/10 text-green-400 border-green-500/20",
        REFUND: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    };
    return (
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${styles[type] || "bg-white/5 border-white/10"}`}>
            {type}
        </span>
    );
}
