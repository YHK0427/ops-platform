import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, MinusCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { AutosaveProvider, useAutosave, type PanelStatus } from "./autosave";
import { SaveBar } from "./ScoringSettings";
import {
    useDeductions, useSaveDeductions,
    type DeductionRule, type DeductionsGrid, type ScoringRound,
} from "@/hooks/useScoring";

/**
 * 감점 탭 — 팀 × 규정 그리드. 운영자가 팀별로 입력하면 서버가 규정 config로 점수·실격을 계산한다.
 * 심사위원·청중에겐 보이지 않는 운영 내부 화면. 설정 탭과 동일하게 자동 저장된다.
 */
type CellInput = Record<string, unknown>;

const tname = (t: { name: string; display_name?: string | null }) =>
    (t.display_name || "").trim() || t.name;

const buildGrid = (data: DeductionsGrid) => {
    const g: Record<string, CellInput> = {};
    for (const d of data.deductions) g[`${d.target_id}:${d.rule_id}`] = d.input ?? {};
    return g;
};

export function ScoringDeductions({ round }: { round: ScoringRound }) {
    const { data, isLoading } = useDeductions(round.id);

    if (isLoading || !data) {
        return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-muted)]" /></div>;
    }

    if (data.rules.length === 0) {
        return (
            <div className="text-center py-16 text-[var(--color-text-secondary)] rounded-xl border border-dashed border-[var(--color-border-subtle)]">
                <MinusCircle className="w-10 h-10 mx-auto mb-3 text-[var(--color-text-muted)]" />
                감점 규정이 없습니다.
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                    설정 탭의 <b>감점 규정</b>에서 먼저 규정을 만들면 여기서 팀별로 입력할 수 있습니다.
                </p>
            </div>
        );
    }

    return (
        <AutosaveProvider>
            {({ statuses, saveAll }) => <DeductionsGridBody round={round} data={data} statuses={statuses} saveAll={saveAll} />}
        </AutosaveProvider>
    );
}

function DeductionsGridBody({
    round, data, statuses, saveAll,
}: {
    round: ScoringRound;
    data: DeductionsGrid;
    statuses: Record<string, PanelStatus>;
    saveAll: () => Promise<void>;
}) {
    const save = useSaveDeductions(round.id);
    const rules = data.rules;
    // (target_id:rule_id) → input — 초기값은 서버 값과 동일하게 잡아야 마운트 직후 dirty로 오판하지 않는다
    const [grid, setGrid] = useState<Record<string, CellInput>>(() => buildGrid(data));
    const serverGrid = useMemo(() => buildGrid(data), [data]);

    const { isDirty, acceptServer } = useAutosave({
        id: "deductions",
        value: grid,
        canSave: () => true,
        save: async (v) => {
            const body = round.targets.flatMap((t) =>
                rules.map((r) => ({ target_id: t.id, rule_id: r.id, input: v[`${t.id}:${r.id}`] ?? {} })),
            ).filter((x) => Object.keys(x.input).length > 0);
            await save.mutateAsync(body);
        },
        serverValue: serverGrid,
    });

    // 서버 값이 새로 내려와도 편집 중이면 덮어쓰지 않는다
    useEffect(() => {
        if (isDirty) return;
        setGrid(serverGrid);
        acceptServer(serverGrid);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data]);

    // 서버가 저장 시점에 계산한 값 (표시용) — 저장 전엔 이전 값
    const savedPoints = useMemo(() => {
        const m: Record<string, { points: number; disqualified: boolean }> = {};
        for (const d of data.deductions) m[`${d.target_id}:${d.rule_id}`] = { points: d.points, disqualified: d.disqualified };
        return m;
    }, [data]);

    const setCell = (tid: number, rid: number, input: CellInput) =>
        setGrid((g) => ({ ...g, [`${tid}:${rid}`]: input }));

    return (
        <div className="space-y-4">
            <SaveBar statuses={statuses} saveAll={saveAll} />
            <p className="text-sm text-[var(--color-text-secondary)]">
                팀별 감점을 입력하면 결과의 <b>최종점수 = 심사 + 청중 − 감점</b>에 자동 반영됩니다.
            </p>

            <div className="space-y-3">
                {round.targets.map((t) => {
                    const teamTotal = rules.reduce((s, r) => s + (savedPoints[`${t.id}:${r.id}`]?.points ?? 0), 0);
                    const dq = rules.some((r) => savedPoints[`${t.id}:${r.id}`]?.disqualified);
                    return (
                        <div key={t.id} className={cn(
                            "rounded-xl border bg-white p-4",
                            dq ? "border-rose-200 bg-rose-50/40" : "border-[var(--color-border-subtle)]",
                        )}>
                            <div className="flex items-center justify-between mb-3">
                                <span className="font-bold text-[var(--color-text-primary)]">{tname(t)}</span>
                                <span className={cn("text-sm font-bold", dq ? "text-rose-600" : "text-[var(--color-accent)]")}>
                                    {dq ? "실격" : `− ${teamTotal}점`}
                                </span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {rules.map((r) => (
                                    <RuleCell
                                        key={r.id}
                                        rule={r}
                                        input={grid[`${t.id}:${r.id}`] ?? {}}
                                        onChange={(inp) => setCell(t.id, r.id, inp)}
                                        computed={savedPoints[`${t.id}:${r.id}`]}
                                    />
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function RuleCell({
    rule, input, onChange, computed,
}: {
    rule: DeductionRule;
    input: CellInput;
    onChange: (input: CellInput) => void;
    computed?: { points: number; disqualified: boolean };
}) {
    return (
        <div className="rounded-lg border border-[var(--color-border-subtle)] p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[var(--color-text-primary)]">{rule.label}</span>
                {computed && (computed.disqualified ? (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-600">
                        <AlertTriangle className="w-3 h-3" /> 실격
                    </span>
                ) : computed.points ? (
                    <span className="text-xs font-bold text-[var(--color-accent)]">− {computed.points}점</span>
                ) : null)}
            </div>

            {rule.kind === "TIME" && (
                <div className="space-y-1">
                    <Input type="datetime-local" className="h-8 text-sm"
                        value={(input.submitted_at as string) ?? ""}
                        onChange={(e) => onChange({ ...input, submitted_at: e.target.value })} />
                    <p className="text-[11px] text-[var(--color-text-muted)]">
                        실제 제출시각 — 마감 기준으로 자동 판정 (비우면 감점 없음)
                    </p>
                </div>
            )}

            {rule.kind === "DURATION" && (() => {
                const raw = input.actual_seconds;
                const has = raw !== undefined && raw !== null && raw !== "";
                const total = has ? Number(raw) : 0;
                const min: number | "" = has ? Math.floor(total / 60) : "";
                const sec: number | "" = has ? total % 60 : "";
                const target = Number(rule.config.target_seconds) || 0;
                const set = (m: number, s: number) => onChange({ actual_seconds: m * 60 + s });
                return (
                    <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                            <span className="text-xs text-[var(--color-text-muted)]">실제 발표시간</span>
                            <Input type="number" min={0} className="w-20 h-9 px-2"
                                value={min} placeholder="분"
                                onChange={(e) => set(Number(e.target.value) || 0, sec === "" ? 0 : sec)} />
                            <span className="text-xs">분</span>
                            <Input type="number" min={0} max={59} className="w-20 h-9 px-2"
                                value={sec} placeholder="초"
                                onChange={(e) => set(min === "" ? 0 : min, Number(e.target.value) || 0)} />
                            <span className="text-xs">초</span>
                        </div>
                        <p className="text-[11px] text-[var(--color-text-muted)]">
                            기준 {Math.floor(target / 60)}분 {target % 60}초 대비 자동 감점 (비우면 감점 없음)
                        </p>
                    </div>
                );
            })()}

            {rule.kind === "FLAG" && (
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={!!input.checked}
                        onCheckedChange={(v) => onChange(v ? { checked: true } : {})} />
                    해당됨 (− {(rule.config.points as number) ?? 0}점)
                </label>
            )}
        </div>
    );
}
