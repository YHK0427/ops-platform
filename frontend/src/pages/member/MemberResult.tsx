import { useCallback, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMemberOwnResult } from "@/hooks/useMemberEvaluation";
import { motion } from "framer-motion";
import { ArrowLeft, Lock, Download } from "lucide-react";
import FinalGrowthReport from "@/components/eval/FinalGrowthReport";
import { useGrowthReportPdf } from "@/hooks/useGrowthReportPdf";
import { useInitialReportPdf } from "@/hooks/useInitialReportPdf";
import { COVER_PARAGRAPHS, COVER_SIGNATURE, DEFAULT_SLOGAN, coverClosing } from "@/constants/growthReportCover";
import GrowthReportContent from "@/components/eval/GrowthReportContent";

// ══════════════════════════════════════════════════════════════════════════
// Main Component
// ══════════════════════════════════════════════════════════════════════════

export default function MemberResult() {
    const { roundId } = useParams<{ roundId: string }>();
    const navigate = useNavigate();
    const { data, isLoading, isError, error } = useMemberOwnResult(roundId!);

    const isForbidden =
        isError && (error as { response?: { status?: number } })?.response?.status === 403;

    const reportPdf = useGrowthReportPdf();  // 후기 비교 리포트(표지·결과1·결과2) 공용 훅
    const initialPdf = useInitialReportPdf();  // 초기(단일) 리포트 2페이지 공용 훅
    const [step, setStep] = useState<"cover" | "report">("cover");  // 후기 비교 결과: 멘트 인트로 → 리포트

    const cohortLabel = data?.cohort_name ? `UnivPT ${data.cohort_name}` : "UnivPT";
    const slogan = data?.cohort_slogan || DEFAULT_SLOGAN;

    const handleDownloadPdf = useCallback(async () => {
        if (!data) return;
        // 후기 비교 리포트 → 공용 훅(표지 포함 3페이지)
        if (data.initial) {
            await reportPdf.generate({
                memberName: data.member_name,
                final: data,
                initial: data.initial,
                growthReflection: data.growth_reflection,
                cohortLabel,
                slogan,
            });
            return;
        }
        // 초기(단일) 리포트 → 공용 훅(2페이지, 운영진 결과 카드와 같은 것)
        await initialPdf.generate({ data, slogan, cohortLabel });
    }, [data, reportPdf, initialPdf, cohortLabel, slogan]);


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

    // ── 후기 비교 결과: 멘트 인트로 화면 (설문처럼 한 단계 거쳐 진입) ──
    if (data.initial && step === "cover") {
        return (
            <div className="member-page">
                <style>{`
                    @keyframes petal-drift-c1 { 0%,100% { transform: translateY(0) rotate(-15deg);} 50%{transform:translateY(-6px) rotate(-5deg);} }
                    @keyframes petal-drift-c2 { 0%,100% { transform: translateY(0) rotate(20deg);} 50%{transform:translateY(-8px) rotate(30deg);} }
                `}</style>
                <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-gray-200">
                    <div className="mx-auto max-w-2xl flex items-center gap-3 px-4 py-3">
                        <button onClick={() => navigate("/member/reports")} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                        <h1 className="text-base font-bold text-gray-900">발표 성장 리포트</h1>
                    </div>
                </header>
                <motion.main
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                    className="mx-auto w-full max-w-2xl px-5 py-6 pb-28"
                >
                    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 text-white p-7 mb-6">
                        <svg className="absolute top-4 right-8 w-6 h-6 text-white/40" viewBox="0 0 20 20" style={{ animation: "petal-drift-c1 4s ease-in-out infinite" }}><ellipse cx="10" cy="8" rx="5" ry="8" fill="currentColor" transform="rotate(-15 10 8)" /></svg>
                        <svg className="absolute top-10 right-20 w-4 h-4 text-white/30" viewBox="0 0 20 20" style={{ animation: "petal-drift-c2 5s ease-in-out infinite .5s" }}><ellipse cx="10" cy="8" rx="5" ry="8" fill="currentColor" transform="rotate(20 10 8)" /></svg>
                        <p className="text-[11px] font-semibold text-rose-100 tracking-widest">{cohortLabel}</p>
                        <h2 className="text-xl font-extrabold mt-1.5">{data.member_name}님의 발표 성장 리포트</h2>
                        <p className="text-sm font-bold mt-3">{slogan}</p>
                    </div>
                    <div className="rounded-2xl bg-white border border-gray-200 p-6 shadow-sm text-sm text-gray-600 leading-[2.0] space-y-4 [word-break:keep-all] text-pretty">
                        {COVER_PARAGRAPHS.map((p, i) => <p key={i} className={p.emphasis ? "font-bold text-gray-800" : ""}>{p.text}</p>)}
                        <p className="font-bold text-rose-600">{coverClosing(slogan)}</p>
                        <p className="text-xs text-gray-400 pt-2 border-t border-gray-100 text-right">{COVER_SIGNATURE}</p>
                    </div>
                </motion.main>
                <div className="fixed bottom-0 inset-x-0 z-10 bg-white/90 backdrop-blur-md border-t border-gray-200">
                    <div className="mx-auto max-w-2xl px-4 py-3">
                        <motion.button
                            whileTap={{ scale: 0.97 }}
                            onClick={() => setStep("report")}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-gradient-to-r from-rose-500 to-rose-600 text-white text-sm font-bold hover:from-rose-600 hover:to-rose-700 transition-all shadow-lg shadow-rose-500/25"
                        >
                            내 성장 리포트 확인하기
                        </motion.button>
                    </div>
                </div>
            </div>
        );
    }

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
                        disabled={initialPdf.generating || reportPdf.generating}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
                    >
                        {initialPdf.generating || reportPdf.generating ? (
                            <span className="inline-block w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                        ) : (
                            <Download className="w-3.5 h-3.5" />
                        )}
                        {initialPdf.generating || reportPdf.generating ? "생성 중..." : "PDF 다운로드"}
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
                {data.initial ? (
                    <FinalGrowthReport
                        memberName={data.member_name}
                        final={data}
                        initial={data.initial}
                        growthReflection={data.growth_reflection}
                        showTitle
                        cohortLabel={cohortLabel}
                    />
                ) : (
                    <GrowthReportContent
                        data={data}
                        showTitle
                        roundLabel={data.round_type === "FINAL" ? "후기 분석지" : "초기 분석지"}
                        cohortLabel={cohortLabel}
                        slogan={slogan}
                    />
                )}
            </motion.main>


            {/* 후기 비교 PDF(표지·결과1·결과2) 오프스크린 렌더 */}
            {reportPdf.node}
            {initialPdf.node}
        </div>
    );
}
