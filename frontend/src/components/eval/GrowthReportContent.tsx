import { useMemo } from "react";
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
import { BarChart3, TrendingUp, Users, Target } from "lucide-react";
import { RadarChart } from "@/components/eval/RadarChart";
import {
    QUESTION_BY_KEY,
    QUESTION_SUBTITLES,
    QUESTION_GROWTH_FEEDBACK,
    DOMAIN_COMMON_FEEDBACK,
    QUESTIONS_BY_DOMAIN,
    getLowestQuestionInDomain,
} from "@/constants/evalQuestions";

// ── Types ────────────────────────────────────────────────────────────────

export interface GrowthReportContentProps {
    data: {
        member_name: string;
        self_scores_by_domain: Record<string, number | null>;
        audience_scores_by_domain: Record<string, number | null>;
        combined_scores_by_domain: Record<string, number | null>;
        self_scores_by_question: Record<string, number | null>;
        audience_scores_by_question: Record<string, number | null>;
        stage: string | null;
        type: string | null;
    };
    showTitle?: boolean;
    showQuestionDetail?: boolean;
    /** 상단 우측 라벨 (기본 "초기 분석지"). 후기 단일 폴백 시 "후기 분석지" 전달용. */
    roundLabel?: string;
}

// ── Constants ───────────────────────────────────────────────────────────

export const DOMAINS = ["PLANNING", "DESIGN", "SPEECH"] as const;

export const DOMAIN_LABELS: Record<string, string> = {
    PLANNING: "기획",
    DESIGN: "디자인",
    SPEECH: "스피치",
};

export const DOMAIN_COLORS: Record<string, { text: string; bg: string; bar: string; border: string }> = {
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
}

export const STAGES: Record<string, StageInfo> = {
    "구조 형성": {
        label: "구조 형성",
        range: "1.0 ~ 1.5",
        color: "text-orange-600",
        bgColor: "bg-orange-50",
    },
    "안정화": {
        label: "안정화",
        range: "1.6 ~ 3.0",
        color: "text-yellow-600",
        bgColor: "bg-yellow-50",
    },
    "정교화": {
        label: "정교화",
        range: "3.1 ~ 4.5",
        color: "text-sky-600",
        bgColor: "bg-sky-50",
    },
    "전달 최적화": {
        label: "전달 최적화",
        range: "4.6 ~ 5.0",
        color: "text-violet-600",
        bgColor: "bg-violet-50",
    },
};

// 도메인별 단계 설명
export const DOMAIN_STAGE_DESCRIPTIONS: Record<string, Record<string, string>> = {
    PLANNING: {
        "구조 형성": "핵심 메시지를 중심으로 발표의 기본 흐름을 세워가는 단계입니다.",
        "안정화": "기본 구조를 바탕으로 내용의 연결성과 흐름을 다듬는 단계입니다.",
        "정교화": "안정된 구조 위에 메시지의 밀도와 설계 의도를 더 선명하게 만드는 단계입니다.",
        "전달 최적화": "청중의 기억에 남는 관점과 여운까지 설계하는 단계입니다.",
    },
    DESIGN: {
        "구조 형성": "정보의 우선순위와 시선 흐름을 정리해 전달 기반을 만드는 단계입니다.",
        "안정화": "가독성과 구성은 갖춰져 있으며, 강조와 덜어내기를 다듬는 단계입니다.",
        "정교화": "메시지를 안정적으로 뒷받침하며, 인상과 분위기까지 확장해가는 단계입니다.",
        "전달 최적화": "디자인이 전달 전략으로 기능하며 발표 전체의 몰입감을 높이는 단계입니다.",
    },
    SPEECH: {
        "구조 형성": "말의 흐름을 안정적으로 이어가는 기본 스피치 역량을 만드는 단계입니다.",
        "안정화": "전달은 안정적이며, 강조와 리듬을 더해 전달력을 높이는 단계입니다.",
        "정교화": "감정 전달과 연결감을 더해 발표 몰입도를 높이는 단계입니다.",
        "전달 최적화": "분위기와 여운까지 설계하는 높은 수준의 전달 단계입니다.",
    },
};

// 유형 해석
export const TYPE_DESCRIPTIONS: Record<string, { emoji: string; summary: string; detail: string; action: string }> = {
    "균형형": {
        emoji: "triangle-balanced",
        summary: "세 영역이 고르게 분포되어 있습니다",
        detail: "세 영역의 점수가 고르게 분포되어 정삼각형에 가까운 형태를 띠고 있습니다. 어떤 주제든 기복 없이 안정적인 발표를 할 수 있음을 의미합니다. 이 유형의 강점은 발표 전반의 안정감과 균형 잡힌 전달력입니다.",
        action: "삼각형의 크기가 큰 경우, 앞으로 이 균형을 유지하면서 가장 자신 있는 부분을 깊게 파고들어, 나만의 필살기로 키워보세요. 만약 삼각형의 크기가 작다면, 현재의 균형을 유지한 채 세 영역의 수준을 동시에 한 단계씩 끌어올리는 것을 목표로 삼아보세요.",
    },
    "강점 집중형": {
        emoji: "triangle-strong",
        summary: "특정 영역이 두드러지게 높습니다",
        detail: "세 영역 중 한 개의 꼭짓점이 다른 영역에 비해 뻗어 나간 비대칭적인 형태를 띠고 있습니다. 이는 현재 자신의 발표 역량 중 특정 영역에서 가장 두드러지는 잠재력이 나타나고 있음을 의미합니다. 이 유형의 강점은 특정 영역에서 돋보이는 역량이 청중에게 인상적으로 전달될 수 있다는 점입니다.",
        action: "앞으로는 강점 영역을 더욱 발전시키는 동시에, 점수가 가장 낮은 영역의 기초 역량을 함께 보완해보세요. 강점을 중심으로 약점을 보완하는 전략을 활용하면 발표 전체의 완성도를 더욱 안정적으로 높일 수 있습니다.",
    },
    "보완점 명확형": {
        emoji: "triangle-growth",
        summary: "특정 영역에서 보완 방향이 명확합니다",
        detail: "세 영역 중 특정 영역의 점수가 상대적으로 낮은 형태를 갖추고 있습니다. 이는 집중적으로 보완해야 할 성장 방향이 명확하게 드러나 있는 긍정적인 신호입니다.",
        action: "현재 균형을 깨고 있는 이 영역을 중심으로 보완해 나가면, 발표의 완성도가 빠르게 높아지는 효과를 경험할 수 있습니다. 앞으로 진행될 강의를 주의 깊게 듣고, 당장 실천할 수 있는 작은 변화부터 다음 세션의 발표에 차근차근 적용해 보세요.",
    },
};

// ── Helpers ──────────────────────────────────────────────────────────────

// 자기 vs 청중 비교 유형
export function getPerceptionType(selfAvg: number, audienceAvg: number): { type: string; label: string; color: string; description: string; feedback: string } {
    const diff = selfAvg - audienceAvg;
    if (diff < -0.5) {
        return {
            type: "underestimate",
            label: "[A유형] 자기<청중",
            color: "text-blue-600",
            description: "본인은 아직 부족하다고 느끼고 있지만, 청중은 이미 긍정적인 발표 역량을 확인하고 있습니다. 이는 자신의 기준이 높거나, 스스로를 엄격하게 평가하는 경우에 자주 나타나는 유형입니다.",
            feedback: "자신감을 더 가져보는 것은 어떨까요? 이미 청중에게는 충분한 강점이 전달되고 있습니다. 이제는 \"부족한 점을 찾는 것\"보다 \"잘하고 있는 부분을 인식하고 확장하는 것\"이 중요합니다. 패들렛과 노션에 남겨진 서술형 피드백을 참고하여, 청중이 특히 긍정적으로 평가한 강점을 1가지 찾아 다음 발표에서 더 의도적으로 활용해 보세요. 청중은 이미 당신의 강점을 보고 있습니다. 이제는 그 강점을 믿고 더 선명하게 드러내 보세요!",
        };
    }
    if (diff > 0.5) {
        return {
            type: "overestimate",
            label: "[C유형] 자기>청중",
            color: "text-rose-600",
            description: "발표자가 의도한 메시지와 전달 방식이 청중에게는 충분히 전달되지 않았을 가능성이 있습니다. 이는 발표 역량이 부족하다기보다는 \"전달 방식과 청중 인식 사이에 간격이 있는 상태\"로 볼 수 있습니다.",
            feedback: "발표는 준비한 내용만큼이나 청중에게 어떻게 전달되는지가 중요합니다. 기획, 디자인, 스피치 중 어디에서 간격이 생겼는지 점검하면 발표의 완성도를 빠르게 높일 수 있습니다. 기수와 운영진이 남긴 서술형 피드백을 참고하여 청중이 특히 어려움을 느낀 지점을 한 가지 선택해 다음 발표에서 먼저 보완해 보세요. 전달 방식만 조금 조정해도 발표의 인상은 크게 달라질 수 있습니다.",
        };
    }
    return {
        type: "objective",
        label: "[B유형] 자기=청중",
        color: "text-emerald-600",
        description: "본인이 인식한 발표 수준과 청중의 평가가 비교적 일치합니다. 이는 자신의 발표를 객관적으로 바라보고 있다는 의미이며, 현재의 역량을 정확히 파악하고 있다는 강점이 있습니다.",
        feedback: "스스로의 발표를 잘 분석하고 있는 만큼 이번 결과를 다음 성장 전략을 설계하는 기준으로 활용해 보세요. 강점은 더욱 살리고, 상대적으로 아쉬운 부분은 보완한다면 발표 역량의 균형과 완성도를 동시에 높일 수 있습니다. 가장 높은 점수의 강점은 유지하고, 가장 낮은 영역 하나를 정해 다음 발표의 우선 과제로 설정해 보세요.",
    };
}

export function getDomainStage(score: number | null): string {
    if (score == null) return "데이터 부족";
    if (score <= 1.5) return "구조 형성";
    if (score <= 3.0) return "안정화";
    if (score <= 4.5) return "정교화";
    return "전달 최적화";
}

/** 소수점 둘째 자리에서 반올림하여 첫째 자리까지 표시 (IEEE 754 안전) */
export function roundDisplay(val: number | null): string {
    if (val == null) return "-";
    const [int, dec = "00"] = val.toFixed(2).split(".");
    let d0 = +dec[0];
    const d1 = +dec[1];
    if (d1 >= 5) d0++;
    if (d0 >= 10) return `${+int + 1}.0`;
    return `${int}.${d0}`;
}

export function avg(scores: Record<string, number | null>): number {
    const vals = Object.values(scores).filter((v): v is number => v != null);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

export function getStrongestDomain(scores: Record<string, number | null>): string {
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

export function getWeakestDomain(scores: Record<string, number | null>): string {
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

export function TriangleIcon({ type, className }: { type: string; className?: string }) {
    const size = 48;
    const pad = 6;
    const cx = size / 2;

    if (type === "triangle-balanced") {
        // Equilateral triangle - 정삼각형
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
        // Very tall/narrow triangle - 한쪽 꼭짓점이 매우 뾰족하게 과장
        return (
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className}>
                <polygon
                    points={`${cx},${pad - 3} ${cx + 8},${size - pad} ${cx - 8},${size - pad}`}
                    fill="rgba(59,130,246,0.15)"
                    stroke="#3b82f6"
                    strokeWidth="2"
                />
            </svg>
        );
    }
    // triangle-growth: very flat/wide triangle - 매우 납작한 삼각형
    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className}>
            <polygon
                points={`${cx},${size / 2 + 6} ${size - pad + 2},${size - pad} ${pad - 2},${size - pad}`}
                fill="rgba(245,158,11,0.15)"
                stroke="#f59e0b"
                strokeWidth="2"
            />
        </svg>
    );
}

// ── Section wrapper ─────────────────────────────────────────────────────

export function Section({ title, icon, children, delay = 0 }: {
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
            className="rounded-2xl bg-white border border-gray-100 px-6 py-5 sm:px-7 sm:py-6 shadow-sm"
        >
            <div className="flex items-center gap-2.5 mb-5">
                <div className="w-7 h-7 rounded-lg bg-rose-50 flex items-center justify-center">
                    {icon}
                </div>
                <h3 className="text-sm font-bold text-gray-900">{title}</h3>
            </div>
            {children}
        </motion.div>
    );
}

// ══════════════════════════════════════════════════════════════════════════
// Main Component
// ══════════════════════════════════════════════════════════════════════════

export default function GrowthReportContent({
    data,
    showTitle = true,
    showQuestionDetail = false,
    roundLabel = "초기 분석지",
}: GrowthReportContentProps) {
    const combinedScores = useMemo(() => {
        if (!data?.combined_scores_by_domain) return { PLANNING: 0, DESIGN: 0, SPEECH: 0 };
        return {
            PLANNING: data.combined_scores_by_domain.PLANNING ?? 0,
            DESIGN: data.combined_scores_by_domain.DESIGN ?? 0,
            SPEECH: data.combined_scores_by_domain.SPEECH ?? 0,
        };
    }, [data?.combined_scores_by_domain]);

    const stageMap = useMemo(() => {
        if (!data?.combined_scores_by_domain) return {} as Record<string, string>;
        return Object.fromEntries(
            DOMAINS.map(d => [d, getDomainStage(data.combined_scores_by_domain[d])])
        ) as Record<string, string>;
    }, [data?.combined_scores_by_domain]);

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

    const typeInfo = TYPE_DESCRIPTIONS[data.type ?? ""] ?? TYPE_DESCRIPTIONS["균형형"];

    return (
        <>
            {/* ─── Title Card ─── */}
            {showTitle && (
                <div className="rounded-2xl bg-gradient-to-br from-rose-500 via-rose-500 to-pink-600 p-6 text-white shadow-xl shadow-rose-500/25 relative overflow-hidden">
                    {/* Decorative circles */}
                    <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/10" />
                    <div className="absolute -bottom-4 -left-4 w-20 h-20 rounded-full bg-white/5" />

                    {/* 초기 분석지 라벨 */}
                    <div className="absolute top-4 right-4">
                        <span className="px-2.5 py-1 rounded-full bg-white/20 backdrop-blur-sm text-[10px] font-bold tracking-wide">
                            {roundLabel}
                        </span>
                    </div>

                    <div className="relative">
                        <p className="text-[11px] font-semibold text-rose-200 tracking-widest mb-2">
                            UnivPT 33기
                        </p>
                        <h2 className="text-xl font-extrabold leading-tight">
                            {data.member_name}님의 발표 성장 리포트
                        </h2>
                        <p className="text-xs text-rose-100 mt-2 leading-[1.8]">
                            현재 발표 역량을 확인하고, 다음 성장을 위한 방향을 살펴보세요.
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-4">
                            {DOMAINS.map((d) => {
                                const badgeBg =
                                    d === "PLANNING" ? "bg-blue-500" :
                                    d === "DESIGN" ? "bg-emerald-500" : "bg-amber-500";
                                return (
                                    <span key={d} className={`px-3 py-1 rounded-full ${badgeBg} text-white text-xs font-bold shadow-sm`}>
                                        [{DOMAIN_LABELS[d]}] {stageMap[d] ?? ""}
                                    </span>
                                );
                            })}
                            {data.type && (
                                <span className="px-3 py-1 rounded-full bg-white text-rose-600 text-xs font-bold shadow-sm">
                                    {data.type}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ─── 0.5 리포트 소개 ─── */}
            {showTitle && (
                <div className="rounded-2xl bg-gray-50 border border-gray-100 px-5 py-4">
                    <p className="text-xs text-gray-500 leading-[1.8] [word-break:keep-all] text-pretty">
                        본 리포트는 프레젠테이션의 핵심 요소인 기획, 디자인, 스피치 세 영역을 기준으로 현재 발표 역량을 진단하고, 앞으로의 성장 방향을 제시하기 위해 작성되었습니다. 본 평가는 경쟁을 위한 평가가 아니라 여러분의 발표 성장 과정을 기록하기 위한 진단입니다.
                    </p>
                </div>
            )}

            {/* ─── 1. 발표 역량 방사형 그래프 ─── */}
            <Section
                title="발표 역량 방사형 그래프"
                icon={<BarChart3 className="w-4 h-4 text-rose-500" />}
                delay={0.05}
            >
                <RadarChart
                    selfScores={combinedScores}
                    size={460}
                    variant="light"
                />

                {/* 설명 문구 */}
                <p className="text-xs text-gray-400 leading-[1.8] mb-2 -mt-2 [word-break:keep-all] text-pretty">
                    이 그래프는 발표 역량의 세 영역(기획, 디자인, 스피치)을 시각적으로 나타낸 것입니다.
                </p>
                <p className="text-xs text-gray-400 leading-[1.8] mb-4 [word-break:keep-all] text-pretty">
                    각 영역별 점수는 자기 평가와 청중 평가를 1:1로 반영한 평균 점수이며, 소수점 둘째 자리에서 반올림하여 표시됩니다.
                </p>

                {/* Score table */}
                <div className="overflow-hidden rounded-xl border border-gray-200">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-gray-50 text-gray-500">
                                <th className="py-2.5 px-3 text-left font-semibold text-xs">영역</th>
                                <th className="py-2.5 px-3 text-center font-semibold text-xs">자기</th>
                                <th className="py-2.5 px-3 text-center font-semibold text-xs">청중</th>
                                <th className="py-2.5 px-3 text-center font-semibold text-xs">종합</th>
                            </tr>
                        </thead>
                        <tbody>
                            {DOMAINS.map((domain) => {
                                const selfVal = data.self_scores_by_domain[domain];
                                const audVal = data.audience_scores_by_domain[domain];
                                const combVal = data.combined_scores_by_domain[domain];
                                const colors = DOMAIN_COLORS[domain];
                                return (
                                    <tr key={domain} className="border-t border-gray-100">
                                        <td className={`py-2.5 px-3 font-bold ${colors.text}`}>
                                            {DOMAIN_LABELS[domain]}
                                        </td>
                                        <td className="py-2.5 px-3 text-center tabular-nums text-gray-700 font-medium">
                                            {roundDisplay(selfVal)}
                                        </td>
                                        <td className="py-2.5 px-3 text-center tabular-nums text-gray-700 font-medium">
                                            {roundDisplay(audVal)}
                                        </td>
                                        <td className="py-2.5 px-3 text-center tabular-nums text-gray-900 font-extrabold">
                                            {roundDisplay(combVal)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </Section>

            {/* ─── 2. 발표 유형 해석 ─── */}
            <Section
                title="발표 유형 해석"
                icon={<Target className="w-4 h-4 text-rose-500" />}
                delay={0.1}
            >
                {/* 삼각형 설명 */}
                <p className="text-[11px] text-gray-400 text-center mb-3">
                    삼각형의 형태는 세 영역의 균형을,
                    크기는 전체 수준을 의미합니다.
                </p>

                {/* Type icons row */}
                <div className="flex items-center justify-center gap-4 sm:gap-8 mb-4">
                    {(["균형형", "강점 집중형", "보완점 명확형"] as const).map((t) => {
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
                <div className="rounded-xl bg-gradient-to-br from-gray-50 to-white border border-gray-100 p-4">
                    <p className="text-sm font-bold text-gray-900 mb-2">
                        {data.type ?? "분석 중"}
                        {data.type === "강점 집중형" && (
                            <span className="text-blue-600 ml-1">
                                — {getStrongestDomain(data.combined_scores_by_domain)} 강점
                            </span>
                        )}
                        {data.type === "보완점 명확형" && (
                            <span className="text-amber-600 ml-1">
                                — {getWeakestDomain(data.combined_scores_by_domain)} 보완 필요
                            </span>
                        )}
                    </p>
                    <p className="text-xs text-gray-600 leading-[1.8] mb-3 [word-break:keep-all] text-pretty">
                        {typeInfo.detail}
                    </p>
                    <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50/50 border border-rose-100">
                        <TrendingUp className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
                        <p className="text-xs text-gray-700 leading-[1.8] font-medium [word-break:keep-all] text-pretty">
                            {typeInfo.action}
                        </p>
                    </div>
                </div>
            </Section>

            {/* ─── 3. 영역별 단계 해석 ─── */}
            <Section
                title="영역별 단계 해석"
                icon={<BarChart3 className="w-4 h-4 text-rose-500" />}
                delay={0.15}
            >
                {/* Stage progress overview */}
                <div className="flex items-center gap-1 mb-4 px-1">
                    {Object.values(STAGES).map((s) => (
                        <div key={s.label} className="flex-1 flex flex-col items-center gap-1">
                            <div className={`w-full h-1.5 rounded-full ${s.bgColor} ${
                                data.stage === s.label ? "ring-2 ring-offset-1 ring-rose-300" : "opacity-50"
                            }`} />
                            <span className={`text-[9px] font-semibold ${
                                data.stage === s.label ? s.color : "text-gray-300"
                            }`}>
                                {s.label}
                            </span>
                            <span className={`text-[7px] ${
                                data.stage === s.label ? "text-gray-400" : "text-gray-200"
                            }`}>
                                {s.range}
                            </span>
                        </div>
                    ))}
                </div>

                <div className="space-y-3">
                    {DOMAINS.map((domain) => {
                        const score = data.combined_scores_by_domain[domain];
                        const stageName = getDomainStage(score);
                        const stageInfo = STAGES[stageName];
                        const pct = score != null ? (score / 5) * 100 : 0;
                        const colors = DOMAIN_COLORS[domain];
                        const domainDesc = DOMAIN_STAGE_DESCRIPTIONS[domain]?.[stageName];

                        return (
                            <div key={domain} className={`rounded-xl border ${colors.border} ${colors.bg} p-3.5`}>
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <span className={`text-sm font-bold ${colors.text}`}>
                                            {DOMAIN_LABELS[domain]}
                                        </span>
                                        {stageInfo && (
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${stageInfo.bgColor} ${stageInfo.color} border border-current/10`}>
                                                {stageInfo.label}
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-base font-extrabold text-gray-900 tabular-nums">
                                        {roundDisplay(score)}
                                    </span>
                                </div>
                                <div className="h-2 bg-white/80 rounded-full overflow-hidden mb-2.5">
                                    <motion.div
                                        className="h-full rounded-full"
                                        style={{ backgroundColor: colors.bar }}
                                        initial={{ width: 0 }}
                                        animate={{ width: `${pct}%` }}
                                        transition={{ delay: 0.3, duration: 0.6, ease: "easeOut" }}
                                    />
                                </div>
                                {domainDesc && (
                                    <p className="text-xs text-gray-600 leading-[1.8] [word-break:keep-all] text-pretty">
                                        {domainDesc}
                                    </p>
                                )}
                            </div>
                        );
                    })}
                </div>
            </Section>

            {/* ─── 4. 자기 vs 청중 인식 비교 ─── */}
            <Section
                title="자기 vs 청중 인식 비교"
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
                                <LabelList dataKey="자기" position="top" fontSize={10} fill="#60a5fa" formatter={(v: unknown) => roundDisplay(Number(v))} />
                            </Bar>
                            <Bar dataKey="청중" radius={[3, 3, 0, 0]} maxBarSize={28}>
                                {barChartData.map((_, i) => (
                                    <Cell key={i} fill="#f472b6" />
                                ))}
                                <LabelList dataKey="청중" position="top" fontSize={10} fill="#f472b6" formatter={(v: unknown) => roundDisplay(Number(v))} />
                            </Bar>
                            <Bar dataKey="종합" radius={[3, 3, 0, 0]} maxBarSize={28}>
                                {barChartData.map((_, i) => (
                                    <Cell key={i} fill="#6b7280" />
                                ))}
                                <LabelList dataKey="종합" position="top" fontSize={10} fill="#6b7280" formatter={(v: unknown) => roundDisplay(Number(v))} />
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Legend */}
                <div className="flex items-center justify-center gap-5 mb-3">
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

                {/* 보완 설명 */}
                <p className="text-xs text-gray-400 mb-4 [word-break:keep-all]">
                    ※ 종합 = 자기·청중 평가 1:1 평균, 소수점 둘째 자리에서 반올림
                </p>

                {/* Perception type */}
                {perceptionType && (
                    <div className="rounded-xl bg-gradient-to-br from-gray-50 to-white border border-gray-100 p-4">
                        <div className="flex items-center gap-1.5 mb-3">
                            {[
                                "[A유형] 자기<청중",
                                "[B유형] 자기=청중",
                                "[C유형] 자기>청중",
                            ].map((t) => {
                                const isActive = perceptionType.label === t;
                                return (
                                    <span
                                        key={t}
                                        className={`flex-1 text-center px-1 py-1.5 rounded-lg text-[10px] font-semibold transition-all whitespace-nowrap ${
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
                        <p className={`text-sm font-bold mb-2 ${perceptionType.color}`}>
                            {perceptionType.label}
                        </p>
                        <p className="text-sm text-gray-600 leading-[2.0] [word-break:keep-all] text-pretty mb-3">
                            {perceptionType.description}
                        </p>
                        <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                            <p className="text-xs font-bold text-gray-500 mb-1.5">피드백</p>
                            <p className="text-sm text-gray-700 leading-[2.0] [word-break:keep-all] text-pretty">
                                {perceptionType.feedback}
                            </p>
                        </div>
                    </div>
                )}
            </Section>

            {/* ─── 5. 성장 PLAN (문항별 개인화) ─── */}
            <Section
                title="성장 PLAN"
                icon={<TrendingUp className="w-4 h-4 text-rose-500" />}
                delay={0.25}
            >
                <div className="space-y-6">
                    {DOMAINS.map((domain) => {
                        const lowestKey = getLowestQuestionInDomain(
                            domain,
                            data.self_scores_by_question,
                            data.audience_scores_by_question,
                        );
                        const questionInfo = lowestKey ? QUESTION_BY_KEY[lowestKey] : null;
                        const subtitle = lowestKey ? QUESTION_SUBTITLES[lowestKey] : null;
                        const feedback = lowestKey ? QUESTION_GROWTH_FEEDBACK[lowestKey] : null;
                        const common = DOMAIN_COMMON_FEEDBACK[domain];
                        const colors = DOMAIN_COLORS[domain];

                        return (
                            <div key={domain} className={`rounded-xl border ${colors.border} overflow-hidden`}>
                                {/* 도메인 헤더 */}
                                <div className={`flex items-center gap-2.5 px-5 py-3 ${colors.bg}`}>
                                    <span className={`px-3 py-1 rounded-lg text-xs font-bold text-white ${
                                        domain === "PLANNING" ? "bg-blue-500"
                                        : domain === "DESIGN" ? "bg-emerald-500"
                                        : "bg-amber-500"
                                    }`}>
                                        {DOMAIN_LABELS[domain]}
                                    </span>
                                    <span className="text-xs text-gray-500 font-medium">
                                        {getDomainStage(data.combined_scores_by_domain[domain])}
                                    </span>
                                </div>

                                <div className="px-5 py-4 space-y-4 bg-white">
                                    {/* 문항별 피드백 */}
                                    {questionInfo && subtitle && feedback && (
                                        <div>
                                            <p className={`text-sm font-bold mb-3 ${colors.text}`}>
                                                [{questionInfo.label} : {subtitle}]
                                            </p>
                                            <div className="space-y-3">
                                                {feedback.split("\n\n").map((paragraph, i) => (
                                                    i === 0 ? (
                                                        <p key={i} className="text-sm text-gray-500 leading-[2.0] [word-break:keep-all] text-pretty">
                                                            {paragraph}
                                                        </p>
                                                    ) : (
                                                        <div key={i} className={`border-l-[3px] ${colors.border} pl-4 py-1`}>
                                                            <p className="text-sm text-gray-700 leading-[2.0] [word-break:keep-all] text-pretty">
                                                                {paragraph}
                                                            </p>
                                                        </div>
                                                    )
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* 구분선 */}
                                    {common && <hr className="border-gray-100" />}

                                    {/* 멘토링 */}
                                    {common && (
                                        <div className={`rounded-xl ${colors.bg} p-4`}>
                                            <p className={`text-sm font-bold ${colors.text} mb-2`}>
                                                💡 멘토링의 도움을 받아보자
                                            </p>
                                            <p className="text-sm text-gray-600 leading-[2.0] [word-break:keep-all] text-pretty">
                                                {common.mentoring}
                                            </p>
                                        </div>
                                    )}

                                    {/* 꿀팁 */}
                                    {common && common.tips.length > 0 && (
                                        <div>
                                            <p className="text-sm font-bold text-gray-800 mb-3">
                                                📌 그 외 꿀팁
                                            </p>
                                            <div className="space-y-3">
                                                {common.tips.map((tip, i) => (
                                                    <div key={i} className="rounded-lg bg-gray-50 border border-gray-100 p-4">
                                                        <p className="text-sm font-bold text-gray-800 mb-2">
                                                            {tip.title}
                                                        </p>
                                                        <p className="text-sm text-gray-600 leading-[2.0] [word-break:keep-all] text-pretty">
                                                            {tip.body}
                                                        </p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </Section>

            {/* ─── 6. 문항별 평가 상세 (conditional) ─── */}
            {showQuestionDetail && (
                <Section
                    title="문항별 평가 상세"
                    icon={<BarChart3 className="w-4 h-4 text-rose-500" />}
                    delay={0.3}
                >
                    <div className="space-y-4">
                        {DOMAINS.map((domain) => {
                            const questions = QUESTIONS_BY_DOMAIN[domain as keyof typeof QUESTIONS_BY_DOMAIN];
                            const colors = DOMAIN_COLORS[domain];
                            const borderLeftColor =
                                domain === "PLANNING" ? "border-l-blue-400"
                                : domain === "DESIGN" ? "border-l-emerald-400"
                                : "border-l-amber-400";
                            return (
                                <div key={domain} className={`rounded-xl ${colors.bg} border ${colors.border} overflow-hidden`}>
                                    {/* Domain header */}
                                    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-200/40">
                                        <span className={`px-2.5 py-1 rounded-lg text-xs font-bold text-white ${
                                            domain === "PLANNING" ? "bg-blue-500"
                                            : domain === "DESIGN" ? "bg-emerald-500"
                                            : "bg-amber-500"
                                        }`}>
                                            {DOMAIN_LABELS[domain]}
                                        </span>
                                        <span className="text-xs text-gray-400 font-medium">
                                            {getDomainStage(data.combined_scores_by_domain[domain])}
                                        </span>
                                    </div>

                                    {/* Table header */}
                                    <div className="grid grid-cols-[1fr_3.5rem_3.5rem_3.5rem] items-center px-4 py-2 bg-white/50 border-b border-gray-200/30">
                                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">문항</span>
                                        <span className="text-xs font-semibold text-blue-400 text-center">자기</span>
                                        <span className="text-xs font-semibold text-pink-400 text-center">청중</span>
                                        <span className="text-xs font-semibold text-gray-500 text-center">종합</span>
                                    </div>

                                    {/* Question rows */}
                                    <div className="divide-y divide-gray-200/30">
                                        {questions.map((q) => {
                                            const selfScore = data.self_scores_by_question[q.key];
                                            const audScore = data.audience_scores_by_question[q.key];
                                            const combined = selfScore != null && audScore != null
                                                ? (selfScore + audScore) / 2
                                                : selfScore ?? audScore ?? null;
                                            return (
                                                <div key={q.key} className={`grid grid-cols-[1fr_3.5rem_3.5rem_3.5rem] items-center px-4 py-3 border-l-[3px] ${borderLeftColor} bg-white/30 hover:bg-white/60 transition-colors`}>
                                                    <div className="min-w-0 pr-2">
                                                        <span className={`text-sm font-bold ${colors.text}`}>[{q.label}]</span>{" "}
                                                        <span className="text-sm text-gray-600 [word-break:keep-all]">{q.selfText}</span>
                                                    </div>
                                                    <span className="text-sm text-center tabular-nums text-blue-500 font-medium">
                                                        {selfScore != null ? Number(selfScore).toFixed(1) : "-"}
                                                    </span>
                                                    <span className="text-sm text-center tabular-nums text-pink-500 font-medium">
                                                        {audScore != null ? Number(audScore).toFixed(1) : "-"}
                                                    </span>
                                                    <span className="text-sm text-center tabular-nums text-gray-900 font-bold">
                                                        {combined != null ? combined.toFixed(1) : "-"}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                        {/* Legend */}
                        <div className="flex items-center justify-center gap-5 pt-1">
                            <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                                <div className="w-2 h-2 rounded-sm bg-blue-400" /> 자기
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                                <div className="w-2 h-2 rounded-sm bg-pink-400" /> 청중
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                                <div className="w-2 h-2 rounded-sm bg-gray-500" /> 종합
                            </div>
                        </div>
                    </div>
                </Section>
            )}

            {/* ─── Footer (Cherry Blossom) ─── */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-white to-[#FFF0F3] py-8 px-6">
                {/* Petal SVGs */}
                <svg className="absolute top-2 left-8 w-5 h-5 text-pink-200 opacity-60" viewBox="0 0 20 20" style={{ animation: "petal-float-1 4s ease-in-out infinite" }}>
                    <ellipse cx="10" cy="8" rx="5" ry="8" fill="currentColor" transform="rotate(-15 10 8)" />
                </svg>
                <svg className="absolute top-4 right-12 w-4 h-4 text-pink-300 opacity-50" viewBox="0 0 20 20" style={{ animation: "petal-float-2 5s ease-in-out infinite 0.5s" }}>
                    <ellipse cx="10" cy="8" rx="5" ry="8" fill="currentColor" transform="rotate(20 10 8)" />
                </svg>
                <svg className="absolute bottom-3 left-1/3 w-3.5 h-3.5 text-pink-200 opacity-40" viewBox="0 0 20 20" style={{ animation: "petal-float-3 6s ease-in-out infinite 1s" }}>
                    <ellipse cx="10" cy="8" rx="5" ry="8" fill="currentColor" transform="rotate(45 10 8)" />
                </svg>

                <p className="text-center text-sm font-medium text-rose-400/80 relative">
                    Bloom UP — 당신의 가능성을 꽃피우기 위해
                </p>
                <p className="text-center text-[10px] text-gray-300 mt-1 relative">
                    UnivPT
                </p>
            </div>
        </>
    );
}
