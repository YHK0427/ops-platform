import { useMemo, type RefObject } from "react";
import { RadarChart } from "@/components/eval/RadarChart";
import { sloganBanner } from "@/constants/growthReportCover";
import {
    DOMAINS,
    DOMAIN_LABELS,
    DOMAIN_COLORS,
    getDomainStage,
    roundDisplay,
    avg,
    getPerceptionType,
    getStrongestDomain,
    getWeakestDomain,
    TYPE_DESCRIPTIONS,
    DOMAIN_STAGE_DESCRIPTIONS,
    type GrowthReportContentProps,
} from "@/components/eval/GrowthReportContent";
import {
    QUESTION_BY_KEY,
    QUESTION_SUBTITLES,
    QUESTION_GROWTH_FEEDBACK,
    DOMAIN_COMMON_FEEDBACK,
    getLowestQuestionInDomain,
} from "@/constants/evalQuestions";

export type InitialReportPdfData = GrowthReportContentProps["data"] & { round_type?: string | null };

/**
 * 초기(단일) 발표 성장 리포트 PDF 2페이지 — 화면 밖에 그려 캡처한다.
 * 기수 결과 화면(MemberResult)에만 박혀 있어서 운영진은 초기 결과 PDF 를 못 받았다 — 공용으로 뺐다.
 */
export default function InitialReportPdf({ data, slogan, cohortLabel, page1Ref, page2Ref }: {
    data: InitialReportPdfData;
    slogan: string;
    cohortLabel: string;
    page1Ref: RefObject<HTMLDivElement | null>;
    page2Ref: RefObject<HTMLDivElement | null>;
}) {
    const combinedScores = useMemo(() => ({
        PLANNING: data.combined_scores_by_domain.PLANNING ?? 0,
        DESIGN: data.combined_scores_by_domain.DESIGN ?? 0,
        SPEECH: data.combined_scores_by_domain.SPEECH ?? 0,
    }), [data.combined_scores_by_domain]);

    const stageMap = useMemo(() => Object.fromEntries(
        DOMAINS.map(d => [d, getDomainStage(data.combined_scores_by_domain[d])])
    ) as Record<string, string>, [data.combined_scores_by_domain]);

    const perceptionType = useMemo(
        () => getPerceptionType(avg(data.self_scores_by_domain), avg(data.audience_scores_by_domain)),
        [data],
    );

    const typeInfo = TYPE_DESCRIPTIONS[data.type ?? ""] ?? TYPE_DESCRIPTIONS["균형형"];

    return (
        <>
            <div ref={page1Ref} style={{ width: 860, height: 1216, padding: "10px 14px", background: "#fff", fontFamily: "system-ui, sans-serif", color: "#1f2937", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
                {/* 배경 장식 원 */}
                <div style={{ position: "absolute", top: -50, left: -50, width: 180, height: 180, borderRadius: "50%", background: "linear-gradient(135deg, #fce7f3, #fdf2f8)", opacity: 0.5 }} />
                <div style={{ position: "absolute", bottom: -40, right: -40, width: 160, height: 160, borderRadius: "50%", background: "linear-gradient(135deg, #eff6ff, #dbeafe)", opacity: 0.4 }} />
                <div style={{ position: "absolute", top: "50%", left: -20, width: 100, height: 100, borderRadius: "50%", background: "linear-gradient(135deg, #ecfdf5, #d1fae5)", opacity: 0.3 }} />

                {/* ── 제목 카드 ── */}
                <div style={{ background: "linear-gradient(135deg, #f43f5e, #ec4899)", borderRadius: 12, padding: "18px 22px", color: "#fff", marginBottom: 14, position: "relative" }}>
                    <span style={{ position: "absolute", top: 14, right: 16, fontSize: 10, background: "rgba(255,255,255,0.2)", padding: "3px 10px", borderRadius: 10, fontWeight: 600 }}>{data.round_type === "FINAL" ? "후기 분석지" : "초기 분석지"}</span>
                    <div style={{ fontSize: 11, opacity: 0.7, letterSpacing: 2, fontWeight: 600 }}>{cohortLabel}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{data.member_name}님의 발표 성장 리포트</div>
                    <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>{data.member_name}님의 현재 발표 역량을 확인하고, 다음 성장을 위한 방향을 살펴보세요.</div>
                    <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                        {DOMAINS.map(d => (
                            <span key={d} style={{ background: d === "PLANNING" ? "#3b82f6" : d === "DESIGN" ? "#10b981" : "#f59e0b", color: "#fff", fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 10 }}>
                                [{DOMAIN_LABELS[d]}] {stageMap[d]}
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
                <div style={{ display: "flex", gap: 14, marginBottom: 14, alignItems: "stretch", flex: 4 }}>
                    {/* 레이더 + 점수표: 세로 배치 */}
                    <div style={{ flex: 1, border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, alignSelf: "flex-start" }}>발표 역량 방사형 그래프</div>
                        <div style={{ width: 200, height: 200, flexShrink: 0 }}>
                            <RadarChart selfScores={combinedScores} size={200} variant="light" />
                        </div>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 4 }}>
                            <thead><tr style={{ background: "#f9fafb" }}>
                                {["영역", "자기", "청중", "종합"].map(h => <th key={h} style={{ padding: "4px 6px", textAlign: h === "영역" ? "left" : "center", fontWeight: 600, borderBottom: "1px solid #e5e7eb", fontSize: 10 }}>{h}</th>)}
                            </tr></thead>
                            <tbody>{DOMAINS.map(d => (
                                <tr key={d}>
                                    <td style={{ padding: "4px 6px", fontWeight: 700, color: DOMAIN_COLORS[d].bar }}>{DOMAIN_LABELS[d]}</td>
                                    <td style={{ padding: "4px 6px", textAlign: "center" }}>{roundDisplay(data.self_scores_by_domain[d])}</td>
                                    <td style={{ padding: "4px 6px", textAlign: "center" }}>{roundDisplay(data.audience_scores_by_domain[d])}</td>
                                    <td style={{ padding: "4px 6px", textAlign: "center", fontWeight: 800 }}>{roundDisplay(data.combined_scores_by_domain[d])}</td>
                                </tr>
                            ))}</tbody>
                        </table>
                        <div style={{ fontSize: 8, color: "#9ca3af", marginTop: 4, lineHeight: 1.4, alignSelf: "flex-start" }}>자기·청중 평가 1:1 평균, 소수점 둘째 자리 반올림</div>
                    </div>
                    {/* 발표 유형 해석 */}
                    <div style={{ flex: 1, border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>발표 유형 해석</div>
                        <div style={{ fontSize: 8, color: "#9ca3af", marginBottom: 8 }}>삼각형의 형태는 세 영역의 균형을, 크기는 현재 발표 역량의 전체 수준을 의미합니다.</div>

                        {/* 3 유형 아이콘 — flex:1로 남는 공간 채움 */}
                        <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", gap: 20, marginBottom: 8 }}>
                            {([["균형형", "#10b981"], ["강점 집중형", "#3b82f6"], ["보완점 명확형", "#f59e0b"]] as const).map(([t, c]) => {
                                const active = data.type === t;
                                return (
                                    <div key={t} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, opacity: active ? 1 : 0.3 }}>
                                        <svg width="48" height="48" viewBox="0 0 48 48">
                                            {t === "균형형" ? (
                                                <polygon points="24,6 42,38 6,38" fill={`${c}22`} stroke={c} strokeWidth="2" />
                                            ) : t === "강점 집중형" ? (
                                                <polygon points="24,3 30,38 18,38" fill={`${c}22`} stroke={c} strokeWidth="2" />
                                            ) : (
                                                <polygon points="24,22 44,42 4,42" fill={`${c}22`} stroke={c} strokeWidth="2" />
                                            )}
                                        </svg>
                                        <span style={{ fontSize: 9, fontWeight: active ? 700 : 500, color: active ? "#111827" : "#9ca3af" }}>{t}</span>
                                    </div>
                                );
                            })}
                        </div>

                        {/* 활성 유형 상세 */}
                        <div style={{ background: "#f9fafb", borderRadius: 8, padding: "8px 10px", marginBottom: 6, border: "1px solid #f3f4f6" }}>
                            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, color: "#111827" }}>
                                {data.type ?? "분석 중"}
                                {data.type === "강점 집중형" && <span style={{ color: "#3b82f6" }}> — {getStrongestDomain(data.combined_scores_by_domain)} 강점</span>}
                                {data.type === "보완점 명확형" && <span style={{ color: "#f59e0b" }}> — {getWeakestDomain(data.combined_scores_by_domain)} 보완 필요</span>}
                            </div>
                            <p style={{ fontSize: 9, color: "#374151", margin: 0, lineHeight: 1.6 }}>{typeInfo.detail}</p>
                        </div>
                        <div style={{ fontSize: 9, color: "#4b5563", background: "#fff1f2", borderRadius: 8, padding: "8px 10px", border: "1px solid #fecdd3", lineHeight: 1.5 }}>
                            {typeInfo.action}
                        </div>
                    </div>
                </div>

                {/* ══ ROW 2: 영역별 단계 해석 | 자기 vs 청중 비교(바 그래프) ══ */}
                <div style={{ display: "flex", gap: 14, marginBottom: 14, alignItems: "stretch", flex: 4 }}>
                    {/* 영역별 단계 해석 */}
                    <div style={{ flex: 1, border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>영역별 단계 해석</div>
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, justifyContent: "center" }}>
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
                                <div style={{ fontSize: 10, fontWeight: 700, color: perceptionType.type === "overestimate" ? "#e11d48" : perceptionType.type === "underestimate" ? "#2563eb" : "#059669", marginBottom: 2 }}>{perceptionType.label}</div>
                                <div style={{ fontSize: 8, color: "#6b7280", lineHeight: 1.5, marginBottom: 4 }}>{perceptionType.description}</div>
                                <div style={{ background: "#f3f4f6", borderRadius: 4, padding: "4px 6px", border: "1px solid #e5e7eb" }}>
                                    <div style={{ fontSize: 7, fontWeight: 700, color: "#6b7280", marginBottom: 1 }}>피드백</div>
                                    <div style={{ fontSize: 8, color: "#374151", lineHeight: 1.5 }}>{perceptionType.feedback}</div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* ══ ROW 3: 성장 PLAN (3열) ══ */}
                <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: "14px 16px", marginBottom: 0, flex: 3, display: "flex", flexDirection: "column" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>성장 PLAN</div>
                    <div style={{ display: "flex", gap: 10, flex: 1 }}>
                        {DOMAINS.map(d => {
                            const lowestKey = getLowestQuestionInDomain(d, data.self_scores_by_question, data.audience_scores_by_question);
                            const qInfo = lowestKey ? QUESTION_BY_KEY[lowestKey] : null;
                            const subtitle = lowestKey ? QUESTION_SUBTITLES[lowestKey] : null;
                            const feedback = lowestKey ? QUESTION_GROWTH_FEEDBACK[lowestKey] : null;
                            const paragraphs = feedback ? feedback.split("\n\n") : [];
                            return (
                                <div key={d} style={{ flex: 1, background: `${DOMAIN_COLORS[d].bar}08`, border: `1px solid ${DOMAIN_COLORS[d].bar}33`, borderRadius: 8, padding: "10px 12px" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
                                        <span style={{ background: DOMAIN_COLORS[d].bar, color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6 }}>{DOMAIN_LABELS[d]}</span>
                                        <span style={{ fontSize: 9, color: "#9ca3af" }}>{getDomainStage(data.combined_scores_by_domain[d])}</span>
                                    </div>
                                    {qInfo && subtitle && (
                                        <div style={{ fontSize: 11, fontWeight: 700, color: DOMAIN_COLORS[d].bar, marginBottom: 5 }}>[{qInfo.label} : {subtitle}]</div>
                                    )}
                                    {paragraphs[0] && (
                                        <div style={{ fontSize: 10, color: "#9ca3af", lineHeight: 1.6, marginBottom: 4 }}>{paragraphs[0]}</div>
                                    )}
                                    {paragraphs.length > 1 && (
                                        <div style={{ fontSize: 8, color: "#9ca3af", fontStyle: "italic" }}>▸ 상세 피드백은 2페이지 참고</div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* 푸터 */}
                <div style={{ textAlign: "center", padding: 0 }}>
                    <span style={{ fontSize: 12, color: "#f472b6", fontWeight: 500 }}>{sloganBanner(slogan)}</span>
                    <span style={{ fontSize: 10, color: "#d1d5db", marginLeft: 10 }}>UnivPT</span>
                </div>
            </div>

            {/* ══════ PAGE 2: 멘토링 + 꿀팁 ══════ */}
            <div ref={page2Ref} style={{ width: 860, height: 1216, padding: "12px 16px", background: "#fff", fontFamily: "system-ui, sans-serif", color: "#1f2937", display: "flex", flexDirection: "column", justifyContent: "center", position: "relative", overflow: "hidden" }}>
                {/* 배경 장식 원 */}
                <div style={{ position: "absolute", top: -60, right: -60, width: 200, height: 200, borderRadius: "50%", background: "linear-gradient(135deg, #fce7f3, #fdf2f8)", opacity: 0.5 }} />
                <div style={{ position: "absolute", bottom: -40, left: -40, width: 160, height: 160, borderRadius: "50%", background: "linear-gradient(135deg, #eff6ff, #dbeafe)", opacity: 0.4 }} />
                <div style={{ position: "absolute", top: "40%", right: -30, width: 120, height: 120, borderRadius: "50%", background: "linear-gradient(135deg, #ecfdf5, #d1fae5)", opacity: 0.3 }} />

                {/* 헤더 */}
                <div style={{ background: "linear-gradient(135deg, #f43f5e, #ec4899)", borderRadius: 12, padding: "14px 22px", color: "#fff", marginBottom: 18, display: "flex", justifyContent: "space-between", alignItems: "center", position: "relative", zIndex: 1 }}>
                    <div>
                        <div style={{ fontSize: 10, opacity: 0.7, letterSpacing: 2, fontWeight: 600 }}>{cohortLabel}</div>
                        <div style={{ fontSize: 16, fontWeight: 800, marginTop: 2 }}>{data.member_name}님의 성장 가이드</div>
                    </div>
                    <span style={{ fontSize: 10, background: "rgba(255,255,255,0.2)", padding: "3px 10px", borderRadius: 10, fontWeight: 600 }}>2 / 2</span>
                </div>

                {/* 소개 문구 */}
                <div style={{ fontSize: 10, color: "#6b7280", padding: "8px 12px", background: "#f9fafb", borderRadius: 8, marginBottom: 18, border: "1px solid #f3f4f6", lineHeight: 1.5, position: "relative", zIndex: 1 }}>
                    나의 성장 방향에 맞는 멘토링 참여와 꿀팁 활용법을 안내합니다. 아래 내용을 참고하여 다음 발표에서 한 단계 더 나아가 보세요.
                </div>

                {/* 도메인별 피드백 + 멘토링 + 꿀팁 */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10, position: "relative", zIndex: 1, flex: 1 }}>
                    {DOMAINS.map(d => {
                        const common = DOMAIN_COMMON_FEEDBACK[d];
                        const lowestKey = getLowestQuestionInDomain(d, data.self_scores_by_question, data.audience_scores_by_question);
                        const qInfo = lowestKey ? QUESTION_BY_KEY[lowestKey] : null;
                        const subtitle = lowestKey ? QUESTION_SUBTITLES[lowestKey] : null;
                        const feedback = lowestKey ? QUESTION_GROWTH_FEEDBACK[lowestKey] : null;
                        const barColor = DOMAIN_COLORS[d].bar;
                        return (
                            <div key={d} style={{ flex: 1, border: `1px solid ${barColor}33`, borderRadius: 10, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                                {/* 도메인 헤더 */}
                                <div style={{ background: `${barColor}10`, padding: "6px 12px", display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${barColor}22` }}>
                                    <span style={{ background: barColor, color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 6 }}>{DOMAIN_LABELS[d]}</span>
                                    {qInfo && subtitle && (
                                        <span style={{ fontSize: 9, fontWeight: 700, color: barColor }}>[{qInfo.label} : {subtitle}]</span>
                                    )}
                                </div>

                                <div style={{ padding: "6px 12px", display: "flex", gap: 8, flex: 1 }}>
                                    {/* 피드백 + 멘토링 (왼쪽) */}
                                    <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                                        {feedback && feedback.split("\n\n").map((p, i) => (
                                            <div key={i} style={{
                                                fontSize: 9, lineHeight: 1.6, marginBottom: 3,
                                                color: i === 0 ? "#9ca3af" : "#4b5563",
                                                ...(i > 0 ? { borderLeft: `2px solid ${barColor}44`, paddingLeft: 6 } : {}),
                                            }}>{p}</div>
                                        ))}
                                        {common && (
                                            <div style={{ background: `${barColor}06`, borderRadius: 5, padding: "5px 8px", border: `1px solid ${barColor}15`, marginTop: 4 }}>
                                                <div style={{ fontSize: 9, fontWeight: 700, color: barColor, marginBottom: 2 }}>💡 멘토링</div>
                                                <div style={{ fontSize: 8, color: "#4b5563", lineHeight: 1.6 }}>{common.mentoring}</div>
                                            </div>
                                        )}
                                    </div>

                                    {/* 꿀팁 (오른쪽) */}
                                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                                        <div style={{ fontSize: 10, fontWeight: 700, color: "#374151" }}>📌 그 외 꿀팁</div>
                                        {common && common.tips.map((tip, i) => (
                                            <div key={i} style={{ background: "#f9fafb", borderRadius: 4, padding: "5px 8px", border: "1px solid #f3f4f6", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                                                <div style={{ fontSize: 9, fontWeight: 700, color: "#374151", marginBottom: 2 }}>{tip.title}</div>
                                                <div style={{ fontSize: 8, color: "#6b7280", lineHeight: 1.6 }}>{tip.body}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* 푸터 */}
                <div style={{ textAlign: "center", padding: 0, position: "relative", zIndex: 1 }}>
                    <span style={{ fontSize: 12, color: "#f472b6", fontWeight: 500 }}>{sloganBanner(slogan)}</span>
                    <span style={{ fontSize: 10, color: "#d1d5db", marginLeft: 10 }}>UnivPT</span>
                </div>
            </div>
        </>
    );
}
