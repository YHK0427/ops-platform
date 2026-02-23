import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useLedger, useMembers, useGiveMerit, useCreateTransaction } from "@/hooks";
import type { LedgerEntry } from "@/hooks";
import { formatNumber } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, PlusCircle, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";

// --- Dialogs ---

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
                    <PlusCircle className="mr-2 h-4 w-4" /> Grant Merit
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>상점 부여 (Grant Merit)</DialogTitle>
                    <DialogDescription>멤버에게 상점을 부여합니다.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Member</Label>
                        <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
                            <SelectTrigger className="col-span-3">
                                <SelectValue placeholder="Select member" />
                            </SelectTrigger>
                            <SelectContent>
                                {members?.map((m: any) => (
                                    <SelectItem key={m.id} value={m.id.toString()}>{m.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Score</Label>
                        <Input type="number" value={score} onChange={(e) => setScore(parseInt(e.target.value))} className="col-span-3" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Reason</Label>
                        <Input value={reason} onChange={(e) => setReason(e.target.value)} className="col-span-3" placeholder="e.g. 우수 질문" />
                    </div>
                </div>
                <DialogFooter>
                    <Button onClick={handleSubmit} disabled={isPending}>
                        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Grant
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
                    <ArrowRightLeft className="mr-2 h-4 w-4" /> Manual Transaction
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>수동 거래 생성</DialogTitle>
                    <DialogDescription>보증금/승점을 수동으로 조정합니다.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Member</Label>
                        <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
                            <SelectTrigger className="col-span-3">
                                <SelectValue placeholder="Select member" />
                            </SelectTrigger>
                            <SelectContent>
                                {members?.map((m: any) => (
                                    <SelectItem key={m.id} value={m.id.toString()}>{m.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Type</Label>
                        <Select value={type} onValueChange={setType}>
                            <SelectTrigger className="col-span-3">
                                <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                            <SelectContent>
                                {["DEPOSIT_RECHARGE", "DEPOSIT_ADJUST", "DEPOSIT_REFUND", "FINE", "ADJUSTMENT"].map(t => (
                                    <SelectItem key={t} value={t}>{t}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Amount</Label>
                        <Input type="number" value={amount} onChange={(e) => setAmount(parseInt(e.target.value) || 0)} className="col-span-3" placeholder="KRW (음수가능)" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Score</Label>
                        <Input type="number" value={score} onChange={(e) => setScore(parseInt(e.target.value) || 0)} className="col-span-3" placeholder="Point (음수가능)" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">Desc</Label>
                        <Input value={description} onChange={(e) => setDescription(e.target.value)} className="col-span-3" placeholder="설명" />
                    </div>
                </div>
                <DialogFooter>
                    <Button onClick={handleSubmit} disabled={isPending}>
                        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Create
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
    const [page] = useState(1);

    // Include inactive members so deactivated member names resolve correctly in the ledger
    const { data: members } = useMembers(false);
    const memberMap = new Map();
    if (members) members.forEach((m: any) => memberMap.set(m.id, m.name));

    const { data: ledgerEntries, isLoading } = useLedger({
        member_id: memberFilter === "all" ? undefined : parseInt(memberFilter),
        type: typeFilter === "all" ? undefined : typeFilter,
        page,
        limit: 50
    });

    return (
        <div className="flex flex-col h-full bg-[var(--color-base)] min-h-screen">
            <PageHeader
                title="Ledger"
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
                            <Select value={memberFilter} onValueChange={setMemberFilter}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Filter by Member" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Members</SelectItem>
                                    {members?.map((m: any) => (
                                        <SelectItem key={m.id} value={m.id.toString()}>{m.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="w-[200px]">
                            <Select value={typeFilter} onValueChange={setTypeFilter}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Filter by Type" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Types</SelectItem>
                                    {["DEPOSIT", "WITHDRAW", "FINE", "MERIT", "ADJUSTMENT", "MILESTONE_FINE", "DEPOSIT_RECHARGE"].map(t => (
                                        <SelectItem key={t} value={t}>{t}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        {/* Date Picker would go here */}
                    </CardContent>
                </Card>

                {/* Table */}
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-gray-900/50 hover:bg-gray-900/50">
                                <TableHead className="w-[120px]">Date</TableHead>
                                <TableHead className="w-[100px]">Member</TableHead>
                                <TableHead className="w-[120px]">Type</TableHead>
                                <TableHead>Description</TableHead>
                                <TableHead className="text-right w-[100px]">Amount</TableHead>
                                <TableHead className="text-right w-[80px]">Score</TableHead>
                                <TableHead className="text-right w-[120px]">Balance</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <TableRow key={i}>
                                        <TableCell><div className="h-4 bg-gray-800 rounded animate-pulse" /></TableCell>
                                        <TableCell><div className="h-4 bg-gray-800 rounded animate-pulse" /></TableCell>
                                        <TableCell><div className="h-4 bg-gray-800 rounded animate-pulse" /></TableCell>
                                        <TableCell><div className="h-4 bg-gray-800 rounded animate-pulse" /></TableCell>
                                        <TableCell><div className="h-4 bg-gray-800 rounded animate-pulse" /></TableCell>
                                        <TableCell><div className="h-4 bg-gray-800 rounded animate-pulse" /></TableCell>
                                        <TableCell><div className="h-4 bg-gray-800 rounded animate-pulse" /></TableCell>
                                    </TableRow>
                                ))
                            ) : ledgerEntries && ledgerEntries.length > 0 ? (
                                ledgerEntries.map((entry) => (
                                    <TableRow key={entry.id} className="hover:bg-white/5 transition-colors">
                                        <TableCell className="text-gray-400 text-xs whitespace-nowrap">
                                            {new Date(entry.created_at).toLocaleDateString()}
                                        </TableCell>
                                        <TableCell className="font-medium">
                                            {entry.member_name || memberMap.get(entry.member_id) || entry.member_id}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className={`
                                                ${entry.type === 'FINE' || entry.type === 'MILESTONE_FINE' ? 'border-red-500/50 text-red-500 bg-red-500/10' :
                                                    entry.type === 'MERIT' ? 'border-green-500/50 text-green-500 bg-green-500/10' :
                                                        entry.type.includes('DEPOSIT') ? 'border-blue-500/50 text-blue-500 bg-blue-500/10' :
                                                            'border-gray-700 text-gray-400 bg-gray-800'}
                                            `}>
                                                {entry.type}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-gray-300 text-sm max-w-[300px] truncate" title={entry.description}>
                                            {entry.description}
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
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center py-12 text-[var(--color-text-muted)]">
                                        표시할 내역이 없습니다.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </div>
        </div>
    );
}
