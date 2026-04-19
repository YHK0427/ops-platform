import { useState, useEffect, useRef } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useLedger, useMembers, useSessions, useUpdateLedger, useDeleteLedgerEntry, useToggleMilestonePaid, LEDGER_TYPE_LABELS, translateDescription } from "@/hooks";
import type { LedgerEntry } from "@/hooks";
import { formatNumber } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, PlusCircle, Pencil, Trash2, ChevronLeft, ChevronRight, Search, CheckCircle2, AlertCircle } from "lucide-react";

import { GrantMeritDialog } from "@/components/GrantMeritDialog";
import { BulkPenaltyDialog } from "@/components/BulkPenaltyDialog";
import { WeeklyReportButton } from "@/components/WeeklyReportImage";
import { ExcelExportButton } from "@/components/ExcelExportButton";

// --- Dialogs ---

const LEDGER_TYPES = [
    "FINE", "MILESTONE_FINE", "DEPOSIT_RECHARGE", "DEPOSIT_ADJUST",
    "DEPOSIT_REFUND", "DEPOSIT_FORFEIT", "MERIT", "ADJUSTMENT"
];

function EditLedgerDialog({ entry, memberName }: { entry: LedgerEntry; memberName: string }) {
    const [open, setOpen] = useState(false);
    const [type, setType] = useState<string>(entry.type);
    const [amount, setAmount] = useState(entry.amount_krw);
    const [score, setScore] = useState(entry.score_delta);
    const [description, setDescription] = useState(entry.description);
    const [sessionId, setSessionId] = useState<number | undefined>(entry.session_id ?? undefined);
    const { mutate: updateLedger, isPending } = useUpdateLedger();
    const { data: sessions } = useSessions();

    const handleOpen = (isOpen: boolean) => {
        if (isOpen) {
            setType(entry.type);
            setAmount(entry.amount_krw);
            setScore(entry.score_delta);
            setDescription(entry.description);
            setSessionId(entry.session_id ?? undefined);
        }
        setOpen(isOpen);
    };

    const handleSubmit = () => {
        updateLedger({
            id: entry.id,
            data: { type, amount_krw: amount, score_delta: score, description, session_id: sessionId },
        }, {
            onSuccess: () => setOpen(false),
        });
    };

    return (
        <Dialog open={open} onOpenChange={handleOpen}>
            <DialogTrigger asChild>
                <button
                    className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] md:opacity-0 md:group-hover/row:opacity-100 transition-opacity shrink-0"
                    onClick={(e) => e.stopPropagation()}
                >
                    <Pencil className="w-3 h-3" />
                </button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[450px]">
                <DialogHeader>
                    <DialogTitle>장부 항목 수정</DialogTitle>
                    <DialogDescription>
                        <span className="font-medium">{memberName}</span>의 장부 항목을 수정합니다.
                        금액/점수 변경 시 멤버 잔액이 즉시 반영됩니다.
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
                            placeholder="원 (음수 가능)"
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
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">세션</Label>
                        <Select value={sessionId != null ? String(sessionId) : "none"} onValueChange={(v) => setSessionId(v === "none" ? undefined : Number(v))}>
                            <SelectTrigger className="col-span-3 h-9">
                                <SelectValue placeholder="세션 없음" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">세션 없음</SelectItem>
                                {(sessions ?? []).map((s: any) => (
                                    <SelectItem key={s.id} value={String(s.id)}>{s.week_num}주차 — {s.title}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
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

// GrantMeritDialog and BulkPenaltyDialog are imported from components


// --- Main Page ---

export default function Ledger() {
    const [memberFilter, setMemberFilter] = useState("all");
    const [typeFilter, setTypeFilter] = useState("all");
    const [sessionFilter, setSessionFilter] = useState("all");
    const [searchInput, setSearchInput] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [page, setPage] = useState(1);
    const LIMIT = 50;
    const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

    useEffect(() => {
        debounceRef.current = setTimeout(() => {
            setSearchQuery(searchInput);
            setPage(1);
        }, 300);
        return () => clearTimeout(debounceRef.current);
    }, [searchInput]);

    // Include inactive members so deactivated member names resolve correctly in the ledger
    const { data: members } = useMembers(false);
    const { data: sessions } = useSessions();
    const memberMap = new Map();
    if (members) members.forEach((m: any) => memberMap.set(m.id, m.name));

    const { data: ledgerEntries, isLoading } = useLedger({
        member_id: memberFilter === "all" ? undefined : parseInt(memberFilter),
        type: typeFilter === "all" ? undefined : typeFilter,
        session_id: sessionFilter === "all" ? undefined : parseInt(sessionFilter),
        search: searchQuery || undefined,
        page,
        limit: LIMIT,
    });
    const { mutate: deleteEntry } = useDeleteLedgerEntry();
    const { mutate: togglePaid, isPending: isTogglingPaid } = useToggleMilestonePaid();

    // Reset page when filters change
    const handleMemberFilter = (v: string) => { setMemberFilter(v); setPage(1); };
    const handleTypeFilter = (v: string) => { setTypeFilter(v); setPage(1); };
    const handleSessionFilter = (v: string) => { setSessionFilter(v); setPage(1); };

    return (
        <div className="flex flex-col h-full bg-[var(--color-base)] min-h-screen">
            <PageHeader
                title="장부"
                subtitle="입출금 및 승점 내역 관리"
                actions={
                    <div className="flex gap-2 flex-wrap justify-end">
                        <WeeklyReportButton />
                        <ExcelExportButton />
                        <BulkPenaltyDialog />
                        <GrantMeritDialog
                            trigger={
                                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white">
                                    <PlusCircle className="mr-2 h-4 w-4" /> 상점 부여
                                </Button>
                            }
                        />
                    </div>
                }
            />

            <div className="flex-1 container mx-auto px-3 md:px-4 py-4 md:py-6 space-y-4 md:space-y-6">
                {/* Filters */}
                <Card className="bg-[var(--color-surface)] border-[var(--color-border)]">
                    <CardContent className="p-3 md:p-4 grid grid-cols-1 sm:grid-cols-2 md:flex md:flex-wrap gap-2 md:gap-4 md:items-center">
                        <div className="relative sm:col-span-2 md:w-[220px]">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                            <Input
                                placeholder="멤버명·설명 검색..."
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                className="pl-9 h-9"
                            />
                        </div>
                        <div className="md:w-[200px]">
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
                        <div className="md:w-[200px]">
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
                        <div className="md:w-[200px]">
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

                {/* Desktop 테이블 */}
                <div className="hidden md:block rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-gray-50 hover:bg-gray-50">
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
                                            <TableCell key={j}><div className="h-4 bg-gray-200 rounded animate-pulse" /></TableCell>
                                        ))}
                                    </TableRow>
                                ))
                            ) : ledgerEntries && ledgerEntries.length > 0 ? (
                                ledgerEntries.map((entry) => (
                                    <TableRow key={entry.id} className="group/row hover:bg-[var(--color-hover)] transition-colors">
                                        <TableCell className="text-[var(--color-text-muted)] text-xs whitespace-nowrap">
                                            {new Date(entry.created_at).toLocaleDateString()}
                                        </TableCell>
                                        <TableCell className="font-medium">
                                            {memberMap.get(entry.member_id) || entry.member_id}
                                        </TableCell>
                                        <TableCell className="text-xs text-[var(--color-text-muted)]">
                                            {entry.session_title ? (
                                                <div>
                                                    <span className="text-[var(--color-text-secondary)]">{entry.session_title}</span>
                                                    {entry.session_date && <span className="block text-[var(--color-text-muted)]">{entry.session_date}</span>}
                                                </div>
                                            ) : (
                                                <span className="text-[var(--color-text-muted)]">—</span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className={`
                                                ${entry.type === 'FINE' || entry.type === 'MILESTONE_FINE' ? 'border-red-500/50 text-red-500 bg-red-500/10' :
                                                    entry.type === 'MERIT' ? 'border-green-500/50 text-green-500 bg-green-500/10' :
                                                        entry.type.includes('DEPOSIT') ? 'border-blue-500/50 text-blue-500 bg-blue-500/10' :
                                                            'border-[var(--color-border)] text-[var(--color-text-muted)] bg-gray-50'}
                                            `}>
                                                {LEDGER_TYPE_LABELS[entry.type] ?? entry.type}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-[var(--color-text-secondary)] text-sm max-w-[320px]">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className="truncate" title={translateDescription(entry.description)}>{translateDescription(entry.description)}</span>
                                                <EditLedgerDialog
                                                    entry={entry}
                                                    memberName={memberMap.get(entry.member_id) || String(entry.member_id)}
                                                />
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
                                                                    if (confirm(`${memberMap.get(entry.member_id) ?? entry.member_id}님의 누적벌점 벌금 ${formatNumber(Math.abs(entry.amount_krw))}원 납부를 확인 처리합니다.\n금고 수입으로 반영됩니다.`)) {
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
                                        <TableCell className={`text-right text-sm ${entry.amount_krw < 0 ? 'text-rose-500' : 'text-[var(--color-text-secondary)]'}`}>
                                            {entry.amount_krw !== 0 ? formatNumber(entry.amount_krw) : '-'}
                                        </TableCell>
                                        <TableCell className={`text-right text-sm ${entry.score_delta < 0 ? 'text-rose-500' : 'text-[var(--color-text-secondary)]'}`}>
                                            {entry.score_delta !== 0 ? (entry.score_delta > 0 ? `+${entry.score_delta}` : entry.score_delta) : '-'}
                                        </TableCell>
                                        <TableCell className="text-right text-sm text-[var(--color-text-muted)]">
                                            {formatNumber(entry.deposit_after)}
                                        </TableCell>
                                        <TableCell>
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <button className="p-0.5 text-gray-600 hover:text-rose-500 opacity-0 group-hover/row:opacity-100 transition-opacity">
                                                        <Trash2 className="w-3 h-3" />
                                                    </button>
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

                {/* Mobile 카드 리스트 */}
                <div className="md:hidden space-y-2">
                    {isLoading ? (
                        Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="h-24 rounded-lg bg-[var(--color-surface)] animate-pulse" />
                        ))
                    ) : !ledgerEntries || ledgerEntries.length === 0 ? (
                        <div className="text-center py-12 text-[var(--color-text-muted)] text-sm">표시할 내역이 없습니다.</div>
                    ) : (
                        ledgerEntries.map((entry) => {
                            const memberName = memberMap.get(entry.member_id) ?? String(entry.member_id);
                            const badgeClass =
                                entry.type === 'FINE' || entry.type === 'MILESTONE_FINE' ? 'border-red-500/50 text-red-500 bg-red-500/10' :
                                entry.type === 'MERIT' ? 'border-green-500/50 text-green-500 bg-green-500/10' :
                                entry.type.includes('DEPOSIT') ? 'border-blue-500/50 text-blue-500 bg-blue-500/10' :
                                'border-[var(--color-border)] text-[var(--color-text-muted)] bg-gray-50';
                            return (
                                <div key={entry.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-2">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            <Badge variant="outline" className={`${badgeClass} text-[10px] py-0 px-1.5 h-5`}>
                                                {LEDGER_TYPE_LABELS[entry.type] ?? entry.type}
                                            </Badge>
                                            <span className="text-sm font-medium text-[var(--color-text-primary)]">{memberName}</span>
                                            {entry.session_title && (
                                                <span className="text-[10px] text-[var(--color-text-muted)]">{entry.session_title}</span>
                                            )}
                                        </div>
                                        <div className="text-right flex-shrink-0">
                                            <div className={`text-sm font-bold ${entry.amount_krw < 0 ? 'text-rose-500' : entry.amount_krw > 0 ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]'}`}>
                                                {entry.amount_krw !== 0 ? formatNumber(entry.amount_krw) : '-'}
                                            </div>
                                            {entry.score_delta !== 0 && (
                                                <div className={`text-[10px] ${entry.score_delta < 0 ? 'text-rose-500' : 'text-green-600'}`}>
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
                                                        if (confirm(`${memberName}님의 누적벌점 벌금 ${formatNumber(Math.abs(entry.amount_krw))}원 납부를 확인 처리합니다.`)) {
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
                                        <span>잔액 {formatNumber(entry.deposit_after)}</span>
                                        <div className="flex items-center gap-1">
                                            <EditLedgerDialog entry={entry} memberName={memberName} />
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <button className="p-1 text-gray-600 hover:text-rose-500">
                                                        <Trash2 className="w-3 h-3" />
                                                    </button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent className="bg-[var(--color-elevated)] border-[var(--color-border)] text-[var(--color-text-primary)]">
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>장부 항목 삭제</AlertDialogTitle>
                                                        <AlertDialogDescription>이 항목을 삭제하면 멤버의 잔액과 점수가 역전됩니다. 계속하시겠습니까?</AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>취소</AlertDialogCancel>
                                                        <AlertDialogAction onClick={() => deleteEntry(entry.id)} className="bg-rose-600 hover:bg-rose-700">삭제</AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Pagination */}
                {ledgerEntries && ledgerEntries.length > 0 && (
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-[var(--color-text-muted)]">
                            {page}페이지 {ledgerEntries.length < LIMIT ? "(마지막)" : ""}
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
