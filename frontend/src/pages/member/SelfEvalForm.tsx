import { useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSelfEvalForm, useSubmitSelfEval } from "@/hooks/useMemberEvaluation";
import { LikertScale } from "@/components/eval/LikertScale";
import { motion } from "framer-motion";
import { ArrowLeft, Send, CheckCircle2, ClipboardList, Sparkles } from "lucide-react";

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
    const [step, setStep] = useState<"intro" | "questions">("intro");

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

    if (step === "intro") {
        return (
            <div className="member-page">
                <style>{`
                    @keyframes petal-drift-1 { 0%, 100% { transform: translateY(0) rotate(-15deg); } 50% { transform: translateY(-6px) rotate(-5deg); } }
                    @keyframes petal-drift-2 { 0%, 100% { transform: translateY(0) rotate(20deg); } 50% { transform: translateY(-8px) rotate(30deg); } }
                    @keyframes petal-drift-3 { 0%, 100% { transform: translateY(0) rotate(45deg); } 50% { transform: translateY(-5px) rotate(55deg); } }
                `}</style>

                <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-gray-200">
                    <div className="mx-auto max-w-2xl flex items-center gap-3 px-4 py-3">
                        <button
                            onClick={() => navigate("/member")}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                        <h1 className="text-base font-bold text-gray-900">
                            자기 평가
                        </h1>
                    </div>
                </header>

                <motion.main
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                    className="mx-auto w-full max-w-2xl px-4 py-6 pb-28"
                >
                    {/* Gradient hero area */}
                    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-rose-50 via-pink-50 to-white border border-rose-100 p-6 sm:p-8 mb-6">
                        {/* Decorative petals */}
                        <svg className="absolute top-3 right-6 w-5 h-5 text-rose-200 opacity-60" viewBox="0 0 20 20" style={{ animation: "petal-drift-1 4s ease-in-out infinite" }}>
                            <ellipse cx="10" cy="8" rx="5" ry="8" fill="currentColor" transform="rotate(-15 10 8)" />
                        </svg>
                        <svg className="absolute top-8 right-20 w-4 h-4 text-pink-200 opacity-50" viewBox="0 0 20 20" style={{ animation: "petal-drift-2 5s ease-in-out infinite 0.5s" }}>
                            <ellipse cx="10" cy="8" rx="5" ry="8" fill="currentColor" transform="rotate(20 10 8)" />
                        </svg>
                        <svg className="absolute bottom-4 left-8 w-3.5 h-3.5 text-rose-200 opacity-40" viewBox="0 0 20 20" style={{ animation: "petal-drift-3 6s ease-in-out infinite 1s" }}>
                            <ellipse cx="10" cy="8" rx="5" ry="8" fill="currentColor" transform="rotate(45 10 8)" />
                        </svg>

                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.1, duration: 0.4 }}
                        >
                            <span className="inline-block px-2.5 py-1 rounded-full bg-rose-100 text-rose-600 text-[11px] font-semibold tracking-wide mb-3">
                                UnivPT 33기
                            </span>
                            <h2 className="text-xl sm:text-2xl font-extrabold text-gray-900 mb-1.5">
                                나의 발표 성장 기록
                            </h2>
                            <p className="text-sm text-gray-500">
                                자기 평가를 통해 나의 변화를 확인해 보세요
                            </p>
                        </motion.div>
                    </div>

                    {/* Intro text */}
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2, duration: 0.4 }}
                        className="p-5 sm:p-6 rounded-xl bg-white border border-gray-200 shadow-sm"
                    >
                        <div className="text-sm text-gray-600 leading-[2.0] space-y-5 [word-break:keep-all]">
                            <p>
                                유니브피티 33기 기수 여러분 안녕하세요.
                            </p>
                            <p>
                                본 평가는 유니브피티 교육 과정의 시작과 끝에서 <strong className="text-gray-800">나의 변화를 직접 확인</strong>해 보기 위한 성장 기록입니다.
                                평가는 개인 1 세션 발표와 최종 개인 발표를 기준으로 <strong className="text-gray-800">총 두 차례</strong> 진행됩니다.
                            </p>
                            <p>
                                여러분의 응답은 <strong className="text-rose-600">개인별 발표 성장 리포트</strong>로 정리되어, 지금의 강점과 앞으로 더 발전시킬 방향을 제시해 드립니다.
                                이를 통해 스스로의 가능성을 구체적인 목표로 연결할 수 있도록 돕고자 합니다.
                            </p>
                            <p>
                                또한 사전·사후 결과를 비교하여, <strong className="text-gray-800">내가 얼마나 성장했는지를 직접 확인</strong>할 수 있습니다.
                                수상 여부와 관계없이, 나의 노력과 변화의 과정을 수치와 피드백으로 남길 수 있다는 점에서 의미가 있습니다.
                            </p>
                            <p className="text-gray-700 font-medium">
                                이 평가는 경쟁을 위한 자리가 아니라, <span className="text-rose-600">어제의 나보다 더 나아진 오늘의 나</span>를 확인하는 과정입니다.
                            </p>
                            <p>
                                정답은 없으니 나를 있는 그대로 바라보고, 현재 나의 모습에 가장 가까운 항목에 <strong className="text-gray-800">솔직하게 응답</strong>해 주세요.
                            </p>
                        </div>
                    </motion.div>
                </motion.main>

                <div className="fixed bottom-0 inset-x-0 z-10 bg-white/90 backdrop-blur-md border-t border-gray-200">
                    <div className="mx-auto max-w-2xl px-4 py-3">
                        <motion.button
                            whileTap={{ scale: 0.97 }}
                            onClick={() => setStep("questions")}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-gradient-to-r from-rose-500 to-rose-600 text-white text-sm font-bold hover:from-rose-600 hover:to-rose-700 transition-all shadow-lg shadow-rose-500/25"
                        >
                            <Sparkles className="w-4 h-4" />
                            평가 시작하기
                        </motion.button>
                    </div>
                </div>
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

                {/* Question intro */}
                <div className="mb-6 p-4 sm:p-5 rounded-xl bg-gradient-to-r from-rose-50 to-pink-50 border border-rose-100">
                    <div className="flex items-start gap-3">
                        <div className="shrink-0 mt-0.5 w-7 h-7 rounded-lg bg-rose-100 flex items-center justify-center">
                            <ClipboardList className="w-3.5 h-3.5 text-rose-500" />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-gray-800 mb-1.5">평가 문항 소개</h3>
                            <p className="text-sm text-gray-600 leading-[1.8] [word-break:keep-all]">
                                본 평가는 프레젠테이션의 3요소인 <strong className="text-gray-800">기획, 디자인, 스피치</strong> 세 영역으로 구성되어 있습니다.
                            </p>
                            <p className="text-sm text-gray-600 leading-[1.8] mt-2 [word-break:keep-all]">
                                각 문항을 읽고 현재 본인의 발표 역량 수준에 가장 가깝다고 생각되는 점수를 선택해 주세요.
                            </p>
                        </div>
                    </div>
                </div>

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
                                            <p className="text-sm text-gray-700 mb-4 leading-[1.8] font-medium [word-break:keep-all]">
                                                <span className="font-bold text-gray-900">[{q.label}]</span>{" "}{q.text}
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
