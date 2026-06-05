import { useMemo } from "react";
import { BarChart3, TrendingUp, Users, Target, Crown, Sparkles, ArrowRight } from "lucide-react";
import { RadarChart } from "@/components/eval/RadarChart";
import {
    DOMAINS,
    DOMAIN_LABELS,
    DOMAIN_COLORS,
    DOMAIN_STAGE_DESCRIPTIONS,
    TYPE_DESCRIPTIONS,
    getDomainStage,
    roundDisplay,
    avg,
    getStrongestDomain,
    getWeakestDomain,
    getPerceptionType,
    TriangleIcon,
    Section,
} from "@/components/eval/GrowthReportContent";
// 주: STAGES 등 미사용 export는 import하지 않음
import {
    perceptionCode,
    getPerceptionTransition,
    QUESTION_BY_KEY,
    QUESTION_SUBTITLES,
    QUESTION_GROWTH_FEEDBACK,
    DOMAIN_COMMON_FEEDBACK,
    getLowestQuestionInDomain,
} from "@/constants/evalQuestions";

// ── Types ────────────────────────────────────────────────────────────────

export interface RoundScores {
    self_scores_by_domain: Record<string, number | null>;
    audience_scores_by_domain: Record<string, number | null>;
    combined_scores_by_domain: Record<string, number | null>;
    self_scores_by_question: Record<string, number | null>;
    audience_scores_by_question: Record<string, number | null>;
    stage: string | null;
    type: string | null;
}

export interface FinalGrowthReportProps {
    memberName: string;
    final: RoundScores;
    initial: RoundScores;
    growthReflection?: string | null;
    showTitle?: boolean;
    /** 맨 끝 "내가 발견한 성장"(성장 회고) 섹션 표시 여부 */
    showReflection?: boolean;
}

const PERCEPTION_BADGE: Record<string, string> = {
    A: "자기<청중",
    B: "자기=청중",
    C: "자기>청중",
};

function toTriple(scores: Record<string, number | null>) {
    return {
        PLANNING: scores.PLANNING ?? 0,
        DESIGN: scores.DESIGN ?? 0,
        SPEECH: scores.SPEECH ?? 0,
    };
}

// ══════════════════════════════════════════════════════════════════════════

export default function FinalGrowthReport({
    memberName,
    final,
    initial,
    growthReflection,
    showTitle = true,
    showReflection = true,
}: FinalGrowthReportProps) {
    const finalCombined = useMemo(() => toTriple(final.combined_scores_by_domain), [final]);
    const initialCombined = useMemo(() => toTriple(initial.combined_scores_by_domain), [initial]);

    // 성장량 + 가장 크게 성장한 영역(👑)
    const growth = useMemo(() => {
        const rows = DOMAINS.map((d) => ({
            d,
            init: initialCombined[d],
            fin: finalCombined[d],
            delta: finalCombined[d] - initialCombined[d],
        }));
        const crown = rows.reduce((a, b) => (b.delta > a.delta ? b : a)).d;
        return { rows, crown };
    }, [initialCombined, finalCombined]);

    // 종합 평균 (초기/후기) — 성장 요약용
    const summary = useMemo(() => {
        const vals = (s: Record<string, number>) => DOMAINS.map((d) => s[d]).filter((v) => v > 0);
        const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
        const oi = mean(vals(initialCombined));
        const of = mean(vals(finalCombined));
        return { overallInit: oi, overallFinal: of, delta: of - oi };
    }, [initialCombined, finalCombined]);

    // 인식 비교 (후기 기준 + 초기→후기 전환)
    const perception = useMemo(() => {
        const finSelf = avg(final.self_scores_by_domain);
        const finAud = avg(final.audience_scores_by_domain);
        const initSelf = avg(initial.self_scores_by_domain);
        const initAud = avg(initial.audience_scores_by_domain);
        const finPerc = getPerceptionType(finSelf, finAud);
        const initCode = perceptionCode(initSelf, initAud);
        const finCode = perceptionCode(finSelf, finAud);
        return { finPerc, initCode, finCode, transition: getPerceptionTransition(initCode, finCode) };
    }, [final, initial]);

    // 자기/청중 — 초기→후기(전후) 불릿 데이터 (후기=막대, 초기=기준선)
    const perceptionBars = useMemo(() =>
        DOMAINS.map((d) => ({
            d,
            자기: { si: initial.self_scores_by_domain[d] ?? 0, sf: final.self_scores_by_domain[d] ?? 0, color: "#3b82f6" },
            청중: { si: initial.audience_scores_by_domain[d] ?? 0, sf: final.audience_scores_by_domain[d] ?? 0, color: "#ec4899" },
        })), [initial, final]);

    const finalType = final.type ?? "균형형";
    const typeInfo = TYPE_DESCRIPTIONS[finalType] ?? TYPE_DESCRIPTIONS["균형형"];

    return (
        <>
            {/* ─── Title ─── */}
            {showTitle && (
                <div className="rounded-2xl bg-gradient-to-br from-rose-500 via-rose-500 to-pink-600 p-6 text-white shadow-xl shadow-rose-500/25 relative overflow-hidden">
                    <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/10" />
                    <div className="absolute -bottom-4 -left-4 w-20 h-20 rounded-full bg-white/5" />
                    <div className="absolute top-4 right-4">
                        <span className="px-2.5 py-1 rounded-full bg-white/20 backdrop-blur-sm text-[10px] font-bold tracking-wide">
                            후기 분석지
                        </span>
                    </div>
                    <div className="relative">
                        <p className="text-[11px] font-semibold text-rose-200 tracking-widest mb-2">UnivPT 33기</p>
                        <h2 className="text-xl font-extrabold leading-tight">{memberName}님의 발표 성장 리포트</h2>
                        <p className="text-xs text-rose-100 mt-2 leading-[1.8]">
                            처음의 나와 지금의 나를 비교하며, 그동안의 성장을 확인해 보세요.
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-4">
                            {DOMAINS.map((d) => {
                                const badgeBg = d === "PLANNING" ? "bg-blue-500" : d === "DESIGN" ? "bg-emerald-500" : "bg-amber-500";
                                return (
                                    <span key={d} className={`px-3 py-1 rounded-full ${badgeBg} text-white text-xs font-bold shadow-sm whitespace-nowrap`}>
                                        {d === growth.crown && "👑 "}
                                        [{DOMAIN_LABELS[d]}] {getDomainStage(finalCombined[d])}
                                    </span>
                                );
                            })}
                            {final.type && (
                                <span className="px-3 py-1 rounded-full bg-white text-rose-600 text-xs font-bold shadow-sm">
                                    {final.type}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ─── 성장 요약 (Hero) ─── */}
            <div className="rounded-2xl border border-rose-100 bg-gradient-to-br from-rose-50 via-pink-50/60 to-white p-5 sm:p-6 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                    <Sparkles className="w-4 h-4 text-rose-500" />
                    <h3 className="text-sm font-bold text-gray-900">성장 요약</h3>
                    <span className="ml-auto px-2.5 py-1 rounded-full bg-rose-500 text-white text-[11px] font-bold shadow-sm">
                        {perception.transition.name}
                    </span>
                </div>

                {/* 종합 점수 초기 → 후기 */}
                <div className="flex items-center justify-center gap-4 sm:gap-6 mb-4">
                    <div className="text-center">
                        <p className="text-[11px] font-semibold text-slate-400 mb-0.5">초기</p>
                        <p className="text-2xl font-extrabold text-slate-400 tabular-nums">{roundDisplay(summary.overallInit)}</p>
                    </div>
                    <div className="flex flex-col items-center">
                        <ArrowRight className="w-6 h-6 text-rose-400" />
                        {summary.delta !== 0 && (
                            <span className={`mt-1 px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums ${summary.delta > 0 ? "bg-rose-100 text-rose-600" : "bg-slate-100 text-slate-500"}`}>
                                {summary.delta > 0 ? "▲" : "▼"} {Math.abs(summary.delta).toFixed(1)}
                            </span>
                        )}
                    </div>
                    <div className="text-center">
                        <p className="text-[11px] font-semibold text-rose-500 mb-0.5">후기</p>
                        <p className="text-3xl font-extrabold text-rose-600 tabular-nums">{roundDisplay(summary.overallFinal)}</p>
                    </div>
                </div>

                {/* 요약 칩 */}
                <div className="flex flex-wrap items-center justify-center gap-2">
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white border border-amber-200 text-amber-700 text-xs font-semibold">
                        <Crown className="w-3.5 h-3.5" /> 가장 성장한 영역 · <b className="font-extrabold">{DOMAIN_LABELS[growth.crown]}</b>
                    </span>
                    <span className="inline-flex items-center px-3 py-1 rounded-full bg-white border border-gray-200 text-gray-600 text-xs font-semibold">
                        {initial.type ?? "—"} → <span className="text-rose-600 ml-1 font-bold">{final.type ?? "—"}</span>
                    </span>
                </div>
                <p className="text-center text-xs text-gray-500 mt-3 leading-[1.7] [word-break:keep-all]">
                    {perception.transition.oneLiner}
                </p>
            </div>

            {/* ─── 1. 방사형 그래프 (초기·후기 오버레이) ─── */}
            <Section title="발표 역량 방사형 그래프" icon={<BarChart3 className="w-4 h-4 text-rose-500" />} delay={0.05}>
                <RadarChart selfScores={finalCombined} compareScores={initialCombined} size={460} variant="light" />
                <div className="flex items-center justify-center gap-5 mb-3 -mt-1">
                    <div className="flex items-center gap-1.5">
                        <div className="w-4 h-0.5 bg-rose-500" />
                        <span className="text-xs text-gray-500">후기</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-4 h-0 border-t-2 border-dashed border-slate-400" />
                        <span className="text-xs text-gray-500">초기</span>
                    </div>
                </div>
                <p className="text-xs text-gray-400 leading-[1.7] mb-1 [word-break:keep-all] text-pretty">
                    초기와 후기의 발표 역량을 겹쳐 표시했습니다.
                </p>
                <p className="text-xs text-gray-400 leading-[1.7] mb-4 [word-break:keep-all] text-pretty">
                    아래 표는 후기 평가 기준(자기·청중)이며, 소수점 둘째 자리에서 반올림됩니다.
                </p>
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
                                const colors = DOMAIN_COLORS[domain];
                                return (
                                    <tr key={domain} className="border-t border-gray-100">
                                        <td className={`py-2.5 px-3 font-bold ${colors.text}`}>{DOMAIN_LABELS[domain]}</td>
                                        <td className="py-2.5 px-3 text-center tabular-nums text-gray-700 font-medium">{roundDisplay(final.self_scores_by_domain[domain])}</td>
                                        <td className="py-2.5 px-3 text-center tabular-nums text-gray-700 font-medium">{roundDisplay(final.audience_scores_by_domain[domain])}</td>
                                        <td className="py-2.5 px-3 text-center tabular-nums text-gray-900 font-extrabold">{roundDisplay(final.combined_scores_by_domain[domain])}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </Section>

            {/* ─── 2. 발표 유형 해석 ─── */}
            <Section title="발표 유형 해석 — 변화" icon={<Target className="w-4 h-4 text-rose-500" />} delay={0.1}>
                <div className="flex items-center justify-center gap-3 mb-4">
                    <span className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-500 text-sm font-bold">{initial.type ?? "분석 중"}</span>
                    <ArrowRight className="w-5 h-5 text-rose-400" />
                    <span className="px-3 py-1.5 rounded-lg bg-rose-50 text-rose-600 text-sm font-bold ring-1 ring-rose-200">{final.type ?? "분석 중"}</span>
                </div>
                <div className="flex items-center justify-center gap-6 sm:gap-12 mb-5">
                    {(["균형형", "강점 집중형", "보완점 명확형"] as const).map((t) => {
                        const isActive = final.type === t;
                        const emoji = t === "균형형" ? "triangle-balanced" : t === "강점 집중형" ? "triangle-strong" : "triangle-growth";
                        return (
                            <div key={t} className={`flex flex-col items-center gap-2 px-3 py-3 rounded-xl transition-all ${isActive ? "bg-gray-50 ring-2 ring-rose-200" : "opacity-40"}`}>
                                <TriangleIcon type={emoji} size={72} />
                                <span className={`text-xs font-semibold ${isActive ? "text-gray-900" : "text-gray-400"}`}>{t}</span>
                            </div>
                        );
                    })}
                </div>
                <div className="rounded-xl bg-gradient-to-br from-gray-50 to-white border border-gray-100 p-4">
                    <p className="text-sm font-bold text-gray-900 mb-2">
                        {final.type ?? "분석 중"}
                        {final.type === "강점 집중형" && <span className="text-blue-600 ml-1">— {getStrongestDomain(final.combined_scores_by_domain)} 강점</span>}
                        {final.type === "보완점 명확형" && <span className="text-amber-600 ml-1">— {getWeakestDomain(final.combined_scores_by_domain)} 보완 필요</span>}
                    </p>
                    <p className="text-xs text-gray-600 leading-[1.8] mb-3 [word-break:keep-all] text-pretty">{typeInfo.detail}</p>
                    <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50/50 border border-rose-100">
                        <TrendingUp className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
                        <p className="text-xs text-gray-700 leading-[1.8] font-medium [word-break:keep-all] text-pretty">{typeInfo.action}</p>
                    </div>
                </div>
            </Section>

            {/* ─── 3. 영역별 단계 해석 (초기 → 후기) ─── */}
            <Section title="영역별 단계 해석 — 초기 vs 후기 변화" icon={<TrendingUp className="w-4 h-4 text-rose-500" />} delay={0.15}>
                <p className="text-[11px] text-gray-400 mb-4 [word-break:keep-all]">
                    각 영역의 종합 점수(자기·청중 평균)가 초기에서 후기로 어떻게 변화했는지 보여줍니다. 가장 크게 성장한 영역에는 👑 표시가 있습니다.
                </p>
                <div className="space-y-4">
                    {growth.rows.map(({ d, init, fin, delta }) => {
                        const colors = DOMAIN_COLORS[d];
                        const initStage = getDomainStage(init);
                        const finStage = getDomainStage(fin);
                        const isCrown = d === growth.crown && delta > 0;
                        const initPct = (init / 5) * 100;
                        const finPct = (fin / 5) * 100;
                        return (
                            <div key={d} className={`rounded-xl border ${colors.border} ${colors.bg} p-4`}>
                                {/* 도메인 + 👑 + 단계 전환 pill(오른쪽) 한 줄 */}
                                <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className={`text-sm font-bold ${colors.text}`}>{DOMAIN_LABELS[d]}</span>
                                        {isCrown && (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">
                                                <Crown className="w-3 h-3" /> 가장 크게 성장
                                            </span>
                                        )}
                                        <span className="inline-flex items-center gap-1.5">
                                            <span className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-slate-500 text-xs font-semibold whitespace-nowrap">{initStage}</span>
                                            <ArrowRight className="w-4 h-4 text-rose-400 shrink-0" />
                                            <span className={`px-2.5 py-1 rounded-lg ${colors.bg} ${colors.text} border ${colors.border} text-xs font-bold whitespace-nowrap`}>{finStage}</span>
                                        </span>
                                    </div>
                                    <span className={`text-xs font-bold tabular-nums ${delta > 0 ? "text-rose-500" : delta < 0 ? "text-slate-400" : "text-gray-400"}`}>
                                        {delta > 0 ? "▲" : delta < 0 ? "▼" : "–"} {Math.abs(delta).toFixed(1)}
                                    </span>
                                </div>

                                {/* 덤벨: 초기(빈 점) ──→ 후기(찬 점), 0~5 축 위 이동 */}
                                <div className="relative mb-3" style={{ height: 46, marginTop: 6 }}>
                                    {/* 기준 트랙 */}
                                    <div className="absolute left-0 right-0 rounded-full bg-gray-200" style={{ top: 21, height: 6 }} />
                                    {/* 변화 구간 */}
                                    <div className="absolute rounded-full" style={{ top: 21, height: 6, left: `${Math.min(initPct, finPct)}%`, width: `${Math.abs(finPct - initPct)}%`, backgroundColor: delta >= 0 ? colors.bar : "#cbd5e1", opacity: 0.45 }} />
                                    {/* 후기 값(위) */}
                                    <span className="absolute text-[10px] font-bold tabular-nums whitespace-nowrap" style={{ left: `${finPct}%`, top: 0, transform: "translateX(-50%)", color: colors.bar }}>후기 {roundDisplay(fin)}</span>
                                    {/* 초기 값(아래) */}
                                    <span className="absolute text-[10px] tabular-nums text-slate-400 whitespace-nowrap" style={{ left: `${initPct}%`, bottom: 0, transform: "translateX(-50%)" }}>초기 {roundDisplay(init)}</span>
                                    {/* 초기 점(빈) */}
                                    <div className="absolute w-3.5 h-3.5 rounded-full bg-white border-2 border-slate-400" style={{ left: `${initPct}%`, top: 17, transform: "translateX(-50%)" }} />
                                    {/* 후기 점(찬) */}
                                    <div className="absolute w-4 h-4 rounded-full border-2 border-white shadow" style={{ left: `${finPct}%`, top: 16, transform: "translateX(-50%)", backgroundColor: colors.bar }} />
                                </div>

                                {/* 단계 설명 — 단계가 같으면 한 번만, 다르면 초기·후기 둘 다 */}
                                <div className="space-y-1.5">
                                    {initStage === finStage ? (
                                        DOMAIN_STAGE_DESCRIPTIONS[d]?.[finStage] && (
                                            <p className="text-xs text-gray-600 leading-[1.7] [word-break:keep-all] text-pretty">
                                                <span className={`font-semibold ${colors.text}`}>{finStage}</span> — {DOMAIN_STAGE_DESCRIPTIONS[d][finStage]}
                                            </p>
                                        )
                                    ) : (
                                        <>
                                            {DOMAIN_STAGE_DESCRIPTIONS[d]?.[initStage] && (
                                                <p className="text-xs text-gray-400 leading-[1.7] [word-break:keep-all] text-pretty">
                                                    <span className="font-semibold text-slate-400">초기 · {initStage}</span> — {DOMAIN_STAGE_DESCRIPTIONS[d][initStage]}
                                                </p>
                                            )}
                                            {DOMAIN_STAGE_DESCRIPTIONS[d]?.[finStage] && (
                                                <p className="text-xs text-gray-600 leading-[1.7] [word-break:keep-all] text-pretty">
                                                    <span className={`font-semibold ${colors.text}`}>후기 · {finStage}</span> — {DOMAIN_STAGE_DESCRIPTIONS[d][finStage]}
                                                </p>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </Section>

            {/* ─── 4. 자기 vs 청중 인식 비교 ─── */}
            <Section title="자기 vs 청중 인식 비교" icon={<Users className="w-4 h-4 text-rose-500" />} delay={0.2}>
                {/* 자기/청중 — 막대 바깥에 숫자(후기 진한색 위 · 초기 회색 아래), 자기=왼쪽 청중=오른쪽 */}
                <div className="flex items-stretch justify-around gap-2 mb-2">
                    {perceptionBars.map(({ d, 자기, 청중 }) => {
                        const metrics = [{ label: "자기", side: "left" as const, textCls: "text-blue-600", ...자기 }, { label: "청중", side: "right" as const, textCls: "text-pink-600", ...청중 }];
                        return (
                            <div key={d} className="flex-1 flex flex-col items-center">
                                <div className="flex items-end justify-center gap-7 w-full border-b border-gray-200" style={{ height: 140, paddingTop: 18 }}>
                                    {metrics.map((m) => (
                                        <div key={m.label} className="relative flex items-end justify-center" style={{ height: "100%", width: 24 }}>
                                            {/* 초기(회색·넓은) */}
                                            <div className="absolute bottom-0 left-1/2 rounded-t" style={{ width: 24, height: `${(m.si / 5) * 100}%`, backgroundColor: "#cbd5e1", transform: "translateX(-50%)" }} />
                                            {/* 후기(색상·좁은) */}
                                            <div className="absolute bottom-0 left-1/2 rounded-t" style={{ width: 11, height: `${(m.sf / 5) * 100}%`, backgroundColor: m.color, transform: "translateX(-50%)" }} />
                                            {/* 숫자 스택: 후기(위)·초기(아래), 막대 바깥쪽 */}
                                            <div
                                                className="absolute flex flex-col items-center leading-tight tabular-nums"
                                                style={{ bottom: `${(m.sf / 5) * 100}%`, transform: "translateY(45%)", [m.side === "left" ? "right" : "left"]: "100%", paddingLeft: m.side === "right" ? 3 : 0, paddingRight: m.side === "left" ? 3 : 0 }}
                                            >
                                                <span className="text-[11px] font-bold" style={{ color: m.color }}>{roundDisplay(m.sf)}</span>
                                                <span className="text-[10px] text-gray-400">{roundDisplay(m.si)}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex justify-center gap-7 w-full mt-1.5">
                                    {metrics.map((m) => (
                                        <span key={m.label} className={`text-[11px] font-semibold text-center ${m.textCls}`} style={{ width: 24 }}>{m.label}</span>
                                    ))}
                                </div>
                                <span className="text-xs font-bold mt-1.5" style={{ color: DOMAIN_COLORS[d].bar }}>{DOMAIN_LABELS[d]}</span>
                            </div>
                        );
                    })}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mb-1">
                    <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-slate-300" /><span className="text-xs text-gray-500">초기</span></div>
                    <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-blue-500" /><span className="text-xs text-gray-500">후기 · 자기</span></div>
                    <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-pink-500" /><span className="text-xs text-gray-500">후기 · 청중</span></div>
                </div>
                <p className="text-xs text-gray-400 mb-4 text-center [word-break:keep-all]">※ 회색 막대 = 초기, 색상 막대 = 후기 · 숫자(위 후기 / 아래 초기)</p>

                {/* 후기 기준 */}
                <div className="rounded-xl bg-gradient-to-br from-gray-50 to-white border border-gray-100 p-4 mb-4">
                    <p className="text-[11px] font-bold text-gray-400 mb-2">후기 기준</p>
                    <p className={`text-sm font-bold mb-2 ${perception.finPerc.color}`}>{perception.finPerc.label}</p>
                    <p className="text-sm text-gray-600 leading-[2.0] [word-break:keep-all] text-pretty mb-3">{perception.finPerc.description}</p>
                    <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                        <p className="text-xs font-bold text-gray-500 mb-1.5">피드백</p>
                        <p className="text-sm text-gray-700 leading-[2.0] [word-break:keep-all] text-pretty">{perception.finPerc.feedback}</p>
                    </div>
                </div>

                {/* 초기 → 후기 전환 */}
                <div className="rounded-xl bg-gradient-to-br from-rose-50 to-pink-50 border border-rose-100 p-4">
                    <div className="flex items-center justify-center gap-3 mb-3">
                        <span className="px-2.5 py-1 rounded-lg bg-white/70 text-slate-500 text-xs font-bold">초기 {PERCEPTION_BADGE[perception.initCode]}</span>
                        <ArrowRight className="w-4 h-4 text-rose-400" />
                        <span className="px-2.5 py-1 rounded-lg bg-white text-rose-600 text-xs font-bold ring-1 ring-rose-200">후기 {PERCEPTION_BADGE[perception.finCode]}</span>
                    </div>
                    <p className="text-center text-base font-extrabold text-gray-900 mb-1">{perception.transition.name}</p>
                    <p className="text-center text-xs text-rose-500 font-medium mb-3 [word-break:keep-all]">{perception.transition.oneLiner}</p>
                    <p className="text-sm text-gray-700 leading-[2.0] [word-break:keep-all] text-pretty">{perception.transition.body}</p>
                </div>
            </Section>

            {/* ─── 5. 성장 PLAN (멘토링 제외) ─── */}
            <Section title="성장 PLAN" icon={<TrendingUp className="w-4 h-4 text-rose-500" />} delay={0.25}>
                <div className="space-y-6">
                    {DOMAINS.map((domain) => {
                        const lowestKey = getLowestQuestionInDomain(domain, final.self_scores_by_question, final.audience_scores_by_question);
                        const questionInfo = lowestKey ? QUESTION_BY_KEY[lowestKey] : null;
                        const subtitle = lowestKey ? QUESTION_SUBTITLES[lowestKey] : null;
                        const feedback = lowestKey ? QUESTION_GROWTH_FEEDBACK[lowestKey] : null;
                        const common = DOMAIN_COMMON_FEEDBACK[domain];
                        const colors = DOMAIN_COLORS[domain];
                        return (
                            <div key={domain} className={`rounded-xl border ${colors.border} overflow-hidden`}>
                                <div className={`flex items-center gap-2.5 px-5 py-3 ${colors.bg}`}>
                                    <span className={`px-3 py-1 rounded-lg text-xs font-bold text-white ${domain === "PLANNING" ? "bg-blue-500" : domain === "DESIGN" ? "bg-emerald-500" : "bg-amber-500"}`}>
                                        {DOMAIN_LABELS[domain]}
                                    </span>
                                    <span className="text-xs text-gray-500 font-medium">{getDomainStage(final.combined_scores_by_domain[domain])}</span>
                                </div>
                                <div className="px-5 py-4 space-y-4 bg-white">
                                    {questionInfo && subtitle && feedback && (
                                        <div>
                                            <p className={`text-sm font-bold mb-3 ${colors.text}`}>[{questionInfo.label} : {subtitle}]</p>
                                            <div className="space-y-3">
                                                {feedback.split("\n\n").map((paragraph, i) =>
                                                    i === 0 ? (
                                                        <p key={i} className="text-sm text-gray-500 leading-[2.0] [word-break:keep-all] text-pretty">{paragraph}</p>
                                                    ) : (
                                                        <div key={i} className={`border-l-[3px] ${colors.border} pl-4 py-1`}>
                                                            <p className="text-sm text-gray-700 leading-[2.0] [word-break:keep-all] text-pretty">{paragraph}</p>
                                                        </div>
                                                    )
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    {/* 후기: '1:N 운영진 멘토링' 블록은 표시하지 않음 */}
                                    {common && common.tips.length > 0 && (
                                        <div>
                                            <p className="text-sm font-bold text-gray-800 mb-3">📌 그 외 꿀팁</p>
                                            <div className="space-y-3">
                                                {common.tips.map((tip, i) => (
                                                    <div key={i} className="rounded-lg bg-gray-50 border border-gray-100 p-4">
                                                        <p className="text-sm font-bold text-gray-800 mb-2">{tip.title}</p>
                                                        <p className="text-sm text-gray-600 leading-[2.0] [word-break:keep-all] text-pretty">{tip.body}</p>
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

            {/* ─── 6. 내가 발견한 성장 (성장 회고) ─── */}
            {showReflection && growthReflection && growthReflection.trim() && (
                <Section title="내가 발견한 성장" icon={<Sparkles className="w-4 h-4 text-rose-500" />} delay={0.3}>
                    <div className="text-sm text-gray-600 leading-[2.0] space-y-3 [word-break:keep-all] text-pretty mb-4">
                        <p>앞선 결과가 발표 역량의 변화를 보여주는 보다 <strong className="text-gray-800">객관적인 성장 기록</strong>이라면, 아래 내용은 여러분이 직접 체감한 <strong className="text-gray-800">주관적인 성장 기록</strong>입니다.</p>
                        <p>유니브피티에서의 발표 경험, 피드백, 팀 활동, 그리고 수많은 연습 과정 속에서 여러분은 각자의 방식으로 성장해 왔습니다. <strong className="text-gray-800">성장은 언제나 점수로만 설명되는 것은 아닙니다.</strong></p>
                        <p>발표를 준비하며 고민했던 시간, 팀원들과 의견을 나누었던 순간, 용기를 내어 사람들 앞에 섰던 경험 하나하나가 여러분만의 성장으로 쌓여 왔습니다.</p>
                        <p>객관적인 성장과 주관적인 성장이 만나는 지점에서 <strong className="text-rose-600">진짜 변화가 시작</strong>됩니다. 유니브피티를 통해 <strong className="text-gray-800">스스로 발견한 가장 큰 성장의 순간</strong>을 확인해 보세요.</p>
                    </div>
                    <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-5">
                        <p className="text-[11px] text-gray-400 mb-2">유니브피티 활동을 통해 가장 크게 성장했다고 느끼는 점</p>
                        <p className="text-sm text-gray-700 leading-[1.9] whitespace-pre-wrap [word-break:keep-all]">{growthReflection}</p>
                    </div>
                </Section>
            )}
        </>
    );
}
