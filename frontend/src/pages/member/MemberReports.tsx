import { useNavigate } from "react-router-dom";
import { usePendingEvals } from "@/hooks/useMemberEvaluation";
import { motion } from "framer-motion";
import { ClipboardList, ChevronRight, Inbox, CheckCircle2, BarChart3 } from "lucide-react";

export default function MemberReports() {
    const { data: evals, isLoading } = usePendingEvals();
    const navigate = useNavigate();

    return (
        <motion.main
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="mx-auto w-full max-w-lg px-4 py-6"
        >
            <div className="flex items-center gap-2 mb-4">
                <ClipboardList className="w-4 h-4 text-rose-500" />
                <h2 className="text-sm font-bold text-gray-900">발표 성장 리포트</h2>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-12">
                    <span className="inline-block w-5 h-5 border-2 border-gray-300 border-t-rose-500 rounded-full animate-spin" />
                </div>
            ) : !evals || evals.length === 0 ? (
                <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
                    <Inbox className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                    <p className="text-sm text-gray-500">현재 진행 중인 평가가 없습니다</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {evals.map((item, index) => (
                        <motion.div
                            key={item.round_id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.05, duration: 0.3 }}
                            className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                        >
                            <div className="flex items-center gap-2 mb-2">
                                <p className="text-sm font-bold text-gray-900 truncate">
                                    {item.round_title}
                                </p>
                                {item.submitted && (
                                    <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-600 border border-emerald-200 shrink-0">
                                        <CheckCircle2 className="w-2.5 h-2.5" />
                                        제출 완료
                                    </span>
                                )}
                            </div>
                            {item.session_title && (
                                <p className="text-xs text-gray-400 mb-3">{item.session_title}</p>
                            )}
                            <div className="flex items-center gap-2">
                                {item.is_open && (
                                    <button
                                        onClick={() => navigate(`/member/eval/${item.round_id}`)}
                                        className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
                                            item.submitted
                                                ? "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                                : "bg-rose-500 text-white hover:bg-rose-600 shadow-sm shadow-rose-500/20"
                                        }`}
                                    >
                                        <ClipboardList className="w-3.5 h-3.5" />
                                        {item.submitted ? "수정하기" : "평가하기"}
                                        <ChevronRight className="w-3 h-3" />
                                    </button>
                                )}
                                {item.results_open && (
                                    <button
                                        onClick={() => navigate(`/member/eval/${item.round_id}/result`)}
                                        className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-sky-50 text-sky-600 border border-sky-200 hover:bg-sky-100 transition-colors"
                                    >
                                        <BarChart3 className="w-3.5 h-3.5" />
                                        결과 보기
                                        <ChevronRight className="w-3 h-3" />
                                    </button>
                                )}
                            </div>
                        </motion.div>
                    ))}
                </div>
            )}
        </motion.main>
    );
}
