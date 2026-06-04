import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Wallet, TrendingUp, TrendingDown, Inbox } from "lucide-react";
import { useMySummary, useMyLedger } from "@/hooks/useMemberLedger";
import { LEDGER_TYPE_LABELS, translateDescription, type LedgerEntry } from "@/hooks/useLedger";
import { cn } from "@/lib/utils";

const TYPE_STYLE: Record<string, string> = {
    FINE: "bg-rose-50 text-rose-600 border-rose-200",
    MILESTONE_FINE: "bg-rose-50 text-rose-600 border-rose-200",
    MERIT: "bg-emerald-50 text-emerald-600 border-emerald-200",
    DEPOSIT_RECHARGE: "bg-blue-50 text-blue-600 border-blue-200",
    DEPOSIT_ADJUST: "bg-slate-50 text-slate-600 border-slate-200",
    DEPOSIT_REFUND: "bg-blue-50 text-blue-600 border-blue-200",
    DEPOSIT_FORFEIT: "bg-gray-100 text-gray-600 border-gray-300",
    ADJUSTMENT: "bg-slate-50 text-slate-600 border-slate-200",
};

const won = (n: number) => `${n > 0 ? "+" : ""}${n.toLocaleString()}원`;
const fmtDate = (s: string) => {
    const d = new Date(s);
    return `${d.getFullYear().toString().slice(2)}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
};

type Filter = "all" | "merit" | "penalty" | "fine";
const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: "전체" },
    { key: "merit", label: "상점" },
    { key: "penalty", label: "벌점" },
    { key: "fine", label: "벌금" },
];

export default function MemberLedger() {
    const { data: summary, isLoading: sumLoading } = useMySummary();
    const { data: ledger, isLoading: ledLoading } = useMyLedger();
    const [filter, setFilter] = useState<Filter>("all");

    const stats = useMemo(() => {
        const l = ledger ?? [];
        let plusCnt = 0, minusCnt = 0, fineSum = 0, rechargeSum = 0;
        for (const e of l) {
            if (e.score_delta > 0) plusCnt++;
            else if (e.score_delta < 0) minusCnt++;
            if ((e.type === "FINE" || e.type === "MILESTONE_FINE") && e.amount_krw < 0) fineSum += e.amount_krw;
            if (e.amount_krw > 0) rechargeSum += e.amount_krw;
        }
        return { plusCnt, minusCnt, fineSum, rechargeSum };
    }, [ledger]);

    const filtered = useMemo(() => {
        const l = ledger ?? [];
        if (filter === "merit") return l.filter((e) => e.score_delta > 0);
        if (filter === "penalty") return l.filter((e) => e.score_delta < 0);
        if (filter === "fine") return l.filter((e) => e.amount_krw < 0 && (e.type === "FINE" || e.type === "MILESTONE_FINE"));
        return l;
    }, [ledger, filter]);

    return (
        <motion.main
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="mx-auto w-full max-w-lg px-4 py-6 space-y-5"
        >
            {/* 디파짓 */}
            <div className="rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 p-5 text-white shadow-lg shadow-rose-500/20">
                <div className="flex items-center gap-1.5 text-rose-100 text-xs font-semibold mb-1">
                    <Wallet className="w-3.5 h-3.5" /> 디파짓 잔액
                </div>
                <p className="text-3xl font-extrabold tabular-nums">
                    {sumLoading ? "—" : `${(summary?.current_deposit ?? 0).toLocaleString()}`}
                    <span className="text-lg font-bold ml-1">원</span>
                </p>
                {!sumLoading && (
                    <div className="flex gap-4 mt-3 pt-3 border-t border-white/20 text-[11px]">
                        <span className="text-rose-100">누적 벌금 <b className="text-white">{Math.abs(stats.fineSum).toLocaleString()}원</b></span>
                        <span className="text-rose-100">누적 충전 <b className="text-white">{stats.rechargeSum.toLocaleString()}원</b></span>
                    </div>
                )}
            </div>

            {/* 상점/벌점/총점 + 건수 */}
            <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center">
                    <div className="flex items-center justify-center gap-1 text-emerald-600 text-[11px] font-semibold mb-1">
                        <TrendingUp className="w-3 h-3" /> 상점
                    </div>
                    <p className="text-xl font-extrabold text-emerald-600 tabular-nums">{sumLoading ? "—" : summary?.total_plus_score ?? 0}</p>
                    <p className="text-[10px] text-emerald-500/70 mt-0.5">{stats.plusCnt}건</p>
                </div>
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-center">
                    <div className="flex items-center justify-center gap-1 text-rose-600 text-[11px] font-semibold mb-1">
                        <TrendingDown className="w-3 h-3" /> 벌점
                    </div>
                    <p className="text-xl font-extrabold text-rose-600 tabular-nums">{sumLoading ? "—" : summary?.total_minus_score ?? 0}</p>
                    <p className="text-[10px] text-rose-500/70 mt-0.5">{stats.minusCnt}건</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-3 text-center">
                    <div className="text-gray-500 text-[11px] font-semibold mb-1">총점</div>
                    <p className="text-xl font-extrabold text-gray-900 tabular-nums">{sumLoading ? "—" : summary?.net_score ?? 0}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">상점+벌점</p>
                </div>
            </div>

            {/* 장부 내역 + 필터 */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-bold text-gray-900">장부 내역</h2>
                    <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5">
                        {FILTERS.map((f) => (
                            <button
                                key={f.key}
                                onClick={() => setFilter(f.key)}
                                className={cn(
                                    "px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors",
                                    filter === f.key ? "bg-white text-rose-600 shadow-sm" : "text-gray-400 hover:text-gray-600",
                                )}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>
                </div>

                {ledLoading ? (
                    <div className="flex items-center justify-center py-12">
                        <span className="inline-block w-5 h-5 border-2 border-gray-300 border-t-rose-500 rounded-full animate-spin" />
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
                        <Inbox className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                        <p className="text-sm text-gray-500">
                            {(ledger?.length ?? 0) === 0 ? "아직 거래 내역이 없습니다" : "해당 유형의 내역이 없습니다"}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2.5">
                        {filtered.map((e: LedgerEntry) => (
                            <div key={e.id} className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm">
                                <div className="flex items-center justify-between mb-1.5">
                                    <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${TYPE_STYLE[e.type] ?? "bg-gray-50 text-gray-600 border-gray-200"}`}>
                                        {LEDGER_TYPE_LABELS[e.type] ?? e.type}
                                    </span>
                                    <span className="text-[11px] text-gray-400 tabular-nums">{fmtDate(e.created_at)}</span>
                                </div>
                                <p className="text-sm text-gray-700 leading-snug mb-2 [word-break:keep-all]">
                                    {translateDescription(e.description)}
                                    {e.session_title && <span className="text-gray-400"> · {e.session_title}</span>}
                                </p>
                                <div className="flex items-center justify-between text-xs">
                                    <div className="flex items-center gap-3">
                                        {e.score_delta !== 0 && (
                                            <span className={`font-bold tabular-nums ${e.score_delta > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                                {e.score_delta > 0 ? "상점 +" : "벌점 "}{e.score_delta}점
                                            </span>
                                        )}
                                        {e.amount_krw !== 0 && (
                                            <span className={`font-bold tabular-nums ${e.amount_krw > 0 ? "text-blue-600" : "text-gray-700"}`}>
                                                {won(e.amount_krw)}
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-gray-400 tabular-nums">잔액 {e.deposit_after.toLocaleString()}원</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </motion.main>
    );
}
