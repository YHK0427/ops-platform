import { useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSelfEvalForm, useSubmitSelfEval } from "@/hooks/useMemberEvaluation";
import { LikertScale } from "@/components/eval/LikertScale";
import { motion } from "framer-motion";
import { ArrowLeft, Send, CheckCircle2 } from "lucide-react";

const DOMAIN_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
    PLANNING: { label: "기획", color: "text-blue-600", bg: "bg-blue-50", border: "border-l-blue-500" },
    DESIGN: { label: "디자인", color: "text-emerald-600", bg: "bg-emerald-50", border: "border-l-emerald-500" },
    SPEECH: { label: "스피치", color: "text-amber-600", bg: "bg-amber-50", border: "border-l-amber-500" },
};

const SCALE_LABELS: Record<number, string> = {
    1: "매우 그렇지 않다",
    2: "그렇지 않다",
    3: "보통이다",
    4: "그렇다",
    5: "매우 그렇다",
};

export default function SelfEvalForm() {
    const { roundId } = useParams<{ roundId: string }>();
    const navigate = useNavigate();
    const { data, isLoading } = useSelfEvalForm(roundId!);
    const submitMutation = useSubmitSelfEval();

    const [scores, setScores] = useState<Record<string, number>>({});

    const effectiveScores = useMemo(() => {
        if (!data?.responses) return scores;
        return { ...data.responses, ...scores };
    }, [data?.responses, scores]);

    const questions = data?.questions ?? [];
    const totalQuestions = questions.length;
    const answeredCount = Object.keys(effectiveScores).length;
    const allAnswered = totalQuestions > 0 && answeredCount >= totalQuestions;

    const isAlreadySubmitted = useMemo(() => {
        if (!data?.responses || !data?.questions) return false;
        return data.questions.every((q) => q.key in data.responses);
    }, [data]);

    const groupedQuestions = useMemo(() => {
        const groups: Record<string, typeof questions> = {};
        for (const q of questions) {
            if (!groups[q.domain]) groups[q.domain] = [];
            groups[q.domain].push(q);
        }
        for (const domain of Object.keys(groups)) {
            groups[domain].sort((a, b) => a.order - b.order);
        }
        return groups;
    }, [questions]);

    const handleScore = (key: string, value: number) => {
        setScores((prev) => ({ ...prev, [key]: value }));
    };

    const handleSubmit = async () => {
        if (!roundId || !allAnswered) return;
        try {
            await submitMutation.mutateAsync({
                roundId,
                scores: effectiveScores,
            });
            if (!isAlreadySubmitted) {
                navigate(`/member/eval/${roundId}/complete`, { replace: true });
            }
        } catch {
            // Error handling via mutation state
        }
    };

    if (isLoading) {
        return (
            <div className="member-page flex items-center justify-center">
                <span className="inline-block w-6 h-6 border-2 border-gray-300 border-t-rose-500 rounded-full animate-spin" />
            </div>
        );
    }

    const progress = totalQuestions > 0 ? (answeredCount / totalQuestions) * 100 : 0;

    return (
        <div className="member-page">
            {/* Header */}
            <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-gray-200">
                <div className="mx-auto max-w-2xl flex items-center gap-3 px-4 py-3">
                    <button
                        onClick={() => navigate("/member")}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div className="flex-1 min-w-0">
                        <h1 className="text-base font-bold text-gray-900">
                            자기 평가
                        </h1>
                        <p className="text-xs text-gray-400">
                            {answeredCount}/{totalQuestions} 문항 완료
                        </p>
                    </div>
                    {isAlreadySubmitted && (
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-600">
                            <CheckCircle2 className="w-3 h-3" />
                            제출 완료
                        </span>
                    )}
                </div>

                {/* Progress bar */}
                <div className="h-1 bg-gray-100">
                    <motion.div
                        className="h-full bg-gradient-to-r from-rose-400 to-rose-500"
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                        transition={{ duration: 0.3, ease: "easeOut" }}
                    />
                </div>
            </header>

            {/* Content */}
            <motion.main
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="mx-auto w-full max-w-2xl px-4 py-6 pb-28"
            >
                {/* Submitted banner */}
                {isAlreadySubmitted && (
                    <div className="mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-center">
                        <p className="text-sm font-medium text-emerald-700">
                            제출 완료
                        </p>
                        <p className="text-xs text-emerald-500 mt-1">
                            수정이 필요하면 변경 후 재제출할 수 있습니다
                        </p>
                    </div>
                )}

                {/* Scale legend */}
                <div className="mb-6 p-4 rounded-xl bg-white border border-gray-200 shadow-sm">
                    <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">
                        평가 기준
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {Object.entries(SCALE_LABELS).map(([val, label]) => (
                            <span key={val} className="text-[11px] text-gray-500">
                                <span className="font-bold text-gray-700">{val}</span>{" "}
                                {label}
                            </span>
                        ))}
                    </div>
                </div>

                {/* Questions grouped by domain */}
                <div className="space-y-8">
                    {Object.entries(groupedQuestions).map(([domain, domainQuestions]) => {
                        const meta = DOMAIN_META[domain] ?? { label: domain, color: "text-gray-600", bg: "bg-gray-50", border: "border-l-gray-400" };
                        return (
                            <section key={domain}>
                                <div className={`flex items-center gap-3 mb-4 px-3 py-2 rounded-lg ${meta.bg}`}>
                                    <div className={`w-1 h-5 rounded-full ${meta.border.replace("border-l-", "bg-")}`} />
                                    <h2 className={`text-sm font-bold ${meta.color}`}>
                                        {meta.label}
                                    </h2>
                                    <span className="text-xs text-gray-400 ml-auto">
                                        {domainQuestions.filter((q) => effectiveScores[q.key] != null).length}/{domainQuestions.length}
                                    </span>
                                </div>

                                <div className="space-y-3">
                                    {domainQuestions.map((q, idx) => (
                                        <motion.div
                                            key={q.key}
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: idx * 0.03, duration: 0.3 }}
                                            className={`p-4 sm:p-5 rounded-xl bg-white border border-gray-200 shadow-sm border-l-4 ${meta.border}`}
                                        >
                                            <p className="text-sm text-gray-700 mb-4 leading-relaxed font-medium">
                                                {q.text}
                                            </p>
                                            <LikertScale
                                                value={effectiveScores[q.key] ?? null}
                                                onChange={(v) => handleScore(q.key, v)}
                                                variant="light"
                                            />
                                        </motion.div>
                                    ))}
                                </div>
                            </section>
                        );
                    })}
                </div>
            </motion.main>

            {/* Fixed bottom submit bar */}
            <div className="fixed bottom-0 inset-x-0 z-10 bg-white/90 backdrop-blur-md border-t border-gray-200">
                <div className="mx-auto max-w-2xl px-4 py-3">
                    <motion.button
                        whileTap={{ scale: 0.97 }}
                        onClick={handleSubmit}
                        disabled={!allAnswered || submitMutation.isPending}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-rose-500 to-rose-600 text-white text-sm font-bold hover:from-rose-600 hover:to-rose-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-rose-500/20"
                    >
                        {submitMutation.isPending ? (
                            <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            <Send className="w-4 h-4" />
                        )}
                        {submitMutation.isPending
                            ? "제출 중..."
                            : !allAnswered
                              ? `${totalQuestions - answeredCount}개 문항이 남았습니다`
                              : isAlreadySubmitted
                                ? "재제출하기"
                                : "평가 제출하기"}
                    </motion.button>

                    {submitMutation.isError && (
                        <p className="text-xs text-rose-500 text-center mt-2">
                            제출에 실패했습니다. 다시 시도해주세요.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
