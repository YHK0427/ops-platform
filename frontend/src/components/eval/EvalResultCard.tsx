import { Fragment, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Target, TrendingUp, Users } from "lucide-react";
import RadarChart from "@/components/eval/RadarChart";
import { cn } from "@/lib/utils";
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

// ── Types ────────────────────────────────────────────────────────────────

interface DomainScores {
    PLANNING: number;
    DESIGN: number;
    SPEECH: number;
}

interface DetailData {
    self_scores_by_domain: Record<string, number | null>;
    audience_scores_by_domain: Record<string, number | null>;
    combined_scores_by_domain: Record<string, number | null>;
    stage: string | null;
    type: string | null;
}

interface EvalResultCardProps {
    memberName: string;
    selfScores: DomainScores;
    audienceScores: DomainScores;
    combinedScores: DomainScores;
    stage: string;
    type: string;
    detail?: DetailData | null;
    expanded?: boolean;
    onToggle?: () => void;
}

// ── Constants ────────────────────────────────────────────────────────────

const DOMAINS = ["PLANNING", "DESIGN", "SPEECH"] as const;

const DOMAIN_LABELS: Record<string, string> = {
    PLANNING: "기획",
    DESIGN: "디자인",
    SPEECH: "스피치",
};

const DOMAIN_COLORS: Record<string, { bar: string; text: string; border: string }> = {
    PLANNING: { bar: "#3b82f6", text: "text-blue-600", border: "border-blue-500/30" },
    DESIGN: { bar: "#10b981", text: "text-emerald-600", border: "border-emerald-500/30" },
    SPEECH: { bar: "#f59e0b", text: "text-amber-600", border: "border-amber-500/30" },
};

const DOMAIN_BG_COLORS: Record<string, string> = {
    PLANNING: "bg-blue-500",
    DESIGN: "bg-emerald-500",
    SPEECH: "bg-amber-500",
};

const STAGE_COLORS: Record<string, string> = {
    "구조 형성": "bg-orange-500/15 text-orange-600 border-orange-500/30",
    "안정화": "bg-yellow-500/15 text-yellow-600 border-yellow-500/30",
    "정교화": "bg-sky-500/15 text-sky-600 border-sky-500/30",
    "전달 최적화": "bg-violet-500/15 text-violet-600 border-violet-500/30",
};

const STAGE_INFO: Record<string, { range: string; description: string }> = {
    "구조 형성": {
        range: "1.0 ~ 1.5",
        description: "현재는 발표의 기본 구조를 만드는 단계입니다. 한 영역에 집중해서 정비하면 전체 완성도가 빠르게 올라갈 수 있습니다.",
    },
    "안정화": {
        range: "1.6 ~ 3.0",
        description: "발표의 기본 구조는 갖춰진 상태입니다. 이제는 전달의 선명도와 흐름을 다듬는 단계입니다.",
    },
    "정교화": {
        range: "3.1 ~ 4.5",
        description: "발표가 충분히 안정된 수준입니다. 이제는 디테일과 정교함을 다듬는 단계입니다.",
    },
    "전달 최적화": {
        range: "4.6 ~ 5.0",
        description: "높은 완성도를 갖춘 발표입니다. 이제는 '잘하는 발표'가 아니라 '영향을 남기는 발표'를 설계하는 단계입니다.",
    },
};

const TYPE_DESCRIPTIONS: Record<string, { detail: string; action: string }> = {
    "균형형": {
        detail: "세 영역의 점수가 고르게 분포되어 정삼각형에 가까운 형태를 띠고 있습니다. 어떤 주제든 기복 없이 안정적인 발표를 할 수 있음을 의미합니다.",
        action: "삼각형의 크기가 큰 경우 자신 있는 부분을 필살기로 키우고, 작다면 세 영역을 동시에 한 단계씩 끌어올려 보세요.",
    },
    "강점 집중형": {
        detail: "세 영역 중 한 개의 꼭짓점이 다른 영역에 비해 뻗어 나간 비대칭적인 형태입니다. 특정 영역에서 두드러지는 잠재력이 나타나고 있습니다.",
        action: "강점 영역을 더 발전시키면서 점수가 가장 낮은 영역의 기초 역량을 함께 보완해보세요.",
    },
    "보완점 명확형": {
        detail: "세 영역 중 특정 영역의 점수가 상대적으로 낮은 형태입니다. 집중적으로 보완해야 할 성장 방향이 명확하게 드러나 있는 긍정적인 신호입니다.",
        action: "균형을 깨고 있는 영역을 중심으로 보완하면 발표의 완성도가 빠르게 높아질 수 있습니다.",
    },
};

const GROWTH_PLANS: Record<string, { low: string; mid: string; high: string }> = {
    PLANNING: {
        low: "발표 전 '이 발표의 한 문장 요약'을 먼저 작성하기. 핵심 메시지를 명확히 하는 것이 기획의 시작.",
        mid: "슬라이드 한 장당 핵심 문장 1개로 축약하는 연습. 논리 흐름을 더 선명하게 만들 수 있음.",
        high: "청중의 기대를 뛰어넘는 '의외의 관점'을 한 가지 넣어볼 것.",
    },
    DESIGN: {
        low: "정보량을 줄이고 여백을 활용. '다 넣는 것'보다 '덜 보여주는 것'이 핵심.",
        mid: "각 슬라이드 상단에 '이 장의 메시지' 문장 명시. 디자인이 기획을 돕는 도구가 됨.",
        high: "시각적 완성도를 기획과 스피치를 보조하는 방향으로 재정렬. '왜 이걸 보여주는가' 의식.",
    },
    SPEECH: {
        low: "핵심 문장 암기 + 속도 조절에 집중. 슬라이드를 읽는 방식에서 벗어나는 것이 첫 단계.",
        mid: "발표 구조를 3단으로 나누고 각 파트의 톤을 다르게 설정. 말의 리듬이 생김.",
        high: "말의 힘을 구조와 시각 정보에 고정. 스피치의 임팩트를 기획·디자인과 연결.",
    },
};

// ── Helpers ──────────────────────────────────────────────────────────────

function getDomainStage(score: number | null): string {
    if (score == null) return "데이터 부족";
    if (score <= 1.5) return "구조 형성";
    if (score <= 3.0) return "안정화";
    if (score <= 4.5) return "정교화";
    return "전달 최적화";
}

function getGrowthPlan(domain: string, score: number | null): string {
    if (score == null) return "데이터 부족";
    const plans = GROWTH_PLANS[domain];
    if (!plans) return "";
    if (score <= 1.5) return plans.low;
    if (score <= 3.0) return plans.mid;
    return plans.high;
}

function getPerceptionType(selfAvg: number, audienceAvg: number) {
    const diff = selfAvg - audienceAvg;
    if (diff > 0.5) return { label: "[B유형] 자기>청중", color: "text-rose-500", description: "의도는 분명했으나 전달이 기대만큼 닿지 않았을 수 있음. '내가 한 것'보다 '상대가 받은 것' 기준으로 점검 필요." };
    if (diff < -0.5) return { label: "[A유형] 자기<청중", color: "text-blue-600", description: "본인은 부족하다고 느끼지만 외부 평가는 긍정적. 현재 수준을 객관적으로 신뢰하고, 잘된 요소를 다음에도 재현할 것." };
    return { label: "[C유형] 자기=청중", color: "text-emerald-600", description: "자기 인식과 외부 인식이 잘 맞는 상태. 강점과 약점을 정확히 파악하고 있어 효율적인 성장이 가능." };
}

function avgScores(scores: Record<string, number | null>): number {
    const vals = Object.values(scores).filter((v): v is number => v != null);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

function getStrongestDomain(scores: Record<string, number | null>): string {
    let best = ""; let bestScore = -1;
    for (const [d, s] of Object.entries(scores)) { if (s != null && s > bestScore) { bestScore = s; best = d; } }
    return DOMAIN_LABELS[best] ?? best;
}

function getWeakestDomain(scores: Record<string, number | null>): string {
    let worst = ""; let worstScore = 6;
    for (const [d, s] of Object.entries(scores)) { if (s != null && s < worstScore) { worstScore = s; worst = d; } }
    return DOMAIN_LABELS[worst] ?? worst;
}

// ── Component ────────────────────────────────────────────────────────────

export default function EvalResultCard({
    memberName,
    selfScores,
    audienceScores,
    combinedScores,
    stage,
    type,
    detail,
    expanded = false,
    onToggle,
}: EvalResultCardProps) {
    const barChartData = useMemo(() => {
        if (!detail) return [];
        return DOMAINS.map((d) => ({
            domain: DOMAIN_LABELS[d],
            자기: detail.self_scores_by_domain[d] ?? 0,
            청중: detail.audience_scores_by_domain[d] ?? 0,
            종합: detail.combined_scores_by_domain[d] ?? 0,
        }));
    }, [detail]);

    const perceptionType = useMemo(() => {
        if (!detail) return null;
        return getPerceptionType(
            avgScores(detail.self_scores_by_domain),
            avgScores(detail.audience_scores_by_domain),
        );
    }, [detail]);

    const typeInfo = TYPE_DESCRIPTIONS[type] ?? TYPE_DESCRIPTIONS["균형형"];

    return (
        <div className="rounded-xl border border-[var(--color-border)] bg-white backdrop-blur-md overflow-hidden">
            {/* ── Collapsed header ── */}
            <button
                onClick={onToggle}
                className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-[var(--color-hover)] transition-colors text-left"
            >
                <span
                    className="font-semibold text-base w-28 shrink-0 truncate"
                    style={{ color: "#1A1A2E" }}
                >
                    {memberName}
                </span>

                <div className="flex-1 flex items-center gap-3 min-w-0">
                    {DOMAINS.map((domain) => {
                        const score = combinedScores[domain] ?? 0;
                        const pct = (score / 5) * 100;
                        return (
                            <div key={domain} className="flex items-center gap-2 flex-1 min-w-0">
                                <span className="text-xs text-[var(--color-text-muted)] w-12 shrink-0">
                                    {DOMAIN_LABELS[domain]}
                                </span>
                                <div className="flex-1 h-2.5 rounded-full bg-[var(--color-hover)] overflow-hidden">
                                    <motion.div
                                        className={cn("h-full rounded-full", DOMAIN_BG_COLORS[domain])}
                                        initial={{ width: 0 }}
                                        animate={{ width: `${pct}%` }}
                                        transition={{ duration: 0.6, ease: "easeOut" }}
                                    />
                                </div>
                                <span className="text-sm text-[var(--color-text-secondary)] w-9 text-right tabular-nums">
                                    {score > 0 ? score.toFixed(1) : "-"}
                                </span>
                            </div>
                        );
                    })}
                </div>

                <span
                    className={cn(
                        "inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold border shrink-0",
                        STAGE_COLORS[stage] ?? "bg-gray-50 text-[var(--color-text-muted)] border-[var(--color-border)]"
                    )}
                >
                    {stage || "-"}
                </span>

                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-gray-50 border border-[var(--color-border)] text-[var(--color-text-secondary)] shrink-0">
                    {type || "-"}
                </span>

                <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                    <ChevronDown className="w-5 h-5 text-[var(--color-text-muted)]" />
                </motion.div>
            </button>

            {/* ── Expanded detail ── */}
            <AnimatePresence>
                {expanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: "easeInOut" }}
                        className="overflow-hidden"
                    >
                        <div className="px-5 pb-6 pt-4 border-t border-[var(--color-border-subtle)] space-y-6">
                            {/* ── Row 1: Radar + Scores ── */}
                            <div className="flex flex-col md:flex-row gap-5">
                                <div className="flex justify-center shrink-0 w-[260px]">
                                    <RadarChart
                                        selfScores={selfScores}
                                        audienceScores={audienceScores}
                                        size={260}
                                    />
                                </div>

                                <div className="flex-1 space-y-3">
                                    <h4 className="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                                        영역별 점수 비교
                                    </h4>
                                    <div className="grid grid-cols-4 gap-2 text-sm">
                                        <div className="text-[var(--color-text-muted)]">영역</div>
                                        <div className="text-center text-blue-600">자기평가</div>
                                        <div className="text-center text-pink-600">청중평가</div>
                                        <div className="text-center text-[var(--color-text-secondary)] font-semibold">종합</div>
                                        {DOMAINS.map((d) => (
                                            <Fragment key={d}>
                                                <div className="text-[var(--color-text-secondary)] py-1.5">
                                                    {DOMAIN_LABELS[d]}
                                                </div>
                                                <div className="text-center py-1.5 tabular-nums">
                                                    {selfScores[d]?.toFixed(1) ?? "-"}
                                                </div>
                                                <div className="text-center py-1.5 tabular-nums">
                                                    {audienceScores[d]?.toFixed(1) ?? "-"}
                                                </div>
                                                <div className="text-center py-1.5 font-semibold tabular-nums">
                                                    {combinedScores[d]?.toFixed(1) ?? "-"}
                                                </div>
                                            </Fragment>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {detail && (
                                <>
                                    {/* ── 나의 발표 유형 ── */}
                                    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-gray-50 p-5">
                                        <div className="flex items-center gap-2 mb-3">
                                            <Target className="w-4 h-4 text-[var(--color-accent)]" />
                                            <h4 className="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                                                발표 유형 해석
                                            </h4>
                                        </div>
                                        <div className="flex items-start gap-3">
                                            <span className={cn(
                                                "shrink-0 px-3 py-1.5 rounded-md text-sm font-bold border",
                                                STAGE_COLORS[stage] ?? "bg-gray-50 text-[var(--color-text-muted)] border-[var(--color-border)]"
                                            )}>
                                                {type || "미정"}
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                                                    {type === "강점 집중형" && (
                                                        <span className="text-blue-600 font-medium">
                                                            {getStrongestDomain(detail.combined_scores_by_domain)} 강점 —{" "}
                                                        </span>
                                                    )}
                                                    {type === "보완점 명확형" && (
                                                        <span className="text-amber-600 font-medium">
                                                            {getWeakestDomain(detail.combined_scores_by_domain)} 보완 —{" "}
                                                        </span>
                                                    )}
                                                    {typeInfo.detail}
                                                </p>
                                                <div className="flex items-start gap-2 mt-2.5 p-2.5 rounded-md bg-gray-50 border border-[var(--color-border)]">
                                                    <TrendingUp className="w-4 h-4 text-[var(--color-accent)] mt-0.5 shrink-0" />
                                                    <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                                                        {typeInfo.action}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* ── 영역별 단계 해석 ── */}
                                    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-gray-50 p-5">
                                        <h4 className="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-4">
                                            영역별 단계 해석
                                        </h4>
                                        <div className="space-y-3">
                                            {DOMAINS.map((domain) => {
                                                const score = detail.combined_scores_by_domain[domain];
                                                const stageName = getDomainStage(score);
                                                const info = STAGE_INFO[stageName];
                                                const pct = score != null ? (score / 5) * 100 : 0;
                                                const colors = DOMAIN_COLORS[domain];

                                                return (
                                                    <div key={domain} className={`rounded-md border ${colors.border} p-3.5`}>
                                                        <div className="flex items-center justify-between mb-2">
                                                            <div className="flex items-center gap-2">
                                                                <span className={`text-sm font-bold ${colors.text}`}>
                                                                    {DOMAIN_LABELS[domain]}
                                                                </span>
                                                                <span className={cn(
                                                                    "px-2 py-0.5 rounded text-xs font-semibold border",
                                                                    STAGE_COLORS[stageName] ?? "bg-gray-50 text-[var(--color-text-muted)] border-[var(--color-border)]"
                                                                )}>
                                                                    {stageName}
                                                                </span>
                                                            </div>
                                                            <span className="text-sm font-bold text-[var(--color-text-secondary)] tabular-nums">
                                                                {score != null ? score.toFixed(1) : "-"}
                                                            </span>
                                                        </div>
                                                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-2.5">
                                                            <motion.div
                                                                className="h-full rounded-full"
                                                                style={{ backgroundColor: colors.bar }}
                                                                initial={{ width: 0 }}
                                                                animate={{ width: `${pct}%` }}
                                                                transition={{ delay: 0.2, duration: 0.6, ease: "easeOut" }}
                                                            />
                                                        </div>
                                                        {info && (
                                                            <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                                                                {info.description}
                                                            </p>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        {/* Stage legend */}
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            {Object.entries(STAGE_COLORS).map(([name, cls]) => (
                                                <span key={name} className={cn("px-2 py-0.5 rounded text-[11px] font-semibold border", cls)}>
                                                    {name} ({STAGE_INFO[name]?.range})
                                                </span>
                                            ))}
                                        </div>
                                    </div>

                                    {/* ── 나 VS 청중 비교 ── */}
                                    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-gray-50 p-5">
                                        <div className="flex items-center gap-2 mb-4">
                                            <Users className="w-4 h-4 text-[var(--color-accent)]" />
                                            <h4 className="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                                                자기 vs 청중 인식 비교
                                            </h4>
                                        </div>

                                        {/* Bar chart */}
                                        <div className="h-52 mb-4">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={barChartData} barCategoryGap="25%">
                                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                                                    <XAxis
                                                        dataKey="domain"
                                                        tick={{ fill: "rgba(0,0,0,0.6)", fontSize: 13, fontWeight: 600 }}
                                                        axisLine={{ stroke: "rgba(0,0,0,0.1)" }}
                                                        tickLine={false}
                                                    />
                                                    <YAxis
                                                        domain={[0, 5]}
                                                        tickCount={6}
                                                        tick={{ fill: "rgba(0,0,0,0.35)", fontSize: 12 }}
                                                        axisLine={false}
                                                        tickLine={false}
                                                        width={24}
                                                    />
                                                    <Bar dataKey="자기" radius={[3, 3, 0, 0]} maxBarSize={26}>
                                                        {barChartData.map((_, i) => <Cell key={i} fill="#60a5fa" />)}
                                                        <LabelList dataKey="자기" position="top" fontSize={11} fill="#60a5fa" formatter={(v: unknown) => Number(v).toFixed(1)} />
                                                    </Bar>
                                                    <Bar dataKey="청중" radius={[3, 3, 0, 0]} maxBarSize={26}>
                                                        {barChartData.map((_, i) => <Cell key={i} fill="#f472b6" />)}
                                                        <LabelList dataKey="청중" position="top" fontSize={11} fill="#f472b6" formatter={(v: unknown) => Number(v).toFixed(1)} />
                                                    </Bar>
                                                    <Bar dataKey="종합" radius={[3, 3, 0, 0]} maxBarSize={26}>
                                                        {barChartData.map((_, i) => <Cell key={i} fill="#9ca3af" />)}
                                                        <LabelList dataKey="종합" position="top" fontSize={11} fill="#9ca3af" formatter={(v: unknown) => Number(v).toFixed(1)} />
                                                    </Bar>
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>

                                        {/* Legend */}
                                        <div className="flex items-center justify-center gap-5 mb-4">
                                            <div className="flex items-center gap-1.5">
                                                <div className="w-2.5 h-2.5 rounded-sm bg-blue-400" />
                                                <span className="text-xs text-[var(--color-text-muted)]">자기</span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <div className="w-2.5 h-2.5 rounded-sm bg-pink-400" />
                                                <span className="text-xs text-[var(--color-text-muted)]">청중</span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <div className="w-2.5 h-2.5 rounded-sm bg-gray-400" />
                                                <span className="text-xs text-[var(--color-text-muted)]">종합</span>
                                            </div>
                                        </div>

                                        {/* Perception type */}
                                        {perceptionType && (
                                            <div className="rounded-md bg-gray-50 border border-[var(--color-border)] p-3.5">
                                                <div className="flex items-center gap-2 mb-2">
                                                    {["[A유형] 자기<청중", "[C유형] 자기=청중", "[B유형] 자기>청중"].map((t) => {
                                                        const isActive = perceptionType.label === t;
                                                        return (
                                                            <span
                                                                key={t}
                                                                className={`px-2.5 py-0.5 rounded text-xs font-semibold transition-all ${
                                                                    isActive
                                                                        ? "bg-[var(--color-hover)] border border-[var(--color-border)] text-[var(--color-text-primary)]"
                                                                        : "text-[var(--color-text-muted)]"
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
                                                <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                                                    {perceptionType.description}
                                                </p>
                                            </div>
                                        )}
                                    </div>

                                    {/* ── 성장 PLAN ── */}
                                    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-gray-50 p-5">
                                        <div className="flex items-center gap-2 mb-4">
                                            <TrendingUp className="w-4 h-4 text-[var(--color-accent)]" />
                                            <h4 className="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                                                성장 PLAN
                                            </h4>
                                        </div>
                                        <div className="space-y-3">
                                            {DOMAINS.map((domain) => {
                                                const score = detail.combined_scores_by_domain[domain];
                                                const plan = getGrowthPlan(domain, score);
                                                return (
                                                    <div key={domain} className="flex items-start gap-3">
                                                        <span className={cn(
                                                            "shrink-0 px-2.5 py-1 rounded-md text-xs font-bold text-white",
                                                            DOMAIN_BG_COLORS[domain]
                                                        )}>
                                                            {DOMAIN_LABELS[domain]}
                                                        </span>
                                                        <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed pt-0.5">
                                                            {plan}
                                                        </p>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
