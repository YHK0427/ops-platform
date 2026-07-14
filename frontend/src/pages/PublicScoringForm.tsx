import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AxiosError } from "axios";
import { CheckCircle2, Gavel, Info, Loader2, Lock, UserRoundCog, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import publicApi, {
    clearParticipantToken, getParticipantToken, setParticipantToken,
} from "@/lib/publicApi";
import {
    ScoreSheet, emptySheet, fromSheetValue, rankLabel, toSheetValue,
    type SheetValue,
} from "@/components/scoring/ScoreSheet";
import type { ObserverMode, ScoringRole, Submission } from "@/hooks/useScoring";

interface PublicRound {
    name: string;
    intro?: string | null;
    is_open: boolean;
    observer_mode: ObserverMode;
    rank_slots: number[];
    observer_groups: string[];
    criteria: { id: number; label: string; description?: string | null; max_score: number }[];
    targets: { id: number; name: string; members: string[] }[];
}

type Stage = "intro" | "sheet" | "done";

export default function PublicScoringForm() {
    const { publicToken = "" } = useParams();

    const [round, setRound] = useState<PublicRound | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);

    const [stage, setStage] = useState<Stage>("intro");
    const [name, setName] = useState("");
    const [role, setRole] = useState<ScoringRole>("JUDGE");
    const [group, setGroup] = useState<string>("");
    const [participantToken, setPToken] = useState<string | null>(null);
    const [blocked, setBlocked] = useState<number[]>([]);
    const [sheet, setSheet] = useState<SheetValue>(emptySheet());
    const [submitting, setSubmitting] = useState(false);
    const [identifying, setIdentifying] = useState(false);

    // 이미 제출한 이름으로 다시 들어왔을 때 띄우는 확인창
    const [editPrompt, setEditPrompt] = useState<Submission | null>(null);

    // 라운드 메타 로드 + 같은 기기 재접속이면 본인 제출분 조용히 복원
    useEffect(() => {
        if (!publicToken) return;
        let alive = true;

        (async () => {
            try {
                const { data } = await publicApi.get<PublicRound>(`/scoring/${publicToken}`);
                if (!alive) return;
                setRound(data);

                const saved = getParticipantToken(publicToken);
                if (saved) {
                    try {
                        const { data: mine } = await publicApi.get<Submission>(`/scoring/${publicToken}/me`, {
                            params: { participant_token: saved },
                        });
                        if (!alive) return;
                        applySubmission(mine);
                        setStage("sheet");
                    } catch {
                        /* 저장된 토큰이 더 이상 유효하지 않음 — 이름 입력부터 시작 */
                    }
                }
            } catch {
                if (alive) setNotFound(true);
            } finally {
                if (alive) setLoading(false);
            }
        })();

        return () => {
            alive = false;
        };
    }, [publicToken]);

    /** 이름 선택 화면으로 되돌리기 — 공용 기기에서 다음 사람이 이어서 채점할 때. */
    const switchPerson = () => {
        clearParticipantToken(publicToken);
        setPToken(null);
        setName("");
        setGroup("");
        setRole("JUDGE");
        setBlocked([]);
        setSheet(emptySheet());
        setStage("intro");
    };

    const applySubmission = (s: Submission) => {
        setPToken(s.participant_token);
        setName(s.entered_name);
        setRole(s.role);
        setGroup(s.group_label ?? "");
        setBlocked(s.blocked_target_ids);
        setSheet(toSheetValue(s.scores, s.ranks, s.comments));
        setParticipantToken(publicToken, s.participant_token);
    };

    const identify = async () => {
        if (!name.trim()) return;
        setIdentifying(true);
        try {
            const { data } = await publicApi.post<Submission & { existing: boolean }>(
                `/scoring/${publicToken}/identify`,
                { name: name.trim(), role, group_label: role === "OBSERVER" ? group || null : null },
            );
            if (data.existing) {
                // 이미 제출한 이름 — 수정할지 물어본다
                setEditPrompt(data);
            } else {
                applySubmission(data);
                setStage("sheet");
            }
        } catch (e) {
            const msg = (e as AxiosError<{ detail?: string }>).response?.data?.detail;
            toast.error(msg ?? "시작하지 못했습니다");
        } finally {
            setIdentifying(false);
        }
    };

    const submit = async () => {
        if (!participantToken) return;
        setSubmitting(true);
        try {
            const { scores, ranks, comments } = fromSheetValue(sheet);
            await publicApi.post(`/scoring/${publicToken}/submit`, {
                participant_token: participantToken,
                scores,
                ranks,
                comments,
            });
            setStage("done");
        } catch (e) {
            const msg = (e as AxiosError<{ detail?: string }>).response?.data?.detail;
            toast.error(msg ?? "제출에 실패했습니다");
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <Centered>
                <Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-muted)]" />
            </Centered>
        );
    }

    if (notFound || !round) {
        return (
            <Centered>
                <Card>
                    <Lock className="w-10 h-10 mx-auto mb-3 text-[var(--color-text-muted)]" />
                    <h1 className="text-lg font-bold text-[var(--color-text-primary)]">링크를 찾을 수 없습니다</h1>
                    <p className="text-sm text-[var(--color-text-muted)] mt-2">
                        주소가 정확한지 확인해 주세요.
                    </p>
                </Card>
            </Centered>
        );
    }

    if (!round.is_open) {
        return (
            <Centered>
                <Card>
                    <Lock className="w-10 h-10 mx-auto mb-3 text-[var(--color-text-muted)]" />
                    <h1 className="text-lg font-bold text-[var(--color-text-primary)]">마감되었습니다</h1>
                    <p className="text-sm text-[var(--color-text-muted)] mt-2">
                        {round.name} 채점이 마감되어 더 이상 제출할 수 없습니다.
                    </p>
                </Card>
            </Centered>
        );
    }

    if (stage === "done") {
        return (
            <Centered>
                <Card>
                    <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-emerald-500" />
                    <h1 className="text-lg font-bold text-[var(--color-text-primary)]">제출 완료</h1>
                    <p className="text-sm text-[var(--color-text-muted)] mt-2">
                        {name}님, 채점해 주셔서 감사합니다.
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)] mt-4 leading-relaxed">
                        마감 전까지는 수정할 수 있습니다. 이 링크로 다시 들어와
                        <b> 같은 이름</b>을 입력하면 매긴 점수를 불러옵니다.
                    </p>
                    <div className="flex flex-col gap-2 mt-5">
                        <Button variant="outline" onClick={() => setStage("sheet")}>
                            이어서 수정하기
                        </Button>
                        <Button variant="ghost" onClick={switchPerson}>
                            <UserRoundCog className="w-4 h-4 mr-1" />
                            다른 사람으로 채점하기
                        </Button>
                    </div>
                </Card>
            </Centered>
        );
    }

    if (stage === "intro") {
        return (
            <Centered>
                <Card>
                    <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-[var(--color-accent-dim)] flex items-center justify-center">
                        <Gavel className="w-6 h-6 text-[var(--color-accent)]" />
                    </div>
                    <h1 className="text-xl font-bold text-[var(--color-text-primary)] text-center">{round.name}</h1>

                    {round.intro && (
                        <div className="mt-4 p-4 rounded-lg bg-[var(--color-hover)] text-left">
                            <div className="flex items-center gap-1.5 mb-2 text-[var(--color-text-secondary)]">
                                <Info className="w-3.5 h-3.5" />
                                <span className="text-xs font-bold">안내</span>
                            </div>
                            <p className="text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap leading-relaxed">
                                {round.intro}
                            </p>
                        </div>
                    )}

                    <div className="mt-5 space-y-4 text-left">
                        <div className="space-y-2">
                            <Label>이름</Label>
                            <Input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="이름을 입력하세요"
                                autoFocus
                                onKeyDown={(e) => e.key === "Enter" && identify()}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>역할</Label>
                            <div className="grid grid-cols-2 gap-2">
                                <RoleButton
                                    active={role === "JUDGE"}
                                    onClick={() => setRole("JUDGE")}
                                    icon={<Gavel className="w-4 h-4" />}
                                    label="심사위원"
                                    desc="기준별 점수 입력"
                                />
                                <RoleButton
                                    active={role === "OBSERVER"}
                                    onClick={() => setRole("OBSERVER")}
                                    icon={<Users className="w-4 h-4" />}
                                    label="참관위원"
                                    // 등수 개수는 운영자 설정을 따라간다 (문구 고정 금지)
                                    desc={
                                        round.observer_mode === "RANK"
                                            ? `${rankLabel(round.rank_slots)} 선택`
                                            : "기준별 점수 입력"
                                    }
                                />
                            </div>
                        </div>

                        {role === "OBSERVER" && (round.observer_groups ?? []).length > 0 && (
                            <div className="space-y-2">
                                <Label>소속</Label>
                                <div className="flex flex-wrap gap-2">
                                    {(round.observer_groups ?? []).map((g) => (
                                        <button
                                            key={g}
                                            type="button"
                                            onClick={() => setGroup(g)}
                                            className={cn(
                                                "px-3 py-1.5 rounded-full border-2 text-sm font-medium transition-colors",
                                                group === g
                                                    ? "border-[var(--color-accent)] bg-[var(--color-accent-dim)] text-[var(--color-accent)]"
                                                    : "border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/40",
                                            )}
                                        >
                                            {g}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <Button
                            className="w-full"
                            disabled={
                                !name.trim() ||
                                identifying ||
                                (role === "OBSERVER" && (round.observer_groups ?? []).length > 0 && !group)
                            }
                            onClick={identify}
                        >
                            {identifying && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                            채점 시작
                        </Button>
                    </div>
                </Card>

                <EditPromptDialog
                    submission={editPrompt}
                    onCancel={() => setEditPrompt(null)}
                    onConfirm={() => {
                        if (editPrompt) {
                            applySubmission(editPrompt);
                            setStage("sheet");
                        }
                        setEditPrompt(null);
                    }}
                />
            </Centered>
        );
    }

    // stage === "sheet"
    return (
        <div className="min-h-screen bg-[var(--color-bg)]">
            <header className="sticky top-0 z-10 bg-white/85 backdrop-blur-md border-b border-[var(--color-border-subtle)]">
                <div className="max-w-2xl mx-auto px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                        <h1 className="font-bold text-[var(--color-text-primary)] truncate">{round.name}</h1>
                        <Button size="sm" disabled={submitting} onClick={submit}>
                            {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                            제출
                        </Button>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-[var(--color-hover)] px-3 py-2">
                        <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                            {name}
                            <span className="ml-1.5 text-xs text-[var(--color-text-muted)]">
                                {role === "JUDGE" ? "심사위원" : "참관위원"}
                                {role === "OBSERVER" && group ? ` · ${group}` : ""}
                            </span>
                        </span>
                        <Button
                            size="sm"
                            variant="outline"
                            className="shrink-0"
                            onClick={switchPerson}
                        >
                            <UserRoundCog className="w-4 h-4 mr-1" />
                            다른 사람으로
                        </Button>
                    </div>
                </div>
            </header>

            <main className="max-w-2xl mx-auto px-4 py-5">
                <ScoreSheet
                    role={role}
                    observerMode={round.observer_mode}
                    rankSlots={round.rank_slots}
                    criteria={round.criteria}
                    targets={round.targets}
                    blockedTargetIds={blocked}
                    value={sheet}
                    onChange={setSheet}
                />

                <Button className="w-full mt-6" size="lg" disabled={submitting} onClick={submit}>
                    {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                    제출하기
                </Button>
                <p className="text-center text-xs text-[var(--color-text-muted)] mt-3 pb-8">
                    제출 후에도 마감 전까지 이 링크에서 같은 이름으로 다시 들어오면 수정할 수 있습니다.
                </p>
            </main>
        </div>
    );
}

function EditPromptDialog({
    submission, onCancel, onConfirm,
}: { submission: Submission | null; onCancel: () => void; onConfirm: () => void }) {
    return (
        <Dialog open={!!submission} onOpenChange={(o) => !o && onCancel()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>점수를 수정하시겠습니까?</DialogTitle>
                    <DialogDescription>
                        <b>{submission?.entered_name}</b> 님은 이미 제출하셨습니다.
                        계속하면 이전에 매긴 점수를 불러와 수정할 수 있습니다.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="outline" onClick={onCancel}>취소</Button>
                    <Button onClick={onConfirm}>불러와서 수정</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function RoleButton({
    active, onClick, icon, label, desc,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; desc: string }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-colors",
                active
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-dim)] text-[var(--color-accent)]"
                    : "border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/40",
            )}
        >
            {icon}
            <span className="text-sm font-bold">{label}</span>
            <span className="text-[11px] text-[var(--color-text-muted)]">{desc}</span>
        </button>
    );
}

function Centered({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] px-4">
            {children}
        </div>
    );
}

function Card({ children }: { children: React.ReactNode }) {
    return (
        <div className="w-full max-w-md p-7 rounded-2xl border border-[var(--color-border-subtle)] bg-white shadow-sm text-center">
            {children}
        </div>
    );
}
