import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, Lock, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAttendanceStreaks, useMembers } from "@/hooks/useMembers";
import { cn } from "@/lib/utils";
import { usePenaltyRulesQuery, useSavePenaltyRules } from "@/hooks/usePenaltyRules";
import {
    ATTENDANCE_RULE_KEYS, ATTENDANCE_RULE_LABEL, EXCUSE_KEYS, EXCUSE_LABEL, streakGrantsOnNextAttend,
    type PenaltyRules as Rules, type RulePair,
} from "@/lib/penaltyRules";

type NumKey = "milestone_every" | "milestone_fine" | "streak_count" | "streak_score" | "eviction_limit" | "warn_from" | "low_deposit";
type PairKey = "ppt_email_late" | "ppt_email_missing" | "homework_missing";

/** 서버 penalty_rules.py 의 범위와 같다 */
const RANGE: Record<NumKey | "score" | "deposit", [number, number]> = {
    score: [0, 50], deposit: [0, 100_000],
    milestone_every: [1, 100], milestone_fine: [0, 100_000],
    streak_count: [1, 20], streak_score: [0, 20],
    eviction_limit: [1, 100], warn_from: [1, 100], low_deposit: [0, 1_000_000],
};

const EXCUSE_FULL: Record<string, string> = { PRE: "사전 사유서", POST: "사후 사유서", NONE: "사유서 없음" };

export default function PenaltyRules() {
    const { data, isLoading, isError } = usePenaltyRulesQuery();
    const { mutate: save, isPending: saving } = useSavePenaltyRules();
    // 편집 중인 값 — 불러온 규칙(서명)이 바뀌면(저장·다른 사람 수정) 서버 값으로 돌아간다
    const [edit, setEdit] = useState<{ sig: string; rules: Rules } | null>(null);
    const draft: Rules | null = data ? (edit?.sig === data.signature ? edit.rules : data.rules) : null;
    const setDraft = (rules: Rules) => { if (data) setEdit({ sig: data.signature, rules }); };

    const canEdit = !!data?.can_edit;
    const dirty = useMemo(() => !!data && !!draft && JSON.stringify(draft) !== JSON.stringify(data.rules), [data, draft]);
    const errors = useMemo(() => (draft ? validate(draft) : []), [draft]);
    const [confirmStreak, setConfirmStreak] = useState(false);

    if (isLoading || !data || !draft) {
        return (
            <div className="flex flex-col h-full">
                <PageHeader title="벌점 규칙" />
                {isError ? (
                    <p className="py-12 text-center text-sm text-[var(--color-text-muted)]">벌점 규칙을 불러오지 못했어요. 새로고침해 주세요.</p>
                ) : <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-muted)]" /></div>}
            </div>
        );
    }

    const d = data.defaults;
    const streakChanged = streakRuleChanged(data.rules, draft);
    const doSave = () => save({ rules: draft, base_signature: data.signature });
    const setNum = (k: NumKey, v: number) => setDraft({ ...draft, [k]: v });
    const setPair = (k: PairKey, part: keyof RulePair, v: number) => setDraft({ ...draft, [k]: { ...draft[k], [part]: v } });
    const setAtt = (k: typeof ATTENDANCE_RULE_KEYS[number], e: typeof EXCUSE_KEYS[number], part: keyof RulePair, v: number) =>
        setDraft({ ...draft, [k]: { ...draft[k], [e]: { ...draft[k][e], [part]: v } } });

    return (
        <div className="flex flex-col h-full">
            <PageHeader
                title="벌점 규칙"
                subtitle="정산·벌점 부여·위험 표시에 쓰는 기준 (이 기수만)"
                actions={canEdit ? (
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" disabled={saving || JSON.stringify(draft) === JSON.stringify(d)}
                            onClick={() => setDraft(structuredClone(d))}>
                            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />기본값으로
                        </Button>
                        {dirty && (
                            <Button variant="ghost" size="sm" disabled={saving} onClick={() => setDraft(structuredClone(data.rules))}>되돌리기</Button>
                        )}
                        <Button size="sm" disabled={!dirty || errors.length > 0 || saving}
                            title={errors.length > 0 ? errors[0] : undefined}
                            onClick={() => streakChanged ? setConfirmStreak(true) : doSave()}
                            className="bg-rose-600 hover:bg-rose-700 text-white">
                            {saving ? "저장 중..." : "저장"}
                        </Button>
                    </div>
                ) : undefined}
            />

            <div className="flex-1 overflow-y-auto p-3 md:p-6">
                <div className="max-w-4xl space-y-4 md:space-y-6">
                    {!canEdit && (
                        <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text-secondary)] break-keep">
                            <Lock className="w-4 h-4 shrink-0 text-[var(--color-text-muted)]" />
                            보기 전용이에요. 수정은 관리자 또는 {data.editor_departments.join("·")} 운영진만 할 수 있어요.
                        </div>
                    )}
                    {errors.length > 0 && (
                        <div className="px-4 py-3 rounded-lg border border-rose-300 bg-rose-50 text-sm text-rose-700 space-y-0.5 break-keep">
                            {errors.map((e) => <p key={e}>{e}</p>)}
                        </div>
                    )}

                    {/* 출결 */}
                    <Section title="출결 벌점" desc="정산할 때 출결 상태와 사유서 종류로 매겨져요. 인정 사유가 승인된 지각·조퇴는 면제.">
                        <div className="divide-y divide-[var(--color-border-subtle)]">
                            {ATTENDANCE_RULE_KEYS.map((k) => (
                                <div key={k} className="py-3 first:pt-0 last:pb-0 grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-2 sm:gap-4 sm:items-center">
                                    <p className="text-sm font-semibold text-[var(--color-text-primary)]">{ATTENDANCE_RULE_LABEL[k].short}</p>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4">
                                        {EXCUSE_KEYS.map((e) => (
                                            <div key={e} className="flex items-center gap-2 sm:block">
                                                <p className="w-20 sm:w-auto shrink-0 text-xs text-[var(--color-text-muted)] sm:mb-1">{EXCUSE_FULL[e] ?? EXCUSE_LABEL[e].short}</p>
                                                <PairInput value={draft[k][e]} def={d[k][e]} disabled={!canEdit}
                                                    onChange={(part, v) => setAtt(k, e, part, v)} />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Section>

                    {/* 과제 */}
                    <Section title="과제 벌점" desc="과제·리뷰·피드백은 하나라도 미제출이면 한 번만 매겨요. 공결이면 면제.">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                            {([
                                ["ppt_email_late", "PPT 이메일 지연 제출"],
                                ["ppt_email_missing", "PPT 이메일 미제출"],
                                ["homework_missing", "과제·리뷰·피드백 미제출"],
                            ] as [PairKey, string][]).map(([k, label]) => (
                                <div key={k}>
                                    <p className="text-xs text-[var(--color-text-muted)] mb-1">{label}</p>
                                    <PairInput value={draft[k]} def={d[k]} disabled={!canEdit} onChange={(part, v) => setPair(k, part, v)} />
                                </div>
                            ))}
                        </div>
                    </Section>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                        <Section title="누적벌점 벌금" desc="디파짓과 별도로 걷는 벌금이에요.">
                            <Sentence>
                                누적벌점
                                <Num value={draft.milestone_every} def={d.milestone_every} k="milestone_every" disabled={!canEdit} onChange={setNum} />
                                점마다
                                <Num value={draft.milestone_fine} def={d.milestone_fine} k="milestone_fine" disabled={!canEdit} onChange={setNum} wide />
                                원
                            </Sentence>
                        </Section>

                        <Section title="연속 출석 상점" desc="마감된 세션 기준, 출석만 이어서 세요. 지각·조퇴·결석·공결·미처리면 끊겨요.">
                            <Sentence>
                                <Num value={draft.streak_count} def={d.streak_count} k="streak_count" disabled={!canEdit} onChange={setNum} />
                                회 연속 출석마다 상점 +
                                <Num value={draft.streak_score} def={d.streak_score} k="streak_score" disabled={!canEdit} onChange={setNum} />
                                점
                            </Sentence>
                            {streakChanged && (
                                <p className="mt-3 flex gap-1.5 text-xs text-amber-700 break-keep">
                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                    지금 이어지는 연속 출석에도 바로 적용돼요. 저장할 때 달라지는 사람을 먼저 보여줘요.
                                </p>
                            )}
                        </Section>

                        <Section title="퇴출 기준" desc="대시보드·멤버 상세의 퇴출 대상·경고 표시에 써요.">
                            <div className="space-y-2">
                                <Sentence>
                                    순점수가 -
                                    <Num value={draft.eviction_limit} def={d.eviction_limit} k="eviction_limit" disabled={!canEdit} onChange={setNum} />
                                    점 아래로 내려가면 퇴출 대상
                                </Sentence>
                                <Sentence>
                                    순점수 -
                                    <Num value={draft.warn_from} def={d.warn_from} k="warn_from" disabled={!canEdit} onChange={setNum} />
                                    점 이하부터 경고
                                </Sentence>
                                {draft.warn_from > draft.eviction_limit ? (
                                    <p className="text-xs font-medium text-rose-600 break-keep">
                                        경고 시작(-{draft.warn_from})이 퇴출 기준(-{draft.eviction_limit})보다 커요. 경고 시작을 낮추거나 퇴출 기준을 올려주세요.
                                    </p>
                                ) : Number.isInteger(draft.eviction_limit) && Number.isInteger(draft.warn_from) && (
                                    <p className="text-xs text-[var(--color-text-muted)]">
                                        지금 설정: <b className="font-semibold text-[var(--color-text-secondary)]">-{draft.eviction_limit + 1}점부터 퇴출 대상</b>,
                                        {" "}-{draft.warn_from} ~ -{draft.eviction_limit}점은 경고
                                    </p>
                                )}
                            </div>
                        </Section>

                        <Section title="디파짓 충전 요망" desc="멤버 목록·대시보드에 충전 요망으로 표시돼요.">
                            <Sentence>
                                잔액
                                <Num value={draft.low_deposit} def={d.low_deposit} k="low_deposit" disabled={!canEdit} onChange={setNum} wide />
                                원 미만
                            </Sentence>
                        </Section>
                    </div>

                    <p className="text-xs text-[var(--color-text-muted)] leading-relaxed pb-6 break-keep">
                        바꾼 규칙은 <b className="font-semibold text-[var(--color-text-secondary)]">다음 정산(마감)부터</b> 적용돼요. 이미 마감된 장부 금액은 바뀌지 않아요.
                        기본값과 다른 칸에는 아래에 기본값이 보여요.
                    </p>
                </div>
            </div>
            {confirmStreak && (
                <StreakChangeDialog old={data.rules} next={draft}
                    onCancel={() => setConfirmStreak(false)}
                    onConfirm={() => { setConfirmStreak(false); doSave(); }} />
            )}
        </div>
    );
}

/** 연속 출석 상점 계산이 바뀌는 저장인가 — 횟수가 바뀌거나, 상점이 꺼짐(0점)↔켜짐. 점수만 바뀌는 건 앞으로 받을 점수만 달라져서 묻지 않는다 */
function streakRuleChanged(a: Rules, b: Rules) {
    return a.streak_count !== b.streak_count || (a.streak_score > 0) !== (b.streak_score > 0);
}

/** 연속 출석 기준을 바꾸면 이미 이어지는 연속에도 새 기준이 바로 적용된다 — 다음 출석 때 상점이 달라지는 사람을 미리 보여준다 */
function StreakChangeDialog({ old, next, onCancel, onConfirm }: {
    old: Rules; next: Rules; onCancel: () => void; onConfirm: () => void;
}) {
    const { data: streaks, isLoading: l1 } = useAttendanceStreaks();
    const { data: members, isLoading: l2 } = useMembers();
    const loading = l1 || l2;
    const affected = useMemo(() => {
        if (!streaks || !members) return [];
        return members.flatMap((m) => {
            const s = streaks.members[String(m.id)];
            if (!s) return [];
            const before = streakGrantsOnNextAttend(s.run, s.granted, old.streak_count, old.streak_score);
            const after = streakGrantsOnNextAttend(s.run, s.granted, next.streak_count, next.streak_score);
            return before !== after ? [{ id: m.id, name: m.name, run: s.run, before, after }] : [];
        }).sort((a, b) => b.after - a.after || b.run - a.run);
    }, [streaks, members, old, next]);
    const countChanged = old.streak_count !== next.streak_count;
    const turningOn = old.streak_score <= 0 && next.streak_score > 0;
    const score = next.streak_score;
    return (
        <AlertDialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
            <AlertDialogContent className="w-[calc(100%-2rem)] max-w-lg rounded-lg p-5 sm:p-6">
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        {countChanged ? `연속 출석 횟수를 ${old.streak_count}회 → ${next.streak_count}회로 바꿀까요?`
                            : turningOn ? "연속 출석 상점을 다시 줄까요?" : "연속 출석 상점을 끌까요?"}
                    </AlertDialogTitle>
                    <AlertDialogDescription asChild>
                        <div className="space-y-1.5 text-sm text-[var(--color-text-secondary)] break-keep">
                            <p>지금 이어지고 있는 연속 출석도 <b className="font-semibold">새 기준으로 다시 세요.</b> 이미 받은 상점은 그대로예요.</p>
                            <p>{next.streak_score <= 0 ? "다음 정산부터 연속 출석 상점이 안 들어가요."
                                : turningOn || next.streak_count < old.streak_count
                                    ? "그래서 다음 출석 때 밀린 상점이 한꺼번에 들어갈 수 있어요."
                                    : "그래서 다음 상점이 원래보다 늦게 들어갈 수 있어요."}</p>
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="rounded-lg border border-[var(--color-border)] overflow-hidden">
                    <p className="px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] bg-[var(--color-hover)]">
                        다음 세션에 출석하면 상점이 달라지는 사람{loading ? "" : ` ${affected.length}명`}
                    </p>
                    {loading ? (
                        <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-[var(--color-text-muted)]" /></div>
                    ) : affected.length === 0 ? (
                        <p className="px-3 py-3 text-sm text-[var(--color-text-muted)]">지금 연속 기록으로는 없어요.</p>
                    ) : (
                        <ul className="max-h-56 overflow-y-auto divide-y divide-[var(--color-border-subtle)] text-sm">
                            {affected.map((a) => (
                                <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
                                    <span className="text-[var(--color-text-primary)]">
                                        {a.name}<span className="ml-1.5 text-xs text-[var(--color-text-muted)]">지금 연속 {a.run}회</span>
                                    </span>
                                    <span className="shrink-0 tabular-nums text-xs text-[var(--color-text-secondary)]">
                                        상점 {a.before}개 → <b className={cn("font-semibold", a.after > a.before ? "text-amber-700" : "text-[var(--color-text-primary)]")}>{a.after}개</b>
                                        {a.after > 0 && <span className="text-[var(--color-text-muted)]"> (+{a.after * score}점)</span>}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                <p className="text-xs text-[var(--color-text-muted)] break-keep">
                    지금 연속 기록과 이미 받은 상점으로 계산한 예상이에요. 실제 지급은 정산 탭 미리보기에서 확인할 수 있어요.
                </p>
                <AlertDialogFooter>
                    <AlertDialogCancel>취소</AlertDialogCancel>
                    <AlertDialogAction onClick={onConfirm} className="bg-rose-600 hover:bg-rose-700 text-white">바꾸고 저장</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

function validate(r: Rules): string[] {
    const errs: string[] = [];
    const inRange = (v: number, [lo, hi]: [number, number]) => Number.isInteger(v) && v >= lo && v <= hi;
    const pairs: RulePair[] = [
        ...ATTENDANCE_RULE_KEYS.flatMap((k) => EXCUSE_KEYS.map((e) => r[k][e])),
        r.ppt_email_late, r.ppt_email_missing, r.homework_missing,
    ];
    if (pairs.some((p) => !inRange(p.score, RANGE.score))) errs.push(`벌점은 ${RANGE.score[0]}~${RANGE.score[1]}점 사이로 적어주세요.`);
    if (pairs.some((p) => !inRange(p.deposit, RANGE.deposit))) errs.push(`차감액은 0~${RANGE.deposit[1].toLocaleString()}원 사이로 적어주세요.`);
    const nums: [NumKey, string][] = [
        ["milestone_every", "누적벌점 단위"], ["milestone_fine", "누적벌점 벌금"], ["streak_count", "연속 출석 횟수"],
        ["streak_score", "연속 출석 상점"], ["eviction_limit", "퇴출 기준"], ["warn_from", "경고 시작"], ["low_deposit", "충전 요망 금액"],
    ];
    for (const [k, label] of nums) {
        if (!inRange(r[k], RANGE[k])) errs.push(`${label}은(는) ${RANGE[k][0].toLocaleString()}~${RANGE[k][1].toLocaleString()} 사이로 적어주세요.`);
    }
    if (r.warn_from > r.eviction_limit) errs.push("경고 시작 점수는 퇴출 기준보다 클 수 없어요.");
    return errs;
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
    return (
        <Card className="bg-[var(--color-surface)] border-[var(--color-border)]">
            <CardContent className="p-4 md:p-6">
                <h2 className="text-sm font-bold text-[var(--color-text-primary)]">{title}</h2>
                {desc && <p className="text-xs text-[var(--color-text-muted)] mt-1 mb-4 leading-relaxed break-keep">{desc}</p>}
                {!desc && <div className="mb-4" />}
                {children}
            </CardContent>
        </Card>
    );
}

function Sentence({ children }: { children: React.ReactNode }) {
    return <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-[var(--color-text-secondary)]">{children}</div>;
}

function NumBox({ value, def, onChange, disabled, wide, suffix, min, max }: {
    value: number; def: number; onChange: (v: number) => void; disabled?: boolean; wide?: boolean; suffix?: string; min: number; max: number;
}) {
    const changed = value !== def;
    const invalid = !Number.isInteger(value) || value < min || value > max;
    return (
        <span className="inline-flex flex-col">
            <span className="inline-flex items-center gap-1">
                <input
                    type="number" inputMode="numeric" min={min} max={max} step={1}
                    value={Number.isNaN(value) ? "" : value}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
                    className={cn(
                        "h-9 rounded-md border bg-white px-2 text-sm text-right tabular-nums text-[var(--color-text-primary)]",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
                        "disabled:bg-[var(--color-hover)] disabled:cursor-not-allowed",
                        invalid ? "border-rose-500 ring-1 ring-rose-500/30" : changed ? "border-amber-400" : "border-[var(--color-border)]",
                        wide ? "w-24" : "w-16",
                    )}
                />
                {suffix && <span className="text-xs text-[var(--color-text-muted)]">{suffix}</span>}
            </span>
            {invalid
                ? <span className="text-[10px] text-rose-600 mt-0.5 text-right pr-0.5">{min.toLocaleString()}~{max.toLocaleString()}</span>
                : changed && <span className="text-[10px] text-amber-600 mt-0.5 text-right pr-0.5">기본 {def.toLocaleString()}</span>}
        </span>
    );
}

function Num({ value, def, k, onChange, disabled, wide }: {
    value: number; def: number; k: NumKey; onChange: (k: NumKey, v: number) => void; disabled?: boolean; wide?: boolean;
}) {
    return <NumBox value={value} def={def} onChange={(v) => onChange(k, v)} disabled={disabled} wide={wide} min={RANGE[k][0]} max={RANGE[k][1]} />;
}

function PairInput({ value, def, onChange, disabled }: {
    value: RulePair; def: RulePair; onChange: (part: keyof RulePair, v: number) => void; disabled?: boolean;
}) {
    return (
        <div className="flex items-start gap-3">
            <NumBox value={value.score} def={def.score} onChange={(v) => onChange("score", v)} disabled={disabled} suffix="점" min={0} max={RANGE.score[1]} />
            <NumBox value={value.deposit} def={def.deposit} onChange={(v) => onChange("deposit", v)} disabled={disabled} wide suffix="원" min={0} max={RANGE.deposit[1]} />
        </div>
    );
}
