import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2, Home } from "lucide-react";

export default function EvalComplete() {
    const navigate = useNavigate();

    return (
        <div className="member-page flex items-center justify-center p-4">
            <style>{`
                @keyframes petal-fall-1 { 0%, 100% { transform: translateY(0) rotate(-15deg); } 50% { transform: translateY(-6px) rotate(-5deg); } }
                @keyframes petal-fall-2 { 0%, 100% { transform: translateY(0) rotate(20deg); } 50% { transform: translateY(-8px) rotate(30deg); } }
                @keyframes petal-fall-3 { 0%, 100% { transform: translateY(0) rotate(45deg); } 50% { transform: translateY(-5px) rotate(55deg); } }
                @keyframes petal-fall-4 { 0%, 100% { transform: translateY(0) rotate(-30deg); } 50% { transform: translateY(-7px) rotate(-20deg); } }
            `}</style>
            <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
                className="w-full max-w-md"
            >
                <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
                    {/* Decorative petals */}
                    <svg className="absolute top-4 left-6 w-5 h-5 text-rose-200 opacity-60" viewBox="0 0 20 20" style={{ animation: "petal-fall-1 4s ease-in-out infinite" }}>
                        <ellipse cx="10" cy="8" rx="5" ry="8" fill="currentColor" transform="rotate(-15 10 8)" />
                    </svg>
                    <svg className="absolute top-6 right-8 w-4 h-4 text-pink-200 opacity-50" viewBox="0 0 20 20" style={{ animation: "petal-fall-2 5s ease-in-out infinite 0.5s" }}>
                        <ellipse cx="10" cy="8" rx="5" ry="8" fill="currentColor" transform="rotate(20 10 8)" />
                    </svg>
                    <svg className="absolute bottom-20 left-10 w-3.5 h-3.5 text-rose-200 opacity-40" viewBox="0 0 20 20" style={{ animation: "petal-fall-3 6s ease-in-out infinite 1s" }}>
                        <ellipse cx="10" cy="8" rx="5" ry="8" fill="currentColor" transform="rotate(45 10 8)" />
                    </svg>
                    <svg className="absolute bottom-24 right-6 w-4 h-4 text-pink-200 opacity-35" viewBox="0 0 20 20" style={{ animation: "petal-fall-4 5.5s ease-in-out infinite 0.8s" }}>
                        <ellipse cx="10" cy="8" rx="5" ry="8" fill="currentColor" transform="rotate(-30 10 8)" />
                    </svg>

                    {/* Animated checkmark */}
                    <motion.div
                        initial={{ scale: 0, rotate: -180 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{
                            delay: 0.2,
                            duration: 0.6,
                            ease: [0.34, 1.56, 0.64, 1],
                        }}
                        className="relative mx-auto mb-6 w-16 h-16 rounded-full bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 flex items-center justify-center"
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
                        transition={{ delay: 0.55, duration: 0.4 }}
                        className="text-sm text-gray-500 mb-1"
                    >
                        평가에 참여해 주셔서 감사합니다.
                    </motion.p>

                    <motion.p
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.6, duration: 0.4 }}
                        className="text-sm text-gray-400 mb-2 [word-break:keep-all]"
                    >
                        본 결과는 개인별 성장 리포트로 정리되어 제공될 예정입니다.
                    </motion.p>

                    <motion.p
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.7, duration: 0.4 }}
                        className="text-sm text-rose-400 font-medium mb-8"
                    >
                        여러분의 성장을 응원합니다 🌼💗
                    </motion.p>

                    <motion.button
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.85, duration: 0.4 }}
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
