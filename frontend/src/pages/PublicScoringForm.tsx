import { useEffect, useRef, useState } from "react";
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
    ck, ScoreSheet, emptySheet, fromSheetValue, rankLabel, toSheetValue,
    type SheetValue,
} from "@/components/scoring/ScoreSheet";
import type { ObserverMode, ScoringRole, Submission } from "@/hooks/useScoring";

interface PubCriterion { id: number; label: string; description?: string | null; max_score: number }
interface PubArea extends PubCriterion { criteria: PubCriterion[] }

interface PublicRound {
    name: string;
    intro?: string | null;
    is_open: boolean;
    observer_mode: ObserverMode;
    rank_slots: number[];
    require_feedback: boolean;
    observer_groups: string[];
    areas: PubArea[];
    criteria: PubCriterion[];  // 미분류 기준
    targets: { id: number; name: string; part_id?: number | null; members: string[] }[];
    parts: { id: number; label: string }[];
    active_part_id?: number | null;
}

type Stage = "intro" | "sheet" | "done";

/**
 * 공개 채점/투표 폼.
 * feedbackOnly=true면 청중 피드백 전용 링크(/s/:token/feedback) — 역할 선택 없이 항상 청중,
 * 순위 카드 없이 팀별 피드백 칸만 보여준다. 심사위원 폼(이 컴포넌트의 기본 경로)은 그대로 둔다.
 */
export default function PublicScoringForm({ feedbackOnly = false }: { feedbackOnly?: boolean }) {
    const { publicToken = "" } = useParams();
    // 순위 링크와 피드백 링크는 같은 publicToken을 쓰지만(참가자는 이름으로 같은 사람으로 연결),
    // 기기 자동 복원용 로컬 저장 키는 링크별로 분리한다 — 안 그러면 순위 링크를 먼저 쓴 기기가
    // 피드백 링크에 들어왔을 때 이름 입력 없이 그대로(엉뚱한 화면으로) 복원돼 버린다.
    const storageKey = feedbackOnly ? `${publicToken}:feedback` : publicToken;

    const [round, setRound] = useState<PublicRound | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);

    const [stage, setStage] = useState<Stage>("intro");
    const [name, setName] = useState("");
    const [role, setRole] = useState<ScoringRole>(feedbackOnly ? "OBSERVER" : "JUDGE");
    const [group, setGroup] = useState<string>("");
    // 소속을 자동으로 채웠는지 — 본인이 직접 고르면 이후 이름 수정에도 그 선택을 덮어쓰지 않는다
    const [groupTouched, setGroupTouched] = useState(false);
    const [participantToken, setPToken] = useState<string | null>(null);
    const [blocked, setBlocked] = useState<number[]>([]);
    const [sheet, setSheet] = useState<SheetValue>(emptySheet());
    const [submitting, setSubmitting] = useState(false);
    const [identifying, setIdentifying] = useState(false);
    // 청중 피드백 폼의 부 페이징 — "전체" 탭 없이 부 탭만 둔다. 부가 있는 라운드는 로드 시
    // active_part_id(없으면 첫 부)로 기본 선택해주고, 그 뒤로는 청중이 탭을 눌러 자유롭게 넘길 수 있다.
    // 부가 없는 라운드는 null로 남아 전체 팀이 그대로 보인다(하위호환).
    const [selectedPartId, setSelectedPartId] = useState<number | null>(null);

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
                // "전체" 없이 부 탭만 두므로, 부가 있으면 항상 특정 부가 선택돼 있어야 한다.
                setSelectedPartId(data.active_part_id ?? data.parts[0]?.id ?? null);

                const saved = getParticipantToken(storageKey);
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [publicToken, storageKey]);

    /** 이름 선택 화면으로 되돌리기 — 공용 기기에서 다음 사람이 이어서 채점할 때. */
    const switchPerson = () => {
        clearParticipantToken(storageKey);
        setPToken(null);
        setName("");
        setGroup("");
        setGroupTouched(false);
        setRole(feedbackOnly ? "OBSERVER" : "JUDGE");
        setBlocked([]);
        setSheet(emptySheet());
        setStage("intro");
    };

    const applySubmission = (s: Submission) => {
        setPToken(s.participant_token);
        setName(s.entered_name);
        setRole(s.role);
        setGroup(s.group_label ?? "");
        setGroupTouched(true);
        setBlocked(s.blocked_target_ids);
        setSheet(toSheetValue(s.scores, s.ranks, s.comments));
        setParticipantToken(storageKey, s.participant_token);
    };

    // 이름을 입력하는 동안(청중만) 명단에서 매칭되는 사람을 찾아 소속을 자동으로 채운다.
    // 본인이 직접 소속 버튼을 눌렀으면(groupTouched) 더 이상 덮어쓰지 않는다.
    useEffect(() => {
        if (stage !== "intro" || role !== "OBSERVER" || groupTouched) return;
        if (!name.trim() || (round?.observer_groups ?? []).length === 0) return;
        const t = window.setTimeout(async () => {
            try {
                const { data } = await publicApi.get<{ group_label: string | null }>(
                    `/scoring/${publicToken}/match-roster`,
                    { params: { name: name.trim(), role: "OBSERVER" } },
                );
                if (data.group_label && (round?.observer_groups ?? []).includes(data.group_label)) {
                    setGroup(data.group_label);
                }
            } catch {
                /* 매칭 실패해도 수동 선택은 그대로 가능하니 조용히 무시 */
            }
        }, 400);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [name, role, stage, groupTouched, publicToken]);

    // 청중 피드백 자동 저장(feedbackOnly 전용) — 입력을 멈추면 1.5초 뒤 자동 저장.
    // 정식 제출(/submit)이 아니라 초안 전용 엔드포인트(/draft)로 보낸다 — 그래야 "저장했다고
    // 곧바로 제출한 걸로 잡히는" 문제 없이, 제출현황·집계에는 "제출" 버튼을 눌러야만 반영된다.
    // 완료 검증(빈 팀 없는지)도 그래서 여기선 안 하고 "피드백 제출" 버튼에서만 한다.
    const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
    const savedCommentsRef = useRef<string>("");
    const autoSaveTimer = useRef<number | null>(null);

    useEffect(() => {
        savedCommentsRef.current = JSON.stringify(sheet.comments);
        setAutoSaveStatus("idle");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [participantToken]);

    useEffect(() => {
        if (!feedbackOnly || stage !== "sheet" || !participantToken) return;
        const snapshot = JSON.stringify(sheet.comments);
        if (snapshot === savedCommentsRef.current) return;
        setAutoSaveStatus("dirty");

        if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = window.setTimeout(async () => {
            setAutoSaveStatus("saving");
            try {
                const { scores, ranks, comments } = fromSheetValue(sheet);
                await publicApi.put(`/scoring/${publicToken}/draft`, {
                    participant_token: participantToken, scores, ranks, comments,
                });
                savedCommentsRef.current = snapshot;
                setAutoSaveStatus("saved");
            } catch {
                setAutoSaveStatus("error");
            }
        }, 1500);

        return () => {
            if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sheet.comments, feedbackOnly, stage, participantToken]);

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

    // 부(파트) 페이징 — 청중 피드백 폼에서만, 지금 청중이 고른 부의 팀만 보여준다.
    // 심사위원 폼·순위 폼은 항상 전체 팀(부와 무관).
    const partPaging = feedbackOnly && !!round && round.parts.length > 0;
    const visibleTargets = round && feedbackOnly
        ? round.targets.filter((t) => selectedPartId == null || t.part_id === selectedPartId)
        : (round?.targets ?? []);

    // 청중(RANK) 피드백 필수 — 피드백 전용 링크에서만 강제한다. 순위 링크엔 피드백 입력칸이
    // 아예 없으므로 여기서 막으면 순위조차 제출 못 하는 사람이 생긴다. 심사위원 총평엔 적용 안 함.
    // 부는 화면에 뭘 보여줄지만 결정하는 페이징일 뿐이라, 완료 여부는 부와 무관하게 라운드 전체 팀 기준.
    const requireFeedback = feedbackOnly && round?.observer_mode === "RANK" && !!round?.require_feedback;
    const missingFeedback = requireFeedback
        ? (round?.targets ?? []).filter((t) => !blocked.includes(t.id) && !(sheet.comments[ck(t.id, null)] ?? "").trim())
        : [];

    const submit = async () => {
        if (!participantToken) return;
        if (missingFeedback.length > 0) {
            const first = missingFeedback[0];
            // 놓친 팀이 지금 보고 있는 부에 없으면, 그 팀이 있는 부로 자동으로 넘겨서 바로 채울 수 있게 한다.
            if (partPaging && first.part_id != null && first.part_id !== selectedPartId) {
                setSelectedPartId(first.part_id);
            }
            toast.error(`모든 팀에 피드백을 남겨야 제출할 수 있어요 (${first.name} 등 ${missingFeedback.length}팀 미작성)`);
            return;
        }
        setSubmitting(true);
        try {
            const { scores, ranks, comments } = fromSheetValue(sheet);
            await publicApi.post(`/scoring/${publicToken}/submit`, {
                participant_token: participantToken,
                scores,
                ranks,
                comments,
                feedback_only: feedbackOnly,
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

    // 피드백 전용 링크는 청중이 등수를 고르는 라운드(RANK)에서만 의미가 있다.
    // SCORE 모드는 청중도 기준별로 채점+코멘트를 한 화면에서 하므로 분리할 게 없다.
    if (feedbackOnly && round.observer_mode !== "RANK") {
        return (
            <Centered>
                <Card>
                    <Info className="w-10 h-10 mx-auto mb-3 text-[var(--color-text-muted)]" />
                    <h1 className="text-lg font-bold text-[var(--color-text-primary)]">별도 피드백 링크가 필요 없어요</h1>
                    <p className="text-sm text-[var(--color-text-muted)] mt-2">
                        이 심사는 청중도 기준별로 채점합니다. 원래 채점 링크에서 점수와 코멘트를 함께 남겨주세요.
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
                        {feedbackOnly ? `${name}님, 피드백 남겨주셔서 감사합니다.` : `${name}님, 채점해 주셔서 감사합니다.`}
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)] mt-4 leading-relaxed">
                        마감 전까지는 수정할 수 있습니다. 이 링크로 다시 들어와
                        <b> 같은 이름</b>을 입력하면 {feedbackOnly ? "남긴 피드백을" : "매긴 점수를"} 불러옵니다.
                    </p>
                    <div className="flex flex-col gap-2 mt-5">
                        <Button variant="outline" onClick={() => setStage("sheet")}>
                            이어서 수정하기
                        </Button>
                        <Button variant="ghost" onClick={switchPerson}>
                            <UserRoundCog className="w-4 h-4 mr-1" />
                            다른 사람으로 {feedbackOnly ? "작성하기" : "채점하기"}
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

                        {feedbackOnly ? (
                            <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-accent)] bg-[var(--color-accent-dim)] rounded-lg px-3 py-2">
                                <Users className="w-3.5 h-3.5 shrink-0" />
                                청중 피드백 전용 링크입니다.
                            </div>
                        ) : (
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
                                        label="청중"
                                        // 등수 개수는 운영자 설정을 따라간다 (문구 고정 금지)
                                        desc={
                                            round.observer_mode === "RANK"
                                                ? `${rankLabel(round.rank_slots)} 선택`
                                                : "기준별 점수 입력"
                                        }
                                    />
                                </div>
                                {role === "OBSERVER" && round.observer_mode === "RANK" && (
                                    <p className="text-[11px] text-[var(--color-text-muted)]">
                                        팀별 피드백은 별도 링크에서 작성합니다.
                                    </p>
                                )}
                            </div>
                        )}

                        {role === "OBSERVER" && (round.observer_groups ?? []).length > 0 && (
                            <div className="space-y-2">
                                <Label>소속</Label>
                                <div className="flex flex-wrap gap-2">
                                    {(round.observer_groups ?? []).map((g) => (
                                        <button
                                            key={g}
                                            type="button"
                                            onClick={() => { setGroup(g); setGroupTouched(true); }}
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
                            {feedbackOnly ? "피드백 시작" : "채점 시작"}
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
                            {feedbackOnly ? "피드백 제출" : "제출"}
                        </Button>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-[var(--color-hover)] px-3 py-2">
                        <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                            {name}
                            <span className="ml-1.5 text-xs text-[var(--color-text-muted)]">
                                {role === "JUDGE" ? "심사위원" : "청중"}
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
                    {feedbackOnly && (
                        <p className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1">
                            {autoSaveStatus === "saving" && (
                                <><Loader2 className="w-3 h-3 animate-spin" /> 임시 저장 중…</>
                            )}
                            {autoSaveStatus === "dirty" && "입력을 멈추면 임시 저장됩니다 (제출은 별도)"}
                            {autoSaveStatus === "saved" && "임시 저장됨 — 아직 제출은 안 됐어요. 다 쓰셨으면 위 버튼으로 제출해 주세요"}
                            {autoSaveStatus === "error" && (
                                <span className="text-rose-500">임시 저장 실패 — 위 버튼으로 제출해 주세요</span>
                            )}
                        </p>
                    )}
                    {partPaging && (
                        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                            {round.parts.map((p) => (
                                <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => setSelectedPartId(p.id)}
                                    className={cn(
                                        "shrink-0 px-3 py-1.5 rounded-full border-2 text-sm font-medium transition-colors",
                                        selectedPartId === p.id
                                            ? "border-[var(--color-accent)] bg-[var(--color-accent-dim)] text-[var(--color-accent)]"
                                            : "border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]",
                                    )}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </header>

            <main className="max-w-2xl mx-auto px-4 py-5">
                <ScoreSheet
                    role={role}
                    observerMode={round.observer_mode}
                    rankSlots={round.rank_slots}
                    areas={round.areas}
                    criteria={round.criteria}
                    targets={visibleTargets}
                    blockedTargetIds={blocked}
                    value={sheet}
                    onChange={setSheet}
                    requireFeedback={requireFeedback}
                    sections={feedbackOnly ? ["feedback"] : ["rank"]}
                />

                <Button className="w-full mt-6" size="lg" disabled={submitting} onClick={submit}>
                    {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                    {feedbackOnly ? "피드백 제출하기" : "제출하기"}
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
