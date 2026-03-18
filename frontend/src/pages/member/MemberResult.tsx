import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMemberOwnResult } from "@/hooks/useMemberEvaluation";
import { RadarChart } from "@/components/eval/RadarChart";
import { motion } from "framer-motion";
// html-to-image, jspdf: 동적 import로 PDF 생성 시에만 로드
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
import { ArrowLeft, Lock, BarChart3, TrendingUp, Users, Target, Download } from "lucide-react";

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
}

const STAGES: Record<string, StageInfo> = {
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
const DOMAIN_STAGE_DESCRIPTIONS: Record<string, Record<string, string>> = {
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
const TYPE_DESCRIPTIONS: Record<string, { emoji: string; summary: string; detail: string; action: string }> = {
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

// 자기 vs 청중 비교 유형
function getPerceptionType(selfAvg: number, audienceAvg: number): { type: string; label: string; color: string; description: string } {
    const diff = selfAvg - audienceAvg;
    if (diff > 0.5) {
        return {
            type: "overestimate",
            label: "[B유형] 자기>청중",
            color: "text-rose-600",
            description: "의도는 분명했으나 전달이 기대만큼 닿지 않았을 수 있습니다. '내가 한 것'보다 '상대가 받은 것' 기준으로 점검해보세요.",
        };
    } else if (diff < -0.5) {
        return {
            type: "underestimate",
            label: "[A유형] 자기<청중",
            color: "text-blue-600",
            description: "본인은 부족하다고 느끼지만 외부 평가는 긍정적입니다. 현재 수준을 객관적으로 신뢰하고, 잘된 요소를 다음에도 재현해보세요.",
        };
    }
    return {
        type: "objective",
        label: "[C유형] 자기=청중",
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
    if (score <= 1.5) return plans.low;
    if (score <= 3.0) return plans.mid;
    return plans.high;
}

function getDomainStage(score: number | null): string {
    if (score == null) return "데이터 부족";
    if (score <= 1.5) return "구조 형성";
    if (score <= 3.0) return "안정화";
    if (score <= 4.5) return "정교화";
    return "전달 최적화";
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** 소수점 둘째 자리에서 반올림하여 첫째 자리까지 표시 (IEEE 754 안전) */
function roundDisplay(val: number | null): string {
    if (val == null) return "-";
    const [int, dec = "00"] = val.toFixed(2).split(".");
    let d0 = +dec[0];
    const d1 = +dec[1];
    if (d1 >= 5) d0++;
    if (d0 >= 10) return `${+int + 1}.0`;
    return `${int}.${d0}`;
}

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

export default function MemberResult() {
    const { roundId } = useParams<{ roundId: string }>();
    const navigate = useNavigate();
    const { data, isLoading, isError, error } = useMemberOwnResult(roundId!);

    const isForbidden =
        isError && (error as { response?: { status?: number } })?.response?.status === 403;

    const pdfRef = useRef<HTMLDivElement>(null);
    const [pdfLoading, setPdfLoading] = useState(false);
    const [showPdf, setShowPdf] = useState(false);

    const handleDownloadPdf = useCallback(async () => {
        if (!data) return;
        setPdfLoading(true);
        setShowPdf(true);
        await new Promise(r => setTimeout(r, 600));
        const el = pdfRef.current;
        if (!el) { setPdfLoading(false); setShowPdf(false); return; }
        try {
            const { toPng } = await import("html-to-image");
            const { jsPDF } = await import("jspdf");
            const dataUrl = await toPng(el, { pixelRatio: 2, backgroundColor: "#ffffff" });
            const img = new Image();
            img.src = dataUrl;
            await new Promise<void>(r => { img.onload = () => r(); });
            const pdf = new jsPDF("p", "mm", "a4");
            const pw = pdf.internal.pageSize.getWidth();
            const ph = pdf.internal.pageSize.getHeight();
            const m = 3;
            const cw = pw - m * 2;
            const ch = ph - m * 2;
            const ratio = img.width / img.height;
            let w: number, h: number;
            if (ratio > cw / ch) { w = cw; h = cw / ratio; } else { h = ch; w = ch * ratio; }
            pdf.addImage(dataUrl, "PNG", m + (cw - w) / 2, m, w, h);
            pdf.save(`${data.member_name}_성장리포트.pdf`);
        } finally {
            setShowPdf(false);
            setPdfLoading(false);
        }
    }, [data]);

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
            <style>{`
                @keyframes petal-float-1 { 0%, 100% { transform: translateY(0) rotate(-15deg); } 50% { transform: translateY(-6px) rotate(-5deg); } }
                @keyframes petal-float-2 { 0%, 100% { transform: translateY(0) rotate(20deg); } 50% { transform: translateY(-8px) rotate(30deg); } }
                @keyframes petal-float-3 { 0%, 100% { transform: translateY(0) rotate(45deg); } 50% { transform: translateY(-5px) rotate(55deg); } }
            `}</style>

            {/* Header */}
            <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-gray-200 print:hidden">
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
                    <button
                        onClick={handleDownloadPdf}
                        disabled={pdfLoading}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
                    >
                        {pdfLoading ? (
                            <span className="inline-block w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                        ) : (
                            <Download className="w-3.5 h-3.5" />
                        )}
                        {pdfLoading ? "생성 중..." : "PDF 다운로드"}
                    </button>
                </div>
            </header>

            {/* Content */}
            <motion.main
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="mx-auto w-full max-w-2xl px-5 py-6 space-y-5"
            >
                {/* ─── Title Card ─── */}
                <div className="rounded-2xl bg-gradient-to-br from-rose-500 via-rose-500 to-pink-600 p-6 text-white shadow-xl shadow-rose-500/25 relative overflow-hidden">
                    {/* Decorative circles */}
                    <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/10" />
                    <div className="absolute -bottom-4 -left-4 w-20 h-20 rounded-full bg-white/5" />

                    {/* 초기 분석지 라벨 */}
                    <div className="absolute top-4 right-4">
                        <span className="px-2.5 py-1 rounded-full bg-white/20 backdrop-blur-sm text-[10px] font-bold tracking-wide">
                            초기 분석지
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
                                        [{DOMAIN_LABELS[d]}]{stageMap[d] ?? ""}
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

                {/* ─── 0.5 리포트 소개 ─── */}
                <div className="rounded-2xl bg-gray-50 border border-gray-100 px-5 py-4">
                    <p className="text-xs text-gray-500 leading-[1.8] break-keep-all text-pretty">
                        본 리포트는 프레젠테이션의 핵심 요소인 기획, 디자인, 스피치 세 영역을 기준으로 현재 발표 역량을 진단하고, 앞으로의 성장 방향을 제시하기 위해 작성되었습니다. 본 평가는 경쟁을 위한 평가가 아니라 여러분의 발표 성장 과정을 기록하기 위한 진단입니다.
                    </p>
                </div>

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
                    <p className="text-xs text-gray-400 leading-[1.8] mb-4 -mt-2 break-keep-all text-pretty">
                        이 그래프는 발표 역량의 세 영역(기획, 디자인, 스피치)을 시각적으로 나타낸 것입니다.
                        각 영역별 점수는 자기 평가와 청중 평가를 1:1로 반영한 평균 점수이며,
                        소수점 둘째 자리에서 반올림하여 표시됩니다.
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
                        <p className="text-xs text-gray-600 leading-[1.8] mb-3 break-keep-all text-pretty">
                            {typeInfo.detail}
                        </p>
                        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50/50 border border-rose-100">
                            <TrendingUp className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
                            <p className="text-xs text-gray-700 leading-[1.8] font-medium break-keep-all text-pretty">
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
                                        <p className="text-xs text-gray-600 leading-[1.8] break-keep-all text-pretty">
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
                    <p className="text-xs text-gray-400 mb-4 break-keep-all">
                        ※ 종합 = 자기·청중 평가 1:1 평균, 소수점 둘째 자리에서 반올림
                    </p>

                    {/* Perception type */}
                    {perceptionType && (
                        <div className="rounded-xl bg-gradient-to-br from-gray-50 to-white border border-gray-100 p-4">
                            <div className="flex items-center gap-1.5 mb-3">
                                {[
                                    "[A유형] 자기<청중",
                                    "[C유형] 자기=청중",
                                    "[B유형] 자기>청중",
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
                            <p className={`text-sm font-bold mb-1.5 ${perceptionType.color}`}>
                                {perceptionType.label}
                            </p>
                            <p className="text-xs text-gray-600 leading-[1.8] break-keep-all text-pretty">
                                {perceptionType.description}
                            </p>
                        </div>
                    )}
                </Section>

                {/* ─── 5. 성장 PLAN ─── */}
                <Section
                    title="성장 PLAN"
                    icon={<TrendingUp className="w-4 h-4 text-rose-500" />}
                    delay={0.25}
                >
                    <div className="space-y-3">
                        {DOMAINS.map((domain) => {
                            const score = data.combined_scores_by_domain[domain];
                            const plan = getGrowthPlan(domain, score);
                            const colors = DOMAIN_COLORS[domain];

                            return (
                                <div key={domain} className={`rounded-xl border ${colors.border} ${colors.bg} p-3.5`}>
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className={`px-2.5 py-1 rounded-lg text-xs font-bold text-white ${
                                            domain === "PLANNING" ? "bg-blue-500"
                                            : domain === "DESIGN" ? "bg-emerald-500"
                                            : "bg-amber-500"
                                        }`}>
                                            {DOMAIN_LABELS[domain]}
                                        </span>
                                        <span className="text-[10px] text-gray-400 font-medium">
                                            {getDomainStage(score)}
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-700 leading-[1.8] break-keep-all text-pretty">
                                        {plan}
                                    </p>
                                </div>
                            );
                        })}
                    </div>
                </Section>

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
            </motion.main>

            {/* ══════ PDF용 오버레이: 동일 박스, 2단 그리드 재배치 ══════ */}
            {showPdf && (
                <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "#fff", overflow: "auto" }}>
                    <div style={{ position: "fixed", top: 12, right: 16, zIndex: 10000, background: "#f43f5e", color: "#fff", padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600 }}>
                        PDF 생성 중...
                    </div>
                    <div ref={pdfRef} style={{ width: 860, height: 1216, padding: "20px 24px", background: "#fff", fontFamily: "system-ui, sans-serif", color: "#1f2937", display: "flex", flexDirection: "column" }}>

                        {/* ── 제목 카드 ── */}
                        <div style={{ background: "linear-gradient(135deg, #f43f5e, #ec4899)", borderRadius: 12, padding: "18px 22px", color: "#fff", marginBottom: 14, position: "relative" }}>
                            <span style={{ position: "absolute", top: 14, right: 16, fontSize: 10, background: "rgba(255,255,255,0.2)", padding: "3px 10px", borderRadius: 10, fontWeight: 600 }}>초기 분석지</span>
                            <div style={{ fontSize: 11, opacity: 0.7, letterSpacing: 2, fontWeight: 600 }}>UnivPT 33기</div>
                            <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{data.member_name}님의 발표 성장 리포트</div>
                            <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>{data.member_name}님의 현재 발표 역량을 확인하고, 다음 성장을 위한 방향을 살펴보세요.</div>
                            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                                {DOMAINS.map(d => (
                                    <span key={d} style={{ background: d === "PLANNING" ? "#3b82f6" : d === "DESIGN" ? "#10b981" : "#f59e0b", color: "#fff", fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 10 }}>
                                        [{DOMAIN_LABELS[d]}]{stageMap[d]}
                                    </span>
                                ))}
                                {data.type && <span style={{ background: "#fff", color: "#e11d48", fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 10 }}>{data.type}</span>}
                            </div>
                        </div>

                        {/* ── 소개 ── */}
                        <div style={{ fontSize: 10, color: "#6b7280", padding: "8px 12px", background: "#f9fafb", borderRadius: 8, marginBottom: 14, border: "1px solid #f3f4f6", lineHeight: 1.5 }}>
                            본 리포트는 프레젠테이션의 핵심 요소인 기획, 디자인, 스피치 세 영역을 기준으로 현재 발표 역량을 진단하고, 앞으로의 성장 방향을 제시하기 위해 작성되었습니다. 본 평가는 경쟁을 위한 평가가 아니라 여러분의 발표 성장 과정을 기록하기 위한 진단입니다.
                        </div>

                        {/* ══ ROW 1: 레이더(좌) + 점수표(우) | 발표 유형 해석 ══ */}
                        <div style={{ display: "flex", gap: 14, marginBottom: 14, alignItems: "stretch", flex: 1 }}>
                            {/* 레이더 + 점수표: 가로 배치 */}
                            <div style={{ flex: 1, border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column" }}>
                                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>발표 역량 방사형 그래프</div>
                                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                                    <div style={{ width: 190, height: 190, flexShrink: 0 }}>
                                        <RadarChart selfScores={combinedScores} size={190} variant="light" />
                                    </div>
                                    <div style={{ flex: 1, fontSize: 11 }}>
                                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                            <thead><tr style={{ background: "#f9fafb" }}>
                                                {["영역", "자기", "청중", "종합"].map(h => <th key={h} style={{ padding: "5px 6px", textAlign: h === "영역" ? "left" : "center", fontWeight: 600, borderBottom: "1px solid #e5e7eb", fontSize: 10 }}>{h}</th>)}
                                            </tr></thead>
                                            <tbody>{DOMAINS.map(d => (
                                                <tr key={d}>
                                                    <td style={{ padding: "5px 6px", fontWeight: 700, color: DOMAIN_COLORS[d].bar }}>{DOMAIN_LABELS[d]}</td>
                                                    <td style={{ padding: "5px 6px", textAlign: "center" }}>{roundDisplay(data.self_scores_by_domain[d])}</td>
                                                    <td style={{ padding: "5px 6px", textAlign: "center" }}>{roundDisplay(data.audience_scores_by_domain[d])}</td>
                                                    <td style={{ padding: "5px 6px", textAlign: "center", fontWeight: 800 }}>{roundDisplay(data.combined_scores_by_domain[d])}</td>
                                                </tr>
                                            ))}</tbody>
                                        </table>
                                        <div style={{ fontSize: 8, color: "#9ca3af", marginTop: 6, lineHeight: 1.4 }}>자기·청중 평가 1:1 평균, 소수점 둘째 자리 반올림</div>
                                    </div>
                                </div>
                            </div>
                            {/* 발표 유형 해석 */}
                            <div style={{ flex: 1, border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column" }}>
                                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>발표 유형 해석</div>
                                <div style={{ fontSize: 8, color: "#9ca3af", marginBottom: 6 }}>삼각형의 형태는 세 영역의 균형을, 크기는 현재 발표 역량의 전체 수준을 의미합니다.</div>
                                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: "#111827" }}>
                                    {data.type ?? "분석 중"}
                                    {data.type === "강점 집중형" && <span style={{ color: "#3b82f6" }}> — {getStrongestDomain(data.combined_scores_by_domain)} 강점</span>}
                                    {data.type === "보완점 명확형" && <span style={{ color: "#f59e0b" }}> — {getWeakestDomain(data.combined_scores_by_domain)} 보완 필요</span>}
                                </div>
                                <p style={{ fontSize: 10, color: "#374151", margin: "0 0 8px 0", lineHeight: 1.6, flex: 1 }}>{typeInfo.detail}</p>
                                <div style={{ fontSize: 9, color: "#4b5563", background: "#fff1f2", borderRadius: 8, padding: "8px 10px", border: "1px solid #fecdd3", lineHeight: 1.5 }}>
                                    {typeInfo.action}
                                </div>
                            </div>
                        </div>

                        {/* ══ ROW 2: 영역별 단계 해석 | 자기 vs 청중 비교(바 그래프) ══ */}
                        <div style={{ display: "flex", gap: 14, marginBottom: 14, alignItems: "stretch", flex: 1 }}>
                            {/* 영역별 단계 해석 */}
                            <div style={{ flex: 1, border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column" }}>
                                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>영역별 단계 해석</div>
                                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                                    {DOMAINS.map(d => {
                                        const score = data.combined_scores_by_domain[d];
                                        const stage = getDomainStage(score);
                                        const desc = DOMAIN_STAGE_DESCRIPTIONS[d]?.[stage] ?? "";
                                        const barColor = DOMAIN_COLORS[d].bar;
                                        const pct = score != null ? (score / 5) * 100 : 0;
                                        return (
                                            <div key={d} style={{ flex: 1, padding: "6px 10px", border: `1px solid ${barColor}33`, borderRadius: 8, background: `${barColor}08` }}>
                                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, marginBottom: 2 }}>
                                                    <span style={{ fontWeight: 700, color: barColor }}>{DOMAIN_LABELS[d]} <span style={{ fontWeight: 600, color: "#6b7280", fontSize: 9 }}>{stage}</span></span>
                                                    <span style={{ fontWeight: 800, fontSize: 12 }}>{roundDisplay(score)}</span>
                                                </div>
                                                <div style={{ height: 4, background: "#e5e7eb", borderRadius: 2, overflow: "hidden", marginBottom: 3 }}>
                                                    <div style={{ height: "100%", width: `${pct}%`, background: barColor, borderRadius: 2 }} />
                                                </div>
                                                <div style={{ fontSize: 8, color: "#9ca3af", lineHeight: 1.3 }}>{desc}</div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                            {/* 자기 vs 청중 인식 비교 — 세로 바 그래프 */}
                            <div style={{ flex: 1, border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column" }}>
                                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>자기 vs 청중 인식 비교</div>
                                {/* 바 차트 영역 */}
                                <div style={{ flex: 1, display: "flex", justifyContent: "space-around", alignItems: "flex-end", padding: "0 6px 0", borderBottom: "1px solid #e5e7eb", marginBottom: 6, minHeight: 0 }}>
                                    {DOMAINS.map(d => {
                                        const s = data.self_scores_by_domain[d] ?? 0;
                                        const a = data.audience_scores_by_domain[d] ?? 0;
                                        const c = data.combined_scores_by_domain[d] ?? 0;
                                        return (
                                            <div key={d} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, height: "100%", justifyContent: "flex-end" }}>
                                                <div style={{ display: "flex", alignItems: "flex-end", gap: 4, flex: 1, paddingTop: 4 }}>
                                                    {[{ v: s, color: "#60a5fa" }, { v: a, color: "#f472b6" }, { v: c, color: "#6b7280" }].map((bar, i) => (
                                                        <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 28, height: "100%", justifyContent: "flex-end" }}>
                                                            <span style={{ fontSize: 8, fontWeight: 600, color: bar.color, marginBottom: 2 }}>{roundDisplay(bar.v)}</span>
                                                            <div style={{ width: "100%", height: `${(bar.v / 5) * 100}%`, background: bar.color, borderRadius: "4px 4px 0 0", minHeight: 3 }} />
                                                        </div>
                                                    ))}
                                                </div>
                                                <span style={{ fontSize: 10, fontWeight: 600, color: DOMAIN_COLORS[d].bar, paddingTop: 4, paddingBottom: 2 }}>{DOMAIN_LABELS[d]}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                                {/* 범례 + 인식 유형 */}
                                <div style={{ display: "flex", justifyContent: "center", gap: 12, marginBottom: 6, fontSize: 9 }}>
                                    {[{ l: "자기", c: "#60a5fa" }, { l: "청중", c: "#f472b6" }, { l: "종합", c: "#6b7280" }].map(x => (
                                        <div key={x.l} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                                            <div style={{ width: 8, height: 8, borderRadius: 2, background: x.c }} />
                                            <span style={{ color: "#6b7280" }}>{x.l}</span>
                                        </div>
                                    ))}
                                </div>
                                {perceptionType && (
                                    <div style={{ background: "#f9fafb", borderRadius: 6, padding: "6px 8px", border: "1px solid #e5e7eb" }}>
                                        <div style={{ fontSize: 10, fontWeight: 700, color: perceptionType.type === "overestimate" ? "#e11d48" : perceptionType.type === "underestimate" ? "#2563eb" : "#059669", marginBottom: 1 }}>{perceptionType.label}</div>
                                        <div style={{ fontSize: 8, color: "#6b7280", lineHeight: 1.3 }}>{perceptionType.description}</div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* ══ ROW 3: 성장 PLAN (3열) ══ */}
                        <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: "14px 16px", marginBottom: 12 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>성장 PLAN</div>
                            <div style={{ display: "flex", gap: 10 }}>
                                {DOMAINS.map(d => {
                                    const score = data.combined_scores_by_domain[d];
                                    return (
                                        <div key={d} style={{ flex: 1, background: `${DOMAIN_COLORS[d].bar}08`, border: `1px solid ${DOMAIN_COLORS[d].bar}33`, borderRadius: 8, padding: "8px 10px" }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
                                                <span style={{ background: DOMAIN_COLORS[d].bar, color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6 }}>{DOMAIN_LABELS[d]}</span>
                                                <span style={{ fontSize: 9, color: "#9ca3af" }}>{getDomainStage(score)}</span>
                                            </div>
                                            <div style={{ fontSize: 10, color: "#4b5563", lineHeight: 1.5 }}>{getGrowthPlan(d, score)}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* 푸터 */}
                        <div style={{ textAlign: "center", padding: "10px 0" }}>
                            <span style={{ fontSize: 12, color: "#f472b6", fontWeight: 500 }}>Bloom UP — 당신의 가능성을 꽃피우기 위해</span>
                            <span style={{ fontSize: 10, color: "#d1d5db", marginLeft: 10 }}>UnivPT</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
