import { useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Lock, MinusCircle, Settings2, Trophy, Unlock, Users } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { ScreenGuide } from "@/components/ScreenGuide";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useScoringRound, useToggleRound } from "@/hooks/useScoring";
import { useScoringSocket } from "@/hooks/useScoringSocket";
import { ShareLinkDialog } from "./ScoringManagement";
import { ScoringSettings } from "@/components/scoring/ScoringSettings";
import { ScoringSubmissions } from "@/components/scoring/ScoringSubmissions";
import { ScoringDeductions } from "@/components/scoring/ScoringDeductions";
import { ScoringResults } from "@/components/scoring/ScoringResults";
import type { AxiosError } from "axios";

type Tab = "settings" | "submissions" | "deductions" | "results";

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: "settings", label: "설정", icon: Settings2 },
    { key: "submissions", label: "제출현황", icon: Users },
    { key: "deductions", label: "감점", icon: MinusCircle },
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
                        <ShareLinkDialog token={round.public_token} name={round.name} observerMode={round.observer_mode} />
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

            <div className="px-4 sm:px-6 pt-3 border-b border-[var(--color-border-subtle)] overflow-x-auto">
                <div className="flex gap-1 w-max min-w-full">
                    {TABS.map((t) => (
                        <button
                            key={t.key}
                            onClick={() => setTab(t.key)}
                            className={cn(
                                "flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors whitespace-nowrap shrink-0",
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
                {tab === "settings" && (
                    <ScreenGuide
                        storageKey="scoring-settings" title="설정 가이드" defaultOpen={false}
                        images={[
                            { src: "/help/scoring-weight.png", cap: "집계 방식 — ①입력 멈추면 자동 저장 ②등수 비율(합 100% 권장) ③청중 소그룹 자유 편집" },
                            { src: "/help/scoring-rubric.png", cap: "심사 기준 — ①영역 배점은 세부항목 합 ②세부항목 없으면 영역 통째 채점 ③영역 밖 기준도 가능" },
                            { src: "/help/scoring-deduction-rules.png", cap: "감점 규정 — ①규정 종류는 실제 상황 이름으로 ②마감 시각 + 구간별/분당 선택 ③발표시간은 기준만 정하면 감점 탭에선 실제 시간만 입력" },
                        ]}
                        steps={[
                            { title: "집계 방식 (비중 · 청중)", body: "심사위원 vs 청중 비중은 합이 항상 100점이고, 한쪽을 바꾸면 다른 쪽이 자동으로 맞춰집니다. 청중은 '등수 선택'(표 1장이 등수 가중치대로 고정된 청중 점수를 나눠 가짐) 또는 '기준 채점'(심사위원과 동일하게 채점) 중 고르고, 소그룹은 자유롭게 추가·삭제할 수 있습니다." },
                            { title: "기준 (영역 → 세부항목)", body: "영역 아래 세부항목을 두면 심사위원이 세부항목별 또는 영역 통째 중 골라 채점합니다. 세부항목이 없으면 영역을 통째로만 채점합니다. 영역 만점은 세부항목 합으로 자동 계산됩니다." },
                            { title: "심사 대상 (팀)", body: "세션에서 팀을 불러오거나 직접 추가할 수 있습니다. '표시 이름'을 넣으면 평가 폼에는 그 이름이 뜨고, 비워두면 원본 팀명이 그대로 쓰입니다." },
                            { title: "명단", body: "제출자 이름을 이 명단과 매칭해 '누가 했는지'를 체크합니다. 기수 멤버·운영진을 한 번에 불러올 수 있고, 명단에 없는 이름이 제출해도 응답 자체는 정상 저장됩니다." },
                            { title: "감점 규정", body: "발표자료 지각(마감 기준 자동 판정)·발표시간 초과·미달(기준 시간 대비 자동 판정)·형식 미준수(체크형) 3가지. 지각은 구간별 또는 분당 감점으로 정의하고, 실격 기준도 넣을 수 있습니다. 모든 설정은 자동 저장됩니다." },
                        ]}
                    />
                )}
                {tab === "deductions" && (
                    <ScreenGuide
                        storageKey="scoring-deductions" title="감점 입력 가이드" defaultOpen={false}
                        images={[
                            { src: "/help/scoring-deductions-input.png", cap: "감점 탭 — ①실제 제출·발표시간만 입력하면 ②저장 시 감점이 자동 계산됩니다" },
                        ]}
                        steps={[
                            { title: "팀별로 입력", body: "설정 탭에서 만든 규정이 팀마다 나옵니다. 발표자료 지각은 실제 제출시각을, 발표시간 초과·미달은 실제 발표시간을, 형식 미준수는 체크만 하면 서버가 감점·실격을 자동 계산합니다." },
                            { title: "자동 저장 → 결과 반영", body: "설정 탭과 동일하게 입력을 멈추면 자동 저장되고, 결과 탭의 최종점수(심사 + 청중 − 감점)에 곧바로 반영됩니다. 감점은 심사위원·청중에게는 보이지 않습니다." },
                        ]}
                    />
                )}
                {tab === "settings" && <ScoringSettings round={round} />}
                {tab === "submissions" && <ScoringSubmissions round={round} />}
                {tab === "deductions" && <ScoringDeductions round={round} />}
                {tab === "results" && <ScoringResults round={round} connected={connected} />}
            </div>
        </div>
    );
}
