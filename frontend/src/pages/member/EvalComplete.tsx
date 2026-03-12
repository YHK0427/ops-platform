import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2, Home } from "lucide-react";

export default function EvalComplete() {
    const navigate = useNavigate();

    return (
        <div className="member-page flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
                className="w-full max-w-sm"
            >
                <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
                    {/* Animated checkmark */}
                    <motion.div
                        initial={{ scale: 0, rotate: -180 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{
                            delay: 0.2,
                            duration: 0.6,
                            ease: [0.34, 1.56, 0.64, 1],
                        }}
                        className="mx-auto mb-6 w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center"
                    >
                        <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                    </motion.div>

                    <motion.h1
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4, duration: 0.4 }}
                        className="text-xl font-bold text-gray-900 mb-2"
                    >
                        평가가 완료되었습니다!
                    </motion.h1>

                    <motion.p
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.5, duration: 0.4 }}
                        className="text-sm text-gray-500 mb-1"
                    >
                        소중한 평가에 감사드립니다 :)
                    </motion.p>

                    <motion.p
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.6, duration: 0.4 }}
                        className="text-xs text-gray-400 mb-8"
                    >
                        결과는 운영진이 공개한 후 확인하실 수 있습니다
                    </motion.p>

                    <motion.button
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.7, duration: 0.4 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => navigate("/member", { replace: true })}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-rose-500 to-rose-600 text-white text-sm font-bold hover:from-rose-600 hover:to-rose-700 transition-all shadow-lg shadow-rose-500/20"
                    >
                        <Home className="w-4 h-4" />
                        홈으로 돌아가기
                    </motion.button>
                </div>
            </motion.div>
        </div>
    );
}
