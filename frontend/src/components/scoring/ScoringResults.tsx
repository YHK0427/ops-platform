import { useRef, useState } from "react";
import {
    Bar, BarChart, CartesianGrid, Legend, PolarAngleAxis, PolarGrid, PolarRadiusAxis,
    Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
    ChevronRight, Download, Filter, Loader2, MessageSquare, RotateCcw, Search, Trophy,
    UserSearch, Wifi, WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
    downloadScoringExcel, fetchParticipantSubmission, useScoringResults,
    type Results, type ScoringRound, type Submission, type Submitter,
} from "@/hooks/useScoring";

const JUDGE_COLOR = "#F43F5E";   // rose-500 (accent)
const OBSERVER_COLOR = "#38BDF8"; // sky-400
const RANK_COLORS = ["#F59E0B", "#94A3B8", "#B45309"]; // 금·은·동

export function ScoringResults({ round, connected }: { round: ScoringRound; connected: boolean }) {
    const [roleFilter, setRoleFilter] = useState<"ALL" | "JUDGE" | "OBSERVER">("ALL");
    const [groupFilter, setGroupFilter] = useState<string[]>([]);
    const { data, isLoading } = useScoringResults(round.id, { role: roleFilter, groups: groupFilter });
    const [downloading, setDownloading] = useState(false);

    if (isLoading || !data) {
        return (
            <div className="flex justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-muted)]" />
            </div>
        );
    }

    const noSubmissions = data.judge_submitted + data.observer_submitted === 0;
    const filtered = roleFilter !== "ALL" || groupFilter.length > 0;

    const download = async () => {
        setDownloading(true);
        try {
            await downloadScoringExcel(round.id, round.name);
        } catch {
            toast.error("엑셀 다운로드 실패");
        } finally {
            setDownloading(false);
        }
    };

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    <Stat label="심사위원" value={`${data.judge_submitted}명`} />
                    <Stat label="참관위원" value={`${data.observer_submitted}명`} />
                    {Object.entries(data.observer_by_group ?? {}).map(([g, n]) => (
                        <Stat key={g} label={g} value={`${n}명`} subtle />
                    ))}
                    <span
                        className={cn(
                            "inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full",
                            connected ? "bg-emerald-50 text-emerald-600" : "bg-zinc-100 text-zinc-500",
                        )}
                        title={connected ? "실시간 연결됨 — 제출이 들어오면 자동 갱신됩니다" : "실시간 연결 끊김"}
                    >
                        {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                        {connected ? "실시간" : "연결 끊김"}
                    </span>
                </div>
                <Button size="sm" variant="outline" onClick={download} disabled={downloading}>
                    {downloading ? (
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                        <Download className="w-4 h-4 mr-1" />
                    )}
                    엑셀 내보내기
                </Button>
            </div>

            {!noSubmissions && (
                <FilterBar
                    round={round}
                    groupsAvailable={Object.keys(data.observer_by_group ?? {})}
                    role={roleFilter}
                    groups={groupFilter}
                    onRole={setRoleFilter}
                    onGroups={setGroupFilter}
                    filtered={filtered}
                />
            )}

            {noSubmissions ? (
                <div className="text-center py-16 text-[var(--color-text-secondary)] rounded-xl border border-dashed border-[var(--color-border-subtle)]">
                    <Trophy className="w-10 h-10 mx-auto mb-3 text-[var(--color-text-muted)]" />
                    아직 제출된 점수가 없습니다.
                    <p className="text-xs text-[var(--color-text-muted)] mt-1">
                        링크를 열고 배포하면 제출이 들어오는 대로 여기에 실시간으로 반영됩니다.
                    </p>
                </div>
            ) : (
                <>
                    <RankTable data={data} round={round} />
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                        <TotalChart data={data} />
                        <CriteriaRadar data={data} round={round} />
                    </div>
                    {round.observer_mode === "RANK" && <RankVotesChart data={data} />}
                    <JudgeMatrix data={data} />
                    <SubmitterList data={data} round={round} />
                    <CommentsPanel data={data} round={round} />
                </>
            )}
        </div>
    );
}

/**
 * 결과 필터 — 누구의 점수만으로 순위를 볼지 고른다.
 * 서버가 그 부분집합만으로 재집계하므로, 필터를 걸면 순위가 실제로 달라진다.
 */
function FilterBar({
    round, groupsAvailable, role, groups, onRole, onGroups, filtered,
}: {
    round: ScoringRound;
    groupsAvailable: string[];
    role: "ALL" | "JUDGE" | "OBSERVER";
    groups: string[];
    onRole: (r: "ALL" | "JUDGE" | "OBSERVER") => void;
    onGroups: (g: string[]) => void;
    filtered: boolean;
}) {
    const toggleGroup = (g: string) =>
        onGroups(groups.includes(g) ? groups.filter((x) => x !== g) : [...groups, g]);

    const scopeNote =
        role === "JUDGE"
            ? `심사위원 점수만 — ${round.judge_weight}점 만점 기준`
            : role === "OBSERVER"
                ? `참관위원 점수만 — ${round.observer_weight}점 만점 기준`
                : null;

    return (
        <section className="rounded-xl border border-[var(--color-border-subtle)] bg-white p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--color-text-secondary)]">
                    <Filter className="w-3.5 h-3.5" />
                    누구 점수로 볼까요
                </span>

                {/* 세그먼트 컨트롤 — 한 번 클릭으로 전환 */}
                <div className="inline-flex rounded-lg border border-[var(--color-border-subtle)] p-0.5 bg-[var(--color-hover)]">
                    {([
                        ["ALL", "전체"],
                        ["JUDGE", "심사위원만"],
                        ["OBSERVER", "참관위원만"],
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

                {/* 참관위원 소그룹 — 심사위원만 보기일 땐 의미 없으니 숨긴다 */}
                {role !== "JUDGE" && groupsAvailable.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-[var(--color-text-muted)]">참관위원 그룹</span>
                        {groupsAvailable.map((g) => (
                            <button
                                key={g}
                                type="button"
                                onClick={() => toggleGroup(g)}
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
                        전체로 되돌리기
                    </Button>
                )}
            </div>

            {filtered && (
                <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                    <b>부분 집계 중</b> — 선택한 사람들의 점수만으로 순위를 다시 계산했습니다.
                    {scopeNote ? ` ${scopeNote}.` : ""}
                    {groups.length > 0 ? ` 참관위원은 ${groups.join(", ")}만 반영.` : ""}
                </p>
            )}
        </section>
    );
}

function Stat({ label, value, subtle }: { label: string; value: string; subtle?: boolean }) {
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full",
                subtle
                    ? "bg-sky-50 text-sky-700"
                    : "bg-[var(--color-hover)] text-[var(--color-text-secondary)]",
            )}
        >
            <span>{label}</span>
            <b className="text-[var(--color-text-primary)]">{value}</b>
        </span>
    );
}

// ── 순위 테이블 ──────────────────────────────────────────────────────────────

function RankTable({ data, round }: { data: Results; round: ScoringRound }) {
    return (
        <section className="rounded-xl border border-[var(--color-border-subtle)] bg-white overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--color-border-subtle)]">
                <h2 className="font-bold text-[var(--color-text-primary)]">순위</h2>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                    심사위원 {round.judge_weight}점 + 참관위원 {round.observer_weight}점 = {" "}
                    {Number(round.judge_weight) + Number(round.observer_weight)}점 만점
                </p>
            </div>
            <div className="overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-14">순위</TableHead>
                            <TableHead>팀</TableHead>
                            <TableHead className="text-right">심사위원</TableHead>
                            <TableHead className="text-right">참관위원</TableHead>
                            <TableHead className="text-right">총점</TableHead>
                            {round.criteria.map((c) => (
                                <TableHead key={c.id} className="text-right whitespace-nowrap">
                                    {c.label}
                                    <span className="text-[10px] text-[var(--color-text-muted)] ml-1">
                                        /{c.max_score}
                                    </span>
                                </TableHead>
                            ))}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {data.results.map((r) => (
                            <TableRow key={r.target_id} className={r.rank === 1 ? "bg-amber-50/60" : undefined}>
                                <TableCell className="font-bold">
                                    {r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : r.rank}
                                </TableCell>
                                <TableCell className="font-semibold">{r.name}</TableCell>
                                <TableCell className="text-right text-[var(--color-text-secondary)]">
                                    {r.judge_points}
                                </TableCell>
                                <TableCell className="text-right text-[var(--color-text-secondary)]">
                                    {r.observer_points}
                                </TableCell>
                                <TableCell className="text-right font-bold text-[var(--color-accent)]">
                                    {r.total}
                                </TableCell>
                                {round.criteria.map((c) => (
                                    <TableCell key={c.id} className="text-right text-[var(--color-text-muted)]">
                                        {r.criterion_avg[c.id] ?? 0}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </section>
    );
}

// ── 총점 스택 바 ─────────────────────────────────────────────────────────────

function TotalChart({ data }: { data: Results }) {
    const chart = data.results.map((r) => ({
        name: r.name,
        심사위원: r.judge_points,
        참관위원: r.observer_points,
    }));

    return (
        <Panel title="팀별 총점" subtitle="심사위원 / 참관위원 기여분을 나눠서 표시">
            <ResponsiveContainer width="100%" height={Math.max(220, chart.length * 46)}>
                <BarChart data={chart} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="심사위원" stackId="a" fill={JUDGE_COLOR} radius={[0, 0, 0, 0]} />
                    <Bar dataKey="참관위원" stackId="a" fill={OBSERVER_COLOR} radius={[0, 4, 4, 0]} />
                </BarChart>
            </ResponsiveContainer>
        </Panel>
    );
}

// ── 기준별 레이더 ────────────────────────────────────────────────────────────

const RADAR_PALETTE = ["#F43F5E", "#38BDF8", "#34D399", "#FBBF24", "#A78BFA", "#FB7185", "#22D3EE"];

function CriteriaRadar({ data, round }: { data: Results; round: ScoringRound }) {
    // 팀이 6개면 다 겹쳐서 못 읽는다 → 기본은 상위 3팀만, 나머지는 칩으로 켜고 끈다
    const top3 = data.results.slice(0, 3).map((r) => r.target_id);
    const [shown, setShown] = useState<number[]>(top3);

    // 필터가 바뀌어 팀 목록이 달라지면 선택도 다시 상위 3팀으로
    const idsKey = data.results.map((r) => r.target_id).join(",");
    const prevKey = useRef(idsKey);
    if (prevKey.current !== idsKey) {
        prevKey.current = idsKey;
        setShown(top3);
    }

    const toggle = (id: number) =>
        setShown(shown.includes(id) ? shown.filter((x) => x !== id) : [...shown, id]);

    const visible = data.results.filter((r) => shown.includes(r.target_id));

    // 기준별 배점이 달라 절대 점수를 겹치면 왜곡된다 → 만점 대비 % 로 정규화
    const chart = round.criteria.map((c) => {
        const row: Record<string, string | number> = { criterion: c.label };
        for (const r of visible) {
            const avg = r.criterion_avg[c.id] ?? 0;
            row[r.name] = c.max_score > 0 ? Math.round((avg / c.max_score) * 100) : 0;
        }
        return row;
    });

    // 색은 전체 순위 기준으로 고정 — 칩을 껐다 켜도 팀 색이 바뀌지 않게
    const colorOf = (id: number) =>
        RADAR_PALETTE[data.results.findIndex((r) => r.target_id === id) % RADAR_PALETTE.length];

    if (round.criteria.length < 3) {
        return (
            <Panel title="기준별 강약점" subtitle="기준이 3개 이상일 때 레이더로 비교됩니다">
                <div className="h-[220px] flex items-center justify-center text-sm text-[var(--color-text-muted)]">
                    심사 기준을 3개 이상 만들면 팀별 강약점을 비교할 수 있습니다.
                </div>
            </Panel>
        );
    }

    return (
        <Panel
            title="기준별 강약점"
            subtitle="기준마다 배점이 달라 만점 대비 %로 환산해 비교 · 팀을 골라서 보세요"
        >
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
                {data.results.map((r) => {
                    const on = shown.includes(r.target_id);
                    return (
                        <button
                            key={r.target_id}
                            type="button"
                            onClick={() => toggle(r.target_id)}
                            className={cn(
                                "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border transition-colors",
                                on
                                    ? "text-[var(--color-text-primary)]"
                                    : "border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]",
                            )}
                            style={
                                on
                                    ? {
                                        borderColor: colorOf(r.target_id),
                                        backgroundColor: `${colorOf(r.target_id)}14`,
                                    }
                                    : undefined
                            }
                        >
                            <span
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: on ? colorOf(r.target_id) : "#D4D4D8" }}
                            />
                            {r.name}
                        </button>
                    );
                })}
                {shown.length !== data.results.length && (
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs"
                        onClick={() => setShown(data.results.map((r) => r.target_id))}
                    >
                        전체 보기
                    </Button>
                )}
            </div>

            {visible.length === 0 ? (
                <div className="h-[260px] flex items-center justify-center text-sm text-[var(--color-text-muted)]">
                    비교할 팀을 하나 이상 선택하세요.
                </div>
            ) : (
                <ResponsiveContainer width="100%" height={280}>
                    <RadarChart data={chart}>
                        <PolarGrid stroke="#E5E7EB" />
                        <PolarAngleAxis dataKey="criterion" tick={{ fontSize: 11 }} />
                        <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(v) => `${v}%`} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        {visible.map((r) => (
                            <Radar
                                key={r.target_id}
                                name={r.name}
                                dataKey={r.name}
                                stroke={colorOf(r.target_id)}
                                fill={colorOf(r.target_id)}
                                fillOpacity={0.12}
                            />
                        ))}
                    </RadarChart>
                </ResponsiveContainer>
            )}
        </Panel>
    );
}

// ── 참관위원 등수 득표 ───────────────────────────────────────────────────────

function RankVotesChart({ data }: { data: Results }) {
    const slots = Array.from(
        new Set(data.results.flatMap((r) => Object.keys(r.rank_votes).map(Number))),
    ).sort((a, b) => a - b);

    if (slots.length === 0) {
        return (
            <Panel title="참관위원 득표" subtitle="아직 등수 투표가 없습니다">
                <div className="h-[160px] flex items-center justify-center text-sm text-[var(--color-text-muted)]">
                    참관위원이 등수를 선택하면 여기에 표시됩니다.
                </div>
            </Panel>
        );
    }

    const chart = data.results.map((r) => {
        const row: Record<string, string | number> = { name: r.name };
        for (const s of slots) row[`${s}위`] = r.rank_votes[s] ?? 0;
        return row;
    });

    return (
        <Panel title="참관위원 득표" subtitle="등수별 득표수 — 몰표인지 갈렸는지 확인">
            <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chart} margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {slots.map((s, i) => (
                        <Bar
                            key={s}
                            dataKey={`${s}위`}
                            stackId="v"
                            fill={RANK_COLORS[i] ?? "#CBD5E1"}
                        />
                    ))}
                </BarChart>
            </ResponsiveContainer>
        </Panel>
    );
}

// ── 심사위원별 매트릭스 (관대·엄격 편차) ─────────────────────────────────────

function JudgeMatrix({ data }: { data: Results }) {
    if (data.judges.length === 0) return null;

    const maxSum = data.round.criteria.reduce((a, c) => a + c.max_score, 0);
    // 색 농도로 관대/엄격을 한눈에
    const shade = (v: number | undefined) => {
        if (v === undefined || maxSum === 0) return undefined;
        const ratio = v / maxSum;
        return { backgroundColor: `rgba(244, 63, 94, ${0.06 + ratio * 0.34})` };
    };

    return (
        <section className="rounded-xl border border-[var(--color-border-subtle)] bg-white overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--color-border-subtle)]">
                <h2 className="font-bold text-[var(--color-text-primary)]">심사위원별 부여 점수</h2>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                    진할수록 높은 점수. 특정 심사위원이 유독 후하거나 박한지 확인할 수 있습니다. (만점 {maxSum}점)
                </p>
            </div>
            <div className="overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>심사위원</TableHead>
                            {data.results.map((r) => (
                                <TableHead key={r.target_id} className="text-center whitespace-nowrap">
                                    {r.name}
                                </TableHead>
                            ))}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {data.judges.map((j) => (
                            <TableRow key={j.participant_id}>
                                <TableCell className="font-medium whitespace-nowrap">
                                    {j.name}
                                </TableCell>
                                {data.results.map((r) => {
                                    const v = j.totals[r.target_id];
                                    return (
                                        <TableCell
                                            key={r.target_id}
                                            className="text-center font-medium"
                                            style={shade(v)}
                                        >
                                            {v ?? <span className="text-[var(--color-text-muted)]">—</span>}
                                        </TableCell>
                                    );
                                })}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </section>
    );
}

// ── 제출자별 상세 (누가 어떻게 냈는지) ───────────────────────────────────────

function SubmitterList({ data, round }: { data: Results; round: ScoringRound }) {
    const [q, setQ] = useState("");
    const [openIds, setOpenIds] = useState<number[]>([]);
    // 펼친 사람의 제출 내용 캐시 (열 때 한 번만 불러온다)
    const [details, setDetails] = useState<Record<number, Submission | "loading">>({});

    const list = data.submitters ?? [];
    if (list.length === 0) return null;

    const needle = q.trim().toLowerCase();
    const shown = needle
        ? list.filter(
            (s) =>
                s.name.toLowerCase().includes(needle)
                || (s.group_label ?? "").toLowerCase().includes(needle)
                || (s.role === "JUDGE" ? "심사위원" : "참관위원").includes(needle),
        )
        : list;

    const toggle = (s: Submitter) => {
        const id = s.participant_id;
        if (openIds.includes(id)) {
            setOpenIds(openIds.filter((x) => x !== id));
            return;
        }
        setOpenIds([...openIds, id]);
        if (!details[id]) {
            setDetails((d) => ({ ...d, [id]: "loading" }));
            fetchParticipantSubmission(id)
                .then((sub) => setDetails((d) => ({ ...d, [id]: sub })))
                .catch(() => {
                    toast.error("제출 내용을 불러오지 못했습니다");
                    setDetails((d) => {
                        const next = { ...d };
                        delete next[id];
                        return next;
                    });
                });
        }
    };

    const allOpen = shown.length > 0 && shown.every((s) => openIds.includes(s.participant_id));
    const toggleAll = () => {
        if (allOpen) {
            setOpenIds([]);
            return;
        }
        shown.forEach((s) => {
            if (!openIds.includes(s.participant_id)) toggle(s);
        });
    };

    return (
        <section className="rounded-xl border border-[var(--color-border-subtle)] bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
                <div className="flex items-center gap-2">
                    <UserSearch className="w-4 h-4 text-[var(--color-text-secondary)]" />
                    <h2 className="font-bold text-[var(--color-text-primary)]">제출자별 상세</h2>
                    <span className="text-xs text-[var(--color-text-muted)]">
                        {shown.length}명{needle ? ` / 전체 ${list.length}명` : ""}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                        <Input
                            className="pl-8 h-8 w-56 text-sm"
                            placeholder="이름·그룹·역할 검색"
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                        />
                    </div>
                    <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={toggleAll}>
                        {allOpen ? "모두 접기" : "모두 펼치기"}
                    </Button>
                </div>
            </div>
            <p className="text-xs text-[var(--color-text-muted)] mb-4">
                카드를 누르면 그 사람이 팀별로 매긴 점수와 남긴 코멘트가 그대로 펼쳐집니다.
            </p>

            {/* 30명 넘어가면 페이지가 한없이 길어진다 → 목록 자체를 스크롤 박스로 */}
            <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                {shown.length === 0 && (
                    <p className="text-center py-8 text-sm text-[var(--color-text-muted)]">
                        검색 결과가 없습니다.
                    </p>
                )}

                {shown.map((s) => {
                    const open = openIds.includes(s.participant_id);
                    const detail = details[s.participant_id];
                    return (
                        <div
                            key={s.participant_id}
                            className="rounded-xl border border-[var(--color-border-subtle)] overflow-hidden"
                        >
                            <button
                                type="button"
                                onClick={() => toggle(s)}
                                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--color-hover)] transition-colors"
                            >
                                <ChevronRight
                                    className={cn(
                                        "w-4 h-4 shrink-0 text-[var(--color-text-muted)] transition-transform",
                                        open && "rotate-90",
                                    )}
                                />
                                <span className="font-semibold text-[var(--color-text-primary)]">
                                    {s.name}
                                </span>
                                <span
                                    className={cn(
                                        "text-[10px] px-1.5 py-0.5 rounded font-bold",
                                        s.role === "JUDGE"
                                            ? "bg-rose-50 text-rose-600"
                                            : "bg-sky-50 text-sky-600",
                                    )}
                                >
                                    {s.role === "JUDGE" ? "심사위원" : "참관위원"}
                                </span>
                                {s.group_label && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-hover)] text-[var(--color-text-secondary)]">
                                        {s.group_label}
                                    </span>
                                )}
                                <span className="ml-auto text-xs text-[var(--color-text-muted)]">
                                    {s.submitted_at
                                        ? new Date(s.submitted_at).toLocaleString("ko-KR", {
                                            month: "numeric",
                                            day: "numeric",
                                            hour: "2-digit",
                                            minute: "2-digit",
                                        })
                                        : ""}
                                </span>
                            </button>

                            {open && (
                                <div className="px-4 pb-4 pt-1 border-t border-[var(--color-border-subtle)] bg-[var(--color-hover)]/40">
                                    {detail === "loading" || !detail ? (
                                        <div className="flex justify-center py-6">
                                            <Loader2 className="w-5 h-5 animate-spin text-[var(--color-text-muted)]" />
                                        </div>
                                    ) : (
                                        <SubmissionDetail
                                            sub={detail}
                                            round={round}
                                            results={data.results}
                                        />
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

/** 한 사람의 제출 내용 — 등수 모드면 등수 목록, 채점 모드면 팀별 기준 점수 + 코멘트. */
function SubmissionDetail({
    sub, round, results,
}: {
    sub: Submission;
    round: ScoringRound;
    results: Results["results"];
}) {
    const tname = new Map(results.map((r) => [r.target_id, r.name]));
    const cname = new Map(round.criteria.map((c) => [c.id, c.label]));
    const cmax = new Map(round.criteria.map((c) => [c.id, c.max_score]));

    if (sub.ranks.length > 0) {
        return (
            <div className="space-y-2 pt-3">
                {[...sub.ranks]
                    .sort((a, b) => a.rank - b.rank)
                    .map((r) => (
                        <div
                            key={r.rank}
                            className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white border border-[var(--color-border-subtle)]"
                        >
                            <span className="w-10 font-bold text-[var(--color-text-primary)]">
                                {r.rank}위
                            </span>
                            <span className="text-[var(--color-text-primary)]">
                                {tname.get(r.target_id) ?? "?"}
                            </span>
                        </div>
                    ))}
                {sub.comments.map((c, i) => (
                    <div
                        key={i}
                        className="px-3 py-2 rounded-lg bg-white border border-[var(--color-border-subtle)]"
                    >
                        <div className="text-xs font-bold text-[var(--color-text-secondary)] mb-1">
                            {tname.get(c.target_id) ?? "?"} ·{" "}
                            {c.criterion_id ? cname.get(c.criterion_id) ?? "기준" : "총평"}
                        </div>
                        <p className="text-sm whitespace-pre-wrap">{c.body}</p>
                    </div>
                ))}
            </div>
        );
    }

    const byTarget = new Map<
        number,
        { scores: Submission["scores"]; comments: Submission["comments"] }
    >();
    for (const s of sub.scores) {
        const b = byTarget.get(s.target_id) ?? { scores: [], comments: [] };
        b.scores.push(s);
        byTarget.set(s.target_id, b);
    }
    for (const c of sub.comments) {
        const b = byTarget.get(c.target_id) ?? { scores: [], comments: [] };
        b.comments.push(c);
        byTarget.set(c.target_id, b);
    }

    const max = round.criteria.reduce((a, c) => a + c.max_score, 0);

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3">
            {results.map((t) => {
                const b = byTarget.get(t.target_id);
                if (!b) return null;
                const sum = b.scores.reduce((a, s) => a + s.score, 0);
                return (
                    <div
                        key={t.target_id}
                        className="rounded-lg bg-white border border-[var(--color-border-subtle)] p-3"
                    >
                        <div className="flex items-center justify-between mb-2">
                            <span className="font-bold text-[var(--color-text-primary)]">{t.name}</span>
                            <span className="text-sm font-bold text-[var(--color-accent)]">
                                {sum}
                                <span className="text-[var(--color-text-muted)] font-normal"> / {max}</span>
                            </span>
                        </div>
                        <div className="space-y-1">
                            {b.scores.map((s) => (
                                <div
                                    key={s.criterion_id}
                                    className="flex items-center justify-between text-sm"
                                >
                                    <span className="text-[var(--color-text-secondary)]">
                                        {cname.get(s.criterion_id) ?? "?"}
                                    </span>
                                    <span className="text-[var(--color-text-primary)]">
                                        {s.score}
                                        <span className="text-xs text-[var(--color-text-muted)]">
                                            {" "}/ {cmax.get(s.criterion_id) ?? 0}
                                        </span>
                                    </span>
                                </div>
                            ))}
                        </div>
                        {b.comments.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-[var(--color-border-subtle)] space-y-1.5">
                                {b.comments.map((c, i) => (
                                    <div key={i} className="text-sm">
                                        <span className="text-xs font-bold text-[var(--color-accent)]">
                                            {c.criterion_id ? cname.get(c.criterion_id) ?? "기준" : "총평"}
                                        </span>
                                        <p className="whitespace-pre-wrap text-[var(--color-text-primary)]">
                                            {c.body}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ── 서술형 피드백 ────────────────────────────────────────────────────────────

function CommentsPanel({ data, round }: { data: Results; round: ScoringRound }) {
    const cname = new Map(round.criteria.map((c) => [c.id, c.label]));
    const withComments = data.results.filter((r) => r.comments.length > 0);

    if (withComments.length === 0) return null;

    return (
        <section className="rounded-xl border border-[var(--color-border-subtle)] bg-white p-5">
            <div className="flex items-center gap-2 mb-4">
                <MessageSquare className="w-4 h-4 text-[var(--color-text-secondary)]" />
                <h2 className="font-bold text-[var(--color-text-primary)]">서술형 피드백</h2>
            </div>

            {/* 코멘트가 수십 건 쌓이면 페이지가 끝없이 길어진다 → 스크롤 박스 */}
            <div className="space-y-5 max-h-[600px] overflow-y-auto pr-1">
                {withComments.map((r) => (
                    <div key={r.target_id}>
                        <h3 className="font-semibold text-[var(--color-text-primary)] mb-2">
                            {r.name}
                            <span className="ml-2 text-xs text-[var(--color-text-muted)] font-normal">
                                {r.comments.length}건
                            </span>
                        </h3>
                        <div className="space-y-2">
                            {r.comments.map((c, i) => (
                                <div
                                    key={i}
                                    className="p-3 rounded-lg bg-[var(--color-hover)] text-sm"
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-xs font-bold text-[var(--color-text-secondary)]">
                                            {c.participant_name}
                                        </span>
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white text-[var(--color-text-muted)]">
                                            {c.role === "JUDGE" ? "심사위원" : "참관위원"}
                                        </span>
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white text-[var(--color-accent)] font-medium">
                                            {c.criterion_id ? cname.get(c.criterion_id) ?? "기준" : "총평"}
                                        </span>
                                    </div>
                                    <p className="text-[var(--color-text-primary)] whitespace-pre-wrap">
                                        {c.body}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}

function Panel({
    title, subtitle, children,
}: { title: string; subtitle?: string; children: React.ReactNode }) {
    return (
        <section className="rounded-xl border border-[var(--color-border-subtle)] bg-white p-5">
            <h2 className="font-bold text-[var(--color-text-primary)]">{title}</h2>
            {subtitle && <p className="text-xs text-[var(--color-text-muted)] mt-0.5 mb-3">{subtitle}</p>}
            {children}
        </section>
    );
}
