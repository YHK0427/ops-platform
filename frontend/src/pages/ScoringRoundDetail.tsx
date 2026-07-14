import { useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Lock, Settings2, Trophy, Unlock, Users } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useScoringRound, useToggleRound } from "@/hooks/useScoring";
import { useScoringSocket } from "@/hooks/useScoringSocket";
import { ShareLinkDialog } from "./ScoringManagement";
import { ScoringSettings } from "@/components/scoring/ScoringSettings";
import { ScoringSubmissions } from "@/components/scoring/ScoringSubmissions";
import { ScoringResults } from "@/components/scoring/ScoringResults";
import type { AxiosError } from "axios";

type Tab = "settings" | "submissions" | "results";

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: "settings", label: "설정", icon: Settings2 },
    { key: "submissions", label: "제출현황", icon: Users },
    { key: "results", label: "결과", icon: Trophy },
];

export default function ScoringRoundDetail() {
    const { roundId } = useParams();
    const id = Number(roundId);
    const { data: round, isLoading } = useScoringRound(id);
    const toggle = useToggleRound(id);
    const { connected } = useScoringSocket(id || null);
    const [tab, setTab] = useState<Tab>("results");

    if (isLoading || !round) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-muted)]" />
            </div>
        );
    }

    const toggleOpen = () => {
        toggle.mutate(!round.is_open, {
            onSuccess: () => toast.success(round.is_open ? "링크를 닫았습니다" : "링크를 열었습니다"),
            onError: (e) => {
                const msg = (e as AxiosError<{ detail?: string }>).response?.data?.detail;
                toast.error(msg ?? "변경 실패");
            },
        });
    };

    return (
        <div className="flex flex-col h-full">
            <PageHeader
                title={round.name}
                subtitle={
                    round.session_label
                        ? `${round.session_label} · 대상 ${round.targets.length}팀`
                        : `독립 심사 · 대상 ${round.targets.length}팀`
                }
                showBackButton
                backTo="/scoring"
                actions={
                    <>
                        <ShareLinkDialog token={round.public_token} name={round.name} />
                        <Button
                            size="sm"
                            variant={round.is_open ? "outline" : "default"}
                            onClick={toggleOpen}
                            disabled={toggle.isPending}
                        >
                            {toggle.isPending ? (
                                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                            ) : round.is_open ? (
                                <Lock className="w-4 h-4 mr-1" />
                            ) : (
                                <Unlock className="w-4 h-4 mr-1" />
                            )}
                            {round.is_open ? "마감하기" : "링크 열기"}
                        </Button>
                    </>
                }
            />

            <div className="px-6 pt-3 border-b border-[var(--color-border-subtle)]">
                <div className="flex gap-1">
                    {TABS.map((t) => (
                        <button
                            key={t.key}
                            onClick={() => setTab(t.key)}
                            className={cn(
                                "flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors",
                                tab === t.key
                                    ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                                    : "border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
                            )}
                        >
                            <t.icon className="w-4 h-4" />
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-auto px-6 py-4">
                {tab === "settings" && <ScoringSettings round={round} />}
                {tab === "submissions" && <ScoringSubmissions round={round} />}
                {tab === "results" && <ScoringResults round={round} connected={connected} />}
            </div>
        </div>
    );
}
