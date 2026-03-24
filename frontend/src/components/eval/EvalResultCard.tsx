import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import GrowthReportContent, {
    DOMAINS,
    DOMAIN_LABELS,
} from "@/components/eval/GrowthReportContent";

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
    self_scores_by_question: Record<string, number | null>;
    audience_scores_by_question: Record<string, number | null>;
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

// ── Component ────────────────────────────────────────────────────────────

export default function EvalResultCard({
    memberName,
    combinedScores,
    stage,
    type,
    detail,
    expanded = false,
    onToggle,
}: EvalResultCardProps) {
    const growthData = useMemo(() => {
        if (!detail) return null;
        return {
            member_name: memberName,
            self_scores_by_domain: detail.self_scores_by_domain,
            audience_scores_by_domain: detail.audience_scores_by_domain,
            combined_scores_by_domain: detail.combined_scores_by_domain,
            self_scores_by_question: detail.self_scores_by_question,
            audience_scores_by_question: detail.audience_scores_by_question,
            stage: detail.stage,
            type: detail.type,
        };
    }, [detail, memberName]);

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
                        <div className="px-5 pb-6 pt-4 border-t border-[var(--color-border-subtle)] space-y-5">
                            {growthData && (
                                <GrowthReportContent
                                    data={growthData}
                                    showTitle={false}
                                    showQuestionDetail
                                />
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
