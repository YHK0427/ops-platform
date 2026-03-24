import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
    ArrowLeft,
    CheckCircle2,
    Circle,
    Loader2,
    Send,
    ChevronRight,
    ClipboardList,
    Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import LikertScale from "@/components/eval/LikertScale";
import {
    useMyAssignments,
    useSubmitAudienceEval,
    useEvalRound,
} from "@/hooks/useEvaluation";

// ── Question definitions (audience_text from backend constants) ──────────────

interface EvalQuestion {
    key: string;
    domain: "PLANNING" | "DESIGN" | "SPEECH";
    label: string;
    text: string;
    order: number;
}

const EVAL_QUESTIONS: EvalQuestion[] = [
    {
        key: "planning_consistency",
        domain: "PLANNING",
        order: 1,
        label: "일관성",
        text: "발표자는 발표의 전개가 하나의 핵심 메시지로 자연스럽게 귀결되도록 구성했다",
    },
    {
        key: "planning_delivery",
        domain: "PLANNING",
        order: 2,
        label: "전달력",
        text: "발표자는 청중의 수준과 관심사를 고려하여 발표를 의도적으로 설계했다",
    },
    {
        key: "planning_originality",
        domain: "PLANNING",
        order: 3,
        label: "특수성",
        text: "발표자는 나만의 관점과 해석이 드러난 차별화된 메시지를 전달했다",
    },
    {
        key: "design_readability",
        domain: "DESIGN",
        order: 4,
        label: "가독성",
        text: "발표자는 슬라이드의 글자 크기와 배치를 청중의 시선을 고려해 읽기 쉽게 구성했다",
    },
    {
        key: "design_support",
        domain: "DESIGN",
        order: 5,
        label: "지원성",
        text: "슬라이드가 스피치의 핵심 메시지와 설명을 시각적으로 적절히 보조하고 있다",
    },
    {
        key: "design_creativity",
        domain: "DESIGN",
        order: 6,
        label: "통일성",
        text: "나는 파워포인트의 기능과 디자인 요소를 발표의 분위기와 목적에 맞게 의도적으로 활용했다",
    },
    {
        key: "speech_expression",
        domain: "SPEECH",
        order: 7,
        label: "표현력",
        text: "발표자는 강조의 위치에 맞게 음량, 속도, 호흡, 어미 등을 적절히 조절했다",
    },
    {
        key: "speech_fluency",
        domain: "SPEECH",
        order: 8,
        label: "유창성",
        text: "발표자는 발표 중 말이 끊기거나 막히지 않고, 흐름을 유지하며 자연스럽게 이어갔다",
    },
    {
        key: "speech_communication",
        domain: "SPEECH",
        order: 9,
        label: "소통능력",
        text: "발표자는 발표 중 슬라이드에만 집중하지 않고, 청중과 시선 교환 및 반응을 주고받으며 발표했다",
    },
];

const DOMAIN_LABELS: Record<string, string> = {
    PLANNING: "기획",
    DESIGN: "디자인",
    SPEECH: "스피치",
};

const DOMAIN_COLORS: Record<string, string> = {
    PLANNING: "text-blue-600",
    DESIGN: "text-emerald-600",
    SPEECH: "text-amber-600",
};

// Group questions by domain
const GROUPED_QUESTIONS = [
    { domain: "PLANNING" as const, questions: EVAL_QUESTIONS.filter((q) => q.domain === "PLANNING") },
    { domain: "DESIGN" as const, questions: EVAL_QUESTIONS.filter((q) => q.domain === "DESIGN") },
    { domain: "SPEECH" as const, questions: EVAL_QUESTIONS.filter((q) => q.domain === "SPEECH") },
];

// ══════════════════════════════════════════════════════════════════════════════
// Main Component
// ══════════════════════════════════════════════════════════════════════════════

export default function EvalAudienceForm() {
    const { roundId } = useParams<{ roundId: string }>();
    const navigate = useNavigate();
    const numRoundId = Number(roundId);

    const { data: round, isLoading: roundLoading } = useEvalRound(numRoundId);
    const { data: assignments, isLoading: assignLoading } = useMyAssignments(numRoundId);
    const submitEval = useSubmitAudienceEval();

    const [showIntro, setShowIntro] = useState(true);
    const [showCompleteModal, setShowCompleteModal] = useState(false);
    const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);
    const [scores, setScores] = useState<Record<string, number>>({});

    const isLoading = roundLoading || assignLoading;

    const selectedAssignment = useMemo(
        () => assignments?.find((a) => a.presenter_member_id === selectedMemberId),
        [assignments, selectedMemberId]
    );

    // Count answered questions
    const answeredCount = Object.keys(scores).length;
    const totalQuestions = EVAL_QUESTIONS.length;
    const allAnswered = answeredCount === totalQuestions;

    function handleScore(key: string, value: number) {
        setScores((prev) => ({ ...prev, [key]: value }));
    }

    function handleSelectMember(memberId: number) {
        setSelectedMemberId(memberId);
        // Load existing responses if previously submitted, otherwise reset
        const assignment = assignments?.find((a) => a.presenter_member_id === memberId);
        if (assignment?.submitted && assignment.responses && Object.keys(assignment.responses).length > 0) {
            setScores(assignment.responses);
        } else {
            setScores({});
        }
    }

    function handleSubmit() {
        if (!allAnswered) {
            toast.error("모든 문항에 응답해주세요.");
            return;
        }
        if (!selectedMemberId) return;

        submitEval.mutate(
            {
                roundId: numRoundId,
                presenter_member_id: selectedMemberId,
                scores,
            },
            {
                onSuccess: () => {
                    // Auto-advance to next unsubmitted member
                    const nextUnsubmitted = assignments?.find(
                        (a) => !a.submitted && a.presenter_member_id !== selectedMemberId
                    );
                    if (nextUnsubmitted) {
                        setSelectedMemberId(nextUnsubmitted.presenter_member_id);
                        setScores({});
                    } else {
                        // 마지막 멤버 — 완료 팝업
                        setShowCompleteModal(true);
                    }
                },
            }
        );
    }

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[var(--color-base)]">
                <Loader2 className="w-8 h-8 animate-spin text-[var(--color-text-muted)]" />
            </div>
        );
    }

    if (!assignments?.length) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--color-base)] p-6 text-center">
                <p className="text-[var(--color-text-muted)] mb-4">
                    배정된 청중 평가가 없습니다.
                </p>
                <Button
                    variant="outline"
                    onClick={() => navigate("/eval")}
                    className="border-[var(--color-border)]"
                >
                    <ArrowLeft className="w-4 h-4 mr-1.5" />
                    돌아가기
                </Button>
            </div>
        );
    }

    const submittedAll = assignments.every((a) => a.submitted);

    if (showIntro) {
        return (
            <div className="min-h-screen bg-[var(--color-base)]">
                {/* Header */}
                <header className="sticky top-0 z-20 bg-[var(--color-base)]/90 backdrop-blur-xl border-b border-[var(--color-border-subtle)]">
                    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                            onClick={() => navigate("/eval")}
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </Button>
                        <div>
                            <h1 className="text-sm font-bold text-[var(--color-text-primary)]">청중 평가</h1>
                            <p className="text-[10px] text-[var(--color-text-muted)]">
                                {round?.title ?? `라운드 #${roundId}`}
                            </p>
                        </div>
                    </div>
                </header>

                <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-6">
                    {/* Title area */}
                    <div className="relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-gradient-to-br from-[var(--color-base)] to-[var(--color-hover)] p-6 sm:p-8">
                        <div className="absolute top-3 right-6 w-20 h-20 rounded-full bg-[var(--color-accent)]/5 blur-2xl" />
                        <span className="inline-block px-2.5 py-1 rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)] text-[11px] font-semibold tracking-wide mb-3">
                            UnivPT 33기
                        </span>
                        <h2 className="text-xl sm:text-2xl font-extrabold text-[var(--color-text-primary)] mb-1.5">
                            청중 평가
                        </h2>
                        <p className="text-sm text-[var(--color-text-muted)]">
                            {round?.title ?? `라운드 #${roundId}`}
                        </p>
                    </div>

                    {/* Intro card */}
                    <div className="rounded-xl border border-[var(--color-border)] bg-white p-6 sm:p-7">
                        <div className="text-sm text-[var(--color-text-secondary)] leading-[2.0] space-y-5 [word-break:keep-all]">
                            <p>
                                유니브피티 33기 운영진 여러분 안녕하세요.
                            </p>
                            <p>
                                본 평가는 유니브피티 교육과정 전후의 변화를 함께 확인하기 위한 <strong className="text-[var(--color-text-primary)]">성장 기록</strong>의 한 과정입니다.
                            </p>
                            <p>
                                운영진 여러분의 평가는 기수들의 자기평가와 함께 정리되어, 한 사람의 발표 여정을 보다 <strong className="text-[var(--color-text-primary)]">입체적으로 보여주는 소중한 기준</strong>이 됩니다.
                                평가는 개인 1 세션 발표와 최종 개인 발표를 기준으로 <strong className="text-[var(--color-text-primary)]">총 두 차례</strong> 진행됩니다.
                            </p>
                            <p>
                                운영진 평가는 우열을 가리기 위한 절대적 잣대가 아니라, 발표자가 인지하지 못했을 수 있는 <strong className="text-[var(--color-text-primary)]">강점과 보완점</strong>을 외부의 시각으로 비춰주는 역할을 합니다.
                                이를 통해 기수들의 현재 위치를 보다 선명하게 확인하고, 다음 단계로 나아갈 방향을 제시하게 됩니다.
                            </p>
                            <p className="font-medium text-[var(--color-text-primary)]">
                                따라서 개인적 호불호보다는 평가 문항의 기준에 따라 <span className="text-[var(--color-accent)]">일관되고 객관적인 시각</span>으로 판단해 주시기 바랍니다.
                            </p>
                        </div>
                    </div>

                    {/* Question intro section */}
                    <div className="rounded-xl border border-[var(--color-accent)]/15 bg-[var(--color-accent)]/[0.03] p-5 sm:p-6">
                        <div className="flex items-start gap-3">
                            <div className="shrink-0 mt-0.5 w-7 h-7 rounded-lg bg-[var(--color-accent)]/10 flex items-center justify-center">
                                <ClipboardList className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-sm font-bold text-[var(--color-text-primary)]">평가 문항 소개</h3>
                                <p className="text-sm text-[var(--color-text-secondary)] leading-[1.8] [word-break:keep-all]">
                                    본 평가는 프레젠테이션의 3요소인 <strong className="text-[var(--color-text-primary)]">기획, 디자인, 스피치</strong> 세 영역으로 구성되어 있습니다.
                                    각 문항을 읽고 현재 발표자의 발표 역량 수준에 가장 가깝다고 생각되는 점수를 선택해 주세요.
                                </p>
                                <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                                    (1점: 매우 그렇지 않다 / 2점: 그렇지 않다 / 3점: 보통이다 / 4점: 그렇다 / 5점: 매우 그렇다)
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Start button */}
                    <Button
                        onClick={() => setShowIntro(false)}
                        className="w-full py-3 text-sm font-semibold rounded-xl bg-[var(--color-accent)] hover:bg-[var(--color-accent)]/80 text-white shadow-lg shadow-[var(--color-accent)]/20"
                    >
                        <Sparkles className="w-4 h-4 mr-2" />
                        평가 시작하기
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[var(--color-base)]">
            {/* 완료 팝업 모달 */}
            <AnimatePresence>
                {showCompleteModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
                        onClick={() => setShowCompleteModal(false)}
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 20 }}
                            transition={{ duration: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
                            className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8 text-center"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="mx-auto mb-5 w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                            </div>
                            <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-3">
                                모든 평가가 완료되었습니다!
                            </h2>
                            <p className="text-sm text-[var(--color-text-secondary)] mb-2 [word-break:keep-all]">
                                평가에 참여해 주셔서 감사합니다.
                            </p>
                            <p className="text-sm text-[var(--color-text-muted)] mb-2 [word-break:keep-all]">
                                본 결과는 기수들에게 개인별 성장 리포트로 정리되어 제공될 예정입니다.
                            </p>
                            <p className="text-sm text-[var(--color-text-muted)] mb-2 [word-break:keep-all]">
                                여러분의 소중한 평가가 33기 기수들의 성장 기록에 의미 있는 기준으로 남게 됩니다.
                            </p>
                            <p className="text-sm text-[var(--color-text-secondary)] font-medium mb-6 [word-break:keep-all]">
                                33기 기수들의 성장에 함께해 주신 운영진 여러분께 진심으로 감사드립니다 🌼💗
                            </p>
                            <Button
                                onClick={() => setShowCompleteModal(false)}
                                className="w-full bg-[var(--color-accent)] hover:bg-[var(--color-accent)]/80 text-white py-3 rounded-xl font-semibold"
                            >
                                확인
                            </Button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Header */}
            <header className="sticky top-0 z-20 bg-[var(--color-base)]/90 backdrop-blur-xl border-b border-[var(--color-border-subtle)]">
                <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                            onClick={() => navigate("/eval")}
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </Button>
                        <div>
                            <h1 className="text-sm font-bold text-[var(--color-text-primary)]">청중 평가</h1>
                            <p className="text-[10px] text-[var(--color-text-muted)]">
                                {round?.title ?? `라운드 #${roundId}`}
                            </p>
                        </div>
                    </div>
                    <div className="text-xs text-[var(--color-text-muted)]">
                        {assignments.filter((a) => a.submitted).length}/{assignments.length} 제출완료
                    </div>
                </div>
            </header>

            <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
                <div className="flex flex-col lg:flex-row gap-6">
                    {/* Left: member list */}
                    <div className="lg:w-56 shrink-0">
                        <h2 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
                            평가 대상
                        </h2>
                        <div className="space-y-1">
                            {assignments.map((a) => (
                                <button
                                    key={a.id}
                                    onClick={() => handleSelectMember(a.presenter_member_id)}
                                    className={cn(
                                        "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors text-left",
                                        selectedMemberId === a.presenter_member_id
                                            ? "bg-[var(--color-accent)]/15 text-[var(--color-text-primary)] border border-[var(--color-accent)]/30"
                                            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] border border-transparent"
                                    )}
                                >
                                    {a.submitted ? (
                                        <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                                    ) : (
                                        <Circle className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />
                                    )}
                                    <span className="truncate flex-1">
                                        {a.presenter_name ?? `멤버 #${a.presenter_member_id}`}
                                    </span>
                                    {selectedMemberId === a.presenter_member_id && (
                                        <ChevronRight className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" />
                                    )}
                                </button>
                            ))}
                        </div>

                        {submittedAll && (
                            <div className="mt-4 p-5 rounded-xl bg-emerald-50 border border-emerald-200 text-center space-y-2">
                                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                                <p className="text-sm font-bold text-emerald-700">모든 평가가 완료되었습니다!</p>
                                <p className="text-xs text-emerald-600">평가에 참여해 주셔서 감사합니다.</p>
                                <p className="text-xs text-emerald-600">본 결과는 기수들에게 개인별 성장 리포트로 정리되어 제공될 예정입니다.</p>
                                <p className="text-xs text-emerald-600">여러분의 소중한 평가가 33기 기수들의 성장 기록에 의미 있는 기준으로 남게 됩니다.</p>
                                <p className="text-xs text-emerald-600">33기 기수들의 성장에 함께해 주신 운영진 여러분께 진심으로 감사드립니다 🌼💗</p>
                            </div>
                        )}
                    </div>

                    {/* Right: evaluation form */}
                    <div className="flex-1 min-w-0">
                        <AnimatePresence mode="wait">
                            {!selectedMemberId ? (
                                <motion.div
                                    key="empty"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="flex items-center justify-center py-20 text-[var(--color-text-muted)]"
                                >
                                    왼쪽에서 평가할 멤버를 선택하세요.
                                </motion.div>
                            ) : (
                                <motion.div
                                    key={selectedMemberId}
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    transition={{ duration: 0.2 }}
                                    className="space-y-6"
                                >
                                    {/* Member header */}
                                    <div className="flex items-center justify-between">
                                        <h2 className="text-lg font-bold text-[var(--color-text-primary)]">
                                            {selectedAssignment?.presenter_name ?? ""}
                                        </h2>
                                        {selectedAssignment?.submitted && (
                                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-green-500/15 text-green-600 border border-green-500/30">
                                                <CheckCircle2 className="w-3 h-3" />
                                                제출완료
                                            </span>
                                        )}
                                    </div>

                                    {/* Previous submission banner */}
                                    {selectedAssignment?.submitted && Object.keys(scores).length > 0 && (
                                        <div className="p-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5">
                                            <p className="text-xs text-emerald-600">
                                                이전 제출 내역이 표시되어 있습니다. 수정 후 재제출할 수 있습니다.
                                            </p>
                                        </div>
                                    )}

                                    {/* Progress */}
                                    <div className="space-y-1">
                                        <div className="flex justify-between text-xs text-[var(--color-text-muted)]">
                                            <span>응답 진행</span>
                                            <span>{answeredCount}/{totalQuestions}</span>
                                        </div>
                                        <div className="h-1.5 rounded-full bg-[var(--color-hover)] overflow-hidden">
                                            <motion.div
                                                className="h-full rounded-full bg-[var(--color-accent)]"
                                                animate={{
                                                    width: `${(answeredCount / totalQuestions) * 100}%`,
                                                }}
                                                transition={{ duration: 0.3 }}
                                            />
                                        </div>
                                    </div>

                                    {/* Questions grouped by domain */}
                                    {GROUPED_QUESTIONS.map((group) => (
                                        <div key={group.domain} className="space-y-4">
                                            {/* Domain header */}
                                            <div className="flex items-center gap-2">
                                                <div
                                                    className={cn(
                                                        "w-1 h-5 rounded-full",
                                                        group.domain === "PLANNING"
                                                            ? "bg-blue-500"
                                                            : group.domain === "DESIGN"
                                                            ? "bg-emerald-500"
                                                            : "bg-amber-500"
                                                    )}
                                                />
                                                <h3
                                                    className={cn(
                                                        "text-sm font-bold",
                                                        DOMAIN_COLORS[group.domain]
                                                    )}
                                                >
                                                    {DOMAIN_LABELS[group.domain]}
                                                </h3>
                                            </div>

                                            {/* Questions */}
                                            {group.questions.map((q) => (
                                                <div
                                                    key={q.key}
                                                    className="rounded-xl border border-[var(--color-border)] bg-white backdrop-blur-md p-4 space-y-3"
                                                >
                                                    <div className="flex items-start gap-2">
                                                        <span className="text-[10px] font-semibold text-[var(--color-text-muted)] bg-[var(--color-hover)] px-1.5 py-0.5 rounded shrink-0">
                                                            {q.label}
                                                        </span>
                                                        <p className="text-sm text-[var(--color-text-secondary)] leading-[1.8] [word-break:keep-all]">
                                                            {q.text}
                                                        </p>
                                                    </div>
                                                    <LikertScale
                                                        value={scores[q.key] ?? null}
                                                        onChange={(val) => handleScore(q.key, val)}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    ))}

                                    {/* Submit button */}
                                    <div className="sticky bottom-4 pt-4">
                                        <Button
                                            onClick={handleSubmit}
                                            disabled={!allAnswered || submitEval.isPending}
                                            className={cn(
                                                "w-full py-3 text-sm font-semibold rounded-xl transition-all",
                                                allAnswered
                                                    ? "bg-[var(--color-accent)] hover:bg-[var(--color-accent)]/80 text-white shadow-lg shadow-[var(--color-accent)]/20"
                                                    : "bg-[var(--color-hover)] text-[var(--color-text-muted)] cursor-not-allowed"
                                            )}
                                        >
                                            {submitEval.isPending ? (
                                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            ) : (
                                                <Send className="w-4 h-4 mr-2" />
                                            )}
                                            {selectedAssignment?.submitted
                                                ? "재제출하기"
                                                : "평가 제출하기"}
                                        </Button>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </div>
    );
}
