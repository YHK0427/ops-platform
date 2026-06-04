import type { RefObject } from "react";
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
} from "@/components/eval/GrowthReportContent";
import {
    perceptionCode,
    getPerceptionTransition,
    QUESTION_BY_KEY,
    QUESTION_SUBTITLES,
    QUESTION_GROWTH_FEEDBACK,
    DOMAIN_COMMON_FEEDBACK,
    getLowestQuestionInDomain,
} from "@/constants/evalQuestions";
import type { RoundScores } from "@/components/eval/FinalGrowthReport";

interface Props {
    memberName: string;
    final: RoundScores;
    initial: RoundScores;
    growthReflection?: string | null;
    page1Ref: RefObject<HTMLDivElement | null>;
    page2Ref: RefObject<HTMLDivElement | null>;
}

// 고정 높이 없이 콘텐츠 높이로 — PDF에서 페이지를 콘텐츠 크기에 맞춰 생성(빈 공간 제거)
const PAGE: React.CSSProperties = {
    width: 860,
    padding: "16px 18px",
    background: "#fff",
    fontFamily: "system-ui, sans-serif",
    color: "#1f2937",
    display: "flex",
    flexDirection: "column",
    position: "relative",
    overflow: "hidden",
};

function triple(s: Record<string, number | null>) {
    return { PLANNING: s.PLANNING ?? 0, DESIGN: s.DESIGN ?? 0, SPEECH: s.SPEECH ?? 0 };
}
function mean(s: Record<string, number>) {
    const v = DOMAINS.map((d) => s[d]).filter((x) => x > 0);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}

export default function FinalReportPdf({ memberName, final, initial, growthReflection, page1Ref, page2Ref }: Props) {
    const finC = triple(final.combined_scores_by_domain);
    const iniC = triple(initial.combined_scores_by_domain);
    const overallI = mean(iniC);
    const overallF = mean(finC);

    const rows = DOMAINS.map((d) => ({ d, init: iniC[d], fin: finC[d], delta: finC[d] - iniC[d] }));
    const crown = rows.reduce((a, b) => (b.delta > a.delta ? b : a)).d;

    const finCode = perceptionCode(avg(final.self_scores_by_domain), avg(final.audience_scores_by_domain));
    const iniCode = perceptionCode(avg(initial.self_scores_by_domain), avg(initial.audience_scores_by_domain));
    const transition = getPerceptionTransition(iniCode, finCode);
    const finPerc = getPerceptionType(avg(final.self_scores_by_domain), avg(final.audience_scores_by_domain));
    const finalType = final.type ?? "균형형";
    const typeInfo = TYPE_DESCRIPTIONS[finalType] ?? TYPE_DESCRIPTIONS["균형형"];
    const PCODE: Record<string, string> = { A: "자기<청중", B: "자기=청중", C: "자기>청중" };

    return (
        <>
            {/* ════════ PAGE 1 ════════ */}
            <div ref={page1Ref} style={PAGE}>
                <div style={{ position: "absolute", top: -50, left: -50, width: 180, height: 180, borderRadius: "50%", background: "linear-gradient(135deg, #fce7f3, #fdf2f8)", opacity: 0.5 }} />
                <div style={{ position: "absolute", bottom: -40, right: -40, width: 160, height: 160, borderRadius: "50%", background: "linear-gradient(135deg, #eff6ff, #dbeafe)", opacity: 0.4 }} />

                {/* 제목 카드 */}
                <div style={{ background: "linear-gradient(135deg, #f43f5e, #ec4899)", borderRadius: 12, padding: "16px 22px", color: "#fff", marginBottom: 12, position: "relative" }}>
                    <span style={{ position: "absolute", top: 14, right: 16, fontSize: 10, background: "rgba(255,255,255,0.2)", padding: "3px 10px", borderRadius: 10, fontWeight: 600 }}>후기 분석지</span>
                    <div style={{ fontSize: 11, opacity: 0.7, letterSpacing: 2, fontWeight: 600 }}>UnivPT 33기</div>
                    <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{memberName}님의 발표 성장 리포트</div>
                    <div style={{ fontSize: 11, opacity: 0.85, marginTop: 4 }}>처음의 나와 지금의 나를 비교하며, 그동안의 성장을 확인해 보세요.</div>
                    <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                        {DOMAINS.map((d) => (
                            <span key={d} style={{ background: d === "PLANNING" ? "#3b82f6" : d === "DESIGN" ? "#10b981" : "#f59e0b", color: "#fff", fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 10 }}>
                                {d === crown ? "👑 " : ""}[{DOMAIN_LABELS[d]}] {getDomainStage(finC[d])}
                            </span>
                        ))}
                        {final.type && <span style={{ background: "#fff", color: "#e11d48", fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 10 }}>{final.type}</span>}
                    </div>
                </div>

                {/* 성장 요약 */}
                <div style={{ background: "#fff1f3", border: "1px solid #fecdd3", borderRadius: 10, padding: "10px 16px", marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#9f1239" }}>성장 요약</span>
                        <span style={{ fontSize: 13 }}>
                            <span style={{ color: "#94a3b8", fontWeight: 700 }}>{roundDisplay(overallI)}</span>
                            <span style={{ color: "#f43f5e", margin: "0 6px" }}>→</span>
                            <span style={{ color: "#e11d48", fontWeight: 800 }}>{roundDisplay(overallF)}</span>
                        </span>
                        <span style={{ fontSize: 11, color: "#6b7280" }}>· 가장 성장 <b style={{ color: "#b45309" }}>{DOMAIN_LABELS[crown]}</b></span>
                        <span style={{ marginLeft: "auto", background: "#f43f5e", color: "#fff", fontSize: 11, fontWeight: 700, padding: "3px 12px", borderRadius: 10 }}>{transition.name}</span>
                    </div>
                    <div style={{ fontSize: 10, color: "#9f1239", marginTop: 5 }}>{transition.oneLiner}</div>
                </div>

                {/* ROW 1: 레이더+표 | 유형 변화 */}
                <div style={{ display: "flex", gap: 14, marginBottom: 12 }}>
                    <div style={{ flex: 1, border: "1px solid #e5e7eb", borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, alignSelf: "flex-start" }}>발표 역량 방사형 그래프</div>
                        <div style={{ width: 210, height: 210, flexShrink: 0 }}>
                            <RadarChart selfScores={finC} compareScores={iniC} size={210} variant="light" />
                        </div>
                        <div style={{ display: "flex", gap: 14, fontSize: 9, color: "#6b7280", margin: "2px 0 6px" }}>
                            <span>━ 후기</span><span style={{ color: "#94a3b8" }}>┄ 초기</span>
                        </div>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                            <thead><tr style={{ background: "#f9fafb" }}>
                                {["영역", "자기", "청중", "종합"].map((h) => <th key={h} style={{ padding: "4px 6px", textAlign: h === "영역" ? "left" : "center", fontWeight: 600, borderBottom: "1px solid #e5e7eb", fontSize: 10 }}>{h}</th>)}
                            </tr></thead>
                            <tbody>{DOMAINS.map((d) => (
                                <tr key={d}>
                                    <td style={{ padding: "4px 6px", fontWeight: 700, color: DOMAIN_COLORS[d].bar }}>{DOMAIN_LABELS[d]}</td>
                                    <td style={{ padding: "4px 6px", textAlign: "center" }}>{roundDisplay(final.self_scores_by_domain[d])}</td>
                                    <td style={{ padding: "4px 6px", textAlign: "center" }}>{roundDisplay(final.audience_scores_by_domain[d])}</td>
                                    <td style={{ padding: "4px 6px", textAlign: "center", fontWeight: 800 }}>{roundDisplay(final.combined_scores_by_domain[d])}</td>
                                </tr>
                            ))}</tbody>
                        </table>
                        <div style={{ fontSize: 8, color: "#9ca3af", marginTop: 4, alignSelf: "flex-start" }}>표는 후기 평가 기준 · 자기·청중 1:1 평균</div>
                    </div>

                    <div style={{ flex: 1, border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>발표 유형 해석 — 변화</div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 10 }}>
                            <span style={{ background: "#f1f5f9", color: "#64748b", fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 8 }}>{initial.type ?? "—"}</span>
                            <span style={{ color: "#f43f5e", fontWeight: 700 }}>→</span>
                            <span style={{ background: "#fff1f3", color: "#e11d48", fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 8, border: "1px solid #fecdd3" }}>{final.type ?? "—"}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "center", gap: 22, marginBottom: 8 }}>
                            {([["균형형", "#10b981"], ["강점 집중형", "#3b82f6"], ["보완점 명확형", "#f59e0b"]] as const).map(([t, c]) => {
                                const active = final.type === t;
                                return (
                                    <div key={t} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, opacity: active ? 1 : 0.3 }}>
                                        <svg width="42" height="42" viewBox="0 0 48 48">
                                            {t === "균형형" ? <polygon points="24,6 42,38 6,38" fill={`${c}22`} stroke={c} strokeWidth="2" /> : t === "강점 집중형" ? <polygon points="24,3 30,38 18,38" fill={`${c}22`} stroke={c} strokeWidth="2" /> : <polygon points="24,22 44,42 4,42" fill={`${c}22`} stroke={c} strokeWidth="2" />}
                                        </svg>
                                        <span style={{ fontSize: 9, fontWeight: active ? 700 : 500, color: active ? "#111827" : "#9ca3af" }}>{t}</span>
                                    </div>
                                );
                            })}
                        </div>
                        <div style={{ background: "#f9fafb", borderRadius: 8, padding: "8px 10px", marginBottom: 6, border: "1px solid #f3f4f6" }}>
                            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                                {final.type ?? "분석 중"}
                                {final.type === "강점 집중형" && <span style={{ color: "#3b82f6" }}> — {getStrongestDomain(final.combined_scores_by_domain)} 강점</span>}
                                {final.type === "보완점 명확형" && <span style={{ color: "#f59e0b" }}> — {getWeakestDomain(final.combined_scores_by_domain)} 보완 필요</span>}
                            </div>
                            <p style={{ fontSize: 9, color: "#374151", margin: 0, lineHeight: 1.6 }}>{typeInfo.detail}</p>
                        </div>
                        <div style={{ fontSize: 9, color: "#4b5563", background: "#fff1f2", borderRadius: 8, padding: "8px 10px", border: "1px solid #fecdd3", lineHeight: 1.5 }}>{typeInfo.action}</div>
                    </div>
                </div>

                {/* ROW 2: 단계 변화 | 자기 vs 청중 */}
                <div style={{ display: "flex", gap: 14 }}>
                    <div style={{ flex: 1, border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column" }}>
                        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>영역별 단계 해석 — 초기 vs 후기</div>
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 10 }}>
                            {rows.map(({ d, init, fin, delta }) => {
                                const bc = DOMAIN_COLORS[d].bar;
                                const iStage = getDomainStage(init);
                                const fStage = getDomainStage(fin);
                                return (
                                    <div key={d} style={{ padding: "6px 10px", border: `1px solid ${bc}33`, borderRadius: 8, background: `${bc}08` }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                                            <span style={{ fontSize: 11, fontWeight: 700, color: bc }}>{DOMAIN_LABELS[d]} {d === crown && delta > 0 ? "👑" : ""}</span>
                                            <span style={{ fontSize: 10 }}>
                                                <span style={{ color: "#94a3b8" }}>{iStage}</span>
                                                <span style={{ color: "#f43f5e", margin: "0 4px" }}>→</span>
                                                <span style={{ fontWeight: 800, color: bc }}>{fStage}</span>
                                            </span>
                                        </div>
                                        {/* 덤벨: 초기(빈 점) ──→ 후기(찬 점) — 웹과 동일 */}
                                        <div style={{ position: "relative", height: 38, marginBottom: 3 }}>
                                            <div style={{ position: "absolute", left: 0, right: 0, top: 18, height: 5, background: "#f1f5f9", borderRadius: 3 }} />
                                            <div style={{ position: "absolute", top: 18, height: 5, borderRadius: 3, left: `${Math.min((init / 5) * 100, (fin / 5) * 100)}%`, width: `${Math.abs((fin - init) / 5) * 100}%`, background: delta >= 0 ? bc : "#cbd5e1", opacity: 0.45 }} />
                                            <span style={{ position: "absolute", left: `${(fin / 5) * 100}%`, top: 0, transform: "translateX(-50%)", fontSize: 9, fontWeight: 700, color: bc, whiteSpace: "nowrap" }}>후기 {roundDisplay(fin)}</span>
                                            <span style={{ position: "absolute", left: `${(init / 5) * 100}%`, bottom: 0, transform: "translateX(-50%)", fontSize: 9, color: "#94a3b8", whiteSpace: "nowrap" }}>초기 {roundDisplay(init)}</span>
                                            <div style={{ position: "absolute", left: `${(init / 5) * 100}%`, top: 14, transform: "translateX(-50%)", width: 12, height: 12, borderRadius: "50%", background: "#fff", border: "2px solid #94a3b8" }} />
                                            <div style={{ position: "absolute", left: `${(fin / 5) * 100}%`, top: 13, transform: "translateX(-50%)", width: 14, height: 14, borderRadius: "50%", background: bc, border: "2px solid #fff" }} />
                                        </div>
                                        {/* 단계 설명 (같으면 1개, 다르면 초기·후기) */}
                                        {iStage === fStage ? (
                                            DOMAIN_STAGE_DESCRIPTIONS[d]?.[fStage] && (
                                                <div style={{ fontSize: 9, color: "#6b7280", lineHeight: 1.55 }}><b style={{ color: bc }}>{fStage}</b> — {DOMAIN_STAGE_DESCRIPTIONS[d][fStage]}</div>
                                            )
                                        ) : (
                                            <>
                                                {DOMAIN_STAGE_DESCRIPTIONS[d]?.[iStage] && <div style={{ fontSize: 9, color: "#94a3b8", lineHeight: 1.55 }}><b>초기·{iStage}</b> — {DOMAIN_STAGE_DESCRIPTIONS[d][iStage]}</div>}
                                                {DOMAIN_STAGE_DESCRIPTIONS[d]?.[fStage] && <div style={{ fontSize: 9, color: "#6b7280", lineHeight: 1.55, marginTop: 2 }}><b style={{ color: bc }}>후기·{fStage}</b> — {DOMAIN_STAGE_DESCRIPTIONS[d][fStage]}</div>}
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        <div style={{ display: "flex", justifyContent: "center", gap: 12, fontSize: 8, color: "#9ca3af", marginTop: 4 }}>
                            <span>● 후기</span><span>○ 초기</span>
                        </div>
                    </div>

                    <div style={{ flex: 1, border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column" }}>
                        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>자기 vs 청중 인식 (전후)</div>
                        {/* 초기(연한·넓은) + 후기(진한·좁은) 겹친 막대 — 후기값 위 / 초기값 아래 (웹과 동일) */}
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-around" }}>
                            {DOMAINS.map((d) => {
                                const metrics = [
                                    { label: "자기", si: initial.self_scores_by_domain[d] ?? 0, sf: final.self_scores_by_domain[d] ?? 0, color: "#3b82f6" },
                                    { label: "청중", si: initial.audience_scores_by_domain[d] ?? 0, sf: final.audience_scores_by_domain[d] ?? 0, color: "#ec4899" },
                                ];
                                return (
                                    <div key={d} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
                                        <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 150, paddingTop: 16, borderBottom: "1px solid #e5e7eb", width: "100%", justifyContent: "center" }}>
                                            {metrics.map((m) => (
                                                <div key={m.label} style={{ position: "relative", width: 24, height: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                                                    <div style={{ position: "absolute", bottom: 0, width: 22, height: `${(m.si / 5) * 100}%`, background: m.color, opacity: 0.2, borderRadius: "3px 3px 0 0" }} />
                                                    <div style={{ position: "absolute", bottom: 0, width: 10, height: `${(m.sf / 5) * 100}%`, background: m.color, borderRadius: "3px 3px 0 0" }} />
                                                    <span style={{ position: "absolute", bottom: `${(m.sf / 5) * 100}%`, fontSize: 9, fontWeight: 700, color: m.color, transform: "translateY(-1px)" }}>{roundDisplay(m.sf)}</span>
                                                </div>
                                            ))}
                                        </div>
                                        {/* 라벨 + 초기값 */}
                                        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 5 }}>
                                            {metrics.map((m) => (
                                                <div key={m.label} style={{ width: 24, display: "flex", flexDirection: "column", alignItems: "center" }}>
                                                    <span style={{ fontSize: 9, fontWeight: 600, color: m.color }}>{m.label}</span>
                                                    <span style={{ fontSize: 8, color: "#9ca3af", whiteSpace: "nowrap" }}>초기 {roundDisplay(m.si)}</span>
                                                </div>
                                            ))}
                                        </div>
                                        <span style={{ fontSize: 10, fontWeight: 700, color: DOMAIN_COLORS[d].bar, marginTop: 4 }}>{DOMAIN_LABELS[d]}</span>
                                    </div>
                                );
                            })}
                        </div>
                        <div style={{ display: "flex", justifyContent: "center", gap: 10, fontSize: 8, color: "#6b7280", margin: "4px 0" }}>
                            <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#3b82f6", borderRadius: 2, marginRight: 2 }} />자기</span>
                            <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#ec4899", borderRadius: 2, marginRight: 2 }} />청중</span>
                            <span>연한=초기 · 진한=후기</span>
                        </div>
                        <div style={{ background: "#f9fafb", borderRadius: 6, padding: "8px 10px", border: "1px solid #e5e7eb" }}>
                            <div style={{ marginBottom: 4 }}>
                                <span style={{ fontSize: 10, fontWeight: 700, color: finPerc.type === "overestimate" ? "#e11d48" : finPerc.type === "underestimate" ? "#2563eb" : "#059669" }}>{finPerc.label}</span>
                                <span style={{ fontSize: 8, color: "#6b7280", marginLeft: 6 }}>초기 {PCODE[iniCode]} → 후기 {PCODE[finCode]}</span>
                            </div>
                            <div style={{ fontSize: 9, color: "#6b7280", lineHeight: 1.6, marginBottom: 5 }}>{finPerc.description}</div>
                            <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 5, padding: "6px 8px" }}>
                                <div style={{ fontSize: 8, fontWeight: 700, color: "#9ca3af", marginBottom: 1 }}>피드백</div>
                                <div style={{ fontSize: 9, color: "#374151", lineHeight: 1.6 }}>{finPerc.feedback}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div style={{ textAlign: "center", marginTop: 8 }}>
                    <span style={{ fontSize: 12, color: "#f472b6", fontWeight: 500 }}>Bloom UP — 당신의 가능성을 꽃피우기 위해</span>
                    <span style={{ fontSize: 10, color: "#d1d5db", marginLeft: 10 }}>1 / 2 · UnivPT</span>
                </div>
            </div>

            {/* ════════ PAGE 2 ════════ */}
            <div ref={page2Ref} style={PAGE}>
                <div style={{ position: "absolute", top: -60, right: -60, width: 200, height: 200, borderRadius: "50%", background: "linear-gradient(135deg, #fce7f3, #fdf2f8)", opacity: 0.5 }} />
                <div style={{ position: "absolute", bottom: -40, left: -40, width: 160, height: 160, borderRadius: "50%", background: "linear-gradient(135deg, #eff6ff, #dbeafe)", opacity: 0.4 }} />

                <div style={{ background: "linear-gradient(135deg, #f43f5e, #ec4899)", borderRadius: 12, padding: "14px 22px", color: "#fff", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center", position: "relative", zIndex: 1 }}>
                    <div>
                        <div style={{ fontSize: 10, opacity: 0.7, letterSpacing: 2, fontWeight: 600 }}>UnivPT 33기</div>
                        <div style={{ fontSize: 16, fontWeight: 800, marginTop: 2 }}>{memberName}님의 성장 이야기</div>
                    </div>
                    <span style={{ fontSize: 10, background: "rgba(255,255,255,0.2)", padding: "3px 10px", borderRadius: 10, fontWeight: 600 }}>2 / 2</span>
                </div>

                {/* 인식 전환 카드 */}
                <div style={{ background: "linear-gradient(135deg,#fff1f3,#fdf2f8)", border: "1px solid #fecdd3", borderRadius: 10, padding: "14px 18px", marginBottom: 14, position: "relative", zIndex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 6 }}>
                        <span style={{ background: "#fff", color: "#64748b", fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 8 }}>초기 {PCODE[iniCode]}</span>
                        <span style={{ color: "#f43f5e", fontWeight: 700 }}>→</span>
                        <span style={{ background: "#fff", color: "#e11d48", fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 8, border: "1px solid #fecdd3" }}>후기 {PCODE[finCode]}</span>
                    </div>
                    <div style={{ textAlign: "center", fontSize: 16, fontWeight: 800, marginBottom: 3 }}>{transition.name}</div>
                    <div style={{ textAlign: "center", fontSize: 11, color: "#e11d48", fontWeight: 600, marginBottom: 8 }}>{transition.oneLiner}</div>
                    <p style={{ fontSize: 11, color: "#374151", lineHeight: 1.8, margin: 0 }}>{transition.body}</p>
                </div>

                {/* 성장 PLAN 3열 (멘토링 제외, 꿀팁 포함) */}
                <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: "14px 16px", marginBottom: 14, position: "relative", zIndex: 1, display: "flex", flexDirection: "column" }}>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>성장 PLAN</div>
                    <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
                        {DOMAINS.map((d) => {
                            const bc = DOMAIN_COLORS[d].bar;
                            const lk = getLowestQuestionInDomain(d, final.self_scores_by_question, final.audience_scores_by_question);
                            const qInfo = lk ? QUESTION_BY_KEY[lk] : null;
                            const subtitle = lk ? QUESTION_SUBTITLES[lk] : null;
                            const fb = lk ? QUESTION_GROWTH_FEEDBACK[lk] : null;
                            const paras = fb ? fb.split("\n\n") : [];
                            const tips = DOMAIN_COMMON_FEEDBACK[d]?.tips ?? [];
                            return (
                                <div key={d} style={{ flex: 1, background: `${bc}08`, border: `1px solid ${bc}33`, borderRadius: 8, padding: "12px 14px", display: "flex", flexDirection: "column" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 7 }}>
                                        <span style={{ background: bc, color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6 }}>{DOMAIN_LABELS[d]}</span>
                                        <span style={{ fontSize: 9, color: "#9ca3af" }}>{getDomainStage(finC[d])}</span>
                                    </div>
                                    {qInfo && subtitle && <div style={{ fontSize: 11, fontWeight: 700, color: bc, marginBottom: 5 }}>[{qInfo.label} : {subtitle}]</div>}
                                    {paras[0] && <div style={{ fontSize: 10, color: "#6b7280", lineHeight: 1.65 }}>{paras[0]}</div>}
                                    {paras[1] && <div style={{ fontSize: 10, color: "#4b5563", lineHeight: 1.65, marginTop: 5, borderLeft: `2px solid ${bc}44`, paddingLeft: 7 }}>{paras[1]}</div>}
                                    {tips.length > 0 && (
                                        <div style={{ marginTop: 8 }}>
                                            <div style={{ fontSize: 10, fontWeight: 700, color: "#374151", marginBottom: 4 }}>📌 그 외 꿀팁</div>
                                            {tips.slice(0, 2).map((tip, i) => (
                                                <div key={i} style={{ background: "#fff", borderRadius: 5, padding: "5px 8px", border: "1px solid #f0f0f0", marginBottom: 4 }}>
                                                    <div style={{ fontSize: 9, fontWeight: 700, color: "#374151" }}>{tip.title}</div>
                                                    <div style={{ fontSize: 9, color: "#6b7280", lineHeight: 1.55 }}>{tip.body}</div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* 내가 발견한 성장 */}
                {growthReflection && growthReflection.trim() && (
                    <div style={{ border: "1px solid #fecdd3", borderRadius: 10, padding: "16px 20px", background: "#fff7f9", position: "relative", zIndex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: "#9f1239" }}>내가 발견한 성장</div>
                        <div style={{ fontSize: 11, color: "#6b7280", lineHeight: 1.8, marginBottom: 12 }}>
                            <p style={{ margin: "0 0 7px" }}>앞선 결과가 발표 역량의 변화를 보여주는 보다 객관적인 성장 기록이라면, 아래 내용은 여러분이 직접 체감한 주관적인 성장 기록입니다.</p>
                            <p style={{ margin: "0 0 7px" }}>유니브피티에서의 발표 경험, 피드백, 팀 활동, 그리고 수많은 연습 과정 속에서 여러분은 각자의 방식으로 성장해 왔습니다. 성장은 언제나 점수로만 설명되는 것은 아닙니다.</p>
                            <p style={{ margin: "0 0 7px" }}>발표를 준비하며 고민했던 시간, 팀원들과 의견을 나누었던 순간, 용기를 내어 사람들 앞에 섰던 경험 하나하나가 여러분만의 성장으로 쌓여 왔습니다.</p>
                            <p style={{ margin: 0 }}>객관적인 성장과 주관적인 성장이 만나는 지점에서 진짜 변화가 시작됩니다. 유니브피티를 통해 스스로 발견한 가장 큰 성장의 순간을 확인해 보세요.</p>
                        </div>
                        <div style={{ background: "#fff", border: "1px solid #fecdd3", borderRadius: 8, padding: "14px 16px" }}>
                            <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 6 }}>유니브피티 활동을 통해 가장 크게 성장했다고 느끼는 점</div>
                            <p style={{ fontSize: 12, color: "#374151", lineHeight: 2.0, margin: 0, whiteSpace: "pre-wrap" }}>{growthReflection}</p>
                        </div>
                    </div>
                )}

                <div style={{ textAlign: "center", paddingTop: 12 }}>
                    <span style={{ fontSize: 12, color: "#f472b6", fontWeight: 500 }}>Bloom UP — 당신의 가능성을 꽃피우기 위해</span>
                    <span style={{ fontSize: 10, color: "#d1d5db", marginLeft: 10 }}>2 / 2 · UnivPT</span>
                </div>
            </div>
        </>
    );
}
