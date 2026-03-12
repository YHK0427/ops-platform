import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMemberOwnResult } from "@/hooks/useMemberEvaluation";
import { RadarChart } from "@/components/eval/RadarChart";
import { motion } from "framer-motion";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    ResponsiveContainer,
    Cell,
    LabelList,
} from "recharts";
import { ArrowLeft, Lock, BarChart3, TrendingUp, Users, Target } from "lucide-react";

// ── Constants ───────────────────────────────────────────────────────────

const DOMAINS = ["PLANNING", "DESIGN", "SPEECH"] as const;

const DOMAIN_LABELS: Record<string, string> = {
    PLANNING: "기획",
    DESIGN: "디자인",
    SPEECH: "스피치",
};

const DOMAIN_COLORS: Record<string, { text: string; bg: string; bar: string; border: string }> = {
    PLANNING: { text: "text-blue-600", bg: "bg-blue-50", bar: "#3b82f6", border: "border-blue-200" },
    DESIGN: { text: "text-emerald-600", bg: "bg-emerald-50", bar: "#10b981", border: "border-emerald-200" },
    SPEECH: { text: "text-amber-600", bg: "bg-amber-50", bar: "#f59e0b", border: "border-amber-200" },
};

// 단계 해석
interface StageInfo {
    label: string;
    range: string;
    color: string;
    bgColor: string;
    description: string;
}

const STAGES: Record<string, StageInfo> = {
    "구조 형성": {
        label: "구조 형성",
        range: "0 ~ 2.5",
        color: "text-orange-600",
        bgColor: "bg-orange-50",
        description: "현재는 발표의 기본 구조를 만드는 단계입니다. 한 영역에 집중해서 정비하면 전체 완성도가 빠르게 올라갈 수 있습니다.",
    },
    "안정화": {
        label: "안정화",
        range: "2.6 ~ 3.5",
        color: "text-yellow-600",
        bgColor: "bg-yellow-50",
        description: "발표의 기본 구조는 갖춰진 상태입니다. 이제는 전달의 선명도와 흐름을 다듬는 단계입니다.",
    },
    "정교화": {
        label: "정교화",
        range: "3.6 ~ 4.2",
        color: "text-sky-600",
        bgColor: "bg-sky-50",
        description: "발표가 충분히 안정된 수준입니다. 이제는 디테일과 정교함을 다듬는 단계입니다.",
    },
    "전달 최적화": {
        label: "전달 최적화",
        range: "4.3 ~ 5.0",
        color: "text-violet-600",
        bgColor: "bg-violet-50",
        description: "높은 완성도를 갖춘 발표입니다. 이제는 '잘하는 발표'가 아니라 '영향을 남기는 발표'를 설계하는 단계입니다.",
    },
};

// 유형 해석
const TYPE_DESCRIPTIONS: Record<string, { emoji: string; summary: string; detail: string; action: string }> = {
    "균형형": {
        emoji: "triangle-balanced",
        summary: "세 영역이 고르게 분포되어 있습니다",
        detail: "큰 약점 없이 안정적인 발표를 하는 유형입니다. 다만 '무난함'으로 남을 수 있으므로, 강점 하나를 의도적으로 더 키워 자신만의 대표 이미지를 만들어보세요.",
        action: "가장 반응이 좋았던 요소 1가지를 선정하여 다음 발표에서 의도적으로 강조해보세요.",
    },
    "강점 집중형": {
        emoji: "triangle-strong",
        summary: "특정 영역이 두드러지게 높습니다",
        detail: "해당 영역의 역량이 돋보이는 유형입니다. 강점을 유지하면서 나머지 영역도 함께 끌어올리면 전체 완성도가 크게 높아질 수 있습니다.",
        action: "강점 영역의 노하우를 다른 영역에도 적용해보세요. 예: 기획이 강하다면 디자인과 스피치도 같은 메시지 중심으로 정렬해보세요.",
    },
    "성장 가능성형": {
        emoji: "triangle-growth",
        summary: "특정 영역에서 성장 여지가 큽니다",
        detail: "약한 영역을 집중적으로 보완하면 전체 발표 완성도가 빠르게 향상될 수 있는 유형입니다. 약점을 인식하는 것 자체가 성장의 첫걸음입니다.",
        action: "약점 영역의 기본기부터 점검해보세요. 작은 개선이 전체 인상을 크게 바꿀 수 있습니다.",
    },
};

// 자기 vs 청중 비교 유형
function getPerceptionType(selfAvg: number, audienceAvg: number): { type: string; label: string; color: string; description: string } {
    const diff = selfAvg - audienceAvg;
    if (diff > 0.5) {
        return {
            type: "overestimate",
            label: "과대평가형",
            color: "text-rose-600",
            description: "의도는 분명했으나 전달이 기대만큼 닿지 않았을 수 있습니다. '내가 한 것'보다 '상대가 받은 것' 기준으로 점검해보세요.",
        };
    } else if (diff < -0.5) {
        return {
            type: "underestimate",
            label: "과소평가형",
            color: "text-blue-600",
            description: "본인은 부족하다고 느끼지만 외부 평가는 긍정적입니다. 현재 수준을 객관적으로 신뢰하고, 잘된 요소를 다음에도 재현해보세요.",
        };
    }
    return {
        type: "objective",
        label: "객관형",
        color: "text-emerald-600",
        description: "자기 인식과 외부 인식이 잘 맞는 상태입니다. 자신의 강점과 약점을 정확히 파악하고 있어 효율적인 성장이 가능합니다.",
    };
}

// 성장 Plan
const GROWTH_PLANS: Record<string, { low: string; mid: string; high: string }> = {
    PLANNING: {
        low: "발표 전 '이 발표의 한 문장 요약'을 먼저 작성해보세요. 핵심 메시지를 명확히 하는 것이 기획의 시작입니다.",
        mid: "슬라이드 한 장당 핵심 문장 1개로 축약하는 연습을 해보세요. 논리 흐름을 더 선명하게 만들 수 있습니다.",
        high: "청중의 기대를 뛰어넘는 '의외의 관점'을 한 가지 넣어보세요. 좋은 기획을 인상적인 기획으로 만들 수 있습니다.",
    },
    DESIGN: {
        low: "정보량을 줄이고 여백을 활용해보세요. '다 넣는 것'보다 '덜 보여주는 것'이 디자인의 핵심입니다.",
        mid: "각 슬라이드 상단에 '이 장의 메시지' 문장을 명시해보세요. 디자인이 기획을 돕는 도구가 될 수 있습니다.",
        high: "시각적 완성도를 기획과 스피치를 보조하는 방향으로 재정렬해보세요. '왜 이걸 보여주는가'를 의식해보세요.",
    },
    SPEECH: {
        low: "원고 완성보다 핵심 문장 암기 + 속도 조절에 집중해보세요. 슬라이드를 읽는 방식에서 벗어나는 것이 첫 단계입니다.",
        mid: "발표 구조를 3단으로 명확히 나누고 각 파트의 톤을 다르게 설정해보세요. 말의 리듬이 생깁니다.",
        high: "말의 힘을 구조와 시각 정보에 고정해보세요. 스피치의 임팩트를 기획·디자인과 연결하면 발표의 완성도가 높아집니다.",
    },
};

function getGrowthPlan(domain: string, score: number | null): string {
    if (score == null) return "데이터가 부족합니다.";
    const plans = GROWTH_PLANS[domain];
    if (!plans) return "";
    if (score <= 2.5) return plans.low;
    if (score <= 3.5) return plans.mid;
    return plans.high;
}

function getDomainStage(score: number | null): string {
    if (score == null) return "데이터 부족";
    if (score <= 2.5) return "구조 형성";
    if (score <= 3.5) return "안정화";
    if (score <= 4.2) return "정교화";
    return "전달 최적화";
}

// ── Helpers ──────────────────────────────────────────────────────────────

function avg(scores: Record<string, number | null>): number {
    const vals = Object.values(scores).filter((v): v is number => v != null);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

function getStrongestDomain(scores: Record<string, number | null>): string {
    let best = "";
    let bestScore = -1;
    for (const [domain, score] of Object.entries(scores)) {
        if (score != null && score > bestScore) {
            bestScore = score;
            best = domain;
        }
    }
    return DOMAIN_LABELS[best] ?? best;
}

function getWeakestDomain(scores: Record<string, number | null>): string {
    let worst = "";
    let worstScore = 6;
    for (const [domain, score] of Object.entries(scores)) {
        if (score != null && score < worstScore) {
            worstScore = score;
            worst = domain;
        }
    }
    return DOMAIN_LABELS[worst] ?? worst;
}

// ── Triangle SVG icons for type display ─────────────────────────────────

function TriangleIcon({ type, className }: { type: string; className?: string }) {
    const size = 48;
    const pad = 6;
    const cx = size / 2;

    if (type === "triangle-balanced") {
        // Equilateral triangle
        return (
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className}>
                <polygon
                    points={`${cx},${pad} ${size - pad},${size - pad} ${pad},${size - pad}`}
                    fill="rgba(16,185,129,0.15)"
                    stroke="#10b981"
                    strokeWidth="2"
                />
            </svg>
        );
    }
    if (type === "triangle-strong") {
        // Tall/narrow triangle (one vertex stretched)
        return (
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className}>
                <polygon
                    points={`${cx},${pad - 2} ${size - pad + 4},${size - pad} ${pad - 4},${size - pad}`}
                    fill="rgba(59,130,246,0.15)"
                    stroke="#3b82f6"
                    strokeWidth="2"
                />
            </svg>
        );
    }
    // triangle-growth: flat/wide triangle
    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className}>
            <polygon
                points={`${cx},${pad + 10} ${size - pad},${size - pad} ${pad},${size - pad}`}
                fill="rgba(245,158,11,0.15)"
                stroke="#f59e0b"
                strokeWidth="2"
            />
        </svg>
    );
}

// ── Section wrapper ─────────────────────────────────────────────────────

function Section({ title, icon, children, delay = 0 }: {
    title: string;
    icon: React.ReactNode;
    children: React.ReactNode;
    delay?: number;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay, duration: 0.4, ease: "easeOut" }}
            className="rounded-xl bg-white border border-gray-200 p-4 sm:p-5 shadow-sm"
        >
            <div className="flex items-center gap-2 mb-4">
                {icon}
                <h3 className="text-sm font-bold text-gray-900">{title}</h3>
            </div>
            {children}
        </motion.div>
    );
}

// ══════════════════════════════════════════════════════════════════════════
// Main Component
// ══════════════════════════════════════════════════════════════════════════

export default function MemberResult() {
    const { roundId } = useParams<{ roundId: string }>();
    const navigate = useNavigate();
    const { data, isLoading, isError, error } = useMemberOwnResult(roundId!);

    const isForbidden =
        isError && (error as { response?: { status?: number } })?.response?.status === 403;

    const selfScores = useMemo(() => {
        if (!data?.self_scores_by_domain) return { PLANNING: 0, DESIGN: 0, SPEECH: 0 };
        return {
            PLANNING: data.self_scores_by_domain.PLANNING ?? 0,
            DESIGN: data.self_scores_by_domain.DESIGN ?? 0,
            SPEECH: data.self_scores_by_domain.SPEECH ?? 0,
        };
    }, [data?.self_scores_by_domain]);

    const audienceScores = useMemo(() => {
        if (!data?.audience_scores_by_domain) return { PLANNING: 0, DESIGN: 0, SPEECH: 0 };
        return {
            PLANNING: data.audience_scores_by_domain.PLANNING ?? 0,
            DESIGN: data.audience_scores_by_domain.DESIGN ?? 0,
            SPEECH: data.audience_scores_by_domain.SPEECH ?? 0,
        };
    }, [data?.audience_scores_by_domain]);

    const perceptionType = useMemo(() => {
        if (!data) return null;
        const selfAvg = avg(data.self_scores_by_domain);
        const audAvg = avg(data.audience_scores_by_domain);
        return getPerceptionType(selfAvg, audAvg);
    }, [data]);

    const barChartData = useMemo(() => {
        if (!data) return [];
        return DOMAINS.map((d) => ({
            domain: DOMAIN_LABELS[d],
            자기: data.self_scores_by_domain[d] ?? 0,
            청중: data.audience_scores_by_domain[d] ?? 0,
            종합: data.combined_scores_by_domain[d] ?? 0,
        }));
    }, [data]);

    // ── Loading ─────────────────────────────────────────────────────────
    if (isLoading) {
        return (
            <div className="member-page flex items-center justify-center">
                <span className="inline-block w-6 h-6 border-2 border-gray-300 border-t-rose-500 rounded-full animate-spin" />
            </div>
        );
    }

    // ── Forbidden / No Data ─────────────────────────────────────────────
    if (isForbidden || !data) {
        return (
            <div className="member-page">
                <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-gray-200">
                    <div className="mx-auto max-w-lg flex items-center gap-3 px-4 py-3">
                        <button
                            onClick={() => navigate("/member")}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                        <h1 className="text-base font-bold text-gray-900">평가 결과</h1>
                    </div>
                </header>
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                    className="flex-1 flex items-center justify-center p-4 min-h-[60vh]"
                >
                    <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center max-w-sm w-full shadow-sm">
                        <Lock className="w-10 h-10 text-gray-300 mx-auto mb-4" />
                        <p className="text-sm font-medium text-gray-700">
                            아직 결과가 공개되지 않았습니다
                        </p>
                        <p className="text-xs text-gray-400 mt-2">
                            운영진이 결과를 공개하면 확인하실 수 있습니다
                        </p>
                    </div>
                </motion.div>
            </div>
        );
    }

    const typeInfo = TYPE_DESCRIPTIONS[data.type ?? ""] ?? TYPE_DESCRIPTIONS["균형형"];

    // ── Main Result ─────────────────────────────────────────────────────
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
                        <h1 className="text-base font-bold text-gray-900 truncate">
                            발표 성장 리포트
                        </h1>
                    </div>
                </div>
            </header>

            {/* Content */}
            <motion.main
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="mx-auto w-full max-w-2xl px-4 py-6 space-y-5"
            >
                {/* ─── Title Card ─── */}
                <div className="rounded-xl bg-gradient-to-r from-rose-500 to-rose-600 p-5 text-white shadow-lg shadow-rose-500/20">
                    <div className="flex items-start justify-between">
                        <div>
                            <p className="text-[11px] font-medium text-rose-200 uppercase tracking-wider">
                                University Presentation
                            </p>
                            <h2 className="text-lg font-extrabold mt-1">
                                32기 기수 성장 리포트
                            </h2>
                            <p className="text-sm text-rose-100 mt-1">
                                {data.member_name} 님의 발표 역량 분석입니다.
                            </p>
                        </div>
                        <span className="px-3 py-1 rounded-lg bg-white/20 text-xs font-bold shrink-0">
                            초기 분석지
                        </span>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                        {data.stage && (
                            <span className="px-2.5 py-0.5 rounded-full bg-white/20 text-xs font-semibold">
                                {data.stage}
                            </span>
                        )}
                        {data.type && (
                            <span className="px-2.5 py-0.5 rounded-full bg-white/20 text-xs font-semibold">
                                {data.type}
                            </span>
                        )}
                    </div>
                </div>

                {/* ─── 0. 방사형 그래프 ─── */}
                <Section
                    title="발표 성장 방사형 그래프"
                    icon={<BarChart3 className="w-4 h-4 text-rose-500" />}
                    delay={0.05}
                >
                    <RadarChart
                        selfScores={selfScores}
                        audienceScores={audienceScores}
                        variant="light"
                    />
                    <div className="flex items-center justify-center gap-6 mt-3">
                        <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full bg-blue-400" />
                            <span className="text-xs text-gray-500">자기 평가</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full bg-pink-400" />
                            <span className="text-xs text-gray-500">청중 평가</span>
                        </div>
                    </div>

                    {/* Score table */}
                    <div className="mt-4 rounded-lg border border-gray-100 overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-gray-50">
                                    <th className="text-left text-xs font-semibold text-gray-500 px-3 py-2">영역</th>
                                    <th className="text-center text-xs font-semibold text-blue-500 px-2 py-2">자기</th>
                                    <th className="text-center text-xs font-semibold text-pink-500 px-2 py-2">청중</th>
                                    <th className="text-center text-xs font-semibold text-gray-700 px-2 py-2">종합</th>
                                </tr>
                            </thead>
                            <tbody>
                                {DOMAINS.map((domain) => (
                                    <tr key={domain} className="border-t border-gray-100">
                                        <td className="text-gray-900 font-semibold px-3 py-2.5">{DOMAIN_LABELS[domain]}</td>
                                        <td className="text-center text-blue-600 font-medium tabular-nums px-2 py-2.5">
                                            {data.self_scores_by_domain[domain] != null ? Number(data.self_scores_by_domain[domain]).toFixed(1) : "-"}
                                        </td>
                                        <td className="text-center text-pink-600 font-medium tabular-nums px-2 py-2.5">
                                            {data.audience_scores_by_domain[domain] != null ? Number(data.audience_scores_by_domain[domain]).toFixed(1) : "-"}
                                        </td>
                                        <td className="text-center text-gray-900 font-bold tabular-nums px-2 py-2.5">
                                            {data.combined_scores_by_domain[domain] != null ? Number(data.combined_scores_by_domain[domain]).toFixed(1) : "-"}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Section>

                {/* ─── 1. 나의 발표 유형 ─── */}
                <Section
                    title="나의 발표 유형"
                    icon={<Target className="w-4 h-4 text-rose-500" />}
                    delay={0.1}
                >
                    {/* Type icons row */}
                    <div className="flex items-center justify-center gap-4 sm:gap-8 mb-4">
                        {(["균형형", "강점 집중형", "성장 가능성형"] as const).map((t) => {
                            const isActive = data.type === t;
                            const emoji =
                                t === "균형형" ? "triangle-balanced"
                                : t === "강점 집중형" ? "triangle-strong"
                                : "triangle-growth";
                            return (
                                <div
                                    key={t}
                                    className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg transition-all ${
                                        isActive ? "bg-gray-50 ring-2 ring-rose-200" : "opacity-40"
                                    }`}
                                >
                                    <TriangleIcon type={emoji} />
                                    <span className={`text-[11px] font-semibold ${isActive ? "text-gray-900" : "text-gray-400"}`}>
                                        {t}
                                    </span>
                                </div>
                            );
                        })}
                    </div>

                    {/* Active type details */}
                    <div className="rounded-lg bg-gray-50 p-4">
                        <p className="text-sm font-bold text-gray-900 mb-1">
                            {data.type ?? "분석 중"}
                            {data.type === "강점 집중형" && (
                                <span className="text-rose-500 ml-1">
                                    — {getStrongestDomain(data.combined_scores_by_domain)} 강점
                                </span>
                            )}
                            {data.type === "성장 가능성형" && (
                                <span className="text-amber-500 ml-1">
                                    — {getWeakestDomain(data.combined_scores_by_domain)} 보완 필요
                                </span>
                            )}
                        </p>
                        <p className="text-xs text-gray-600 leading-relaxed mb-2">
                            {typeInfo.detail}
                        </p>
                        <div className="flex items-start gap-2 mt-2 p-2.5 rounded-md bg-white border border-gray-200">
                            <TrendingUp className="w-3.5 h-3.5 text-rose-400 mt-0.5 shrink-0" />
                            <p className="text-xs text-gray-600 leading-relaxed">
                                {typeInfo.action}
                            </p>
                        </div>
                    </div>
                </Section>

                {/* ─── 2. 영역별 단계 해석 ─── */}
                <Section
                    title="영역별 단계 해석"
                    icon={<BarChart3 className="w-4 h-4 text-rose-500" />}
                    delay={0.15}
                >
                    <div className="space-y-3">
                        {DOMAINS.map((domain) => {
                            const score = data.combined_scores_by_domain[domain];
                            const stageName = getDomainStage(score);
                            const stageInfo = STAGES[stageName];
                            const pct = score != null ? (score / 5) * 100 : 0;
                            const colors = DOMAIN_COLORS[domain];

                            return (
                                <div key={domain} className={`rounded-lg border ${colors.border} p-3`}>
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <span className={`text-sm font-bold ${colors.text}`}>
                                                {DOMAIN_LABELS[domain]}
                                            </span>
                                            {stageInfo && (
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${stageInfo.bgColor} ${stageInfo.color}`}>
                                                    {stageInfo.label}
                                                </span>
                                            )}
                                        </div>
                                        <span className="text-sm font-bold text-gray-700 tabular-nums">
                                            {score != null ? score.toFixed(1) : "-"}
                                        </span>
                                    </div>
                                    {/* Progress bar */}
                                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-2">
                                        <motion.div
                                            className="h-full rounded-full"
                                            style={{ backgroundColor: colors.bar }}
                                            initial={{ width: 0 }}
                                            animate={{ width: `${pct}%` }}
                                            transition={{ delay: 0.3, duration: 0.6, ease: "easeOut" }}
                                        />
                                    </div>
                                    {stageInfo && (
                                        <p className="text-[11px] text-gray-500 leading-relaxed">
                                            {stageInfo.description}
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Stage legend */}
                    <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {Object.values(STAGES).map((s) => (
                            <div key={s.label} className={`px-2 py-1.5 rounded-md ${s.bgColor} text-center`}>
                                <p className={`text-[10px] font-bold ${s.color}`}>{s.label}</p>
                                <p className="text-[9px] text-gray-400">{s.range}</p>
                            </div>
                        ))}
                    </div>
                </Section>

                {/* ─── 3. 나 VS 청중 비교 ─── */}
                <Section
                    title="나 VS 청중 비교"
                    icon={<Users className="w-4 h-4 text-rose-500" />}
                    delay={0.2}
                >
                    {/* Bar Chart */}
                    <div className="h-48 sm:h-56 mb-4">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={barChartData} barCategoryGap="25%">
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                                <XAxis
                                    dataKey="domain"
                                    tick={{ fill: "#374151", fontSize: 12, fontWeight: 600 }}
                                    axisLine={{ stroke: "rgba(0,0,0,0.1)" }}
                                    tickLine={false}
                                />
                                <YAxis
                                    domain={[0, 5]}
                                    tickCount={6}
                                    tick={{ fill: "rgba(0,0,0,0.3)", fontSize: 10 }}
                                    axisLine={false}
                                    tickLine={false}
                                    width={25}
                                />
                                <Bar dataKey="자기" radius={[3, 3, 0, 0]} maxBarSize={28}>
                                    {barChartData.map((_, i) => (
                                        <Cell key={i} fill="#60a5fa" />
                                    ))}
                                    <LabelList dataKey="자기" position="top" fontSize={10} fill="#60a5fa" formatter={(v: unknown) => Number(v).toFixed(1)} />
                                </Bar>
                                <Bar dataKey="청중" radius={[3, 3, 0, 0]} maxBarSize={28}>
                                    {barChartData.map((_, i) => (
                                        <Cell key={i} fill="#f472b6" />
                                    ))}
                                    <LabelList dataKey="청중" position="top" fontSize={10} fill="#f472b6" formatter={(v: unknown) => Number(v).toFixed(1)} />
                                </Bar>
                                <Bar dataKey="종합" radius={[3, 3, 0, 0]} maxBarSize={28}>
                                    {barChartData.map((_, i) => (
                                        <Cell key={i} fill="#6b7280" />
                                    ))}
                                    <LabelList dataKey="종합" position="top" fontSize={10} fill="#6b7280" formatter={(v: unknown) => Number(v).toFixed(1)} />
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    {/* Legend */}
                    <div className="flex items-center justify-center gap-5 mb-4">
                        <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-sm bg-blue-400" />
                            <span className="text-xs text-gray-500">자기</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-sm bg-pink-400" />
                            <span className="text-xs text-gray-500">청중</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-sm bg-gray-400" />
                            <span className="text-xs text-gray-500">종합</span>
                        </div>
                    </div>

                    {/* Perception type */}
                    {perceptionType && (
                        <div className="rounded-lg bg-gray-50 p-4">
                            <div className="flex items-center gap-2 mb-2">
                                {/* Type selector */}
                                {["과소평가형", "객관형", "과대평가형"].map((t) => {
                                    const isActive = perceptionType.label === t;
                                    return (
                                        <span
                                            key={t}
                                            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${
                                                isActive
                                                    ? "bg-white shadow-sm border border-gray-200 text-gray-900"
                                                    : "text-gray-300"
                                            }`}
                                        >
                                            {t}
                                        </span>
                                    );
                                })}
                            </div>
                            <p className={`text-sm font-bold mb-1 ${perceptionType.color}`}>
                                {perceptionType.label}
                            </p>
                            <p className="text-xs text-gray-600 leading-relaxed">
                                {perceptionType.description}
                            </p>
                        </div>
                    )}
                </Section>

                {/* ─── 4. 성장 PLAN ─── */}
                <Section
                    title="성장 PLAN"
                    icon={<TrendingUp className="w-4 h-4 text-rose-500" />}
                    delay={0.25}
                >
                    <div className="space-y-3">
                        {DOMAINS.map((domain) => {
                            const score = data.combined_scores_by_domain[domain];
                            const plan = getGrowthPlan(domain, score);

                            return (
                                <div key={domain} className="flex items-start gap-3">
                                    <span className={`shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-bold text-white ${
                                        domain === "PLANNING" ? "bg-blue-500"
                                        : domain === "DESIGN" ? "bg-emerald-500"
                                        : "bg-amber-500"
                                    }`}>
                                        {DOMAIN_LABELS[domain]}
                                    </span>
                                    <p className="text-xs text-gray-600 leading-relaxed pt-0.5">
                                        {plan}
                                    </p>
                                </div>
                            );
                        })}
                    </div>
                </Section>

                {/* ─── Footer ─── */}
                <p className="text-center text-[11px] text-gray-300 py-4">
                    Bloom UP, 당신의 가능성을 꽃피우기 위해
                </p>
            </motion.main>
        </div>
    );
}
