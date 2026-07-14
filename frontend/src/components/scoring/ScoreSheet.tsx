import { Ban, Trophy } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { CommentEntry, ObserverMode, RankEntry, ScoreEntry, ScoringRole } from "@/hooks/useScoring";

/**
 * 채점 시트 — 공개 폼과 운영진 대리입력이 공유하는 컨트롤드 컴포넌트.
 *
 * 내부 상태는 평평한 맵으로 들고 있다가 제출 시 API 배열로 변환한다.
 * (배열로 들고 있으면 입력할 때마다 탐색·치환이 번거로움)
 */

export interface SheetCriterion {
    id: number;
    label: string;
    description?: string | null;
    max_score: number;
}

export interface SheetTarget {
    id: number;
    name: string;
    members?: string[]; // 팀원 이름 — 어느 팀인지 알아보게 하는 표시용
}

export interface SheetValue {
    scores: Record<string, number>;   // `${targetId}:${criterionId}` → 점수
    comments: Record<string, string>; // `${targetId}:${criterionId}` 또는 `${targetId}:overall` → 내용
    ranks: Record<number, number>;    // 등수 → targetId
}

/**
 * 등수 목록을 사람이 읽는 문구로. 등수 개수는 운영자가 자유롭게 바꾸므로,
 * 화면 어디서든 이 함수를 써서 실제 설정과 문구가 어긋나지 않게 한다.
 * 예: [1,2,3] → "1·2·3위", [1] → "1위"
 */
export function rankLabel(ranks: number[]): string {
    const sorted = [...ranks].sort((a, b) => a - b);
    if (sorted.length === 0) return "등수";
    return `${sorted.join("·")}위`;
}

export const emptySheet = (): SheetValue => ({ scores: {}, comments: {}, ranks: {} });

const sk = (t: number, c: number) => `${t}:${c}`;
const ck = (t: number, c: number | null) => `${t}:${c ?? "overall"}`;

export function toSheetValue(
    scores: ScoreEntry[], ranks: RankEntry[], comments: CommentEntry[],
): SheetValue {
    const v = emptySheet();
    for (const s of scores) v.scores[sk(s.target_id, s.criterion_id)] = s.score;
    for (const r of ranks) v.ranks[r.rank] = r.target_id;
    for (const c of comments) v.comments[ck(c.target_id, c.criterion_id ?? null)] = c.body;
    return v;
}

export function fromSheetValue(v: SheetValue): {
    scores: ScoreEntry[]; ranks: RankEntry[]; comments: CommentEntry[];
} {
    const scores: ScoreEntry[] = Object.entries(v.scores).map(([key, score]) => {
        const [t, c] = key.split(":").map(Number);
        return { target_id: t, criterion_id: c, score };
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
    criteria: SheetCriterion[];
    targets: SheetTarget[];
    blockedTargetIds: number[];
    value: SheetValue;
    onChange: (v: SheetValue) => void;
}

export function ScoreSheet({
    role, observerMode, rankSlots, criteria, targets, blockedTargetIds, value, onChange,
}: Props) {
    // 참관위원 + RANK 모드 → 점수 입력 대신 등수 선택
    const rankMode = role === "OBSERVER" && observerMode === "RANK";
    const blocked = new Set(blockedTargetIds);

    const setScore = (t: number, c: number, raw: string, max: number) => {
        const next = { ...value.scores };
        if (raw === "") {
            delete next[sk(t, c)];
        } else {
            const n = Number(raw);
            if (Number.isNaN(n)) return;
            next[sk(t, c)] = Math.max(0, Math.min(max, n));
        }
        onChange({ ...value, scores: next });
    };

    const setComment = (t: number, c: number | null, body: string) =>
        onChange({ ...value, comments: { ...value.comments, [ck(t, c)]: body } });

    const setRank = (rank: number, targetId: number | null) => {
        const next = { ...value.ranks };
        // 같은 팀이 다른 등수에 이미 있으면 그 자리를 비운다 (한 팀은 한 등수만)
        for (const [r, t] of Object.entries(next)) {
            if (targetId && t === targetId && Number(r) !== rank) delete next[Number(r)];
        }
        if (targetId) next[rank] = targetId;
        else delete next[rank];
        onChange({ ...value, ranks: next });
    };

    if (rankMode) {
        return (
            <div className="space-y-5">
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

                {targets.map((t) => (
                    <TargetCommentCard
                        key={t.id}
                        target={t}
                        blocked={blocked.has(t.id)}
                        value={value.comments[ck(t.id, null)] ?? ""}
                        onChange={(body) => setComment(t.id, null, body)}
                    />
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-5">
            {targets.map((t) => {
                const isBlocked = blocked.has(t.id);
                const sum = criteria.reduce((acc, c) => acc + (value.scores[sk(t.id, c.id)] ?? 0), 0);
                const maxSum = criteria.reduce((acc, c) => acc + c.max_score, 0);

                return (
                    <div
                        key={t.id}
                        className={cn(
                            "rounded-xl border bg-white p-5",
                            isBlocked
                                ? "border-zinc-200 opacity-60"
                                : "border-[var(--color-border-subtle)]",
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
                                    {sum} <span className="text-[var(--color-text-muted)] font-normal">/ {maxSum}</span>
                                </span>
                            )}
                        </div>

                        <fieldset disabled={isBlocked} className="space-y-4">
                            {criteria.map((c) => (
                                <div key={c.id} className="space-y-2">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                                                {c.label}
                                            </span>
                                            <span className="ml-2 text-xs text-[var(--color-text-muted)]">
                                                {c.max_score}점 만점
                                            </span>
                                            {c.description && (
                                                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                                                    {c.description}
                                                </p>
                                            )}
                                        </div>
                                        <Input
                                            type="number"
                                            min={0}
                                            max={c.max_score}
                                            step="0.5"
                                            className="w-24 shrink-0 text-center"
                                            value={value.scores[sk(t.id, c.id)] ?? ""}
                                            onChange={(e) => setScore(t.id, c.id, e.target.value, c.max_score)}
                                            placeholder="점수"
                                        />
                                    </div>
                                    <textarea
                                        className="w-full min-h-[52px] px-3 py-2 rounded-lg border border-[var(--color-border-subtle)] bg-white text-sm resize-y placeholder:text-[var(--color-text-muted)]"
                                        placeholder={`${c.label}에 대한 코멘트 (선택)`}
                                        value={value.comments[ck(t.id, c.id)] ?? ""}
                                        onChange={(e) => setComment(t.id, c.id, e.target.value)}
                                    />
                                </div>
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

function TargetCommentCard({
    target, blocked, value, onChange,
}: { target: SheetTarget; blocked: boolean; value: string; onChange: (v: string) => void }) {
    return (
        <div
            className={cn(
                "rounded-xl border bg-white p-5",
                blocked ? "border-zinc-200 opacity-60" : "border-[var(--color-border-subtle)]",
            )}
        >
            <h3 className="font-bold text-[var(--color-text-primary)] flex items-center gap-2">
                {target.name}
                {blocked && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500">
                        <Ban className="w-3 h-3" /> 본인 소속팀
                    </span>
                )}
            </h3>
            {!!target.members?.length && (
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5 mb-2">
                    {target.members.join(" · ")}
                </p>
            )}
            <textarea
                disabled={blocked}
                className="w-full min-h-[72px] px-3 py-2 rounded-lg border border-[var(--color-border-subtle)] bg-white text-sm resize-y placeholder:text-[var(--color-text-muted)] disabled:bg-zinc-50"
                placeholder="이 팀에 대한 피드백 (선택)"
                value={value}
                onChange={(e) => onChange(e.target.value)}
            />
        </div>
    );
}
