import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
    ArrowLeft,
    CreditCard,
    History,
    Loader2,
    ShieldAlert,
    Trophy,
    Pencil,
    Trash2
} from "lucide-react";
import { useMember, useLedger, useDeactivateMember, useReactivateMember, useCreateTransaction, useUpdateLedger, useDeleteLedgerEntry, LEDGER_TYPE_LABELS, translateDescription } from "@/hooks";
import type { LedgerEntry } from "@/hooks";
import { PageHeader } from "@/components/PageHeader";
import { ScoreDisplay } from "@/components/ScoreDisplay";
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

    const { data: member, isLoading: isLoadingMember } = useMember(memberId);
    const { data: ledger, isLoading: isLoadingLedger } = useLedger({ member_id: memberId });
    const deactivateMutation = useDeactivateMember();
    const reactivateMutation = useReactivateMember();
    const { mutate: createTransaction, isPending: isCreatingTx } = useCreateTransaction();
    const { mutate: updateEntry, isPending: isUpdating } = useUpdateLedger();
    const { mutate: deleteEntry, isPending: isDeleting } = useDeleteLedgerEntry();

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
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => navigate("/members")}>
                            <ArrowLeft className="w-4 h-4 mr-2" /> 뒤로
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setIsEditOpen(true)}>
                            <Pencil className="w-4 h-4 mr-2" /> 수정
                        </Button>
                        {member.is_active ? (
                            <Dialog>
                                <DialogTrigger asChild>
                                    <Button variant="destructive" size="sm">
                                        <ShieldAlert className="w-4 h-4 mr-2" /> 비활성화
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="bg-[var(--color-elevated)] border-[var(--color-border)] text-[var(--color-text-primary)]">
                                    <DialogHeader>
                                        <DialogTitle>멤버 비활성화</DialogTitle>
                                        <DialogDescription>
                                            {member.name}을(를) 비활성화하시겠습니까?
                                            잔여 보증금 <strong>₩{(member.current_deposit || 0).toLocaleString()}</strong>이 환불 처리됩니다.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <DialogFooter>
                                        <Button variant="outline" onClick={() => { }}>취소</Button>
                                        <Button
                                            variant="destructive"
                                            onClick={() => {
                                                deactivateMutation.mutate(member.id, {
                                                    onSuccess: () => navigate("/members")
                                                });
                                            }}
                                            disabled={deactivateMutation.isPending}
                                        >
                                            {deactivateMutation.isPending ? "처리 중..." : "비활성화 확인"}
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        ) : (
                            <Button
                                size="sm"
                                onClick={() => {
                                    if (confirm(`${member?.name}을(를) 재활성화하시겠습니까?`)) {
                                        reactivateMutation.mutate(memberId);
                                    }
                                }}
                                disabled={reactivateMutation.isPending}
                                className="bg-green-900/50 hover:bg-green-800 border-green-700 text-green-200"
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

            <div className="flex-1 overflow-y-auto p-6 space-y-8">
                {/* Top Stats */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Deposit Card */}
                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 flex flex-col justify-between">
                        <div className="flex items-start justify-between mb-4">
                            <div className="flex items-center gap-3 text-[var(--color-text-secondary)]">
                                <CreditCard className="w-5 h-5" />
                                <span className="text-sm font-medium">보증금 잔액</span>
                            </div>
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setIsDepositOpen(true)}>관리</Button>
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
                                <span className="text-sm font-medium">총 점수</span>
                            </div>
                            <GrantMeritDialog
                                preselectedMemberId={member.id}
                                trigger={
                                    <Button size="sm" variant="outline" className="h-7 text-xs bg-[var(--color-accent)]/10 text-[var(--color-accent)] border-[var(--color-accent)]/20 hover:bg-[var(--color-accent)]/20">
                                        상점 부여
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
                            <span>태그:</span>
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
                        <h3 className="text-sm font-bold uppercase tracking-wider">거래 내역</h3>
                    </div>

                    <div className="rounded-xl border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)]/50">
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
                                    <SelectItem value="DEPOSIT_RECHARGE">보증금 충전</SelectItem>
                                    <SelectItem value="DEPOSIT_ADJUST">보증금 조정</SelectItem>
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
                            disabled={isCreatingTx || !txDesc || txAmount === 0}
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

function LedgerRow({
    entry,
    onDelete,
    onUpdate,
    isDeleting,
    isUpdating,
}: {
    entry: LedgerEntry;
    onDelete: () => void;
    onUpdate: (data: { amount_krw?: number; description?: string }) => void;
    isDeleting: boolean;
    isUpdating: boolean;
}) {
    const [editOpen, setEditOpen] = useState(false);
    const [editAmount, setEditAmount] = useState(entry.amount_krw);
    const [editDesc, setEditDesc] = useState(entry.description);

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
            <TableCell className="text-xs font-mono text-[var(--color-text-muted)]">
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
                {translateDescription(entry.description)}
            </TableCell>
            <TableCell className={`text-right font-mono text-sm ${entry.amount_krw > 0 ? "text-green-400" : entry.amount_krw < 0 ? "text-rose-400" : "text-gray-500"}`}>
                {entry.amount_krw !== 0 ? `${entry.amount_krw > 0 ? "+" : ""}${entry.amount_krw.toLocaleString()}` : "-"}
            </TableCell>
            <TableCell className={`text-right font-mono text-sm ${entry.score_delta > 0 ? "text-green-400" : entry.score_delta < 0 ? "text-rose-400" : "text-gray-500"}`}>
                {entry.score_delta !== 0 ? (entry.score_delta > 0 ? `+${entry.score_delta}` : entry.score_delta) : "-"}
            </TableCell>
            <TableCell className="text-right font-mono text-sm text-[var(--color-text-muted)]">
                {entry.deposit_after.toLocaleString()}
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
                        <PopoverContent
                            className="w-64 bg-[var(--color-elevated)] border-[var(--color-border)] p-3"
                            align="end"
                        >
                            <div className="space-y-3">
                                <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase">원장 수정</p>
                                <div className="space-y-1">
                                    <label className="text-xs text-[var(--color-text-muted)]">금액 (KRW)</label>
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
                                className="h-6 w-6 p-0 hover:bg-rose-500/10 hover:text-rose-400"
                                disabled={isDeleting}
                            >
                                <Trash2 className="w-3 h-3" />
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="bg-[var(--color-elevated)] border-[var(--color-border)] text-[var(--color-text-primary)]">
                            <AlertDialogHeader>
                                <AlertDialogTitle>원장 항목 삭제</AlertDialogTitle>
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

function LedgerTypeBadge({ type }: { type: LedgerEntry["type"] }) {
    const styles: Record<string, string> = {
        FINE: "bg-rose-500/10 text-rose-400 border-rose-500/20",
        MILESTONE_FINE: "bg-red-500/10 text-red-400 border-red-500/20",
        DEPOSIT_RECHARGE: "bg-blue-500/10 text-blue-400 border-blue-500/20",
        DEPOSIT_ADJUST: "bg-sky-500/10 text-sky-400 border-sky-500/20",
        DEPOSIT_REFUND: "bg-purple-500/10 text-purple-400 border-purple-500/20",
        MERIT: "bg-green-500/10 text-green-400 border-green-500/20",
        ADJUSTMENT: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    };
    return (
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${styles[type] || "bg-white/5 border-white/10"}`}>
            {LEDGER_TYPE_LABELS[type] ?? type}
        </span>
    );
}
