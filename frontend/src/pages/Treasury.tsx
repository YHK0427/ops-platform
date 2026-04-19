import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { renderSafeHangul } from "@/components/SafeText";
import { Card, CardContent } from "@/components/ui/card";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useTreasury, useToggleMilestonePaid, useCreateTransaction, useCreateTreasuryExpense, useDeleteTreasuryExpense } from "@/hooks";
import { useMembers } from "@/hooks";
import { Loader2, Check, Plus, Trash2, MinusCircle } from "lucide-react";

type Tab = "session" | "member" | "unpaid" | "expense" | "all";

function formatKRW(n: number) {
    return n.toLocaleString("ko-KR") + "원";
}

export default function Treasury() {
    const { data, isLoading } = useTreasury();
    const { mutate: togglePaid, isPending } = useToggleMilestonePaid();
    const { data: members } = useMembers();
    const { mutate: createTransaction, isPending: isCreating } = useCreateTransaction();
    const { mutate: createExpense, isPending: isCreatingExpense } = useCreateTreasuryExpense();
    const { mutate: deleteExpense, isPending: isDeletingExpense } = useDeleteTreasuryExpense();
    const [tab, setTab] = useState<Tab>("session");
    const [showAddDialog, setShowAddDialog] = useState(false);
    const [showExpenseDialog, setShowExpenseDialog] = useState(false);
    const [newFine, setNewFine] = useState({ member_id: "", amount: "5000", description: "누적벌점 벌금" });
    const [newExpense, setNewExpense] = useState({ amount: "", description: "" });

    const summary = data?.summary;
    const totalIncome = (summary?.total_fine_collected ?? 0) + (summary?.milestone_paid ?? 0) + (summary?.total_forfeit ?? 0);
    const totalExpenses = summary?.total_expenses ?? 0;
    const netTreasury = totalIncome - totalExpenses;

    const tabs: { key: Tab; label: string }[] = [
        { key: "session", label: "세션별" },
        { key: "member", label: "멤버별" },
        { key: "unpaid", label: `미납 현황${data?.unpaid_milestones?.length ? ` (${data.unpaid_milestones.length})` : ""}` },
        { key: "expense", label: `지출${data?.expenses?.length ? ` (${data.expenses.length})` : ""}` },
        { key: "all", label: "전체 내역" },
    ];

    const handleAddFine = () => {
        if (!newFine.member_id || !newFine.amount) return;
        createTransaction({
            member_id: parseInt(newFine.member_id),
            type: "MILESTONE_FINE",
            amount_krw: -Math.abs(parseInt(newFine.amount)),
            score_delta: 0,
            description: newFine.description || "누적벌점 벌금",
        }, {
            onSuccess: () => {
                setShowAddDialog(false);
                setNewFine({ member_id: "", amount: "5000", description: "누적벌점 벌금" });
            },
        });
    };

    const handleAddExpense = () => {
        const amt = parseInt(newExpense.amount);
        if (!amt || amt <= 0 || !newExpense.description) return;
        createExpense({ amount_krw: amt, description: newExpense.description }, {
            onSuccess: () => {
                setShowExpenseDialog(false);
                setNewExpense({ amount: "", description: "" });
            },
        });
    };

    return (
        <div className="flex flex-col h-full">
            <PageHeader title="금고" subtitle="동아리 재정 현황" />

            <div className="p-3 md:p-6 space-y-4 md:space-y-6">
                {isLoading ? (
                    <div className="flex justify-center py-12">
                        <Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-muted)]" />
                    </div>
                ) : (
                    <>
                        {/* 재정 요약: 금고 vs 기수 */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* 금고 (운영진 자금) */}
                            <Card className="bg-[var(--color-surface)] border-blue-500/30">
                                <CardContent className="pt-4 md:pt-6 pb-4 md:pb-5 px-4 md:px-6">
                                    <div className="flex items-center justify-between mb-3 md:mb-4 gap-2">
                                        <p className="text-xs md:text-sm font-semibold text-blue-600 uppercase tracking-wider">금고 (운영 자금)</p>
                                        <p className={`text-xl md:text-3xl font-bold ${netTreasury >= 0 ? "text-blue-600" : "text-rose-500"}`}>{formatKRW(netTreasury)}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center">
                                            <span className="text-[var(--color-text-muted)]">벌금 수입 (디파짓 차감)</span>
                                            <span className="text-[var(--color-text-primary)] font-medium">+{formatKRW(summary?.total_fine_collected ?? 0)}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-[var(--color-text-muted)]">이탈자 디파짓 몰수</span>
                                            <span className="text-[var(--color-text-primary)] font-medium">+{formatKRW(summary?.total_forfeit ?? 0)}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-[var(--color-text-muted)]">누적벌점 벌금 (납부완료)</span>
                                            <span className="text-emerald-600 font-medium">+{formatKRW(summary?.milestone_paid ?? 0)}</span>
                                        </div>
                                        {(summary?.milestone_unpaid ?? 0) > 0 && (
                                            <div className="flex justify-between items-center px-2 py-1.5 -mx-2 rounded-lg bg-rose-500/8 border border-rose-500/20">
                                                <span className="text-rose-500 font-medium">누적벌점 미납</span>
                                                <span className="text-rose-500 font-bold">{formatKRW(summary?.milestone_unpaid ?? 0)}</span>
                                            </div>
                                        )}
                                        {totalExpenses > 0 && (
                                            <div className="flex justify-between items-center">
                                                <span className="text-[var(--color-text-muted)]">지출</span>
                                                <span className="text-rose-500 font-medium">-{formatKRW(totalExpenses)}</span>
                                            </div>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>

                            {/* 기수 자금 (멤버 디파짓) */}
                            <Card className="bg-[var(--color-surface)] border-cyan-500/30">
                                <CardContent className="pt-4 md:pt-6 pb-4 md:pb-5 px-4 md:px-6">
                                    <div className="flex items-center justify-between mb-3 md:mb-4 gap-2">
                                        <p className="text-xs md:text-sm font-semibold text-cyan-600 uppercase tracking-wider">기수 자금</p>
                                        <p className="text-xl md:text-3xl font-bold text-cyan-600">{formatKRW(data?.deposit_summary?.total_deposits ?? 0)}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center">
                                            <span className="text-[var(--color-text-muted)]">활성 멤버</span>
                                            <span className="text-[var(--color-text-primary)] font-medium">{data?.deposit_summary?.active_members ?? 0}명</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-[var(--color-text-muted)]">1인 평균 잔액</span>
                                            <span className="text-[var(--color-text-primary)] font-medium">
                                                {(data?.deposit_summary?.active_members ?? 0) > 0
                                                    ? formatKRW(Math.round((data?.deposit_summary?.total_deposits ?? 0) / (data?.deposit_summary?.active_members ?? 1)))
                                                    : "-"}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center pt-2 border-t border-[var(--color-border-subtle)]">
                                            <span className="text-[var(--color-text-muted)]">수료 시 환급 예정</span>
                                            <span className="text-cyan-600 font-medium">{formatKRW(data?.deposit_summary?.total_deposits ?? 0)}</span>
                                        </div>
                                        <p className="text-xs text-[var(--color-text-muted)] pt-1">
                                            기수 종료 시 수료자에 한해 잔여 디파짓 환급
                                        </p>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Action Buttons (모바일 상단) */}
                        <div className="flex gap-2 md:hidden">
                            <button
                                onClick={() => setShowExpenseDialog(true)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors text-rose-500 border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20"
                            >
                                <MinusCircle className="w-3.5 h-3.5" />
                                지출 기록
                            </button>
                            <button
                                onClick={() => setShowAddDialog(true)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors text-amber-600 border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20"
                            >
                                <Plus className="w-3.5 h-3.5" />
                                누적벌점 벌금
                            </button>
                        </div>

                        {/* Tab Buttons + Action Buttons (PC) */}
                        <div className="flex items-center gap-1 border-b border-[var(--color-border)] overflow-x-auto">
                            {tabs.map(t => (
                                <button
                                    key={t.key}
                                    onClick={() => setTab(t.key)}
                                    className={`px-3 md:px-4 py-2 text-xs md:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                                        tab === t.key
                                            ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                                            : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                                    }`}
                                >
                                    {t.label}
                                </button>
                            ))}
                            <div className="ml-auto pb-1 hidden md:flex gap-2">
                                <button
                                    onClick={() => setShowExpenseDialog(true)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors text-rose-500 border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20"
                                >
                                    <MinusCircle className="w-3.5 h-3.5" />
                                    지출 기록
                                </button>
                                <button
                                    onClick={() => setShowAddDialog(true)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors text-amber-600 border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20"
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                    누적벌점 벌금
                                </button>
                            </div>
                        </div>

                        {/* Tab Content — Desktop */}
                        <div className="hidden md:block rounded-xl border border-[var(--color-border)] overflow-x-auto">
                            {tab === "session" && (
                                <Table>
                                    <TableHeader>
                                        <TableRow className="border-b border-[var(--color-border-subtle)] hover:bg-transparent">
                                            <TableHead className="text-[var(--color-text-muted)]">세션</TableHead>
                                            <TableHead className="text-[var(--color-text-muted)]">날짜</TableHead>
                                            <TableHead className="text-right text-[var(--color-text-muted)]">벌금</TableHead>
                                            <TableHead className="text-right text-[var(--color-text-muted)]">누적벌점</TableHead>
                                            <TableHead className="text-right text-[var(--color-text-muted)]">합계</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {!data?.by_session?.length ? (
                                            <TableRow>
                                                <TableCell colSpan={5} className="text-center py-8 text-[var(--color-text-muted)]">
                                                    벌금 내역이 없습니다
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            data.by_session.map((s: any) => (
                                                <TableRow key={s.session_id} className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-hover)]">
                                                    <TableCell className="font-medium text-[var(--color-text-primary)]">{renderSafeHangul(s.title)}</TableCell>
                                                    <TableCell className="text-[var(--color-text-muted)]">{s.date}</TableCell>
                                                    <TableCell className="text-right text-[var(--color-text-primary)]">{formatKRW(s.fine_total)}</TableCell>
                                                    <TableCell className="text-right text-amber-600">{s.milestone_total > 0 ? formatKRW(s.milestone_total) : "-"}</TableCell>
                                                    <TableCell className="text-right font-bold text-[var(--color-text-primary)]">{formatKRW(s.fine_total + s.milestone_total)}</TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            )}

                            {tab === "member" && (
                                <Table>
                                    <TableHeader>
                                        <TableRow className="border-b border-[var(--color-border-subtle)] hover:bg-transparent">
                                            <TableHead className="text-[var(--color-text-muted)]">멤버</TableHead>
                                            <TableHead className="text-right text-[var(--color-text-muted)]">벌금</TableHead>
                                            <TableHead className="text-right text-[var(--color-text-muted)]">누적벌점</TableHead>
                                            <TableHead className="text-right text-[var(--color-text-muted)]">합계</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {!data?.by_member?.length ? (
                                            <TableRow>
                                                <TableCell colSpan={4} className="text-center py-8 text-[var(--color-text-muted)]">
                                                    벌금 내역이 없습니다
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            data.by_member.map((m: any) => (
                                                <TableRow key={m.member_id} className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-hover)]">
                                                    <TableCell className="font-medium text-[var(--color-text-primary)]">{m.name}</TableCell>
                                                    <TableCell className="text-right text-[var(--color-text-primary)]">{formatKRW(m.fine_total)}</TableCell>
                                                    <TableCell className="text-right text-amber-600">{m.milestone_total > 0 ? formatKRW(m.milestone_total) : "-"}</TableCell>
                                                    <TableCell className="text-right font-bold text-[var(--color-text-primary)]">{formatKRW(m.fine_total + m.milestone_total)}</TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            )}

                            {tab === "unpaid" && (
                                <Table>
                                    <TableHeader>
                                        <TableRow className="border-b border-[var(--color-border-subtle)] hover:bg-transparent">
                                            <TableHead className="text-[var(--color-text-muted)]">멤버</TableHead>
                                            <TableHead className="text-[var(--color-text-muted)]">세션</TableHead>
                                            <TableHead className="text-right text-[var(--color-text-muted)]">금액</TableHead>
                                            <TableHead className="text-[var(--color-text-muted)]">설명</TableHead>
                                            <TableHead className="text-center text-[var(--color-text-muted)]">처리</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {!data?.unpaid_milestones?.length ? (
                                            <TableRow>
                                                <TableCell colSpan={5} className="text-center py-8 text-emerald-600">
                                                    미납 내역 없음
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            data.unpaid_milestones.map((u: any) => (
                                                <TableRow key={u.id} className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-hover)]">
                                                    <TableCell className="font-medium text-[var(--color-text-primary)]">{u.member_name}</TableCell>
                                                    <TableCell className="text-[var(--color-text-muted)]">{u.session_title || "-"}</TableCell>
                                                    <TableCell className="text-right text-rose-500 font-bold">{formatKRW(Math.abs(u.amount_krw))}</TableCell>
                                                    <TableCell className="text-[var(--color-text-primary)]">{u.description}</TableCell>
                                                    <TableCell className="text-center">
                                                        <button
                                                            onClick={() => togglePaid({ id: u.id, is_paid: true })}
                                                            disabled={isPending}
                                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border transition-colors text-emerald-600 border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20"
                                                        >
                                                            <Check className="w-3 h-3" />
                                                            납부 확인
                                                        </button>
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            )}

                            {tab === "expense" && (
                                <Table>
                                    <TableHeader>
                                        <TableRow className="border-b border-[var(--color-border-subtle)] hover:bg-transparent">
                                            <TableHead className="text-[var(--color-text-muted)]">날짜</TableHead>
                                            <TableHead className="text-[var(--color-text-muted)]">내용</TableHead>
                                            <TableHead className="text-right text-[var(--color-text-muted)]">금액</TableHead>
                                            <TableHead className="text-[var(--color-text-muted)]">기록자</TableHead>
                                            <TableHead className="w-[60px]" />
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {!data?.expenses?.length ? (
                                            <TableRow>
                                                <TableCell colSpan={5} className="text-center py-8 text-[var(--color-text-muted)]">
                                                    지출 내역 없음
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            data.expenses.map((e: any) => (
                                                <TableRow key={e.id} className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-hover)]">
                                                    <TableCell className="text-[var(--color-text-muted)]">
                                                        {e.created_at ? new Date(e.created_at).toLocaleDateString("ko-KR") : "-"}
                                                    </TableCell>
                                                    <TableCell className="font-medium text-[var(--color-text-primary)]">{e.description}</TableCell>
                                                    <TableCell className="text-right font-bold text-rose-500">{formatKRW(e.amount_krw)}</TableCell>
                                                    <TableCell className="text-[var(--color-text-muted)]">{e.created_by || "-"}</TableCell>
                                                    <TableCell>
                                                        <AlertDialog>
                                                            <AlertDialogTrigger asChild>
                                                                <button
                                                                    disabled={isDeletingExpense}
                                                                    className="p-1 rounded hover:bg-rose-500/10 hover:text-rose-500 transition-colors text-[var(--color-text-muted)]"
                                                                >
                                                                    <Trash2 className="w-3.5 h-3.5" />
                                                                </button>
                                                            </AlertDialogTrigger>
                                                            <AlertDialogContent className="bg-[var(--color-elevated)] border-[var(--color-border)] text-[var(--color-text-primary)]">
                                                                <AlertDialogHeader>
                                                                    <AlertDialogTitle>지출 삭제</AlertDialogTitle>
                                                                    <AlertDialogDescription>
                                                                        "{e.description}" ({formatKRW(e.amount_krw)}) 지출 기록을 삭제하시겠습니까?
                                                                    </AlertDialogDescription>
                                                                </AlertDialogHeader>
                                                                <AlertDialogFooter>
                                                                    <AlertDialogCancel>취소</AlertDialogCancel>
                                                                    <AlertDialogAction
                                                                        onClick={() => deleteExpense(e.id)}
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
                                        )}
                                    </TableBody>
                                </Table>
                            )}

                            {tab === "all" && (
                                <Table>
                                    <TableHeader>
                                        <TableRow className="border-b border-[var(--color-border-subtle)] hover:bg-transparent">
                                            <TableHead className="text-[var(--color-text-muted)]">멤버</TableHead>
                                            <TableHead className="text-[var(--color-text-muted)]">세션</TableHead>
                                            <TableHead className="text-[var(--color-text-muted)]">구분</TableHead>
                                            <TableHead className="text-right text-[var(--color-text-muted)]">금액</TableHead>
                                            <TableHead className="text-[var(--color-text-muted)]">설명</TableHead>
                                            <TableHead className="text-[var(--color-text-muted)]">날짜</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {!data?.all_entries?.length ? (
                                            <TableRow>
                                                <TableCell colSpan={6} className="text-center py-8 text-[var(--color-text-muted)]">
                                                    내역이 없습니다
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            data.all_entries.map((e: any) => (
                                                <TableRow key={e.id} className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-hover)]">
                                                    <TableCell className="font-medium text-[var(--color-text-primary)]">{e.member_name}</TableCell>
                                                    <TableCell className="text-[var(--color-text-muted)]">{e.session_title || "-"}</TableCell>
                                                    <TableCell>
                                                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                                            e.type === "FINE"
                                                                ? "bg-blue-500/10 text-blue-600"
                                                                : e.type === "DEPOSIT_FORFEIT"
                                                                    ? "bg-yellow-500/10 text-yellow-600"
                                                                    : "bg-amber-500/10 text-amber-600"
                                                        }`}>
                                                            {e.type === "FINE" ? "벌금" : e.type === "DEPOSIT_FORFEIT" ? "이탈 몰수" : "누적벌점"}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="text-right font-bold text-rose-500">{formatKRW(Math.abs(e.amount_krw))}</TableCell>
                                                    <TableCell className="text-[var(--color-text-primary)]">{e.description}</TableCell>
                                                    <TableCell className="text-[var(--color-text-muted)]">
                                                        {e.created_at ? new Date(e.created_at).toLocaleDateString("ko-KR") : "-"}
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            )}
                        </div>

                        {/* Tab Content — Mobile 카드 */}
                        <div className="md:hidden space-y-2">
                            {tab === "session" && (
                                !data?.by_session?.length ? (
                                    <div className="text-center py-8 text-[var(--color-text-muted)] text-sm">벌금 내역이 없습니다</div>
                                ) : data.by_session.map((s: any) => (
                                    <div key={s.session_id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                                        <div className="flex items-start justify-between gap-2 mb-2">
                                            <div>
                                                <div className="font-medium text-sm text-[var(--color-text-primary)]">{renderSafeHangul(s.title)}</div>
                                                <div className="text-[10px] text-[var(--color-text-muted)]">{s.date}</div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-sm font-bold text-[var(--color-text-primary)]">{formatKRW(s.fine_total + s.milestone_total)}</div>
                                                <div className="text-[10px] text-[var(--color-text-muted)]">합계</div>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                                            <div><span className="text-[var(--color-text-muted)]">벌금 </span><span>{formatKRW(s.fine_total)}</span></div>
                                            <div><span className="text-[var(--color-text-muted)]">누적벌점 </span><span className={s.milestone_total > 0 ? "text-amber-600" : ""}>{s.milestone_total > 0 ? formatKRW(s.milestone_total) : "-"}</span></div>
                                        </div>
                                    </div>
                                ))
                            )}
                            {tab === "member" && (
                                !data?.by_member?.length ? (
                                    <div className="text-center py-8 text-[var(--color-text-muted)] text-sm">벌금 내역이 없습니다</div>
                                ) : data.by_member.map((m: any) => (
                                    <div key={m.member_id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                                        <div className="flex items-start justify-between gap-2 mb-2">
                                            <div className="font-medium text-sm text-[var(--color-text-primary)]">{m.name}</div>
                                            <div className="text-right">
                                                <div className="text-sm font-bold text-[var(--color-text-primary)]">{formatKRW(m.fine_total + m.milestone_total)}</div>
                                                <div className="text-[10px] text-[var(--color-text-muted)]">합계</div>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                                            <div><span className="text-[var(--color-text-muted)]">벌금 </span><span>{formatKRW(m.fine_total)}</span></div>
                                            <div><span className="text-[var(--color-text-muted)]">누적벌점 </span><span className={m.milestone_total > 0 ? "text-amber-600" : ""}>{m.milestone_total > 0 ? formatKRW(m.milestone_total) : "-"}</span></div>
                                        </div>
                                    </div>
                                ))
                            )}
                            {tab === "unpaid" && (
                                !data?.unpaid_milestones?.length ? (
                                    <div className="text-center py-8 text-emerald-600 text-sm">미납 내역 없음</div>
                                ) : data.unpaid_milestones.map((u: any) => (
                                    <div key={u.id} className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 space-y-2">
                                        <div className="flex items-start justify-between gap-2">
                                            <div>
                                                <div className="font-medium text-sm text-[var(--color-text-primary)]">{u.member_name}</div>
                                                {u.session_title && <div className="text-[10px] text-[var(--color-text-muted)]">{renderSafeHangul(u.session_title)}</div>}
                                            </div>
                                            <div className="text-sm font-bold text-rose-500">{formatKRW(Math.abs(u.amount_krw))}</div>
                                        </div>
                                        <div className="text-xs text-[var(--color-text-secondary)]">{u.description}</div>
                                        <button
                                            onClick={() => togglePaid({ id: u.id, is_paid: true })}
                                            disabled={isPending}
                                            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border text-emerald-600 border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20"
                                        >
                                            <Check className="w-3 h-3" /> 납부 확인
                                        </button>
                                    </div>
                                ))
                            )}
                            {tab === "expense" && (
                                !data?.expenses?.length ? (
                                    <div className="text-center py-8 text-[var(--color-text-muted)] text-sm">지출 내역 없음</div>
                                ) : data.expenses.map((e: any) => (
                                    <div key={e.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                                        <div className="flex items-start justify-between gap-2 mb-1">
                                            <div className="font-medium text-sm text-[var(--color-text-primary)]">{e.description}</div>
                                            <div className="text-sm font-bold text-rose-500">{formatKRW(e.amount_krw)}</div>
                                        </div>
                                        <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)]">
                                            <span>{e.created_at ? new Date(e.created_at).toLocaleDateString("ko-KR") : "-"} · {e.created_by || "-"}</span>
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <button disabled={isDeletingExpense} className="p-1 rounded hover:bg-rose-500/10 hover:text-rose-500">
                                                        <Trash2 className="w-3 h-3" />
                                                    </button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent className="bg-[var(--color-elevated)] border-[var(--color-border)] text-[var(--color-text-primary)]">
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>지출 삭제</AlertDialogTitle>
                                                        <AlertDialogDescription>"{e.description}" ({formatKRW(e.amount_krw)}) 지출 기록을 삭제하시겠습니까?</AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>취소</AlertDialogCancel>
                                                        <AlertDialogAction onClick={() => deleteExpense(e.id)} className="bg-rose-600 hover:bg-rose-700">삭제</AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        </div>
                                    </div>
                                ))
                            )}
                            {tab === "all" && (
                                !data?.all_entries?.length ? (
                                    <div className="text-center py-8 text-[var(--color-text-muted)] text-sm">내역이 없습니다</div>
                                ) : data.all_entries.map((e: any) => (
                                    <div key={e.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-1.5">
                                        <div className="flex items-start justify-between gap-2">
                                            <div>
                                                <div className="flex items-center gap-1.5">
                                                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                                                        e.type === "FINE" ? "bg-blue-500/10 text-blue-600" :
                                                        e.type === "DEPOSIT_FORFEIT" ? "bg-yellow-500/10 text-yellow-600" :
                                                        "bg-amber-500/10 text-amber-600"
                                                    }`}>
                                                        {e.type === "FINE" ? "벌금" : e.type === "DEPOSIT_FORFEIT" ? "이탈 몰수" : "누적벌점"}
                                                    </span>
                                                    <span className="font-medium text-sm text-[var(--color-text-primary)]">{e.member_name}</span>
                                                </div>
                                                {e.session_title && <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{renderSafeHangul(e.session_title)}</div>}
                                            </div>
                                            <div className="text-sm font-bold text-rose-500">{formatKRW(Math.abs(e.amount_krw))}</div>
                                        </div>
                                        <div className="text-xs text-[var(--color-text-secondary)]">{e.description}</div>
                                        <div className="text-[10px] text-[var(--color-text-muted)]">
                                            {e.created_at ? new Date(e.created_at).toLocaleDateString("ko-KR") : "-"}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* Add Milestone Fine Dialog */}
            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                <DialogContent className="bg-[var(--color-surface)] border-[var(--color-border)]">
                    <DialogHeader>
                        <DialogTitle>누적벌점 벌금 추가</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div>
                            <label className="text-sm text-[var(--color-text-muted)] mb-1.5 block">멤버</label>
                            <Select value={newFine.member_id} onValueChange={v => setNewFine(p => ({ ...p, member_id: v }))}>
                                <SelectTrigger className="bg-[var(--color-bg)] border-[var(--color-border)]">
                                    <SelectValue placeholder="멤버 선택" />
                                </SelectTrigger>
                                <SelectContent>
                                    {members?.map((m: any) => (
                                        <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <label className="text-sm text-[var(--color-text-muted)] mb-1.5 block">금액 (원)</label>
                            <input
                                type="number"
                                value={newFine.amount}
                                onChange={e => setNewFine(p => ({ ...p, amount: e.target.value }))}
                                className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-sm"
                                placeholder="5000"
                            />
                        </div>
                        <div>
                            <label className="text-sm text-[var(--color-text-muted)] mb-1.5 block">설명</label>
                            <input
                                type="text"
                                value={newFine.description}
                                onChange={e => setNewFine(p => ({ ...p, description: e.target.value }))}
                                className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-sm"
                                placeholder="누적벌점 벌금"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <button
                            onClick={() => setShowAddDialog(false)}
                            className="px-4 py-2 rounded-lg text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                        >
                            취소
                        </button>
                        <button
                            onClick={handleAddFine}
                            disabled={!newFine.member_id || !newFine.amount || isCreating}
                            className="px-4 py-2 rounded-lg text-sm font-medium bg-amber-500/20 text-amber-600 border border-amber-500/30 hover:bg-amber-500/30 disabled:opacity-50 transition-colors"
                        >
                            {isCreating ? "처리 중..." : "추가"}
                        </button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Add Expense Dialog */}
            <Dialog open={showExpenseDialog} onOpenChange={setShowExpenseDialog}>
                <DialogContent className="bg-[var(--color-surface)] border-[var(--color-border)]">
                    <DialogHeader>
                        <DialogTitle>금고 지출 기록</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div>
                            <label className="text-sm text-[var(--color-text-muted)] mb-1.5 block">금액 (원)</label>
                            <input
                                type="number"
                                value={newExpense.amount}
                                onChange={e => setNewExpense(p => ({ ...p, amount: e.target.value }))}
                                className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-sm"
                                placeholder="10000"
                            />
                        </div>
                        <div>
                            <label className="text-sm text-[var(--color-text-muted)] mb-1.5 block">사용 내역</label>
                            <input
                                type="text"
                                value={newExpense.description}
                                onChange={e => setNewExpense(p => ({ ...p, description: e.target.value }))}
                                className="w-full px-3 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-sm"
                                placeholder="예: 간식 구매, 회식비 등"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <button
                            onClick={() => setShowExpenseDialog(false)}
                            className="px-4 py-2 rounded-lg text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                        >
                            취소
                        </button>
                        <button
                            onClick={handleAddExpense}
                            disabled={!newExpense.amount || !newExpense.description || isCreatingExpense}
                            className="px-4 py-2 rounded-lg text-sm font-medium bg-rose-500/20 text-rose-500 border border-rose-500/30 hover:bg-rose-500/30 disabled:opacity-50 transition-colors"
                        >
                            {isCreatingExpense ? "처리 중..." : "기록"}
                        </button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
