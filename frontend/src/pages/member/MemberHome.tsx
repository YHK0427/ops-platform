import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { BarChart3, Wallet, ChevronRight, MessageSquareHeart, Megaphone } from "lucide-react";
import { useMySummary } from "@/hooks/useMemberLedger";
import { useOpenFeedbackBoard } from "@/hooks/useLiveFeedback";

export default function MemberHome() {
    const navigate = useNavigate();
    const { data: summary, isLoading } = useMySummary();
    const { data: openBoard } = useOpenFeedbackBoard();

    const menu = [
        {
            to: "/member/announcements",
            icon: Megaphone,
            title: "공지사항",
            desc: "운영진 공지 확인",
            color: "from-rose-500 to-pink-600",
        },
        {
            to: "/member/reports",
            icon: BarChart3,
            title: "성장 리포트",
            desc: "초기·후기 평가",
            color: "from-violet-500 to-purple-600",
        },
        {
            to: "/member/feedback",
            icon: MessageSquareHeart,
            title: "실시간 피드백",
            desc: "발표 피드백 보드",
            color: "from-amber-500 to-orange-500",
        },
        {
            to: "/member/ledger",
            icon: Wallet,
            title: "내 점수·장부",
            desc: "상·벌점·디파짓",
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
            {/* 실시간 피드백 진행 중 (보드 공개 시에만 노출) */}
            {openBoard && (
                <motion.button
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => navigate(`/member/feedback/${openBoard.id}`)}
                    className="w-full flex items-center gap-4 rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 to-pink-50 p-4 shadow-sm text-left"
                >
                    <div className="shrink-0 w-11 h-11 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center text-white">
                        <MessageSquareHeart className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                            <span className="relative flex h-2 w-2">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                                <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
                            </span>
                            <p className="text-sm font-bold text-rose-700">실시간 피드백 진행 중</p>
                        </div>
                        <p className="text-xs text-rose-500/80 mt-0.5 [word-break:keep-all] truncate">
                            {openBoard.title} · 발표자에게 익명으로 남겨보세요
                        </p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-rose-300 shrink-0" />
                </motion.button>
            )}

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

            {/* 메뉴 보드 */}
            <div>
                <p className="text-xs font-semibold text-gray-400 mb-2 px-1">메뉴</p>
                <div className="grid grid-cols-2 gap-3">
                    {menu.map(({ to, icon: Icon, title, desc, color }) => (
                        <motion.button
                            key={to}
                            whileTap={{ scale: 0.97 }}
                            onClick={() => navigate(to)}
                            className="flex flex-col items-start gap-2.5 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm text-left hover:border-gray-300 hover:shadow-md transition-all"
                        >
                            <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center text-white shadow-sm`}>
                                <Icon className="w-5 h-5" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm font-bold text-gray-900">{title}</p>
                                <p className="text-[11px] text-gray-400 mt-0.5 [word-break:keep-all]">{desc}</p>
                            </div>
                        </motion.button>
                    ))}
                </div>
            </div>
        </motion.main>
    );
}
