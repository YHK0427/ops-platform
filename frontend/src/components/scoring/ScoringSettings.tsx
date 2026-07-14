import { useEffect, useState } from "react";
import {
    AlertCircle, CloudOff, Download, GripVertical, Loader2, Plus, RotateCcw, Save, Search, Shield,
    Trash2, UserPlus, X,
} from "lucide-react";
import { CircleCheck as CloudCheck } from "lucide-react";
import { AutosaveProvider, useAutosave, type PanelStatus } from "./autosave";
import { rankLabel } from "./ScoreSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useSessions } from "@/hooks/useSessions";
import {
    useImportMembers, useImportSessionTeams, useImportStaff, useSaveCriteria, useSaveRoster, useSaveTargets,
    useUpdateRound,
    type ScoringRound, type ScoringRole,
} from "@/hooks/useScoring";

interface CriterionDraft {
    id?: number;
    label: string;
    description?: string | null;
    max_score: number;
}

interface TargetDraft {
    id?: number;
    name: string;
    display_name?: string | null;
    member_names?: string[];
}

interface RosterDraft {
    id?: number;
    name: string;
    role: ScoringRole | "ANY";
    member_id?: number | null;
    note?: string | null;
    group_label?: string | null;
}

export function ScoringSettings({ round }: { round: ScoringRound }) {
    return (
        <AutosaveProvider>
            {({ statuses, saveAll }) => (
                <div className="space-y-5">
                    <SaveBar statuses={statuses} saveAll={saveAll} />
                    <WeightPanel round={round} />
                    <CriteriaPanel round={round} />
                    <TargetsPanel round={round} />
                    <RosterPanel round={round} />
                </div>
            )}
        </AutosaveProvider>
    );
}

/** 스크롤해도 계속 보이는 저장 상태 바. 자동 저장이 기본이고, 수동 저장 버튼도 남겨둔다. */
function SaveBar({
    statuses, saveAll,
}: {
    statuses: Record<string, PanelStatus>;
    saveAll: () => Promise<void>;
}) {
    const list = Object.values(statuses);
    const saving = list.some((s) => s.saving);
    const dirty = list.some((s) => s.dirty);
    const error = list.some((s) => s.error);
    const lastSaved = list.reduce<number | null>(
        (a, s) => (s.savedAt && (!a || s.savedAt > a) ? s.savedAt : a),
        null,
    );

    const [, tick] = useState(0);
    // "n초 전 저장됨" 표시를 흘러가게
    useEffect(() => {
        const t = window.setInterval(() => tick((v) => v + 1), 5000);
        return () => clearInterval(t);
    }, []);

    const ago = (ts: number) => {
        const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
        if (sec < 5) return "방금";
        if (sec < 60) return `${sec}초 전`;
        return `${Math.floor(sec / 60)}분 전`;
    };

    // -mt-4·-mx-6 으로 컨테이너 패딩을 끌어올려 상단에 빈 공간 없이 붙인다
    return (
        <div className="sticky top-0 z-20 -mx-6 -mt-4 px-6 py-2.5 bg-white/90 backdrop-blur-md border-b border-[var(--color-border-subtle)]">
            <div className="flex flex-wrap items-center gap-2">
                {error ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-600">
                        <AlertCircle className="w-3.5 h-3.5" />
                        저장 실패 — 저장 버튼을 눌러 다시 시도하세요
                    </span>
                ) : saving ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--color-text-secondary)]">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        저장 중…
                    </span>
                ) : dirty ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-600">
                        <CloudOff className="w-3.5 h-3.5" />
                        변경사항 있음 — 곧 자동 저장됩니다
                    </span>
                ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600">
                        <CloudCheck className="w-3.5 h-3.5" />
                        {lastSaved ? `자동 저장됨 · ${ago(lastSaved)}` : "자동 저장 켜짐"}
                    </span>
                )}

                <span className="hidden sm:inline text-xs text-[var(--color-text-muted)]">
                    입력을 멈추면 자동으로 저장됩니다. 지금 저장하려면 →
                </span>

                <Button
                    size="sm"
                    className="ml-auto"
                    disabled={saving}
                    onClick={() =>
                        saveAll()
                            .then(() => toast.success("저장됨"))
                            .catch(() => toast.error("저장 실패"))
                    }
                >
                    {saving ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                        <Save className="w-4 h-4 mr-1" />
                    )}
                    저장
                </Button>
            </div>
        </div>
    );
}

// ── 비중 / 모드 ──────────────────────────────────────────────────────────────

function WeightPanel({ round }: { round: ScoringRound }) {
    const update = useUpdateRound(round.id);
    const [judge, setJudge] = useState(String(round.judge_weight));
    const [observer, setObserver] = useState(String(round.observer_weight));
    const [mode, setMode] = useState(round.observer_mode);
    const [rankPts, setRankPts] = useState(round.rank_points);
    const [excludeOwn, setExcludeOwn] = useState(round.exclude_own_team);
    const [intro, setIntro] = useState(round.intro ?? "");
    const [groups, setGroups] = useState<string[]>(round.observer_groups ?? []);
    const [newGroup, setNewGroup] = useState("");

    const draft = {
        judge_weight: Number(judge),
        observer_weight: Number(observer),
        observer_mode: mode,
        rank_points: rankPts,
        exclude_own_team: excludeOwn,
        observer_groups: groups,
        intro,
    };
    const serverDraft = {
        judge_weight: Number(round.judge_weight),
        observer_weight: Number(round.observer_weight),
        observer_mode: round.observer_mode,
        rank_points: round.rank_points,
        exclude_own_team: round.exclude_own_team,
        observer_groups: round.observer_groups ?? [],
        intro: round.intro ?? "",
    };

    const weightSum = Number(judge) + Number(observer);
    const weightOk = Math.abs(weightSum - 100) < 0.01;

    const { isDirty, acceptServer } = useAutosave({
        id: "weight",
        value: draft,
        // 합계가 100이 아니면 서버가 400을 준다 → 자동 저장하지 않는다
        canSave: (v) => Math.abs(v.judge_weight + v.observer_weight - 100) < 0.01,
        save: (v) => update.mutateAsync(v),
        serverValue: serverDraft,
    });

    // 서버 값이 새로 내려와도 편집 중이면 덮어쓰지 않는다
    useEffect(() => {
        if (isDirty) return;
        setJudge(String(round.judge_weight));
        setObserver(String(round.observer_weight));
        setMode(round.observer_mode);
        setRankPts(round.rank_points);
        setExcludeOwn(round.exclude_own_team);
        setIntro(round.intro ?? "");
        setGroups(round.observer_groups ?? []);
        acceptServer(serverDraft);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [round]);

    const addGroup = () => {
        const g = newGroup.trim();
        if (!g || groups.includes(g)) return;
        setGroups([...groups, g]);
        setNewGroup("");
    };

    // 총점은 항상 100 — 한쪽을 바꾸면 다른 쪽이 자동으로 보정된다.
    const clamp100 = (v: string) => Math.max(0, Math.min(100, Number(v) || 0));
    const setJudgeLinked = (v: string) => {
        const j = clamp100(v);
        setJudge(String(j));
        setObserver(String(100 - j));
    };
    const setObserverLinked = (v: string) => {
        const o = clamp100(v);
        setObserver(String(o));
        setJudge(String(100 - o));
    };

    const perPerson = rankPts.reduce((a, p) => a + p.points, 0);

    return (
        <Panel title="집계 방식">
            <div>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                    <Label>비중 배분</Label>
                    <span
                        className={cn(
                            "text-xs font-bold px-2 py-0.5 rounded-full",
                            weightOk ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600",
                        )}
                    >
                        합계 {weightSum}점 {weightOk ? "" : "— 100점이어야 합니다"}
                    </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label className="text-xs text-[var(--color-text-secondary)]">심사위원</Label>
                        <Input
                            type="number"
                            min={0}
                            max={100}
                            value={judge}
                            onChange={(e) => setJudgeLinked(e.target.value)}
                        />
                        <p className="text-xs text-[var(--color-text-muted)]">
                            각 팀은 심사위원 평균 점수를 이 만점 기준으로 받습니다.
                        </p>
                    </div>
                    <div className="space-y-2">
                        <Label className="text-xs text-[var(--color-text-secondary)]">참관위원</Label>
                        <Input
                            type="number"
                            min={0}
                            max={100}
                            value={observer}
                            onChange={(e) => setObserverLinked(e.target.value)}
                        />
                        <p className="text-xs text-[var(--color-text-muted)]">
                            몇 명이 제출하든 참관위원 전체 기여는 이 점수로 고정됩니다.
                        </p>
                    </div>
                </div>
                <p className="text-xs text-[var(--color-text-muted)] mt-2">
                    총점은 항상 <b>100점</b>입니다. 한쪽을 바꾸면 다른 쪽이 자동으로 맞춰집니다.
                </p>
            </div>

            <div className="space-y-2">
                <Label>참관위원 채점 방식</Label>
                <div className="flex flex-wrap gap-2">
                    <ModeButton active={mode === "RANK"} onClick={() => setMode("RANK")}>
                        {/* 등수 개수는 아래에서 운영자가 바꾸므로 문구도 그 설정을 따라간다 */}
                        {rankLabel(rankPts.map((p) => p.rank))} 선택
                    </ModeButton>
                    <ModeButton active={mode === "SCORE"} onClick={() => setMode("SCORE")}>
                        심사위원과 동일하게 채점
                    </ModeButton>
                </div>
            </div>

            {mode === "RANK" && (
                <div className="space-y-2 p-4 rounded-lg bg-[var(--color-hover)]">
                    <div className="flex flex-wrap items-center gap-2">
                        <Label>등수 가중치 (%)</Label>
                        <span
                            className={cn(
                                "text-xs font-bold px-2 py-0.5 rounded-full",
                                Math.abs(perPerson - 100) < 0.01
                                    ? "bg-emerald-50 text-emerald-600"
                                    : "bg-amber-50 text-amber-700",
                            )}
                        >
                            합계 {perPerson.toFixed(1)}%
                        </span>
                        {Math.abs(perPerson - 100) >= 0.01 && (
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-xs"
                                onClick={() => {
                                    if (perPerson <= 0) return;
                                    setRankPts(
                                        rankPts.map((p) => ({
                                            ...p,
                                            points: Math.round((p.points / perPerson) * 1000) / 10,
                                        })),
                                    );
                                }}
                            >
                                100%로 맞추기
                            </Button>
                        )}
                    </div>
                    <p className="text-xs text-[var(--color-text-muted)]">
                        참관위원 표 1장을 등수별로 몇 %씩 쳐줄지 정합니다. 참관위원이 몇 명이든 이들의 기여
                        합계는 항상 <b>{observer}점</b>으로 고정되고, 그 안에서 받은 표를 이 비율대로 나눠 갖습니다.
                        합계가 100%가 아니어도 비율대로 동작하지만, 100%로 맞추면 읽기 쉽습니다.
                    </p>
                    <div className="space-y-2 pt-1">
                        {rankPts.map((p, i) => (
                            <div key={p.rank} className="flex items-center gap-2">
                                <span className="w-12 shrink-0 text-sm font-bold">{p.rank}위</span>
                                <Input
                                    type="number"
                                    step="0.1"
                                    min={0}
                                    className="w-24"
                                    value={p.points}
                                    onChange={(e) => {
                                        const next = [...rankPts];
                                        next[i] = { ...p, points: Number(e.target.value) };
                                        setRankPts(next);
                                    }}
                                />
                                <span className="text-xs text-[var(--color-text-muted)]">%</span>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-rose-500 ml-auto"
                                    onClick={() => setRankPts(rankPts.filter((_, j) => j !== i))}
                                >
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </div>
                        ))}
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                            setRankPts([
                                ...rankPts,
                                { rank: (rankPts.at(-1)?.rank ?? 0) + 1, points: 10 },
                            ])
                        }
                    >
                        <Plus className="w-4 h-4 mr-1" /> 등수 추가
                    </Button>
                </div>
            )}

            <div className="space-y-2 p-4 rounded-lg bg-[var(--color-hover)]">
                <Label>참관위원 소그룹</Label>
                <p className="text-xs text-[var(--color-text-muted)]">
                    {groups.length === 0 ? (
                        <>
                            지금은 그룹이 없어서 <b>참관위원에게 소속을 묻지 않습니다.</b> 그룹을 추가하면
                            폼에서 고르게 되고, 제출현황·결과·엑셀에서 그룹별로 나눠 볼 수 있습니다.
                        </>
                    ) : (
                        <>
                            참관위원은 폼에서 <b>{groups.join(" / ")}</b> 중 하나를 고릅니다.
                            <b> 집계에는 영향이 없고</b>, 제출현황·결과·엑셀에서 그룹별로 나눠 보기 위한 분류입니다.
                        </>
                    )}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                    {groups.map((g) => (
                        <span
                            key={g}
                            className="inline-flex items-center gap-1 pl-3 pr-1.5 py-1 rounded-full bg-white border border-[var(--color-border-subtle)] text-sm"
                        >
                            {g}
                            <button
                                type="button"
                                className="p-0.5 rounded-full hover:bg-rose-50 text-[var(--color-text-muted)] hover:text-rose-500"
                                onClick={() => setGroups(groups.filter((x) => x !== g))}
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </span>
                    ))}
                    {groups.length === 0 && (
                        <span className="text-xs text-[var(--color-text-muted)] py-1">
                            그룹 없음 — 참관위원에게 그룹을 묻지 않습니다.
                        </span>
                    )}
                </div>
                <div className="flex gap-2 pt-1">
                    <Input
                        className="w-56"
                        placeholder="그룹 추가 (예: 심사자문단)"
                        value={newGroup}
                        onChange={(e) => setNewGroup(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                addGroup();
                            }
                        }}
                    />
                    <Button size="sm" variant="outline" onClick={addGroup} disabled={!newGroup.trim()}>
                        <Plus className="w-4 h-4 mr-1" /> 추가
                    </Button>
                </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={excludeOwn} onCheckedChange={(v) => setExcludeOwn(!!v)} />
                <span className="text-sm text-[var(--color-text-primary)]">본인 소속팀 채점 제외</span>
                <span className="text-xs text-[var(--color-text-muted)]">
                    (명단에서 기수 멤버로 매칭된 사람만 적용 — 외부 심사위원은 영향 없음)
                </span>
            </label>

            <div className="space-y-2">
                <Label>참가자 안내문</Label>
                <textarea
                    className="w-full min-h-[120px] px-3 py-2 rounded-lg border border-[var(--color-border-subtle)] bg-white text-sm resize-y"
                    value={intro}
                    onChange={(e) => setIntro(e.target.value)}
                />
                <p className="text-xs text-[var(--color-text-muted)]">
                    공개 폼 첫 화면에 그대로 보입니다. 수정 방법 안내가 기본으로 들어 있습니다.
                </p>
            </div>
        </Panel>
    );
}

// ── 심사 기준 ────────────────────────────────────────────────────────────────

function CriteriaPanel({ round }: { round: ScoringRound }) {
    const save = useSaveCriteria(round.id);
    const [items, setItems] = useState<CriterionDraft[]>(round.criteria);

    const payload = (list: CriterionDraft[]) =>
        list.map((c) => ({
            id: c.id,
            label: c.label.trim(),
            description: c.description ?? null,
            max_score: Number(c.max_score),
        }));

    const { isDirty, acceptServer } = useAutosave({
        id: "criteria",
        value: payload(items),
        // 기준명이 비었거나 배점이 0 이하면 저장하지 않는다 (아직 입력 중일 수 있으므로)
        canSave: (v) => v.every((c) => c.label.length > 0 && c.max_score > 0),
        save: (v) => save.mutateAsync(v),
        serverValue: payload(round.criteria),
    });

    useEffect(() => {
        if (isDirty) return;
        setItems(round.criteria);
        acceptServer(payload(round.criteria));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [round.criteria]);

    const total = items.reduce((a, c) => a + (Number(c.max_score) || 0), 0);

    return (
        <Panel
            title="심사 기준"
            subtitle={`만점 합계 ${total}점 — 이 만점 대비 득점 비율이 비중으로 환산됩니다`}
        >
            <div className="space-y-2">
                {items.map((c, i) => (
                    <div key={c.id ?? `new-${i}`} className="flex items-start gap-2">
                        <GripVertical className="w-4 h-4 mt-3 text-[var(--color-text-muted)] shrink-0" />
                        <div className="flex-1 space-y-2">
                            <div className="flex gap-2">
                                <Input
                                    placeholder="기준명 (예: 논리성)"
                                    value={c.label}
                                    onChange={(e) => {
                                        const next = [...items];
                                        next[i] = { ...c, label: e.target.value };
                                        setItems(next);
                                    }}
                                />
                                <Input
                                    type="number"
                                    className="w-28"
                                    placeholder="배점"
                                    value={c.max_score}
                                    onChange={(e) => {
                                        const next = [...items];
                                        next[i] = { ...c, max_score: Number(e.target.value) };
                                        setItems(next);
                                    }}
                                />
                            </div>
                            <Input
                                placeholder="설명 (선택) — 심사위원에게 보입니다"
                                value={c.description ?? ""}
                                onChange={(e) => {
                                    const next = [...items];
                                    next[i] = { ...c, description: e.target.value };
                                    setItems(next);
                                }}
                            />
                        </div>
                        <Button
                            size="sm"
                            variant="ghost"
                            className="text-rose-500 mt-1"
                            onClick={() => setItems(items.filter((_, j) => j !== i))}
                        >
                            <Trash2 className="w-4 h-4" />
                        </Button>
                    </div>
                ))}
            </div>
            <Button
                size="sm"
                variant="outline"
                onClick={() => setItems([...items, { label: "", description: "", max_score: 10 }])}
            >
                <Plus className="w-4 h-4 mr-1" /> 기준 추가
            </Button>
        </Panel>
    );
}

// ── 심사 대상 ────────────────────────────────────────────────────────────────

function TargetsPanel({ round }: { round: ScoringRound }) {
    const save = useSaveTargets(round.id);
    const importTeams = useImportSessionTeams(round.id);
    const { data: sessions = [] } = useSessions();
    const [items, setItems] = useState<TargetDraft[]>(round.targets);
    const [sessionId, setSessionId] = useState<string>(round.session_id ? String(round.session_id) : "");

    const payload = (list: TargetDraft[]) =>
        list.map((t) => ({
            id: t.id,
            name: t.name.trim(),
            display_name: (t.display_name ?? "").trim() || null,
        }));

    const { isDirty, acceptServer } = useAutosave({
        id: "targets",
        value: payload(items),
        canSave: (v) => v.every((t) => t.name.length > 0), // 팀 이름이 비면 저장하지 않는다
        save: (v) => save.mutateAsync(v),
        serverValue: payload(round.targets),
    });

    useEffect(() => {
        if (isDirty) return;
        setItems(round.targets);
        acceptServer(payload(round.targets));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [round.targets]);

    const teamSessions = sessions.filter((s) => s.type === "TEAM");

    return (
        <Panel
            title="심사 대상 (팀)"
            subtitle="평가 폼에는 '표시 이름'이 뜹니다. 비워두면 원본 팀명이 그대로 쓰입니다."
        >
            <div className="flex items-end gap-2 p-3 rounded-lg bg-[var(--color-hover)]">
                <div className="flex-1 space-y-1">
                    <Label className="text-xs">팀세션에서 가져오기</Label>
                    <select
                        className="w-full h-9 px-3 rounded-lg border border-[var(--color-border-subtle)] bg-white text-sm"
                        value={sessionId}
                        onChange={(e) => setSessionId(e.target.value)}
                    >
                        <option value="">— 세션 선택 —</option>
                        {teamSessions.map((s) => (
                            <option key={s.id} value={s.id}>
                                {s.week_num}주차 · {s.title}
                            </option>
                        ))}
                    </select>
                </div>
                <Button
                    size="sm"
                    variant="outline"
                    disabled={!sessionId || importTeams.isPending}
                    onClick={() =>
                        importTeams.mutate(Number(sessionId), {
                            onSuccess: () => toast.success("팀을 가져왔습니다"),
                            onError: () => toast.error("가져오기 실패 — 편성된 팀이 있는지 확인하세요"),
                        })
                    }
                >
                    {importTeams.isPending ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                        <Download className="w-4 h-4 mr-1" />
                    )}
                    가져오기
                </Button>
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">
                세션을 가져오면 기존 대상이 교체되고, 자기팀 제외 판정용 팀원 정보도 함께 저장됩니다.
                <b> 세션을 고르지 않고 아래에 팀 이름만 직접 입력해도 됩니다</b> — 우리 시스템에 없는
                외부 팀·외부 심사위원만으로도 독립 심사가 가능합니다.
            </p>

            <div className="space-y-2">
                <div className="flex items-center gap-2 px-1 text-xs text-[var(--color-text-muted)]">
                    <span className="w-6" />
                    <span className="flex-1">원본 팀명</span>
                    <span className="flex-1">평가 폼 표시 이름</span>
                    <span className="w-9" />
                </div>
                {items.map((t, i) => (
                    <div key={t.id ?? `new-${i}`} className="space-y-1">
                        <div className="flex items-center gap-2">
                            <span className="w-6 text-xs text-[var(--color-text-muted)]">{i + 1}</span>
                            <Input
                                placeholder="팀 이름"
                                className="flex-1"
                                value={t.name}
                                onChange={(e) => {
                                    const next = [...items];
                                    next[i] = { ...t, name: e.target.value };
                                    setItems(next);
                                }}
                            />
                            <Input
                                placeholder={t.name ? `비우면 '${t.name}'` : "표시 이름 (선택)"}
                                className="flex-1"
                                value={t.display_name ?? ""}
                                onChange={(e) => {
                                    const next = [...items];
                                    next[i] = { ...t, display_name: e.target.value };
                                    setItems(next);
                                }}
                            />
                            <Button
                                size="sm"
                                variant="ghost"
                                className="text-rose-500"
                                onClick={() => setItems(items.filter((_, j) => j !== i))}
                            >
                                <Trash2 className="w-4 h-4" />
                            </Button>
                        </div>
                        {!!t.member_names?.length && (
                            <p className="pl-8 text-xs text-[var(--color-text-muted)]">
                                팀원 {t.member_names.length}명 · {t.member_names.join(", ")}
                            </p>
                        )}
                    </div>
                ))}
            </div>
            <Button size="sm" variant="outline" onClick={() => setItems([...items, { name: "" }])}>
                <Plus className="w-4 h-4 mr-1" /> 팀 추가
            </Button>
        </Panel>
    );
}

// ── 명단 ─────────────────────────────────────────────────────────────────────

function RosterPanel({ round }: { round: ScoringRound }) {
    const save = useSaveRoster(round.id);
    const importMembers = useImportMembers(round.id);
    const importStaff = useImportStaff(round.id);
    const [items, setItems] = useState<RosterDraft[]>(round.roster);

    const groups = round.observer_groups ?? [];
    // 임포트할 때 붙일 기본 소그룹 — 기수/운영진 라벨이 있으면 자동으로 골라둔다
    const [memberGroup, setMemberGroup] = useState(
        () => groups.find((g) => g.includes("기수")) ?? "",
    );
    const [staffGroup, setStaffGroup] = useState(
        () => groups.find((g) => g.includes("운영진")) ?? "",
    );

    const payload = (list: RosterDraft[]) =>
        list.map((r) => ({
            id: r.id,
            name: r.name.trim(),
            role: r.role,
            member_id: r.member_id ?? null,
            note: r.note ?? null,
            group_label: r.group_label ?? null,
        }));

    const { isDirty, acceptServer } = useAutosave({
        id: "roster",
        value: payload(items),
        canSave: (v) => v.every((r) => r.name.length > 0), // 이름이 비면 저장하지 않는다
        save: (v) => save.mutateAsync(v as never),
        serverValue: payload(round.roster),
    });

    useEffect(() => {
        if (isDirty) return;
        setItems(round.roster);
        acceptServer(payload(round.roster));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [round.roster]);

    // ── 필터 (표시만 거른다) ──
    // 중요: 저장 payload는 항상 items 전체다. 보이는 것만 저장하면 필터에 걸려 안 보이는
    // 사람이 통째로 삭제된다(PUT이 전체 교체라서). 그래서 렌더링에만 필터를 적용하고,
    // 수정·삭제는 원본 배열의 인덱스로 처리한다.
    const [q, setQ] = useState("");
    const [roleF, setRoleF] = useState<"ALL" | ScoringRole | "ANY">("ALL");
    const [groupF, setGroupF] = useState("ALL"); // "ALL" | "__none__" | 그룹명

    const needle = q.trim().toLowerCase();
    const visible = items
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => {
            if (needle) {
                const hay = `${r.name} ${r.note ?? ""} ${r.group_label ?? ""}`.toLowerCase();
                if (!hay.includes(needle)) return false;
            }
            if (roleF !== "ALL" && r.role !== roleF) return false;
            if (groupF === "__none__" && r.group_label) return false;
            if (groupF !== "ALL" && groupF !== "__none__" && r.group_label !== groupF) return false;
            return true;
        });

    const filtering = !!needle || roleF !== "ALL" || groupF !== "ALL";

    return (
        <Panel
            title="명단"
            subtitle="제출자 이름을 이 명단과 매칭해 '누가 했는지' 체크합니다. 명단에 없어도 제출은 가능합니다."
        >
            <div className="p-3 rounded-lg bg-[var(--color-hover)] space-y-2">
                <p className="text-xs text-[var(--color-text-muted)]">
                    한 번에 불러오면서 소그룹을 태깅합니다. 제출자가 폼에서 그룹을 안 고르면 이 값이 적용됩니다.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                    <GroupSelect groups={groups} value={memberGroup} onChange={setMemberGroup} />
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={importMembers.isPending}
                        onClick={() =>
                            importMembers.mutate(
                                { role: "OBSERVER", group_label: memberGroup || null },
                                {
                                    onSuccess: () => toast.success("기수 멤버를 명단에 추가했습니다"),
                                    onError: () => toast.error("가져오기 실패"),
                                },
                            )
                        }
                    >
                        {importMembers.isPending ? (
                            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                            <UserPlus className="w-4 h-4 mr-1" />
                        )}
                        기수 멤버 가져오기
                    </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <GroupSelect groups={groups} value={staffGroup} onChange={setStaffGroup} />
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={importStaff.isPending}
                        onClick={() =>
                            importStaff.mutate(
                                { role: "OBSERVER", group_label: staffGroup || null },
                                {
                                    onSuccess: () => toast.success("운영진을 명단에 추가했습니다"),
                                    onError: () => toast.error("가져오기 실패"),
                                },
                            )
                        }
                    >
                        {importStaff.isPending ? (
                            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                            <Shield className="w-4 h-4 mr-1" />
                        )}
                        운영진 가져오기
                    </Button>
                </div>
            </div>

            {/* 필터 — 표시만 거른다. 저장은 항상 전체 명단이 나간다. */}
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                    <Input
                        className="pl-8 h-9 w-52"
                        placeholder="이름·비고 검색"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                    />
                </div>
                <select
                    className="h-9 px-2 rounded-lg border border-[var(--color-border-subtle)] bg-white text-sm"
                    value={roleF}
                    onChange={(e) => setRoleF(e.target.value as typeof roleF)}
                >
                    <option value="ALL">역할 전체</option>
                    <option value="JUDGE">심사위원</option>
                    <option value="OBSERVER">참관위원</option>
                    <option value="ANY">무관</option>
                </select>
                <select
                    className="h-9 px-2 rounded-lg border border-[var(--color-border-subtle)] bg-white text-sm"
                    value={groupF}
                    onChange={(e) => setGroupF(e.target.value)}
                >
                    <option value="ALL">그룹 전체</option>
                    {groups.map((g) => (
                        <option key={g} value={g}>
                            {g}
                        </option>
                    ))}
                    <option value="__none__">그룹 없음</option>
                </select>

                <span className="text-xs text-[var(--color-text-muted)]">
                    {filtering ? `${visible.length}명 표시 / 전체 ${items.length}명` : `${items.length}명`}
                </span>

                {filtering && (
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs"
                        onClick={() => {
                            setQ("");
                            setRoleF("ALL");
                            setGroupF("ALL");
                        }}
                    >
                        <RotateCcw className="w-3.5 h-3.5 mr-1" />
                        필터 해제
                    </Button>
                )}
            </div>

            {filtering && (
                <p className="text-xs text-[var(--color-text-muted)]">
                    필터는 보기만 거릅니다 — 저장하면 숨겨진 사람도 그대로 유지됩니다.
                </p>
            )}

            <div className="space-y-2">
                {visible.length === 0 && items.length > 0 && (
                    <p className="text-center py-6 text-sm text-[var(--color-text-muted)]">
                        조건에 맞는 사람이 없습니다.
                    </p>
                )}
                {visible.map(({ r, i }) => (
                    <div key={r.id ?? `new-${i}`} className="flex items-center gap-2">
                        <Input
                            placeholder="이름"
                            className="flex-1"
                            value={r.name}
                            onChange={(e) => {
                                const next = [...items];
                                next[i] = { ...r, name: e.target.value };
                                setItems(next);
                            }}
                        />
                        <select
                            className="h-9 px-2 rounded-lg border border-[var(--color-border-subtle)] bg-white text-sm"
                            value={r.role}
                            onChange={(e) => {
                                const next = [...items];
                                next[i] = { ...r, role: e.target.value as RosterDraft["role"] };
                                setItems(next);
                            }}
                        >
                            <option value="ANY">무관</option>
                            <option value="JUDGE">심사위원</option>
                            <option value="OBSERVER">참관위원</option>
                        </select>
                        <select
                            className="h-9 px-2 rounded-lg border border-[var(--color-border-subtle)] bg-white text-sm w-28"
                            value={r.group_label ?? ""}
                            onChange={(e) => {
                                const next = [...items];
                                next[i] = { ...r, group_label: e.target.value || null };
                                setItems(next);
                            }}
                        >
                            <option value="">그룹 없음</option>
                            {groups.map((g) => (
                                <option key={g} value={g}>
                                    {g}
                                </option>
                            ))}
                        </select>
                        <Input
                            placeholder="소속 등 (선택)"
                            className="w-36"
                            value={r.note ?? ""}
                            onChange={(e) => {
                                const next = [...items];
                                next[i] = { ...r, note: e.target.value };
                                setItems(next);
                            }}
                        />
                        <Button
                            size="sm"
                            variant="ghost"
                            className="text-rose-500"
                            onClick={() => setItems(items.filter((_, j) => j !== i))}
                        >
                            <Trash2 className="w-4 h-4" />
                        </Button>
                    </div>
                ))}
            </div>
            <Button
                size="sm"
                variant="outline"
                onClick={() => {
                    // 필터가 걸려 있으면 새로 추가한 빈 줄이 안 보여 혼란스럽다 → 먼저 필터를 푼다
                    setQ("");
                    setRoleF("ALL");
                    setGroupF("ALL");
                    setItems([...items, { name: "", role: "JUDGE", note: "", group_label: null }]);
                }}
            >
                <Plus className="w-4 h-4 mr-1" /> 이름 추가
            </Button>
        </Panel>
    );
}

function GroupSelect({
    groups, value, onChange,
}: { groups: string[]; value: string; onChange: (v: string) => void }) {
    return (
        <select
            className="h-9 px-2 rounded-lg border border-[var(--color-border-subtle)] bg-white text-sm w-32"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={groups.length === 0}
        >
            <option value="">{groups.length === 0 ? "그룹 없음" : "— 그룹 선택 —"}</option>
            {groups.map((g) => (
                <option key={g} value={g}>
                    {g}
                </option>
            ))}
        </select>
    );
}

// ── 공통 ─────────────────────────────────────────────────────────────────────

function Panel({
    title, subtitle, action, children,
}: {
    title: string;
    subtitle?: string;
    action?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <section className="rounded-xl border border-[var(--color-border-subtle)] bg-white p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 className="font-bold text-[var(--color-text-primary)]">{title}</h2>
                    {subtitle && <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{subtitle}</p>}
                </div>
                {action}
            </div>
            {children}
        </section>
    );
}

function ModeButton({
    active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={
                active
                    ? "px-4 py-2 rounded-lg border-2 border-[var(--color-accent)] bg-[var(--color-accent-dim)] text-[var(--color-accent)] text-sm font-bold"
                    : "px-4 py-2 rounded-lg border-2 border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] text-sm font-medium hover:border-[var(--color-accent)]/40"
            }
        >
            {children}
        </button>
    );
}
