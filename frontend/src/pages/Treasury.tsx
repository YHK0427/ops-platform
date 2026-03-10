import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
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

            <div className="p-6 space-y-6">
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
                                <CardContent className="pt-6 pb-5 px-6">
                                    <div className="flex items-center justify-between mb-4">
                                        <p className="text-sm font-semibold text-blue-400 uppercase tracking-wider">금고 (운영 자금)</p>
                                        <p className={`text-3xl font-bold ${netTreasury >= 0 ? "text-blue-400" : "text-rose-400"}`}>{formatKRW(netTreasury)}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center">
                                            <span className="text-[var(--color-text-muted)]">벌금 수입 (디파짓 차감)</span>
                                            <span className="text-[var(--color-text-secondary)] font-medium">+{formatKRW(summary?.total_fine_collected ?? 0)}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-[var(--color-text-muted)]">이탈자 디파짓 몰수</span>
                                            <span className="text-[var(--color-text-secondary)] font-medium">+{formatKRW(summary?.total_forfeit ?? 0)}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-[var(--color-text-muted)]">누적벌점 벌금 (납부완료)</span>
                                            <span className="text-emerald-400 font-medium">+{formatKRW(summary?.milestone_paid ?? 0)}</span>
                                        </div>
                                        {(summary?.milestone_unpaid ?? 0) > 0 && (
                                            <div className="flex justify-between items-center px-2 py-1.5 -mx-2 rounded-lg bg-rose-500/8 border border-rose-500/20">
                                                <span className="text-rose-400 font-medium">누적벌점 미납</span>
                                                <span className="text-rose-400 font-bold">{formatKRW(summary?.milestone_unpaid ?? 0)}</span>
                                            </div>
                                        )}
                                        {totalExpenses > 0 && (
                                            <div className="flex justify-between items-center">
                                                <span className="text-[var(--color-text-muted)]">지출</span>
                                                <span className="text-rose-400 font-medium">-{formatKRW(totalExpenses)}</span>
                                            </div>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>

                            {/* 기수 자금 (멤버 디파짓) */}
                            <Card className="bg-[var(--color-surface)] border-cyan-500/30">
                                <CardContent className="pt-6 pb-5 px-6">
                                    <div className="flex items-center justify-between mb-4">
                                        <p className="text-sm font-semibold text-cyan-400 uppercase tracking-wider">기수 자금 (멤버 디파짓)</p>
                                        <p className="text-3xl font-bold text-cyan-400">{formatKRW(data?.deposit_summary?.total_deposits ?? 0)}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center">
                                            <span className="text-[var(--color-text-muted)]">활성 멤버</span>
                                            <span className="text-[var(--color-text-secondary)] font-medium">{data?.deposit_summary?.active_members ?? 0}명</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-[var(--color-text-muted)]">1인 평균 잔액</span>
                                            <span className="text-[var(--color-text-secondary)] font-medium">
                                                {(data?.deposit_summary?.active_members ?? 0) > 0
                                                    ? formatKRW(Math.round((data?.deposit_summary?.total_deposits ?? 0) / (data?.deposit_summary?.active_members ?? 1)))
                                                    : "-"}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center pt-2 border-t border-[var(--color-border-subtle)]">
                                            <span className="text-[var(--color-text-muted)]">수료 시 환급 예정</span>
                                            <span className="text-cyan-400 font-medium">{formatKRW(data?.deposit_summary?.total_deposits ?? 0)}</span>
                                        </div>
                                        <p className="text-xs text-[var(--color-text-muted)] pt-1">
                                            기수 종료 시 수료자에 한해 잔여 디파짓 환급
                                        </p>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Tab Buttons + Action Buttons */}
                        <div className="flex items-center gap-1 border-b border-[var(--color-border)]">
                            {tabs.map(t => (
                                <button
                                    key={t.key}
                                    onClick={() => setTab(t.key)}
                                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                                        tab === t.key
                                            ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                                            : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                                    }`}
                                >
                                    {t.label}
                                </button>
                            ))}
                            <div className="ml-auto pb-1 flex gap-2">
                                <button
                                    onClick={() => setShowExpenseDialog(true)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors text-rose-400 border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20"
                                >
                                    <MinusCircle className="w-3.5 h-3.5" />
                                    지출 기록
                                </button>
                                <button
                                    onClick={() => setShowAddDialog(true)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors text-amber-400 border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20"
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                    누적벌점 벌금
                                </button>
                            </div>
                        </div>

                        {/* Tab Content */}
                        <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
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
                                                    <TableCell className="font-medium text-[var(--color-text-primary)]">{s.title}</TableCell>
                                                    <TableCell className="text-[var(--color-text-muted)]">{s.date}</TableCell>
                                                    <TableCell className="text-right text-[var(--color-text-secondary)]">{formatKRW(s.fine_total)}</TableCell>
                                                    <TableCell className="text-right text-amber-400">{s.milestone_total > 0 ? formatKRW(s.milestone_total) : "-"}</TableCell>
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
                                                    <TableCell className="text-right text-[var(--color-text-secondary)]">{formatKRW(m.fine_total)}</TableCell>
                                                    <TableCell className="text-right text-amber-400">{m.milestone_total > 0 ? formatKRW(m.milestone_total) : "-"}</TableCell>
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
                                                <TableCell colSpan={5} className="text-center py-8 text-emerald-400">
                                                    미납 내역 없음
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            data.unpaid_milestones.map((u: any) => (
                                                <TableRow key={u.id} className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-hover)]">
                                                    <TableCell className="font-medium text-[var(--color-text-primary)]">{u.member_name}</TableCell>
                                                    <TableCell className="text-[var(--color-text-muted)]">{u.session_title || "-"}</TableCell>
                                                    <TableCell className="text-right text-rose-400 font-bold">{formatKRW(Math.abs(u.amount_krw))}</TableCell>
                                                    <TableCell className="text-[var(--color-text-secondary)]">{u.description}</TableCell>
                                                    <TableCell className="text-center">
                                                        <button
                                                            onClick={() => togglePaid({ id: u.id, is_paid: true })}
                                                            disabled={isPending}
                                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border transition-colors text-emerald-400 border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20"
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
                                                    <TableCell className="text-right font-bold text-rose-400">{formatKRW(e.amount_krw)}</TableCell>
                                                    <TableCell className="text-[var(--color-text-muted)]">{e.created_by || "-"}</TableCell>
                                                    <TableCell>
                                                        <AlertDialog>
                                                            <AlertDialogTrigger asChild>
                                                                <button
                                                                    disabled={isDeletingExpense}
                                                                    className="p-1 rounded hover:bg-rose-500/10 hover:text-rose-400 transition-colors text-[var(--color-text-muted)]"
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
                                                                ? "bg-blue-500/10 text-blue-400"
                                                                : e.type === "DEPOSIT_FORFEIT"
                                                                    ? "bg-yellow-500/10 text-yellow-400"
                                                                    : "bg-amber-500/10 text-amber-400"
                                                        }`}>
                                                            {e.type === "FINE" ? "벌금" : e.type === "DEPOSIT_FORFEIT" ? "이탈 몰수" : "누적벌점"}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="text-right font-bold text-rose-400">{formatKRW(Math.abs(e.amount_krw))}</TableCell>
                                                    <TableCell className="text-[var(--color-text-secondary)]">{e.description}</TableCell>
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
                            className="px-4 py-2 rounded-lg text-sm font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 disabled:opacity-50 transition-colors"
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
                            className="px-4 py-2 rounded-lg text-sm font-medium bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/30 disabled:opacity-50 transition-colors"
                        >
                            {isCreatingExpense ? "처리 중..." : "기록"}
                        </button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
