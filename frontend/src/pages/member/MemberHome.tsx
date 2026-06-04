import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { BarChart3, Wallet, ChevronRight } from "lucide-react";
import { useMySummary } from "@/hooks/useMemberLedger";

export default function MemberHome() {
    const navigate = useNavigate();
    const { data: summary, isLoading } = useMySummary();

    const shortcuts = [
        {
            to: "/member/reports",
            icon: BarChart3,
            title: "발표 성장 리포트",
            desc: "초기·후기 평가와 나의 성장 리포트 확인",
            color: "from-rose-500 to-pink-600",
        },
        {
            to: "/member/ledger",
            icon: Wallet,
            title: "내 점수·장부",
            desc: "상점·벌점·디파짓과 거래 내역 확인",
            color: "from-sky-500 to-indigo-500",
        },
    ];

    return (
        <motion.main
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="mx-auto w-full max-w-lg px-4 py-6 space-y-5"
        >
            {/* 한눈에 보기 */}
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold text-gray-400 mb-3">한눈에 보기</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                        <p className="text-[11px] text-gray-400 mb-0.5">총점</p>
                        <p className="text-lg font-extrabold text-gray-900 tabular-nums">{isLoading ? "—" : summary?.net_score ?? 0}</p>
                    </div>
                    <div>
                        <p className="text-[11px] text-gray-400 mb-0.5">상점/벌점</p>
                        <p className="text-lg font-extrabold tabular-nums">
                            <span className="text-emerald-600">{isLoading ? "—" : summary?.total_plus_score ?? 0}</span>
                            <span className="text-gray-300 mx-0.5">/</span>
                            <span className="text-rose-600">{isLoading ? "—" : summary?.total_minus_score ?? 0}</span>
                        </p>
                    </div>
                    <div>
                        <p className="text-[11px] text-gray-400 mb-0.5">디파짓</p>
                        <p className="text-lg font-extrabold text-gray-900 tabular-nums">{isLoading ? "—" : `${((summary?.current_deposit ?? 0) / 10000).toFixed(1)}만`}</p>
                    </div>
                </div>
            </div>

            {/* 바로가기 */}
            <div className="space-y-3">
                {shortcuts.map(({ to, icon: Icon, title, desc, color }) => (
                    <motion.button
                        key={to}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => navigate(to)}
                        className="w-full flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm text-left hover:bg-gray-50 transition-colors"
                    >
                        <div className={`shrink-0 w-11 h-11 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center text-white`}>
                            <Icon className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-gray-900">{title}</p>
                            <p className="text-xs text-gray-400 mt-0.5 [word-break:keep-all]">{desc}</p>
                        </div>
                        <ChevronRight className="w-5 h-5 text-gray-300 shrink-0" />
                    </motion.button>
                ))}
            </div>
        </motion.main>
    );
}
