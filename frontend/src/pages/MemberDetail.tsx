import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
    ArrowLeft,
    CreditCard,
    History,
    Loader2,
    ShieldAlert,
    GraduationCap,
    Trophy,
    Pencil,
    Trash2,
    CheckCircle2,
    AlertCircle
} from "lucide-react";
import { useMember, useLedger, useDeactivateMember, useReactivateMember, useGraduateMember, useCreateTransaction, useUpdateLedger, useDeleteLedgerEntry, useToggleMilestonePaid, LEDGER_TYPE_LABELS, translateDescription } from "@/hooks";
import type { LedgerEntry } from "@/hooks";
import { PageHeader } from "@/components/PageHeader";
import { ScoreDisplay } from "@/components/ScoreDisplay";
import { MemberEditSheet } from "@/components/MemberEditSheet";
import { GrantMeritDialog } from "@/components/GrantMeritDialog";
import { GivePenaltyDialog } from "@/components/GivePenaltyDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function MemberDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const memberId = Number(id);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [isDepositOpen, setIsDepositOpen] = useState(false);
    const [txType, setTxType] = useState("DEPOSIT_RECHARGE");
    const [txAmount, setTxAmount] = useState(0);
    const [txDesc, setTxDesc] = useState("");
    const [rechargeAmount, setRechargeAmount] = useState("");

    const { data: member, isLoading: isLoadingMember } = useMember(memberId);
    const { data: ledger, isLoading: isLoadingLedger } = useLedger({ member_id: memberId });
    const deactivateMutation = useDeactivateMember();
    const reactivateMutation = useReactivateMember();
    const graduateMutation = useGraduateMember();
    const { mutate: createTransaction, isPending: isCreatingTx } = useCreateTransaction();
    const { mutate: updateEntry, isPending: isUpdating } = useUpdateLedger();
    const { mutate: deleteEntry, isPending: isDeleting } = useDeleteLedgerEntry();
    const { mutateAsync: togglePaidAsync, isPending: isTogglingPaidTop } = useToggleMilestonePaid();

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
                <p>멤버를 찾을 수 없습니다</p>
                <Button variant="link" onClick={() => navigate("/members")}>돌아가기</Button>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            <PageHeader
                title={member.name}
                subtitle={member.email ?? undefined}
                actions={
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                        <Button variant="outline" size="sm" onClick={() => navigate("/members")}>
                            <ArrowLeft className="w-4 h-4 mr-2" /> 뒤로
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setIsEditOpen(true)}>
                            <Pencil className="w-4 h-4 mr-2" /> 수정
                        </Button>
                        {member.is_active ? (
                            <>
                                <Dialog>
                                    <DialogTrigger asChild>
                                        <Button size="sm" className="bg-emerald-100 hover:bg-emerald-200 border-emerald-300 text-emerald-700">
                                            <GraduationCap className="w-4 h-4 mr-2" /> 수료
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent className="bg-[var(--color-elevated)] border-[var(--color-border)] text-[var(--color-text-primary)]">
                                        <DialogHeader>
                                            <DialogTitle>수료 처리</DialogTitle>
                                            <DialogDescription>
                                                {member.name}을(를) 수료 처리하시겠습니까?
                                                잔여 디파짓 <strong>₩{(member.current_deposit || 0).toLocaleString()}</strong>이 환급됩니다.
                                            </DialogDescription>
                                        </DialogHeader>
                                        <DialogFooter>
                                            <DialogClose asChild><Button variant="outline">취소</Button></DialogClose>
                                            <Button
                                                className="bg-emerald-600 hover:bg-emerald-700"
                                                onClick={() => {
                                                    graduateMutation.mutate(member.id, {
                                                        onSuccess: () => navigate("/members")
                                                    });
                                                }}
                                                disabled={graduateMutation.isPending}
                                            >
                                                {graduateMutation.isPending ? "처리 중..." : "수료 확인"}
                                            </Button>
                                        </DialogFooter>
                                    </DialogContent>
                                </Dialog>
                                <Dialog>
                                    <DialogTrigger asChild>
                                        <Button variant="destructive" size="sm">
                                            <ShieldAlert className="w-4 h-4 mr-2" /> 이탈 처리
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent className="bg-[var(--color-elevated)] border-[var(--color-border)] text-[var(--color-text-primary)]">
                                        <DialogHeader>
                                            <DialogTitle>이탈 처리 (비활성화)</DialogTitle>
                                            <DialogDescription>
                                                {member.name}을(를) 이탈 처리하시겠습니까?
                                                잔여 디파짓 <strong>₩{(member.current_deposit || 0).toLocaleString()}</strong>은 금고로 귀속되며 환급되지 않습니다.
                                            </DialogDescription>
                                        </DialogHeader>
                                        <DialogFooter>
                                            <DialogClose asChild><Button variant="outline">취소</Button></DialogClose>
                                            <Button
                                                variant="destructive"
                                                onClick={() => {
                                                    deactivateMutation.mutate(member.id, {
                                                        onSuccess: () => navigate("/members")
                                                    });
                                                }}
                                                disabled={deactivateMutation.isPending}
                                            >
                                                {deactivateMutation.isPending ? "처리 중..." : "이탈 처리 확인"}
                                            </Button>
                                        </DialogFooter>
                                    </DialogContent>
                                </Dialog>
                            </>
                        ) : (
                            <Button
                                size="sm"
                                onClick={() => {
                                    if (confirm(`${member?.name}을(를) 재활성화하시겠습니까?`)) {
                                        reactivateMutation.mutate(memberId);
                                    }
                                }}
                                disabled={reactivateMutation.isPending}
                                className="bg-green-100 hover:bg-green-200 border-green-300 text-green-700"
                            >
                                {reactivateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                                재활성화
                            </Button>
                        )}

                        <MemberEditSheet
                            member={member}
                            open={isEditOpen}
                            onOpenChange={setIsEditOpen}
                        />
                    </div>
                }
            />

            <div className="flex-1 overflow-y-auto p-3 md:p-6 space-y-6 md:space-y-8">
                {/* 받을 돈 요약 — 디파짓 부족 또는 미납 벌금 있을 때 */}
                {(() => {
                    const unpaidEntries = (ledger ?? []).filter(
                        (e: LedgerEntry) => e.type === "MILESTONE_FINE" && !e.is_paid
                    );
                    const unpaidMilestoneTotal = unpaidEntries.reduce(
                        (sum: number, e: LedgerEntry) => sum + Math.abs(e.amount_krw), 0
                    );
                    const needsDeposit = (member.current_deposit || 0) < 10000 && member.is_active;
                    const depositShortfall = needsDeposit ? 20000 - (member.current_deposit || 0) : 0;
                    const totalReceivable = depositShortfall + unpaidMilestoneTotal;

                    if (totalReceivable === 0) return null;

                    const confirmAllPaid = async () => {
                        const totalTxt = `₩${unpaidMilestoneTotal.toLocaleString()}`;
                        if (!confirm(`${member.name}님의 누적벌점 벌금 ${totalTxt} (${unpaidEntries.length}건) 납부를 확인 처리합니다.\n금고 수입으로 반영됩니다.`)) return;
                        for (const e of unpaidEntries) {
                            await togglePaidAsync({ id: e.id, is_paid: true });
                        }
                    };

                    return (
                        <div className="rounded-xl border border-rose-500/40 bg-rose-500/5 p-4 md:p-5">
                            <div className="flex items-center gap-2 mb-3">
                                <AlertCircle className="w-4 h-4 text-rose-500" />
                                <span className="text-sm font-bold text-rose-500 uppercase tracking-wider">받아야 할 돈</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 md:gap-4">
                                <div>
                                    <div className="text-[11px] text-[var(--color-text-muted)] mb-1">디파짓 충전</div>
                                    <div className={`text-lg font-bold ${depositShortfall > 0 ? "text-rose-500" : "text-[var(--color-text-muted)]"}`}>
                                        {depositShortfall > 0 ? `₩${depositShortfall.toLocaleString()}` : "-"}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[11px] text-[var(--color-text-muted)] mb-1">누적벌점 벌금 미납</div>
                                    <div className={`text-lg font-bold ${unpaidMilestoneTotal > 0 ? "text-rose-500" : "text-[var(--color-text-muted)]"}`}>
                                        {unpaidMilestoneTotal > 0 ? `₩${unpaidMilestoneTotal.toLocaleString()}` : "-"}
                                    </div>
                                </div>
                                <div className="sm:border-l sm:border-rose-500/20 sm:pl-4">
                                    <div className="text-[11px] text-[var(--color-text-muted)] mb-1">총 받을 돈</div>
                                    <div className="text-2xl font-extrabold text-rose-500">
                                        ₩{totalReceivable.toLocaleString()}
                                    </div>
                                </div>
                            </div>
                            {unpaidMilestoneTotal > 0 && (
                                <div className="mt-4 pt-4 border-t border-rose-500/20 flex items-center justify-between gap-3 flex-wrap">
                                    <div className="text-xs text-[var(--color-text-muted)]">
                                        누적벌점 벌금 {unpaidEntries.length}건이 미납 상태입니다. 납부를 받으셨으면 확인 처리해주세요.
                                    </div>
                                    <Button
                                        onClick={confirmAllPaid}
                                        disabled={isTogglingPaidTop}
                                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-sm shadow-emerald-500/20"
                                    >
                                        <CheckCircle2 className="w-4 h-4 mr-2" />
                                        {isTogglingPaidTop ? "처리 중..." : `누적벌점 벌금 납부 확인 (₩${unpaidMilestoneTotal.toLocaleString()})`}
                                    </Button>
                                </div>
                            )}
                        </div>
                    );
                })()}

                {/* Top Stats */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                    {/* Deposit Card */}
                    <div className={`rounded-xl border bg-[var(--color-surface)] p-4 md:p-6 flex flex-col justify-between ${(member.current_deposit || 0) < 10000 ? "border-rose-500/40" : "border-[var(--color-border)]"}`}>
                        <div className="flex items-start justify-between mb-4">
                            <div className="flex items-center gap-3 text-[var(--color-text-secondary)]">
                                <CreditCard className="w-5 h-5" />
                                <span className="text-sm font-medium">디파짓 잔액</span>
                            </div>
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setIsDepositOpen(true)}>관리</Button>
                        </div>
                        <div>
                            <span className={`text-2xl md:text-3xl font-bold ${(member.current_deposit || 0) < 10000 ? "text-rose-500" : "text-[var(--color-text-primary)]"}`}>
                                ₩{(member.current_deposit || 0).toLocaleString()}
                            </span>
                        </div>
                        {(member.current_deposit || 0) < 10000 && member.is_active && (
                            <div className="mt-4 pt-4 border-t border-rose-500/20">
                                <div className="flex items-center gap-2 mb-3">
                                    <span className="text-xs font-semibold text-rose-500 uppercase tracking-wider">충전 요망</span>
                                    <span className="text-[10px] text-[var(--color-text-muted)]">
                                        부족분: ₩{(20000 - (member.current_deposit || 0)).toLocaleString()}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        value={rechargeAmount}
                                        onChange={e => setRechargeAmount(e.target.value)}
                                        placeholder={String(20000 - (member.current_deposit || 0))}
                                        className="flex-1 px-3 py-1.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-sm"
                                    />
                                    <Button
                                        size="sm"
                                        className="h-8 bg-blue-600 hover:bg-blue-700 text-white"
                                        disabled={isCreatingTx}
                                        onClick={() => {
                                            const amt = parseInt(rechargeAmount) || (20000 - (member.current_deposit || 0));
                                            if (amt > 0) {
                                                createTransaction(
                                                    { member_id: member.id, type: "DEPOSIT_RECHARGE", amount_krw: amt, score_delta: 0, description: "디파짓 충전" },
                                                    { onSuccess: () => setRechargeAmount("") }
                                                );
                                            }
                                        }}
                                    >
                                        {isCreatingTx ? "처리 중..." : "충전 확인"}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Score Card */}
                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:p-6">
                        <div className="flex items-start justify-between mb-4">
                            <div className="flex items-center gap-3 text-[var(--color-text-secondary)]">
                                <Trophy className="w-5 h-5" />
                                <span className="text-sm font-medium">총 점수</span>
                            </div>
                            <div className="flex gap-1.5">
                                <GrantMeritDialog
                                    preselectedMemberId={member.id}
                                    trigger={
                                        <Button size="sm" variant="outline" className="h-7 text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/20">
                                            상점 부여
                                        </Button>
                                    }
                                />
                                <GivePenaltyDialog
                                    memberId={member.id}
                                    memberName={member.name}
                                    trigger={
                                        <Button size="sm" variant="outline" className="h-7 text-xs bg-rose-500/10 text-rose-500 border-rose-500/20 hover:bg-rose-500/20">
                                            벌점 부여
                                        </Button>
                                    }
                                />
                            </div>
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
                            <span>태그:</span>
                            <div className="flex gap-2">
                                {member.tags.map(t => <span key={t} className="px-1.5 py-0.5 bg-[var(--color-hover)] rounded border border-[var(--color-border)]">{t}</span>)}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Ledger History */}
                <div className="space-y-4">
                    <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
                        <History className="w-4 h-4" />
                        <h3 className="text-sm font-bold uppercase tracking-wider">거래 내역</h3>
                    </div>

                    {/* Desktop 테이블 */}
                    <div className="hidden md:block rounded-xl border border-[var(--color-border)] overflow-x-auto bg-[var(--color-surface)]/50">
                        <Table>
                            <TableHeader className="bg-[var(--color-surface)]">
                                <TableRow className="border-b-[var(--color-border)] hover:bg-transparent">
                                    <TableHead className="w-[120px] text-[var(--color-text-muted)]">날짜</TableHead>
                                    <TableHead className="w-[140px] text-[var(--color-text-muted)]">세션</TableHead>
                                    <TableHead className="text-[var(--color-text-muted)]">유형</TableHead>
                                    <TableHead className="text-[var(--color-text-muted)]">설명</TableHead>
                                    <TableHead className="text-right text-[var(--color-text-muted)]">금액</TableHead>
                                    <TableHead className="text-right text-[var(--color-text-muted)]">점수</TableHead>
                                    <TableHead className="text-right text-[var(--color-text-muted)]">잔액</TableHead>
                                    <TableHead className="w-[72px]" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {ledger?.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={8} className="h-24 text-center text-[var(--color-text-muted)]">
                                            내역이 없습니다.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    ledger?.map((entry) => (
                                        <LedgerRow
                                            key={entry.id}
                                            entry={entry}
                                            memberName={member.name}
                                            onDelete={() => deleteEntry(entry.id)}
                                            onUpdate={(data) => updateEntry({ id: entry.id, data })}
                                            isDeleting={isDeleting}
                                            isUpdating={isUpdating}
                                        />
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Mobile 카드 */}
                    <div className="md:hidden space-y-2">
                        {!ledger || ledger.length === 0 ? (
                            <div className="text-center py-8 text-[var(--color-text-muted)] text-sm">내역이 없습니다.</div>
                        ) : (
                            ledger.map((entry) => (
                                <LedgerCardMobile
                                    key={entry.id}
                                    entry={entry}
                                    memberName={member.name}
                                    onDelete={() => deleteEntry(entry.id)}
                                    onUpdate={(data) => updateEntry({ id: entry.id, data })}
                                    isDeleting={isDeleting}
                                    isUpdating={isUpdating}
                                />
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Deposit Management Dialog */}
            <Dialog open={isDepositOpen} onOpenChange={setIsDepositOpen}>
                <DialogContent className="sm:max-w-[400px] bg-[var(--color-elevated)] border-[var(--color-border)] text-[var(--color-text-primary)]">
                    <DialogHeader>
                        <DialogTitle>디파짓 관리 — {member.name}</DialogTitle>
                        <DialogDescription>현재 잔액: ₩{(member.current_deposit || 0).toLocaleString()}</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label className="text-right">유형</Label>
                            <Select value={txType} onValueChange={(v) => { setTxType(v); setTxAmount(0); }}>
                                <SelectTrigger className="col-span-3">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="DEPOSIT_RECHARGE">디파짓 충전 (+)</SelectItem>
                                    <SelectItem value="DEPOSIT_ADJUST">디파짓 차감 (-)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label className="text-right">금액 (원)</Label>
                            <div className="col-span-3 relative">
                                <span className={`absolute left-3 top-1/2 -translate-y-1/2 font-medium text-sm ${txType === "DEPOSIT_RECHARGE" ? "text-green-600" : "text-rose-500"}`}>
                                    {txType === "DEPOSIT_RECHARGE" ? "+" : "-"}
                                </span>
                                <Input
                                    type="number"
                                    value={txAmount}
                                    onChange={(e) => setTxAmount(Math.abs(parseInt(e.target.value) || 0))}
                                    min={0}
                                    className="pl-7"
                                    placeholder={txType === "DEPOSIT_RECHARGE" ? "충전할 금액" : "차감할 금액"}
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label className="text-right">사유</Label>
                            <Input
                                className="col-span-3"
                                value={txDesc}
                                onChange={(e) => setTxDesc(e.target.value)}
                                placeholder={txType === "DEPOSIT_RECHARGE" ? "예: 디파짓 재충전" : "예: 오입금 정정"}
                            />
                        </div>
                        {txAmount > 0 && (
                            <div className={`rounded-lg px-4 py-3 text-sm flex justify-between ${
                                txType === "DEPOSIT_RECHARGE"
                                    ? "bg-green-500/5 border border-green-500/20"
                                    : "bg-rose-500/5 border border-rose-500/20"
                            }`}>
                                <span className="text-[var(--color-text-muted)]">변동 후 잔액</span>
                                <span className="font-medium">
                                    ₩{(
                                        (member.current_deposit || 0) + (txType === "DEPOSIT_RECHARGE" ? txAmount : -txAmount)
                                    ).toLocaleString()}
                                </span>
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button
                            disabled={isCreatingTx || !txDesc || txAmount === 0}
                            onClick={() => {
                                const finalAmount = txType === "DEPOSIT_RECHARGE" ? txAmount : -txAmount;
                                createTransaction(
                                    { member_id: member.id, type: txType, amount_krw: finalAmount, score_delta: 0, description: txDesc },
                                    { onSuccess: () => { setIsDepositOpen(false); setTxAmount(0); setTxDesc(""); } }
                                );
                            }}
                        >
                            {isCreatingTx ? "처리 중..." : txType === "DEPOSIT_RECHARGE" ? "충전" : "차감"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function LedgerRow({
    entry,
    memberName,
    onDelete,
    onUpdate,
    isDeleting,
    isUpdating,
}: {
    entry: LedgerEntry;
    memberName: string;
    onDelete: () => void;
    onUpdate: (data: { amount_krw?: number; description?: string }) => void;
    isDeleting: boolean;
    isUpdating: boolean;
}) {
    const [editOpen, setEditOpen] = useState(false);
    const [editAmount, setEditAmount] = useState(entry.amount_krw);
    const [editDesc, setEditDesc] = useState(entry.description);
    const { mutate: togglePaid, isPending: isTogglingPaid } = useToggleMilestonePaid();

    useEffect(() => {
        setEditAmount(entry.amount_krw);
        setEditDesc(entry.description);
    }, [entry.amount_krw, entry.description]);

    const handleSave = () => {
        onUpdate({ amount_krw: editAmount, description: editDesc });
        setEditOpen(false);
    };

    return (
        <TableRow className="group/row border-b-[var(--color-border-subtle)] hover:bg-[var(--color-hover)]">
            <TableCell className="text-xs text-[var(--color-text-muted)]">
                {new Date(entry.created_at).toLocaleDateString()}
            </TableCell>
            <TableCell className="text-xs text-[var(--color-text-muted)]">
                {entry.session_title ? (
                    <div>
                        <span className="text-[var(--color-text-secondary)]">{entry.session_title}</span>
                        {entry.session_date && <span className="block text-[var(--color-text-muted)] opacity-60">{entry.session_date}</span>}
                    </div>
                ) : (
                    <span className="opacity-40">—</span>
                )}
            </TableCell>
            <TableCell>
                <LedgerTypeBadge type={entry.type} />
            </TableCell>
            <TableCell className="text-sm text-[var(--color-text-secondary)]">
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span>{translateDescription(entry.description)}</span>
                    {entry.type === "MILESTONE_FINE" && (
                        entry.is_paid ? (
                            <Badge variant="outline" className="border-gray-400/50 text-gray-500 bg-gray-100 text-[10px] py-0 px-1.5 h-5">
                                <CheckCircle2 className="w-3 h-3 mr-0.5" /> 납부 완료
                            </Badge>
                        ) : (
                            <>
                                <Badge variant="outline" className="border-rose-500/50 text-rose-600 bg-rose-500/10 text-[10px] py-0 px-1.5 h-5 font-semibold">
                                    <AlertCircle className="w-3 h-3 mr-0.5" /> 미납 — 납부 확인 필요
                                </Badge>
                                <button
                                    onClick={() => {
                                        if (confirm(`${memberName}님의 누적벌점 벌금 ${Math.abs(entry.amount_krw).toLocaleString()}원 납부를 확인 처리합니다.\n금고 수입으로 반영됩니다.`)) {
                                            togglePaid({ id: entry.id, is_paid: true });
                                        }
                                    }}
                                    disabled={isTogglingPaid}
                                    className="text-[10px] px-1.5 h-5 rounded border border-emerald-500/50 text-emerald-600 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-50"
                                >
                                    납부 확인
                                </button>
                            </>
                        )
                    )}
                </div>
            </TableCell>
            <TableCell className={`text-right text-sm ${entry.amount_krw > 0 ? "text-green-600" : entry.amount_krw < 0 ? "text-rose-500" : "text-[var(--color-text-muted)]"}`}>
                {entry.amount_krw !== 0 ? `${entry.amount_krw > 0 ? "+" : ""}${entry.amount_krw.toLocaleString()}` : "-"}
            </TableCell>
            <TableCell className={`text-right text-sm ${entry.score_delta > 0 ? "text-green-600" : entry.score_delta < 0 ? "text-rose-500" : "text-[var(--color-text-muted)]"}`}>
                {entry.score_delta !== 0 ? (entry.score_delta > 0 ? `+${entry.score_delta}` : entry.score_delta) : "-"}
            </TableCell>
            <TableCell className="text-right text-sm text-[var(--color-text-muted)]">
                {entry.deposit_after.toLocaleString()}
            </TableCell>
            <TableCell>
                <div className="flex items-center justify-end gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
                    <Popover open={editOpen} onOpenChange={setEditOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 hover:bg-[var(--color-hover)]"
                                disabled={isUpdating}
                            >
                                <Pencil className="w-3 h-3" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent
                            className="w-64 bg-[var(--color-elevated)] border-[var(--color-border)] p-3"
                            align="end"
                        >
                            <div className="space-y-3">
                                <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase">장부 수정</p>
                                <div className="space-y-1">
                                    <label className="text-xs text-[var(--color-text-muted)]">금액 (원)</label>
                                    <Input
                                        type="number"
                                        value={editAmount}
                                        onChange={(e) => setEditAmount(Number(e.target.value))}
                                        className="h-7 text-sm bg-transparent border-[var(--color-border)]"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-[var(--color-text-muted)]">사유</label>
                                    <Input
                                        value={editDesc}
                                        onChange={(e) => setEditDesc(e.target.value)}
                                        className="h-7 text-sm bg-transparent border-[var(--color-border)]"
                                    />
                                </div>
                                <Button
                                    size="sm"
                                    onClick={handleSave}
                                    disabled={isUpdating || !editDesc}
                                    className="w-full h-7 text-xs bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]"
                                >
                                    저장
                                </Button>
                            </div>
                        </PopoverContent>
                    </Popover>

                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 hover:bg-rose-500/10 hover:text-rose-500"
                                disabled={isDeleting}
                            >
                                <Trash2 className="w-3 h-3" />
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="bg-[var(--color-elevated)] border-[var(--color-border)] text-[var(--color-text-primary)]">
                            <AlertDialogHeader>
                                <AlertDialogTitle>장부 항목 삭제</AlertDialogTitle>
                                <AlertDialogDescription>
                                    이 항목을 삭제하면 멤버의 잔액과 점수가 역전됩니다. 계속하시겠습니까?
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>취소</AlertDialogCancel>
                                <AlertDialogAction
                                    onClick={onDelete}
                                    className="bg-rose-600 hover:bg-rose-700"
                                >
                                    삭제
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </TableCell>
        </TableRow>
    );
}

function LedgerCardMobile({
    entry,
    memberName,
    onDelete,
    onUpdate,
    isDeleting,
    isUpdating,
}: {
    entry: LedgerEntry;
    memberName: string;
    onDelete: () => void;
    onUpdate: (data: { amount_krw?: number; description?: string }) => void;
    isDeleting: boolean;
    isUpdating: boolean;
}) {
    const [editOpen, setEditOpen] = useState(false);
    const [editAmount, setEditAmount] = useState(entry.amount_krw);
    const [editDesc, setEditDesc] = useState(entry.description);
    const { mutate: togglePaid, isPending: isTogglingPaid } = useToggleMilestonePaid();

    useEffect(() => {
        setEditAmount(entry.amount_krw);
        setEditDesc(entry.description);
    }, [entry.amount_krw, entry.description]);

    const handleSave = () => {
        onUpdate({ amount_krw: editAmount, description: editDesc });
        setEditOpen(false);
    };

    return (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                    <LedgerTypeBadge type={entry.type} />
                    {entry.session_title && (
                        <span className="text-[10px] text-[var(--color-text-muted)]">{entry.session_title}</span>
                    )}
                </div>
                <div className="text-right flex-shrink-0">
                    <div className={`text-sm font-bold ${entry.amount_krw > 0 ? "text-green-600" : entry.amount_krw < 0 ? "text-rose-500" : "text-[var(--color-text-muted)]"}`}>
                        {entry.amount_krw !== 0 ? `${entry.amount_krw > 0 ? "+" : ""}${entry.amount_krw.toLocaleString()}` : "-"}
                    </div>
                    {entry.score_delta !== 0 && (
                        <div className={`text-[10px] ${entry.score_delta < 0 ? "text-rose-500" : "text-green-600"}`}>
                            {entry.score_delta > 0 ? `+${entry.score_delta}` : entry.score_delta}점
                        </div>
                    )}
                </div>
            </div>
            <div className="text-xs text-[var(--color-text-secondary)] break-words">
                {translateDescription(entry.description)}
            </div>
            {entry.type === "MILESTONE_FINE" && (
                entry.is_paid ? (
                    <Badge variant="outline" className="border-gray-400/50 text-gray-500 bg-gray-100 text-[10px] py-0 px-1.5 h-5">
                        <CheckCircle2 className="w-3 h-3 mr-0.5" /> 납부 완료
                    </Badge>
                ) : (
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="outline" className="border-rose-500/50 text-rose-600 bg-rose-500/10 text-[10px] py-0 px-1.5 h-5 font-semibold">
                            <AlertCircle className="w-3 h-3 mr-0.5" /> 미납
                        </Badge>
                        <button
                            onClick={() => {
                                if (confirm(`${memberName}님의 누적벌점 벌금 ${Math.abs(entry.amount_krw).toLocaleString()}원 납부를 확인 처리합니다.`)) {
                                    togglePaid({ id: entry.id, is_paid: true });
                                }
                            }}
                            disabled={isTogglingPaid}
                            className="text-[10px] px-2 h-6 rounded border border-emerald-500/50 text-emerald-600 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-50"
                        >
                            납부 확인
                        </button>
                    </div>
                )
            )}
            <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)] pt-1 border-t border-[var(--color-border-subtle)]">
                <span>{new Date(entry.created_at).toLocaleDateString()}</span>
                <span>잔액 {entry.deposit_after.toLocaleString()}</span>
                <div className="flex items-center gap-1">
                    <Popover open={editOpen} onOpenChange={setEditOpen}>
                        <PopoverTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" disabled={isUpdating}>
                                <Pencil className="w-3 h-3" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 bg-[var(--color-elevated)] border-[var(--color-border)] p-3" align="end">
                            <div className="space-y-3">
                                <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase">장부 수정</p>
                                <div className="space-y-1">
                                    <label className="text-xs text-[var(--color-text-muted)]">금액 (원)</label>
                                    <Input type="number" value={editAmount} onChange={(e) => setEditAmount(Number(e.target.value))} className="h-7 text-sm" />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-[var(--color-text-muted)]">사유</label>
                                    <Input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} className="h-7 text-sm" />
                                </div>
                                <Button size="sm" onClick={handleSave} disabled={isUpdating || !editDesc} className="w-full h-7 text-xs bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]">
                                    저장
                                </Button>
                            </div>
                        </PopoverContent>
                    </Popover>
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-rose-500" disabled={isDeleting}>
                                <Trash2 className="w-3 h-3" />
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="bg-[var(--color-elevated)] border-[var(--color-border)] text-[var(--color-text-primary)]">
                            <AlertDialogHeader>
                                <AlertDialogTitle>장부 항목 삭제</AlertDialogTitle>
                                <AlertDialogDescription>이 항목을 삭제하면 멤버의 잔액과 점수가 역전됩니다. 계속하시겠습니까?</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>취소</AlertDialogCancel>
                                <AlertDialogAction onClick={onDelete} className="bg-rose-600 hover:bg-rose-700">삭제</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </div>
        </div>
    );
}

function LedgerTypeBadge({ type }: { type: LedgerEntry["type"] }) {
    const styles: Record<string, string> = {
        FINE: "bg-rose-500/10 text-rose-500 border-rose-500/20",
        MILESTONE_FINE: "bg-red-500/10 text-red-600 border-red-500/20",
        DEPOSIT_RECHARGE: "bg-blue-500/10 text-blue-600 border-blue-500/20",
        DEPOSIT_ADJUST: "bg-sky-500/10 text-sky-600 border-sky-500/20",
        DEPOSIT_REFUND: "bg-purple-500/10 text-purple-600 border-purple-500/20",
        DEPOSIT_FORFEIT: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
        MERIT: "bg-green-500/10 text-green-600 border-green-500/20",
        ADJUSTMENT: "bg-orange-500/10 text-orange-600 border-orange-500/20",
    };
    return (
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${styles[type] || "bg-[var(--color-hover)] border-[var(--color-border)]"}`}>
            {LEDGER_TYPE_LABELS[type] ?? type}
        </span>
    );
}
