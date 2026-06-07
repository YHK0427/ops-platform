import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { MessageSquareHeart, ChevronRight, Loader2 } from "lucide-react";
import { useMemberFeedbackBoards } from "@/hooks/useLiveFeedback";

export default function MemberFeedbackList() {
    const navigate = useNavigate();
    const { data: boards, isLoading } = useMemberFeedbackBoards();

    return (
        <motion.main
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="mx-auto w-full max-w-lg px-4 py-6 space-y-4"
        >
            <div>
                <h2 className="text-lg font-extrabold text-gray-900">실시간 피드백</h2>
                <p className="text-xs text-gray-400 mt-0.5">발표 피드백 보드 (진행 중 · 지난 기록)</p>
            </div>

            {isLoading ? (
                <div className="flex justify-center py-16">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-300" />
                </div>
            ) : !boards || boards.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-300 p-10 text-center">
                    <MessageSquareHeart className="w-9 h-9 text-gray-300 mx-auto mb-3" />
                    <p className="text-sm text-gray-500">아직 피드백 보드가 없습니다.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {boards.map((b) => (
                        <motion.button
                            key={b.id}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => navigate(`/member/feedback/${b.id}`)}
                            className="w-full flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm text-left hover:bg-gray-50 transition-colors"
                        >
                            <div className="shrink-0 w-11 h-11 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center text-white">
                                <MessageSquareHeart className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <p className="text-sm font-bold text-gray-900 truncate">{b.title}</p>
                                    {b.is_open && (
                                        <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-600 text-[10px] font-bold">
                                            <span className="relative flex h-1.5 w-1.5">
                                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                                                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-rose-500" />
                                            </span>
                                            진행중
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-gray-400 mt-0.5 truncate">
                                    {b.session_week_num != null ? `${b.session_week_num}주차 · ` : ""}
                                    {b.session_title ?? "세션"}
                                </p>
                            </div>
                            <ChevronRight className="w-5 h-5 text-gray-300 shrink-0" />
                        </motion.button>
                    ))}
                </div>
            )}
        </motion.main>
    );
}
