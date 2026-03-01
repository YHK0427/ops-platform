import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useLedger, useMembers, useSessions, useGiveMerit, useCreateTransaction, useUpdateLedger, useDeleteLedgerEntry, LEDGER_TYPE_LABELS, translateDescription } from "@/hooks";
import type { LedgerEntry } from "@/hooks";
import { formatNumber } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, PlusCircle, ArrowRightLeft, Pencil, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

// --- Dialogs ---

const LEDGER_TYPES = [
    "FINE", "MILESTONE_FINE", "DEPOSIT_RECHARGE", "DEPOSIT_ADJUST",
    "DEPOSIT_REFUND", "MERIT", "ADJUSTMENT"
];

function EditLedgerDialog({ entry, memberName }: { entry: LedgerEntry; memberName: string }) {
    const [open, setOpen] = useState(false);
    const [type, setType] = useState<string>(entry.type);
    const [amount, setAmount] = useState(entry.amount_krw);
    const [score, setScore] = useState(entry.score_delta);
    const [description, setDescription] = useState(entry.description);
    const { mutate: updateLedger, isPending } = useUpdateLedger();

    const handleOpen = (isOpen: boolean) => {
        if (isOpen) {
            setType(entry.type);
            setAmount(entry.amount_krw);
            setScore(entry.score_delta);
            setDescription(entry.description);
        }
        setOpen(isOpen);
    };

    const handleSubmit = () => {
        updateLedger({
            id: entry.id,
            data: { type, amount_krw: amount, score_delta: score, description },
        }, {
            onSuccess: () => setOpen(false),
        });
    };

    return (
        <Dialog open={open} onOpenChange={handleOpen}>
            <DialogTrigger asChild>
                <button
                    className="p-0.5 text-gray-600 hover:text-gray-300 opacity-0 group-hover/row:opacity-100 transition-opacity shrink-0"
                    onClick={(e) => e.stopPropagation()}
                >
                    <Pencil className="w-3 h-3" />
                </button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[450px]">
                <DialogHeader>
                    <DialogTitle>원장 항목 수정</DialogTitle>
                    <DialogDescription>
                        <span className="font-medium">{memberName}</span>의 원장 항목을 수정합니다.
                        amount/score 변경 시 멤버 잔액이 즉시 반영됩니다.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">유형</Label>
                        <Select value={type} onValueChange={setType}>
                            <SelectTrigger className="col-span-3">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {LEDGER_TYPES.map(t => (
                                    <SelectItem key={t} value={t}>{LEDGER_TYPE_LABELS[t] ?? t}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">금액</Label>
                        <Input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(parseInt(e.target.value) || 0)}
                            className="col-span-3"
                            placeholder="KRW (음수 가능)"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">점수</Label>
                        <Input
                            type="number"
                            value={score}
                            onChange={(e) => setScore(parseInt(e.target.value) || 0)}
                            className="col-span-3"
                            placeholder="점수 (음수 가능)"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">설명</Label>
                        <Input
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="col-span-3"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
                    <Button onClick={handleSubmit} disabled={isPending || !description}>
                        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        저장
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function GrantMeritDialog() {
    const { mutate: giveMerit, isPending } = useGiveMerit();
    const { data: members } = useMembers(); // Need active members
    const [selectedMemberId, setSelectedMemberId] = useState<string>("");
    const [score, setScore] = useState(1);
    const [reason, setReason] = useState("");
    const [open, setOpen] = useState(false);

    const handleSubmit = () => {
        if (!selectedMemberId) return toast.error("멤버를 선택해주세요.");
        if (!reason) return toast.error("사유를 입력해주세요.");

        giveMerit({
            member_ids: [parseInt(selectedMemberId)],
            score_delta: score,
            reason
        }, {
            onSuccess: () => {
                setOpen(false);
                setReason("");
                setSelectedMemberId("");
            }
        });
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button className="bg-[var(--color-primary)] hover:bg-rose-600 text-white">
                    <PlusCircle className="mr-2 h-4 w-4" /> 상점 부여
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>상점 부여</DialogTitle>
                    <DialogDescription>멤버에게 상점을 부여합니다.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">멤버</Label>
                        <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
                            <SelectTrigger className="col-span-3">
                                <SelectValue placeholder="멤버 선택" />
                            </SelectTrigger>
                            <SelectContent>
                                {members?.map((m: any) => (
                                    <SelectItem key={m.id} value={m.id.toString()}>{m.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">점수</Label>
                        <Input type="number" value={score} onChange={(e) => setScore(parseInt(e.target.value))} className="col-span-3" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">사유</Label>
                        <Input value={reason} onChange={(e) => setReason(e.target.value)} className="col-span-3" placeholder="예: 우수 질문" />
                    </div>
                </div>
                <DialogFooter>
                    <Button onClick={handleSubmit} disabled={isPending}>
                        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        부여
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function CreateTransactionDialog() {
    const { mutate: createTransaction, isPending } = useCreateTransaction();
    const { data: members } = useMembers();
    const [selectedMemberId, setSelectedMemberId] = useState<string>("");
    const [type, setType] = useState<string>("DEPOSIT_ADJUST");
    const [amount, setAmount] = useState(0);
    const [score, setScore] = useState(0);
    const [description, setDescription] = useState("");
    const [open, setOpen] = useState(false);

    const handleSubmit = () => {
        if (!selectedMemberId) return toast.error("멤버를 선택해주세요.");
        if (!description) return toast.error("설명을 입력해주세요.");
        if (amount === 0 && score === 0) return toast.error("금액 또는 점수를 입력해주세요.");

        createTransaction({
            member_id: parseInt(selectedMemberId),
            type,
            amount_krw: amount,
            score_delta: score,
            description
        }, {
            onSuccess: () => {
                setOpen(false);
                setDescription("");
                setAmount(0);
                setScore(0);
                setSelectedMemberId("");
            }
        });
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" className="text-blue-400 border-blue-400/20 hover:bg-blue-400/10">
                    <ArrowRightLeft className="mr-2 h-4 w-4" /> 수동 거래
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>수동 거래 생성</DialogTitle>
                    <DialogDescription>보증금/승점을 수동으로 조정합니다.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">멤버</Label>
                        <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
                            <SelectTrigger className="col-span-3">
                                <SelectValue placeholder="멤버 선택" />
                            </SelectTrigger>
                            <SelectContent>
                                {members?.map((m: any) => (
                                    <SelectItem key={m.id} value={m.id.toString()}>{m.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">유형</Label>
                        <Select value={type} onValueChange={setType}>
                            <SelectTrigger className="col-span-3">
                                <SelectValue placeholder="유형 선택" />
                            </SelectTrigger>
                            <SelectContent>
                                {["DEPOSIT_RECHARGE", "DEPOSIT_ADJUST", "DEPOSIT_REFUND", "FINE", "ADJUSTMENT"].map(t => (
                                    <SelectItem key={t} value={t}>{LEDGER_TYPE_LABELS[t] ?? t}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">금액</Label>
                        <Input type="number" value={amount} onChange={(e) => setAmount(parseInt(e.target.value) || 0)} className="col-span-3" placeholder="KRW (음수 가능)" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">점수</Label>
                        <Input type="number" value={score} onChange={(e) => setScore(parseInt(e.target.value) || 0)} className="col-span-3" placeholder="점수 (음수 가능)" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">설명</Label>
                        <Input value={description} onChange={(e) => setDescription(e.target.value)} className="col-span-3" placeholder="설명" />
                    </div>
                </div>
                <DialogFooter>
                    <Button onClick={handleSubmit} disabled={isPending}>
                        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        생성
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}


// --- Main Page ---

export default function Ledger() {
    const [memberFilter, setMemberFilter] = useState("all");
    const [typeFilter, setTypeFilter] = useState("all");
    const [sessionFilter, setSessionFilter] = useState("all");
    const [page, setPage] = useState(1);
    const LIMIT = 50;

    // Include inactive members so deactivated member names resolve correctly in the ledger
    const { data: members } = useMembers(false);
    const { data: sessions } = useSessions();
    const memberMap = new Map();
    if (members) members.forEach((m: any) => memberMap.set(m.id, m.name));

    const { data: ledgerEntries, isLoading } = useLedger({
        member_id: memberFilter === "all" ? undefined : parseInt(memberFilter),
        type: typeFilter === "all" ? undefined : typeFilter,
        session_id: sessionFilter === "all" ? undefined : parseInt(sessionFilter),
        page,
        limit: LIMIT,
    });
    const { mutate: deleteEntry } = useDeleteLedgerEntry();

    // Reset page when filters change
    const handleMemberFilter = (v: string) => { setMemberFilter(v); setPage(1); };
    const handleTypeFilter = (v: string) => { setTypeFilter(v); setPage(1); };
    const handleSessionFilter = (v: string) => { setSessionFilter(v); setPage(1); };

    return (
        <div className="flex flex-col h-full bg-[var(--color-base)] min-h-screen">
            <PageHeader
                title="원장"
                subtitle="입출금 및 승점 내역 관리"
                actions={
                    <div className="flex gap-2">
                        <CreateTransactionDialog />
                        <GrantMeritDialog />
                    </div>
                }
            />

            <div className="flex-1 container mx-auto px-4 py-6 space-y-6">
                {/* Filters */}
                <Card className="bg-[var(--color-surface)] border-[var(--color-border)]">
                    <CardContent className="p-4 flex flex-wrap gap-4 items-center">
                        <div className="w-[200px]">
                            <Select value={memberFilter} onValueChange={handleMemberFilter}>
                                <SelectTrigger>
                                    <SelectValue placeholder="멤버 필터" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">전체 멤버</SelectItem>
                                    {members?.map((m: any) => (
                                        <SelectItem key={m.id} value={m.id.toString()}>{m.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="w-[200px]">
                            <Select value={typeFilter} onValueChange={handleTypeFilter}>
                                <SelectTrigger>
                                    <SelectValue placeholder="유형 필터" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">전체 유형</SelectItem>
                                    {LEDGER_TYPES.map(t => (
                                        <SelectItem key={t} value={t}>{LEDGER_TYPE_LABELS[t] ?? t}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="w-[200px]">
                            <Select value={sessionFilter} onValueChange={handleSessionFilter}>
                                <SelectTrigger>
                                    <SelectValue placeholder="세션 필터" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">전체 세션</SelectItem>
                                    {sessions?.slice().sort((a, b) => b.week_num - a.week_num).map(s => (
                                        <SelectItem key={s.id} value={s.id.toString()}>
                                            {s.week_num}주차 — {s.title}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </CardContent>
                </Card>

                {/* Table */}
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-gray-900/50 hover:bg-gray-900/50">
                                <TableHead className="w-[120px]">날짜</TableHead>
                                <TableHead className="w-[100px]">멤버</TableHead>
                                <TableHead className="w-[140px]">세션</TableHead>
                                <TableHead className="w-[120px]">유형</TableHead>
                                <TableHead>설명</TableHead>
                                <TableHead className="text-right w-[100px]">금액</TableHead>
                                <TableHead className="text-right w-[80px]">점수</TableHead>
                                <TableHead className="text-right w-[120px]">잔액</TableHead>
                                <TableHead className="w-[48px]" />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <TableRow key={i}>
                                        {Array.from({ length: 9 }).map((_, j) => (
                                            <TableCell key={j}><div className="h-4 bg-gray-800 rounded animate-pulse" /></TableCell>
                                        ))}
                                    </TableRow>
                                ))
                            ) : ledgerEntries && ledgerEntries.length > 0 ? (
                                ledgerEntries.map((entry) => (
                                    <TableRow key={entry.id} className="group/row hover:bg-white/5 transition-colors">
                                        <TableCell className="text-gray-400 text-xs whitespace-nowrap">
                                            {new Date(entry.created_at).toLocaleDateString()}
                                        </TableCell>
                                        <TableCell className="font-medium">
                                            {memberMap.get(entry.member_id) || entry.member_id}
                                        </TableCell>
                                        <TableCell className="text-xs text-gray-400">
                                            {entry.session_title ? (
                                                <div>
                                                    <span className="text-gray-300">{entry.session_title}</span>
                                                    {entry.session_date && <span className="block text-gray-600">{entry.session_date}</span>}
                                                </div>
                                            ) : (
                                                <span className="text-gray-600">—</span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className={`
                                                ${entry.type === 'FINE' || entry.type === 'MILESTONE_FINE' ? 'border-red-500/50 text-red-500 bg-red-500/10' :
                                                    entry.type === 'MERIT' ? 'border-green-500/50 text-green-500 bg-green-500/10' :
                                                        entry.type.includes('DEPOSIT') ? 'border-blue-500/50 text-blue-500 bg-blue-500/10' :
                                                            'border-gray-700 text-gray-400 bg-gray-800'}
                                            `}>
                                                {LEDGER_TYPE_LABELS[entry.type] ?? entry.type}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-gray-300 text-sm max-w-[300px]">
                                            <div className="flex items-center gap-1">
                                                <span className="truncate" title={translateDescription(entry.description)}>{translateDescription(entry.description)}</span>
                                                <EditLedgerDialog
                                                    entry={entry}
                                                    memberName={memberMap.get(entry.member_id) || String(entry.member_id)}
                                                />
                                            </div>
                                        </TableCell>
                                        <TableCell className={`text-right font-mono text-sm ${entry.amount_krw < 0 ? 'text-rose-400' : 'text-gray-300'}`}>
                                            {entry.amount_krw !== 0 ? formatNumber(entry.amount_krw) : '-'}
                                        </TableCell>
                                        <TableCell className={`text-right font-mono text-sm ${entry.score_delta < 0 ? 'text-rose-400' : 'text-gray-300'}`}>
                                            {entry.score_delta !== 0 ? (entry.score_delta > 0 ? `+${entry.score_delta}` : entry.score_delta) : '-'}
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-sm text-[var(--color-text-muted)]">
                                            {formatNumber(entry.deposit_after)}
                                        </TableCell>
                                        <TableCell>
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <button className="p-0.5 text-gray-600 hover:text-rose-400 opacity-0 group-hover/row:opacity-100 transition-opacity">
                                                        <Trash2 className="w-3 h-3" />
                                                    </button>
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
                                                            onClick={() => deleteEntry(entry.id)}
                                                            className="bg-rose-600 hover:bg-rose-700"
                                                        >
                                                            삭제
                                                        </AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={9} className="text-center py-12 text-[var(--color-text-muted)]">
                                        표시할 내역이 없습니다.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>

                {/* Pagination */}
                {ledgerEntries && ledgerEntries.length > 0 && (
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-[var(--color-text-muted)]">
                            Page {page} {ledgerEntries.length < LIMIT ? "(마지막)" : ""}
                        </span>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                disabled={page === 1}
                            >
                                <ChevronLeft className="w-4 h-4 mr-1" /> 이전
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPage((p) => p + 1)}
                                disabled={ledgerEntries.length < LIMIT}
                            >
                                다음 <ChevronRight className="w-4 h-4 ml-1" />
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
