import { useState } from "react";
import {
    AlertTriangle, Check, Filter, Link2, Loader2, PenLine, Plus, RotateCcw, Trash2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
    fetchParticipantSubmission, useDeleteParticipant, usePatchParticipant, useProxySubmit,
    useScoringParticipants,
    type Participant, type RosterEntry, type ScoringRole, type ScoringRound,
} from "@/hooks/useScoring";
import {
    ScoreSheet, emptySheet, fromSheetValue, toSheetValue, type SheetValue,
} from "./ScoreSheet";

const ROLE_KR: Record<string, string> = { JUDGE: "심사위원", OBSERVER: "참관위원", ANY: "무관" };

export function ScoringSubmissions({ round }: { round: ScoringRound }) {
    const { data, isLoading } = useScoringParticipants(round.id);
    const [proxyFor, setProxyFor] = useState<{ participant?: Participant; open: boolean }>({ open: false });
    const [roleFilter, setRoleFilter] = useState<"ALL" | ScoringRole>("ALL");
    const [groupFilter, setGroupFilter] = useState<string[]>([]);

    if (isLoading || !data) {
        return (
            <div className="flex justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-muted)]" />
            </div>
        );
    }

    const submitted = data.participants.filter((p) => p.submitted_at);
    const unmatched = submitted.filter((p) => !p.matched_roster_id);
    // 명단을 안 만들 수도 있다 — 그땐 '누가 명단에 있나'가 아니라 '누가 냈나'만 본다.
    // (그룹만 지정해두면 참가자가 폼에서 자기 그룹을 고르므로 그룹별 집계는 그대로 가능)
    const hasRoster = data.roster.length > 0;

    // 명단 각 줄의 실제 그룹 — 제출자가 폼에서 고른 값이 우선, 없으면 명단에 태깅된 기본 그룹
    const rowGroup = (rosterId: number, fallback?: string | null) => {
        const pid = data.roster_submitted[rosterId];
        const p = data.participants.find((x) => x.id === pid);
        return p?.group_label ?? fallback ?? null;
    };

    const groupsAvailable = Array.from(
        new Set(
            data.roster
                .map((r) => rowGroup(r.id, r.group_label))
                .filter((g): g is string => !!g),
        ),
    );

    const visibleRoster = data.roster.filter((r) => {
        if (roleFilter !== "ALL" && r.role !== "ANY" && r.role !== roleFilter) return false;
        if (groupFilter.length === 0) return true;
        const g = rowGroup(r.id, r.group_label);
        return groupFilter.includes(g ?? "미분류");
    });

    const visibleSubmitted = visibleRoster.filter((r) => data.roster_submitted[r.id]).length;

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-[var(--color-text-secondary)]">
                    명단 {visibleRoster.length}명 중{" "}
                    <b className="text-[var(--color-text-primary)]">{visibleSubmitted}명</b> 제출
                    {(roleFilter !== "ALL" || groupFilter.length > 0) && (
                        <span className="ml-1 text-xs text-[var(--color-text-muted)]">
                            (필터 적용 · 전체 {data.roster.length}명)
                        </span>
                    )}
                    <span className="ml-2 text-xs text-[var(--color-text-muted)]">
                        전체 제출 {submitted.length}건
                    </span>
                </div>
                <Button size="sm" onClick={() => setProxyFor({ open: true })}>
                    <Plus className="w-4 h-4 mr-1" /> 점수 입력
                </Button>
            </div>

            {hasRoster ? (
                <SubmissionOverview
                    roster={data.roster}
                    rosterSubmitted={data.roster_submitted}
                    rowGroup={rowGroup}
                    unmatchedCount={unmatched.length}
                    onPickGroup={(g) => setGroupFilter(groupFilter.includes(g) ? [] : [g])}
                    activeGroups={groupFilter}
                />
            ) : (
                <OpenParticipationOverview submitted={submitted} />
            )}

            {hasRoster && (
                <SubmissionFilterBar
                    groupsAvailable={groupsAvailable}
                    role={roleFilter}
                    groups={groupFilter}
                    onRole={setRoleFilter}
                    onGroups={setGroupFilter}
                />
            )}

            {/* 명단이 없으면 '미매칭'이라는 개념 자체가 없다 — 경고로 띄우지 않는다 */}
            {hasRoster && unmatched.length > 0 && (
                <UnmatchedPanel round={round} unmatched={unmatched} rosterCount={data.roster.length} />
            )}

            <ParticipantTable
                round={round}
                participants={submitted}
                hasRoster={hasRoster}
                onEdit={(p) => setProxyFor({ participant: p, open: true })}
            />

            {hasRoster && (
            <section className="rounded-xl border border-[var(--color-border-subtle)] bg-white overflow-hidden">
                <div className="px-5 py-3 border-b border-[var(--color-border-subtle)]">
                    <h2 className="font-bold text-[var(--color-text-primary)]">명단 체크리스트</h2>
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                        누가 제출했는지 확인합니다. 이름이 조금 달라도 매칭해두면 여기에 체크됩니다.
                    </p>
                </div>
                <div className="overflow-auto max-h-[520px]">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-10" />
                                <TableHead>이름</TableHead>
                                <TableHead>역할</TableHead>
                                <TableHead>그룹</TableHead>
                                <TableHead>비고</TableHead>
                                <TableHead>입력한 이름</TableHead>
                                <TableHead className="text-right">작업</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {visibleRoster.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center py-8 text-[var(--color-text-muted)]">
                                        {data.roster.length === 0
                                            ? "명단이 비어 있습니다. 설정 탭에서 등록하세요."
                                            : "이 조건에 해당하는 사람이 없습니다."}
                                    </TableCell>
                                </TableRow>
                            )}
                            {visibleRoster.map((r) => {
                                const pid = data.roster_submitted[r.id];
                                const p = data.participants.find((x) => x.id === pid);
                                return (
                                    <TableRow key={r.id}>
                                        <TableCell>
                                            {p ? (
                                                <span className="inline-flex w-5 h-5 rounded-full bg-emerald-50 items-center justify-center">
                                                    <Check className="w-3 h-3 text-emerald-600" />
                                                </span>
                                            ) : (
                                                <span className="inline-flex w-5 h-5 rounded-full bg-zinc-100 items-center justify-center">
                                                    <X className="w-3 h-3 text-zinc-400" />
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell className="font-medium">{r.name}</TableCell>
                                        <TableCell className="text-[var(--color-text-secondary)]">
                                            {ROLE_KR[r.role]}
                                        </TableCell>
                                        <TableCell className="text-xs">
                                            {rowGroup(r.id, r.group_label) ? (
                                                <span className="px-2 py-0.5 rounded-full bg-sky-50 text-sky-600">
                                                    {rowGroup(r.id, r.group_label)}
                                                </span>
                                            ) : (
                                                <span className="text-[var(--color-text-muted)]">—</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-[var(--color-text-muted)] text-xs">
                                            {r.note}
                                        </TableCell>
                                        <TableCell className="text-xs">
                                            {p ? (
                                                <span className="text-[var(--color-text-secondary)]">
                                                    {p.entered_name}
                                                </span>
                                            ) : (
                                                <span className="text-[var(--color-text-muted)]">미제출</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() =>
                                                    setProxyFor({ participant: p, open: true })
                                                }
                                            >
                                                <PenLine className="w-3.5 h-3.5 mr-1" />
                                                {p ? "수정" : "점수 입력"}
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            </section>
            )}

            <ProxySubmitDialog
                round={round}
                participant={proxyFor.participant}
                open={proxyFor.open}
                onClose={() => setProxyFor({ open: false })}
            />
        </div>
    );
}

/**
 * 명단을 안 만든 경우의 개요 — '몇 명 중 몇 명'이 아니라 '누가 얼마나 냈는지'만 보여준다.
 * 자유 참가(아무나 링크로 들어와 투표)에서는 분모가 존재하지 않는다.
 */
function OpenParticipationOverview({ submitted }: { submitted: Participant[] }) {
    const judges = submitted.filter((p) => p.role === "JUDGE").length;
    const observers = submitted.filter((p) => p.role === "OBSERVER");

    const byGroup = new Map<string, number>();
    for (const p of observers) {
        const g = p.group_label || "미분류";
        byGroup.set(g, (byGroup.get(g) ?? 0) + 1);
    }
    const groups = [...byGroup.entries()].sort((a, b) => b[1] - a[1]);

    return (
        <section className="rounded-xl border border-[var(--color-border-subtle)] bg-white p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="font-bold text-[var(--color-text-primary)]">제출 개요 (자유 참가)</h2>
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                        명단을 등록하지 않아 <b>링크를 받은 사람은 누구나</b> 참여할 수 있습니다.
                        미제출자를 셀 기준이 없으므로 제출된 것만 집계합니다.
                    </p>
                </div>
                <div className="text-right">
                    <div className="text-2xl font-bold text-[var(--color-text-primary)]">
                        {submitted.length}
                        <span className="text-sm font-normal text-[var(--color-text-muted)]"> 명 제출</span>
                    </div>
                </div>
            </div>

            <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-rose-50 text-rose-700">
                    심사위원 <b>{judges}명</b>
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-sky-50 text-sky-700">
                    참관위원 <b>{observers.length}명</b>
                </span>
                {groups.map(([g, n]) => (
                    <span
                        key={g}
                        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-[var(--color-hover)] text-[var(--color-text-secondary)]"
                    >
                        {g} <b className="text-[var(--color-text-primary)]">{n}명</b>
                    </span>
                ))}
            </div>

            <p className="text-xs text-[var(--color-text-muted)]">
                누가 냈는지 확인하려면 설정 탭에서 명단을 등록하세요. 등록하면 제출자 이름이 명단과 자동
                매칭되고, 미제출자 체크리스트가 생깁니다.
            </p>
        </section>
    );
}

/** 제출자 목록 — 명단 유무와 무관하게 '실제로 낸 사람'을 전부 보여준다. */
function ParticipantTable({
    round, participants, hasRoster, onEdit,
}: {
    round: ScoringRound;
    participants: Participant[];
    hasRoster: boolean;
    onEdit: (p: Participant) => void;
}) {
    const del = useDeleteParticipant(round.id);

    return (
        <section className="rounded-xl border border-[var(--color-border-subtle)] bg-white overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--color-border-subtle)]">
                <h2 className="font-bold text-[var(--color-text-primary)]">제출자 목록</h2>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                    실제로 제출한 사람 전부입니다{hasRoster ? " (명단에 없는 사람 포함)" : ""}.
                </p>
            </div>
            <div className="overflow-auto max-h-[520px]">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>이름</TableHead>
                            <TableHead>역할</TableHead>
                            <TableHead>그룹</TableHead>
                            {hasRoster && <TableHead>명단 매칭</TableHead>}
                            <TableHead>제출시각</TableHead>
                            <TableHead className="text-right">작업</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {participants.length === 0 && (
                            <TableRow>
                                <TableCell
                                    colSpan={hasRoster ? 6 : 5}
                                    className="text-center py-8 text-[var(--color-text-muted)]"
                                >
                                    아직 제출이 없습니다.
                                </TableCell>
                            </TableRow>
                        )}
                        {participants.map((p) => (
                            <TableRow key={p.id}>
                                <TableCell className="font-medium">{p.entered_name}</TableCell>
                                <TableCell className="text-[var(--color-text-secondary)]">
                                    {ROLE_KR[p.role]}
                                </TableCell>
                                <TableCell className="text-xs">
                                    {p.group_label ? (
                                        <span className="px-2 py-0.5 rounded-full bg-sky-50 text-sky-600">
                                            {p.group_label}
                                        </span>
                                    ) : (
                                        <span className="text-[var(--color-text-muted)]">—</span>
                                    )}
                                </TableCell>
                                {hasRoster && (
                                    <TableCell className="text-xs">
                                        {p.matched_roster_id ? (
                                            <span className="inline-flex items-center gap-1 text-emerald-600">
                                                <Check className="w-3 h-3" /> 연결됨
                                            </span>
                                        ) : (
                                            <span className="text-amber-600">미연결</span>
                                        )}
                                    </TableCell>
                                )}
                                <TableCell className="text-xs text-[var(--color-text-muted)]">
                                    {p.submitted_at
                                        ? new Date(p.submitted_at).toLocaleString("ko-KR", {
                                            month: "numeric",
                                            day: "numeric",
                                            hour: "2-digit",
                                            minute: "2-digit",
                                        })
                                        : ""}
                                </TableCell>
                                <TableCell className="text-right whitespace-nowrap">
                                    <Button size="sm" variant="ghost" onClick={() => onEdit(p)}>
                                        <PenLine className="w-3.5 h-3.5 mr-1" />
                                        수정
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="text-rose-500"
                                        onClick={() => {
                                            if (confirm(`'${p.entered_name}'의 제출을 삭제할까요? 점수도 함께 사라집니다.`)) {
                                                del.mutate(p.id, {
                                                    onSuccess: () => toast.success("삭제됨"),
                                                    onError: () => toast.error("삭제 실패"),
                                                });
                                            }
                                        }}
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </section>
    );
}

/**
 * 제출 개요 — 그룹별로 몇 명 중 몇 명이 냈는지, 누가 아직 안 냈는지 한눈에.
 * 카드를 누르면 아래 체크리스트가 그 그룹으로 필터된다.
 */
function SubmissionOverview({
    roster, rosterSubmitted, rowGroup, unmatchedCount, onPickGroup, activeGroups,
}: {
    roster: RosterEntry[];
    rosterSubmitted: Record<number, number>;
    rowGroup: (rosterId: number, fallback?: string | null) => string | null;
    unmatchedCount: number;
    onPickGroup: (g: string) => void;
    activeGroups: string[];
}) {
    // 그룹 → {제출, 전체, 미제출자 이름}
    const buckets = new Map<string, { done: number; total: number; missing: string[] }>();
    for (const r of roster) {
        const g = rowGroup(r.id, r.group_label) ?? "미분류";
        const b = buckets.get(g) ?? { done: 0, total: 0, missing: [] };
        b.total += 1;
        if (rosterSubmitted[r.id]) b.done += 1;
        else b.missing.push(r.name);
        buckets.set(g, b);
    }

    const totalDone = roster.filter((r) => rosterSubmitted[r.id]).length;
    const pct = roster.length ? Math.round((totalDone / roster.length) * 100) : 0;
    const groups = [...buckets.entries()].sort((a, b) => b[1].total - a[1].total);

    if (roster.length === 0) return null;

    return (
        <section className="rounded-xl border border-[var(--color-border-subtle)] bg-white p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="font-bold text-[var(--color-text-primary)]">제출 개요</h2>
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                        그룹 카드를 누르면 아래 명단이 그 그룹만 보입니다.
                    </p>
                </div>
                <div className="text-right">
                    <div className="text-2xl font-bold text-[var(--color-text-primary)]">
                        {totalDone}
                        <span className="text-sm font-normal text-[var(--color-text-muted)]">
                            {" "}/ {roster.length}명
                        </span>
                    </div>
                    <div className="text-xs text-[var(--color-text-muted)]">전체 제출률 {pct}%</div>
                </div>
            </div>

            {/* 전체 진행 바 */}
            <div className="h-2 rounded-full bg-[var(--color-hover)] overflow-hidden">
                <div
                    className="h-full rounded-full bg-[var(--color-accent)] transition-all"
                    style={{ width: `${pct}%` }}
                />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {groups.map(([g, b]) => {
                    const gp = b.total ? Math.round((b.done / b.total) * 100) : 0;
                    const active = activeGroups.includes(g);
                    return (
                        <button
                            key={g}
                            type="button"
                            onClick={() => onPickGroup(g)}
                            className={cn(
                                "text-left p-4 rounded-xl border transition-colors",
                                active
                                    ? "border-[var(--color-accent)] bg-[var(--color-accent-dim)]"
                                    : "border-[var(--color-border-subtle)] hover:border-[var(--color-accent)]/40",
                            )}
                        >
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="font-bold text-[var(--color-text-primary)] truncate">{g}</span>
                                <span className="text-sm font-bold text-[var(--color-text-primary)]">
                                    {b.done}
                                    <span className="text-xs font-normal text-[var(--color-text-muted)]">
                                        /{b.total}
                                    </span>
                                </span>
                            </div>

                            <div className="mt-2 h-1.5 rounded-full bg-[var(--color-hover)] overflow-hidden">
                                <div
                                    className={cn(
                                        "h-full rounded-full transition-all",
                                        gp === 100 ? "bg-emerald-500" : "bg-[var(--color-accent)]",
                                    )}
                                    style={{ width: `${gp}%` }}
                                />
                            </div>

                            <p className="mt-2 text-xs text-[var(--color-text-muted)] line-clamp-2">
                                {b.missing.length === 0 ? (
                                    <span className="text-emerald-600 font-medium">전원 제출 완료</span>
                                ) : (
                                    <>미제출 {b.missing.length}명 · {b.missing.slice(0, 5).join(", ")}
                                        {b.missing.length > 5 ? ` 외 ${b.missing.length - 5}명` : ""}</>
                                )}
                            </p>
                        </button>
                    );
                })}
            </div>

            {unmatchedCount > 0 && (
                <p className="text-xs text-amber-700">
                    명단에 없는 제출 {unmatchedCount}건이 있습니다 — 아래에서 명단에 연결하면 이 개요에 반영됩니다.
                </p>
            )}
        </section>
    );
}

/** 제출현황 필터 — 역할/그룹으로 명단을 좁혀 본다 (표시만 거르고 집계는 건드리지 않는다). */
function SubmissionFilterBar({
    groupsAvailable, role, groups, onRole, onGroups,
}: {
    groupsAvailable: string[];
    role: "ALL" | ScoringRole;
    groups: string[];
    onRole: (r: "ALL" | ScoringRole) => void;
    onGroups: (g: string[]) => void;
}) {
    const toggle = (g: string) =>
        onGroups(groups.includes(g) ? groups.filter((x) => x !== g) : [...groups, g]);
    const filtered = role !== "ALL" || groups.length > 0;

    return (
        <section className="rounded-xl border border-[var(--color-border-subtle)] bg-white p-4">
            <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--color-text-secondary)]">
                    <Filter className="w-3.5 h-3.5" />
                    보기
                </span>

                <div className="inline-flex rounded-lg border border-[var(--color-border-subtle)] p-0.5 bg-[var(--color-hover)]">
                    {([
                        ["ALL", "전체"],
                        ["JUDGE", "심사위원"],
                        ["OBSERVER", "참관위원"],
                    ] as const).map(([key, label]) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => onRole(key)}
                            className={cn(
                                "px-3 py-1.5 text-xs font-bold rounded-md transition-colors",
                                role === key
                                    ? "bg-white text-[var(--color-accent)] shadow-sm"
                                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
                            )}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {groupsAvailable.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-[var(--color-text-muted)]">그룹</span>
                        {groupsAvailable.map((g) => (
                            <button
                                key={g}
                                type="button"
                                onClick={() => toggle(g)}
                                className={cn(
                                    "px-2.5 py-1 text-xs font-medium rounded-full border transition-colors",
                                    groups.includes(g)
                                        ? "border-sky-400 bg-sky-50 text-sky-700"
                                        : "border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-sky-300",
                                )}
                            >
                                {g}
                            </button>
                        ))}
                    </div>
                )}

                {filtered && (
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs ml-auto"
                        onClick={() => {
                            onRole("ALL");
                            onGroups([]);
                        }}
                    >
                        <RotateCcw className="w-3.5 h-3.5 mr-1" />
                        전체 보기
                    </Button>
                )}
            </div>
        </section>
    );
}

/** 명단에 없는 이름으로 들어온 제출 — 점수는 이미 반영되어 있고, 여기서 명단에 연결한다. */
function UnmatchedPanel({
    round, unmatched, rosterCount,
}: { round: ScoringRound; unmatched: Participant[]; rosterCount: number }) {
    const patch = usePatchParticipant(round.id);
    const del = useDeleteParticipant(round.id);

    return (
        <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-5 space-y-3">
            <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <h2 className="font-bold text-amber-900">명단에 없는 제출 {unmatched.length}건</h2>
            </div>
            <p className="text-xs text-amber-800">
                점수는 이미 집계에 반영되어 있습니다. 아래에서 명단의 실제 인물과 연결하면 체크리스트가 채워집니다.
                (이름 오타·동명이인 처리용)
            </p>

            <div className="space-y-2">
                {unmatched.map((p) => (
                    <div
                        key={p.id}
                        className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-white border border-amber-200"
                    >
                        <span className="font-bold text-[var(--color-text-primary)]">{p.entered_name}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-hover)] text-[var(--color-text-secondary)]">
                            {ROLE_KR[p.role]}
                        </span>
                        {p.group_label && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-sky-50 text-sky-600">
                                {p.group_label}
                            </span>
                        )}

                        <div className="flex items-center gap-1 ml-auto">
                            <Link2 className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                            <select
                                className="h-8 px-2 rounded-lg border border-[var(--color-border-subtle)] bg-white text-sm"
                                defaultValue=""
                                disabled={rosterCount === 0}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    if (!v) return;
                                    patch.mutate(
                                        { participantId: p.id, matched_roster_id: Number(v) },
                                        {
                                            onSuccess: () => toast.success("명단에 연결했습니다"),
                                            onError: () => toast.error("연결 실패"),
                                        },
                                    );
                                }}
                            >
                                <option value="">
                                    {rosterCount === 0 ? "명단이 비어 있음" : "— 명단에서 연결 —"}
                                </option>
                                {p.suggestions.length > 0 && (
                                    <optgroup label="비슷한 이름">
                                        {p.suggestions.map((s) => (
                                            <option key={s.id} value={s.id}>
                                                {s.name} {s.note ? `(${s.note})` : ""}
                                            </option>
                                        ))}
                                    </optgroup>
                                )}
                            </select>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="text-rose-500"
                                onClick={() => {
                                    if (confirm(`'${p.entered_name}'의 제출을 삭제할까요? 점수도 함께 사라집니다.`)) {
                                        del.mutate(p.id, {
                                            onSuccess: () => toast.success("삭제됨"),
                                            onError: () => toast.error("삭제 실패"),
                                        });
                                    }
                                }}
                            >
                                <Trash2 className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>
                ))}
            </div>
            <RosterPicker round={round} unmatched={unmatched} />
        </section>
    );
}

/** 유사 후보가 없을 때를 위한 전체 명단 선택기 (위 select에는 후보만 넣어 좁게 유지). */
function RosterPicker({ round, unmatched }: { round: ScoringRound; unmatched: Participant[] }) {
    const patch = usePatchParticipant(round.id);
    const [pid, setPid] = useState("");
    const [rid, setRid] = useState("");

    if (round.roster.length === 0) return null;

    return (
        <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-amber-200">
            <div className="space-y-1">
                <Label className="text-xs text-amber-900">제출자</Label>
                <select
                    className="h-9 px-2 rounded-lg border border-[var(--color-border-subtle)] bg-white text-sm"
                    value={pid}
                    onChange={(e) => setPid(e.target.value)}
                >
                    <option value="">— 선택 —</option>
                    {unmatched.map((p) => (
                        <option key={p.id} value={p.id}>
                            {p.entered_name}
                        </option>
                    ))}
                </select>
            </div>
            <div className="space-y-1">
                <Label className="text-xs text-amber-900">명단 전체에서 찾기</Label>
                <select
                    className="h-9 px-2 rounded-lg border border-[var(--color-border-subtle)] bg-white text-sm"
                    value={rid}
                    onChange={(e) => setRid(e.target.value)}
                >
                    <option value="">— 선택 —</option>
                    {round.roster.map((r) => (
                        <option key={r.id} value={r.id}>
                            {r.name} {r.note ? `(${r.note})` : ""}
                        </option>
                    ))}
                </select>
            </div>
            <Button
                size="sm"
                disabled={!pid || !rid || patch.isPending}
                onClick={() =>
                    patch.mutate(
                        { participantId: Number(pid), matched_roster_id: Number(rid) },
                        {
                            onSuccess: () => {
                                toast.success("연결했습니다");
                                setPid("");
                                setRid("");
                            },
                            onError: () => toast.error("연결 실패"),
                        },
                    )
                }
            >
                연결
            </Button>
        </div>
    );
}

/** 운영진 입력 — 종이로 받은 점수를 대신 넣거나, 기존 제출을 고친다.
 *  is_proxy는 DB에 남기지만 화면에는 표시하지 않는다(불공정해 보인다는 피드백). */
function ProxySubmitDialog({
    round, participant, open, onClose,
}: {
    round: ScoringRound;
    participant?: Participant;
    open: boolean;
    onClose: () => void;
}) {
    const proxy = useProxySubmit(round.id);
    const [name, setName] = useState("");
    const [role, setRole] = useState<ScoringRole>("JUDGE");
    const [group, setGroup] = useState("");
    const [sheet, setSheet] = useState<SheetValue>(emptySheet());
    const [blocked, setBlocked] = useState<number[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadedFor, setLoadedFor] = useState<number | null>(null);

    // 다이얼로그가 열릴 때 대상에 맞춰 초기화 (기존 제출이면 불러온다)
    if (open && participant && loadedFor !== participant.id) {
        setLoadedFor(participant.id);
        setLoading(true);
        setName(participant.entered_name);
        setRole(participant.role);
        setGroup(participant.group_label ?? "");
        fetchParticipantSubmission(participant.id)
            .then((s) => {
                setSheet(toSheetValue(s.scores, s.ranks, s.comments));
                setBlocked(s.blocked_target_ids);
            })
            .catch(() => toast.error("기존 제출을 불러오지 못했습니다"))
            .finally(() => setLoading(false));
    }
    if (open && !participant && loadedFor !== 0) {
        setLoadedFor(0);
        setName("");
        setRole("JUDGE");
        setGroup("");
        setSheet(emptySheet());
        setBlocked([]);
    }

    const close = () => {
        setLoadedFor(null);
        onClose();
    };

    const submit = () => {
        if (!participant && !name.trim()) {
            toast.error("이름을 입력하세요");
            return;
        }
        const { scores, ranks, comments } = fromSheetValue(sheet);
        proxy.mutate(
            {
                participant_id: participant?.id ?? null,
                name: name.trim(),
                role,
                group_label: role === "OBSERVER" ? group || null : null,
                scores,
                ranks,
                comments,
            },
            {
                onSuccess: () => {
                    toast.success("저장됨");
                    close();
                },
                onError: () => toast.error("저장 실패"),
            },
        );
    };

    return (
        <Dialog open={open} onOpenChange={(o) => !o && close()}>
            <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{participant ? "제출 수정" : "점수 입력"}</DialogTitle>
                    <DialogDescription>
                        운영진이 대신 입력합니다. 마감된 뒤에도 입력할 수 있습니다.
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <div className="flex justify-center py-10">
                        <Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-muted)]" />
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <Label>이름</Label>
                                <Input
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="심사위원 이름"
                                    disabled={!!participant}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>역할</Label>
                                <select
                                    className="w-full h-9 px-3 rounded-lg border border-[var(--color-border-subtle)] bg-white text-sm"
                                    value={role}
                                    onChange={(e) => setRole(e.target.value as ScoringRole)}
                                >
                                    <option value="JUDGE">심사위원</option>
                                    <option value="OBSERVER">참관위원</option>
                                </select>
                            </div>
                        </div>

                        {role === "OBSERVER" && (round.observer_groups ?? []).length > 0 && (
                            <div className="space-y-2">
                                <Label>소그룹</Label>
                                <select
                                    className="w-full h-9 px-3 rounded-lg border border-[var(--color-border-subtle)] bg-white text-sm"
                                    value={group}
                                    onChange={(e) => setGroup(e.target.value)}
                                >
                                    <option value="">— 미분류 —</option>
                                    {(round.observer_groups ?? []).map((g) => (
                                        <option key={g} value={g}>
                                            {g}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <ScoreSheet
                            role={role}
                            observerMode={round.observer_mode}
                            rankSlots={round.rank_points.map((r) => r.rank)}
                            criteria={round.criteria}
                            targets={round.targets}
                            blockedTargetIds={blocked}
                            value={sheet}
                            onChange={setSheet}
                        />
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={close}>
                        취소
                    </Button>
                    <Button onClick={submit} disabled={proxy.isPending || loading}>
                        {proxy.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                        저장
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
