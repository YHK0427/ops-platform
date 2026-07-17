import { useState } from "react";
import { Ban, LayoutList, MessageSquareText, Square, Trophy } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { CommentEntry, ObserverMode, RankEntry, ScoreEntry, ScoringRole } from "@/hooks/useScoring";

/**
 * 채점 시트 — 공개 폼과 운영진 입력이 공유하는 컨트롤드 컴포넌트.
 *
 * 계층형 기준: 영역(area) 아래 세부항목(criterion). 영역마다 심사위원이
 * "세부항목별 입력" 또는 "영역 통째 입력"을 고를 수 있다.
 *
 * 내부 상태는 평평한 맵으로 들고 있다가 제출 시 API 배열로 변환한다.
 * 점수 키에 접두사를 붙여 구분: "c:{target}:{criterionId}" | "a:{target}:{areaId}"
 */

export interface SheetCriterion {
    id: number;
    label: string;
    description?: string | null;
    max_score: number;
}

export interface SheetArea {
    id: number;
    label: string;
    description?: string | null;
    max_score: number;
    criteria: SheetCriterion[];  // 없으면 영역 통째로만 채점
}

export interface SheetTarget {
    id: number;
    name: string;
    members?: string[];
}

export interface SheetValue {
    scores: Record<string, number>;   // "c:t:cid" | "a:t:aid" → 점수
    comments: Record<string, string>; // "t:cid" | "t:overall" → 내용
    ranks: Record<number, number>;    // 등수 → targetId
}

export function rankLabel(ranks: number[]): string {
    const sorted = [...ranks].sort((a, b) => a - b);
    if (sorted.length === 0) return "등수";
    return `${sorted.join("·")}위`;
}

export const emptySheet = (): SheetValue => ({ scores: {}, comments: {}, ranks: {} });

const csk = (t: number, c: number) => `c:${t}:${c}`;   // 세부항목/미분류 점수
const ask = (t: number, a: number) => `a:${t}:${a}`;   // 영역 통째 점수
export const ck = (t: number, c: number | null) => `${t}:${c ?? "overall"}`;

export function toSheetValue(
    scores: ScoreEntry[], ranks: RankEntry[], comments: CommentEntry[],
): SheetValue {
    const v = emptySheet();
    for (const s of scores) {
        if (s.criterion_id != null) v.scores[csk(s.target_id, s.criterion_id)] = s.score;
        else if (s.area_id != null) v.scores[ask(s.target_id, s.area_id)] = s.score;
    }
    for (const r of ranks) v.ranks[r.rank] = r.target_id;
    for (const c of comments) v.comments[ck(c.target_id, c.criterion_id ?? null)] = c.body;
    return v;
}

export function fromSheetValue(v: SheetValue): {
    scores: ScoreEntry[]; ranks: RankEntry[]; comments: CommentEntry[];
} {
    const scores: ScoreEntry[] = Object.entries(v.scores).map(([key, score]) => {
        const [kind, t, id] = key.split(":");
        return kind === "a"
            ? { target_id: Number(t), area_id: Number(id), score }
            : { target_id: Number(t), criterion_id: Number(id), score };
    });
    const ranks: RankEntry[] = Object.entries(v.ranks)
        .filter(([, targetId]) => !!targetId)
        .map(([rank, targetId]) => ({ rank: Number(rank), target_id: targetId }));
    const comments: CommentEntry[] = Object.entries(v.comments)
        .filter(([, body]) => body.trim())
        .map(([key, body]) => {
            const [t, c] = key.split(":");
            return { target_id: Number(t), criterion_id: c === "overall" ? null : Number(c), body };
        });
    return { scores, ranks, comments };
}

interface Props {
    role: ScoringRole;
    observerMode: ObserverMode;
    rankSlots: number[];
    areas: SheetArea[];
    criteria: SheetCriterion[];  // 미분류(평면) 기준
    targets: SheetTarget[];
    blockedTargetIds: number[];
    value: SheetValue;
    onChange: (v: SheetValue) => void;
    /** 청중(RANK 모드) 전용 — 켜지면 팀별 피드백을 모두 채워야 한다. 심사위원엔 적용 안 함. */
    requireFeedback?: boolean;
    /** 청중(RANK 모드) 화면 분할용 — 순위/피드백 중 이 화면에서 보여줄 구간. 기본은 둘 다(운영진 대리입력용). */
    sections?: ("rank" | "feedback")[];
}

export function ScoreSheet({
    role, observerMode, rankSlots, areas, criteria, targets, blockedTargetIds, value, onChange,
    requireFeedback = false, sections = ["rank", "feedback"],
}: Props) {
    // 청중 + RANK 모드 → 점수 입력 대신 등수 선택
    const rankMode = role === "OBSERVER" && observerMode === "RANK";
    const blocked = new Set(blockedTargetIds);

    // 영역별 입력 방식 토글 상태 {"t:aid": "detail"|"lump"} — 초기값은 기존 데이터로 추론
    const [areaMode, setAreaMode] = useState<Record<string, "detail" | "lump">>(() => {
        const m: Record<string, "detail" | "lump"> = {};
        for (const t of targets) for (const a of areas) {
            const key = `${t.id}:${a.id}`;
            if (value.scores[ask(t.id, a.id)] != null) m[key] = "lump";
            else if (a.criteria.some((c) => value.scores[csk(t.id, c.id)] != null)) m[key] = "detail";
        }
        return m;
    });
    const modeOf = (t: number, a: SheetArea): "detail" | "lump" =>
        a.criteria.length === 0 ? "lump" : (areaMode[`${t}:${a.id}`] ?? "detail");

    const setKey = (key: string, raw: string, max: number) => {
        const next = { ...value.scores };
        if (raw === "") delete next[key];
        else {
            const n = Number(raw);
            if (Number.isNaN(n)) return;
            next[key] = Math.max(0, Math.min(max, n));
        }
        onChange({ ...value, scores: next });
    };

    const switchAreaMode = (t: number, a: SheetArea, mode: "detail" | "lump") => {
        setAreaMode((m) => ({ ...m, [`${t}:${a.id}`]: mode }));
        // 다른 방식의 값은 지운다 (한 영역은 한 방식으로만)
        const next = { ...value.scores };
        if (mode === "lump") a.criteria.forEach((c) => delete next[csk(t, c.id)]);
        else delete next[ask(t, a.id)];
        onChange({ ...value, scores: next });
    };

    const setComment = (t: number, c: number | null, body: string) =>
        onChange({ ...value, comments: { ...value.comments, [ck(t, c)]: body } });

    const setRank = (rank: number, targetId: number | null) => {
        const next = { ...value.ranks };
        for (const [r, t] of Object.entries(next)) {
            if (targetId && t === targetId && Number(r) !== rank) delete next[Number(r)];
        }
        if (targetId) next[rank] = targetId;
        else delete next[rank];
        onChange({ ...value, ranks: next });
    };

    // 팀 t의 현재 득점 합 / 만점
    const targetSum = (t: number) => {
        let s = 0;
        for (const a of areas) {
            if (modeOf(t, a) === "lump") s += value.scores[ask(t, a.id)] ?? 0;
            else a.criteria.forEach((c) => (s += value.scores[csk(t, c.id)] ?? 0));
        }
        criteria.forEach((c) => (s += value.scores[csk(t, c.id)] ?? 0));
        return s;
    };
    const maxSum = areas.reduce((s, a) => s + a.max_score, 0)
        + criteria.reduce((s, c) => s + c.max_score, 0);

    if (rankMode) {
        const showRank = sections.includes("rank");
        const showFeedback = sections.includes("feedback");
        return (
            <div className="space-y-5">
                {showRank && (
                    <div className="rounded-xl border border-[var(--color-border-subtle)] bg-white p-5">
                        <div className="flex items-center gap-2 mb-1">
                            <Trophy className="w-4 h-4 text-amber-500" />
                            <h3 className="font-bold text-[var(--color-text-primary)]">
                                {rankLabel(rankSlots)} 선택
                            </h3>
                        </div>
                        <p className="text-xs text-[var(--color-text-muted)] mb-4">
                            가장 좋았던 팀부터 순서대로 골라주세요. 한 팀은 한 등수에만 선택할 수 있습니다.
                        </p>
                        <div className="space-y-3">
                            {rankSlots.map((rank) => (
                                <div key={rank} className="flex items-center gap-3">
                                    <span className="w-12 shrink-0 text-sm font-bold text-[var(--color-text-primary)]">
                                        {rank}위
                                    </span>
                                    <select
                                        className="flex-1 h-10 px-3 rounded-lg border border-[var(--color-border-subtle)] bg-white text-sm"
                                        value={value.ranks[rank] ?? ""}
                                        onChange={(e) => setRank(rank, e.target.value ? Number(e.target.value) : null)}
                                    >
                                        <option value="">— 선택 —</option>
                                        {targets.map((t) => (
                                            <option key={t.id} value={t.id} disabled={blocked.has(t.id)}>
                                                {t.name}
                                                {t.members?.length ? ` — ${t.members.join(", ")}` : ""}
                                                {blocked.has(t.id) ? " (본인 소속팀)" : ""}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {showFeedback && (
                    <>
                        <div className={cn("flex items-center gap-2", showRank && "pt-2")}>
                            <MessageSquareText className="w-4 h-4 text-[var(--color-accent)]" />
                            <h3 className="font-bold text-[var(--color-text-primary)]">피드백</h3>
                            <span className="text-xs text-[var(--color-text-muted)]">
                                {requireFeedback ? "팀마다 한마디씩 남겨야 제출할 수 있어요" : "팀마다 한마디씩 남겨주세요"}
                            </span>
                        </div>
                        {targets.map((t) => (
                            <TargetCommentCard
                                key={t.id}
                                target={t}
                                blocked={blocked.has(t.id)}
                                required={requireFeedback}
                                value={value.comments[ck(t.id, null)] ?? ""}
                                onChange={(body) => setComment(t.id, null, body)}
                            />
                        ))}
                    </>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-5">
            {targets.map((t) => {
                const isBlocked = blocked.has(t.id);
                return (
                    <div
                        key={t.id}
                        className={cn(
                            "rounded-xl border bg-white p-5",
                            isBlocked ? "border-zinc-200 opacity-60" : "border-[var(--color-border-subtle)]",
                        )}
                    >
                        <div className="flex items-start justify-between gap-3 mb-4">
                            <div className="min-w-0">
                                <h3 className="font-bold text-[var(--color-text-primary)] flex items-center gap-2">
                                    {t.name}
                                    {isBlocked && (
                                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500">
                                            <Ban className="w-3 h-3" /> 본인 소속팀 — 채점 제외
                                        </span>
                                    )}
                                </h3>
                                {!!t.members?.length && (
                                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                                        {t.members.join(" · ")}
                                    </p>
                                )}
                            </div>
                            {!isBlocked && (
                                <span className="shrink-0 text-sm font-bold text-[var(--color-accent)]">
                                    {targetSum(t.id)} <span className="text-[var(--color-text-muted)] font-normal">/ {maxSum}</span>
                                </span>
                            )}
                        </div>

                        <fieldset disabled={isBlocked} className="space-y-4">
                            {/* 영역 */}
                            {areas.map((a) => {
                                const mode = modeOf(t.id, a);
                                const areaSum = mode === "lump"
                                    ? (value.scores[ask(t.id, a.id)] ?? 0)
                                    : a.criteria.reduce((s, c) => s + (value.scores[csk(t.id, c.id)] ?? 0), 0);
                                return (
                                    <div key={a.id} className="rounded-lg border border-[var(--color-border-subtle)] p-3.5 space-y-3">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <span className="text-sm font-bold text-[var(--color-text-primary)]">{a.label}</span>
                                                <span className="ml-2 text-xs text-[var(--color-text-muted)]">{a.max_score}점</span>
                                                {a.description && (
                                                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{a.description}</p>
                                                )}
                                            </div>
                                            <span className="shrink-0 text-sm font-bold text-[var(--color-accent)]">
                                                {areaSum}<span className="text-[var(--color-text-muted)] font-normal">/{a.max_score}</span>
                                            </span>
                                        </div>

                                        {/* 세부항목이 있으면 방식 토글 */}
                                        {a.criteria.length > 0 && (
                                            <div className="inline-flex rounded-lg border border-[var(--color-border-subtle)] p-0.5 bg-[var(--color-hover)] text-xs">
                                                <button type="button"
                                                    onClick={() => switchAreaMode(t.id, a, "detail")}
                                                    className={cn("inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-medium",
                                                        mode === "detail" ? "bg-white text-[var(--color-accent)] shadow-sm" : "text-[var(--color-text-secondary)]")}>
                                                    <LayoutList className="w-3 h-3" /> 세부항목별
                                                </button>
                                                <button type="button"
                                                    onClick={() => switchAreaMode(t.id, a, "lump")}
                                                    className={cn("inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-medium",
                                                        mode === "lump" ? "bg-white text-[var(--color-accent)] shadow-sm" : "text-[var(--color-text-secondary)]")}>
                                                    <Square className="w-3 h-3" /> 영역 통째
                                                </button>
                                            </div>
                                        )}

                                        {mode === "lump" ? (
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="text-sm text-[var(--color-text-secondary)]">이 영역 점수</span>
                                                <Input type="number" min={0} max={a.max_score} step="0.5"
                                                    className="w-24 shrink-0 text-center"
                                                    value={value.scores[ask(t.id, a.id)] ?? ""}
                                                    onChange={(e) => setKey(ask(t.id, a.id), e.target.value, a.max_score)}
                                                    placeholder="점수" />
                                            </div>
                                        ) : (
                                            <div className="space-y-3 pl-3 border-l-2 border-[var(--color-border-subtle)]">
                                                {a.criteria.map((c) => (
                                                    <SubRow key={c.id}
                                                        c={c}
                                                        score={value.scores[csk(t.id, c.id)] ?? ""}
                                                        onScore={(v) => setKey(csk(t.id, c.id), v, c.max_score)}
                                                        comment={value.comments[ck(t.id, c.id)] ?? ""}
                                                        onComment={(v) => setComment(t.id, c.id, v)} />
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {/* 미분류 기준 */}
                            {criteria.map((c) => (
                                <SubRow key={c.id}
                                    c={c}
                                    score={value.scores[csk(t.id, c.id)] ?? ""}
                                    onScore={(v) => setKey(csk(t.id, c.id), v, c.max_score)}
                                    comment={value.comments[ck(t.id, c.id)] ?? ""}
                                    onComment={(v) => setComment(t.id, c.id, v)} />
                            ))}

                            <div className="pt-2 border-t border-[var(--color-border-subtle)]">
                                <label className="text-sm font-semibold text-[var(--color-text-primary)]">총평</label>
                                <textarea
                                    className="mt-2 w-full min-h-[72px] px-3 py-2 rounded-lg border border-[var(--color-border-subtle)] bg-white text-sm resize-y placeholder:text-[var(--color-text-muted)]"
                                    placeholder="팀 전체에 대한 총평 (선택)"
                                    value={value.comments[ck(t.id, null)] ?? ""}
                                    onChange={(e) => setComment(t.id, null, e.target.value)}
                                />
                            </div>
                        </fieldset>
                    </div>
                );
            })}
        </div>
    );
}

function SubRow({
    c, score, onScore, comment, onComment,
}: {
    c: SheetCriterion;
    score: number | "";
    onScore: (v: string) => void;
    comment: string;
    onComment: (v: string) => void;
}) {
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <span className="text-sm font-semibold text-[var(--color-text-primary)]">{c.label}</span>
                    <span className="ml-2 text-xs text-[var(--color-text-muted)]">{c.max_score}점 만점</span>
                    {c.description && (
                        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{c.description}</p>
                    )}
                </div>
                <Input type="number" min={0} max={c.max_score} step="0.5"
                    className="w-24 shrink-0 text-center" value={score}
                    onChange={(e) => onScore(e.target.value)} placeholder="점수" />
            </div>
            <textarea
                className="w-full min-h-[52px] px-3 py-2 rounded-lg border border-[var(--color-border-subtle)] bg-white text-sm resize-y placeholder:text-[var(--color-text-muted)]"
                placeholder={`${c.label}에 대한 코멘트 (선택)`}
                value={comment}
                onChange={(e) => onComment(e.target.value)}
            />
        </div>
    );
}

function TargetCommentCard({
    target, blocked, required = false, value, onChange,
}: { target: SheetTarget; blocked: boolean; required?: boolean; value: string; onChange: (v: string) => void }) {
    const missing = required && !blocked && !value.trim();
    return (
        <div
            className={cn(
                "rounded-xl border bg-white p-5",
                blocked ? "border-zinc-200 opacity-60" : missing ? "border-rose-200" : "border-[var(--color-border-subtle)]",
            )}
        >
            <h3 className="font-bold text-[var(--color-text-primary)] flex items-center gap-2">
                {target.name}
                {blocked && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500">
                        <Ban className="w-3 h-3" /> 본인 소속팀
                    </span>
                )}
                {missing && (
                    <span className="text-[11px] font-bold text-rose-500">필수</span>
                )}
            </h3>
            {!!target.members?.length && (
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5 mb-2">
                    {target.members.join(" · ")}
                </p>
            )}
            <textarea
                disabled={blocked}
                className={cn(
                    "w-full min-h-[72px] px-3 py-2 rounded-lg border bg-white text-sm resize-y placeholder:text-[var(--color-text-muted)] disabled:bg-zinc-50",
                    missing ? "border-rose-200" : "border-[var(--color-border-subtle)]",
                )}
                placeholder={required ? "이 팀에 대한 피드백을 입력해 주세요" : "이 팀에 대한 피드백 (선택)"}
                value={value}
                onChange={(e) => onChange(e.target.value)}
            />
        </div>
    );
}
