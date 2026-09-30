import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Vote, Trophy, Loader2, RotateCcw, Trash2, Lock, Users, Pencil, Info, ClipboardList } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { errMsg } from "@/hooks/useExcuses";
import {
    useSessionVotes, useOpenVote, useUpdateCandidates, useCloseVote, useResolveVote, useReopenVote, useDeleteVote,
    useVoteSignals, voteKeys, VOTE_LABEL, VOTE_DESC,
    type SessionVote, type SessionVotesData, type VoteCategory, type Person, type VoteMerit, type VoteKind,
} from "@/hooks/useSessionVotes";

const CATS: VoteCategory[] = ["OFF", "OPI"];
const groupLabel = (g: number | null) => (g == null ? "전체" : `${g}분반`);
// 서버 분반 키(session_votes._gkey) — 분반 없음은 "all"
const gkey = (g: number | null) => (g == null ? "all" : String(g));
const roundLabel = (r: number) => (r === 1 ? "본투표" : `${r - 1}차 재투표`);
const STAGED_NOTE = "정산 단계 상점 목록에 추가되었습니다. 세션을 정산하면 상점이 적용됩니다.";

/** 출석 탭 카드 — 분반별 상태 요약 + '투표 관리' 버튼. 조작은 큰 모달에서. */
export function SessionVoteCard({ sessionId, weekNum }: { sessionId: number; weekNum: number }) {
    const qc = useQueryClient();
    const { data } = useSessionVotes(sessionId);
    const [open, setOpen] = useState(false);
    useVoteSignals("admin", () => qc.invalidateQueries({ queryKey: voteKeys.session(sessionId) }));

    return (
        <div className="bg-[var(--color-surface)] p-4 rounded-xl border border-[var(--color-border)] flex flex-col">
            <div className="mb-3">
                <h3 className="font-bold text-lg flex items-center gap-2"><Vote className="w-5 h-5 text-[var(--color-accent)]" />오프·오피 투표</h3>
                <p className="text-sm text-[var(--color-text-secondary)]">
                    {data?.kind === "TEAM" ? "기수원 투표로 오늘의 프레젠터·PPT 팀을 뽑습니다" : "기수원 투표로 오늘의 프레젠터·PPT를 뽑습니다"}
                </p>
            </div>
            <div className="space-y-1.5 mb-3 flex-1">
                {(data?.groups ?? []).map((g) => (
                    <div key={String(g)} className="flex items-center justify-between gap-2 text-sm">
                        <span className="font-medium text-[var(--color-text-primary)] shrink-0">{groupLabel(g)}</span>
                        <GroupSummary chain={chainOf(data!, g)} />
                    </div>
                ))}
            </div>
            <Button size="sm" onClick={() => setOpen(true)} className="self-start">투표 관리</Button>
            {data && (
                <Dialog open={open} onOpenChange={setOpen}>
                    <DialogContent className="max-w-5xl w-[calc(100vw-1.5rem)] h-[88vh] p-0 gap-0 flex flex-col overflow-hidden">
                        <DialogHeader className="px-5 pt-5 pb-3 border-b border-[var(--color-border)]">
                            <DialogTitle className="flex items-center gap-2"><Vote className="w-5 h-5 text-[var(--color-accent)]" />오프·오피 투표 · {weekNum}주차</DialogTitle>
                        </DialogHeader>
                        <VoteManager sessionId={sessionId} data={data} />
                    </DialogContent>
                </Dialog>
            )}
        </div>
    );
}

function chainOf(data: SessionVotesData, g: number | null) {
    return data.votes.filter((v) => v.group_num === g).sort((a, b) => a.round - b.round || a.id - b.id);
}

function pendingTie(v: SessionVote) {
    return !v.is_open && CATS.some((c) => v.result?.[c]?.tie && !v.result?.[c]?.resolved);
}

function GroupSummary({ chain }: { chain: SessionVote[] }) {
    const last = chain[chain.length - 1];
    if (!last) return <span className="text-[var(--color-text-muted)]">아직 안 열림</span>;
    if (last.is_open) {
        const done = last.voters.filter((v) => Object.keys(v.picks).length > 0).length;
        return <span className="text-emerald-600 font-medium flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />{roundLabel(last.round)} 진행 중 · {done}/{last.voters.length}명</span>;
    }
    if (chain.some(pendingTie)) return <span className="text-amber-600 font-medium">동률 — 처리 필요</span>;
    return <span className="text-[var(--color-text-secondary)]">마감</span>;
}

function VoteManager({ sessionId, data }: { sessionId: number; data: SessionVotesData }) {
    const [group, setGroup] = useState<number | null>(data.groups[0] ?? null);
    const finalized = data.session_status === "FINALIZED";
    return (
        <div className="flex-1 min-h-0 flex flex-col">
            {data.groups.length > 1 && (
                <div className="flex gap-1 px-5 pt-3">
                    {data.groups.map((g) => (
                        <button key={String(g)} onClick={() => setGroup(g)}
                            className={cn("px-4 py-2 rounded-lg text-sm font-semibold transition-colors",
                                g === group ? "bg-[var(--color-accent)] text-white" : "text-[var(--color-text-secondary)] hover:bg-gray-100")}>
                            {groupLabel(g)} <GroupDot chain={chainOf(data, g)} />
                        </button>
                    ))}
                </div>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">
                {finalized && (
                    <p className="text-sm rounded-lg bg-gray-50 border border-[var(--color-border)] px-3 py-2 flex items-center gap-2 text-[var(--color-text-secondary)]">
                        <Lock className="w-4 h-4" />정산이 끝난 세션이라 투표를 바꿀 수 없습니다.
                    </p>
                )}
                <GroupPanel key={String(group)} sessionId={sessionId} group={group} data={data} finalized={finalized} />
            </div>
        </div>
    );
}

function GroupDot({ chain }: { chain: SessionVote[] }) {
    const last = chain[chain.length - 1];
    if (last?.is_open) return <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 ml-1 align-middle" />;
    if (chain.some(pendingTie)) return <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 ml-1 align-middle" />;
    return null;
}

function GroupPanel({ sessionId, group, data, finalized }: { sessionId: number; group: number | null; data: SessionVotesData; finalized: boolean }) {
    const chain = chainOf(data, group);
    const pool = data.pool[gkey(group)] ?? [];
    const voters = data.eligible[gkey(group)]?.length ?? 0;
    if (!chain.length) return <OpenForm sessionId={sessionId} group={group} kind={data.kind} pool={pool} voters={voters} defaultMerit={data.default_merit} disabled={finalized} />;
    // 최신 라운드가 위로
    return (
        <>
            {[...chain].reverse().map((v) => (
                <VotePanel key={v.id} sessionId={sessionId} vote={v} pool={pool} finalized={finalized} />
            ))}
        </>
    );
}

function CandidatePicker({ people, value, onChange, unit = "명" }: { people: Person[]; value: Set<number>; onChange: (s: Set<number>) => void; unit?: string }) {
    const all = people.length > 0 && people.every((p) => value.has(p.id));
    const team = people.some((p) => p.sub !== undefined);
    return (
        <div>
            <label className="flex items-center gap-2 text-sm font-semibold mb-2 cursor-pointer select-none">
                <Checkbox checked={all} onCheckedChange={(c) => onChange(new Set(c ? people.map((p) => p.id) : []))} />
                전체 선택 ({value.size}/{people.length}{unit})
            </label>
            <div className={cn("grid gap-1.5", team ? "grid-cols-1 sm:grid-cols-2 md:grid-cols-3" : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4")}>
                {people.map((p) => (
                    <label key={p.id} className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer select-none transition-colors",
                        value.has(p.id) ? "border-[var(--color-accent)] bg-rose-50/60" : "border-[var(--color-border)] hover:bg-gray-50")}>
                        <Checkbox checked={value.has(p.id)} onCheckedChange={(c) => {
                            const n = new Set(value);
                            if (c) n.add(p.id); else n.delete(p.id);
                            onChange(n);
                        }} />
                        <span className="min-w-0">
                            <span className="block">{p.name}</span>
                            {p.sub && <span className="block text-xs text-[var(--color-text-muted)] truncate">{p.sub}</span>}
                        </span>
                    </label>
                ))}
            </div>
        </div>
    );
}

function MeritFields({ value, onChange }: { value: Record<VoteCategory, VoteMerit>; onChange: (v: Record<VoteCategory, VoteMerit>) => void }) {
    return (
        <div className="grid sm:grid-cols-2 gap-2">
            {CATS.map((c) => (
                <div key={c} className="rounded-lg border border-[var(--color-border)] p-3 space-y-2">
                    <p className="text-sm font-bold">{VOTE_LABEL[c]} 1등 팀 전원 상점</p>
                    <div className="flex gap-2">
                        <Input value={value[c].reason} maxLength={40} placeholder="상점 명목"
                            onChange={(e) => onChange({ ...value, [c]: { ...value[c], reason: e.target.value } })} />
                        <div className="flex items-center gap-1 shrink-0">
                            <span className="text-sm">+</span>
                            <Input type="number" min={1} max={10} className="w-16" value={value[c].score}
                                onChange={(e) => onChange({ ...value, [c]: { ...value[c], score: Math.max(1, Math.min(10, Number(e.target.value) || 1)) } })} />
                            <span className="text-sm">점</span>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

const meritValid = (m: Record<VoteCategory, VoteMerit>) => CATS.every((c) => m[c].reason.trim().length > 0);

function ScoringHint() {
    return (
        <p className="text-sm rounded-lg bg-sky-50 border border-sky-200 text-sky-800 px-3 py-2 flex items-start gap-2">
            <ClipboardList className="w-4 h-4 mt-0.5 shrink-0" />
            <span>팀별 세부 점수(항목별 채점·심사위원 점수)가 필요하면 <Link to="/scoring" className="font-semibold underline underline-offset-2">심사/채점 페이지</Link>를 사용하세요. 이 투표는 오프·오피 1등만 뽑습니다.</span>
        </p>
    );
}

function OpenForm({ sessionId, group, kind, pool, voters, defaultMerit, disabled }: {
    sessionId: number; group: number | null; kind: VoteKind; pool: Person[]; voters: number;
    defaultMerit: Record<VoteCategory, VoteMerit>; disabled: boolean;
}) {
    const team = kind === "TEAM";
    const [picked, setPicked] = useState(() => new Set(pool.map((p) => p.id)));
    const [merit, setMerit] = useState(defaultMerit);
    const openVote = useOpenVote(sessionId);
    useEffect(() => setPicked(new Set(pool.map((p) => p.id))), [pool.length]); // eslint-disable-line react-hooks/exhaustive-deps
    return (
        <div className="rounded-xl border border-[var(--color-border)] p-4 space-y-4">
            <div>
                <p className="font-bold">{team ? "투표 열기 — 후보 팀 고르기" : `${groupLabel(group)} 투표 열기 — 후보 고르기`}</p>
                <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                    {team
                        ? `오늘 출석자 ${voters}명이 오프·오피 팀에 한 표씩 던집니다. 결석·공결은 투표할 수 없고, 자기 팀에는 투표할 수 없습니다. 1등 팀은 팀원 전원이 상점을 받습니다.`
                        : `${groupLabel(group)} 오늘 출석자 ${voters}명이 오프·오피에 한 표씩 던집니다. 결석·공결은 투표할 수 없고, 본인에게는 투표할 수 없습니다.`}
                </p>
            </div>
            {team && <ScoringHint />}
            {pool.length === 0
                ? <p className="text-sm text-[var(--color-text-muted)]">{team ? "이 세션에 팀이 없습니다. 팀을 먼저 만들어 주세요." : "출석자가 없습니다. 출결을 먼저 확인해 주세요."}</p>
                : <CandidatePicker people={pool} value={picked} onChange={setPicked} unit={team ? "팀" : "명"} />}
            {team && <MeritFields value={merit} onChange={setMerit} />}
            <Button disabled={disabled || picked.size < 2 || (team && !meritValid(merit)) || openVote.isPending}
                onClick={() => openVote.mutate({ group_num: group, candidates: [...picked], ...(team ? { merit } : {}) }, {
                    onSuccess: () => toast.success(`${team ? "투표" : `${groupLabel(group)} 투표`}를 열었습니다. 기수원에게 알림을 보냈습니다.`),
                    onError: (e) => toast.error(errMsg(e, "투표를 열지 못했습니다")),
                })}>
                {openVote.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                투표 열기 (후보 {picked.size}{team ? "팀" : "명"})
            </Button>
        </div>
    );
}

function VotePanel({ sessionId, vote, pool, finalized }: { sessionId: number; vote: SessionVote; pool: Person[]; finalized: boolean }) {
    const close = useCloseVote(sessionId);
    const reopen = useReopenVote(sessionId);
    const del = useDeleteVote(sessionId);
    const [editing, setEditing] = useState(false);
    const cats = CATS.filter((c) => vote.candidates[c]);
    const voted = vote.voters.filter((v) => Object.keys(v.picks).length > 0);
    const notVoted = vote.voters.filter((v) => Object.keys(v.picks).length === 0);
    const nameOf = useMemo(() => {
        const m = new Map<number, string>();
        cats.forEach((c) => vote.candidates[c]!.forEach((p) => m.set(p.id, p.name)));
        return (id?: number) => (id == null ? "" : m.get(id) ?? `#${id}`);
    }, [vote, cats]);
    const staged = !vote.is_open && cats.some((c) => ["auto", "all"].includes(vote.result?.[c]?.resolved ?? ""));
    const busy = close.isPending || reopen.isPending || del.isPending;
    const fail = (fallback: string) => (e: unknown) => toast.error(errMsg(e, fallback));

    return (
        <section className="rounded-xl border border-[var(--color-border)] overflow-hidden">
            <header className="flex flex-wrap items-center gap-2 px-4 py-3 bg-gray-50/80 border-b border-[var(--color-border)]">
                <span className="font-bold">{roundLabel(vote.round)}</span>
                {vote.is_open
                    ? <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />진행 중</span>
                    : <span className="text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-full px-2 py-0.5">마감</span>}
                <span className="text-sm text-[var(--color-text-secondary)] flex items-center gap-1"><Users className="w-4 h-4" />투표 {voted.length}/{vote.voters.length}명</span>
                <div className="ml-auto flex flex-wrap gap-1.5">
                    {vote.is_open ? (
                        <>
                            {vote.round === 1 && (
                                <Button size="sm" variant="outline" disabled={finalized || busy} onClick={() => setEditing((e) => !e)}>
                                    <Pencil className="w-3.5 h-3.5 mr-1" />{vote.kind === "TEAM" ? "후보·상점 수정" : "후보 수정"}
                                </Button>
                            )}
                            <Button size="sm" disabled={finalized || busy} onClick={() => {
                                if (!window.confirm(`${roundLabel(vote.round)}를 닫을까요? 1등이 정산 상점 목록에 올라갑니다.`)) return;
                                close.mutate(vote.id, {
                                    onSuccess: (r) => {
                                        const res = (r as { data: { result: SessionVote["result"] } }).data.result ?? {};
                                        if (CATS.some((c) => res[c]?.tie)) toast.warning("동률이 나왔습니다. 재투표할지 모두 올릴지 골라주세요.");
                                        else if (CATS.some((c) => res[c]?.resolved === "auto")) toast.success(STAGED_NOTE);
                                        else toast.info("표가 없어 선정된 사람이 없습니다.");
                                    },
                                    onError: fail("투표를 닫지 못했습니다"),
                                });
                            }}>
                                {close.isPending && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}투표 닫기
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button size="sm" variant="outline" disabled={finalized || busy} onClick={() => {
                                if (!window.confirm("다시 열까요? 이 투표(와 이어진 재투표)로 정산 목록에 올린 상점은 빠지고, 다시 닫으면 새 결과로 올라갑니다. 이미 던진 표는 그대로 남습니다.")) return;
                                reopen.mutate(vote.id, { onSuccess: () => toast.success("투표를 다시 열었습니다"), onError: fail("다시 열지 못했습니다") });
                            }}>
                                <RotateCcw className="w-3.5 h-3.5 mr-1" />다시 열기
                            </Button>
                            <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" disabled={finalized || busy} onClick={() => {
                                if (!window.confirm("이 투표를 삭제할까요? 표와 정산 목록에 올린 상점이 함께 지워집니다.")) return;
                                del.mutate(vote.id, { onSuccess: () => toast.success("투표를 삭제했습니다"), onError: fail("삭제하지 못했습니다") });
                            }}>
                                <Trash2 className="w-3.5 h-3.5 mr-1" />삭제
                            </Button>
                        </>
                    )}
                </div>
            </header>

            <div className="p-4 space-y-4">
                {editing && vote.is_open && (
                    <CandidateEditor sessionId={sessionId} vote={vote} pool={pool} onDone={() => setEditing(false)} />
                )}

                {vote.kind === "TEAM" && (
                    <p className="text-sm text-[var(--color-text-secondary)]">
                        1등 팀 전원 상점 — {cats.map((c) => `${VOTE_LABEL[c]}: ${vote.merit[c].reason} +${vote.merit[c].score}`).join(" · ")}
                    </p>
                )}

                {staged && (
                    <p className="text-sm rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2 flex items-start gap-2">
                        <Info className="w-4 h-4 mt-0.5 shrink-0" />{STAGED_NOTE}
                    </p>
                )}

                <div className={cn("grid gap-3", cats.length > 1 && "md:grid-cols-2")}>
                        {cats.map((c) => <CategoryBoard key={c} sessionId={sessionId} vote={vote} cat={c} finalized={finalized} />)}
                </div>

                {vote.is_open && notVoted.length > 0 && (
                    <div className="text-sm rounded-lg bg-gray-50 border border-[var(--color-border)] px-3 py-2">
                        <span className="font-semibold text-[var(--color-text-secondary)]">미투표 {notVoted.length}명</span>
                        <span className="text-[var(--color-text-muted)]"> · {notVoted.map((v) => v.name).join(", ")}</span>
                    </div>
                )}

                <div>
                    <p className="text-sm font-bold mb-2">누가 누구를 찍었나</p>
                    {vote.voters.length === 0 ? (
                        <p className="text-sm text-[var(--color-text-muted)]">투표권자가 없습니다.</p>
                    ) : (
                        <div className="rounded-lg border border-[var(--color-border)] overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 text-[var(--color-text-secondary)]">
                                    <tr>
                                        <th className="text-left font-medium px-3 py-2">투표자</th>
                                        {cats.map((c) => <th key={c} className="text-left font-medium px-3 py-2">{VOTE_LABEL[c]}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {[...voted, ...notVoted].map((v) => (
                                        <tr key={v.id} className="border-t border-[var(--color-border)]">
                                            <td className="px-3 py-1.5 font-medium">{v.name}</td>
                                            {cats.map((c) => (
                                                <td key={c} className="px-3 py-1.5">
                                                    {v.picks[c] ? nameOf(v.picks[c]) : <span className="text-[var(--color-text-muted)]">미투표</span>}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}

function CategoryBoard({ sessionId, vote, cat, finalized }: { sessionId: number; vote: SessionVote; cat: VoteCategory; finalized: boolean }) {
    const resolve = useResolveVote(sessionId);
    const tally = vote.tally[cat] ?? {};
    const rows = [...(vote.candidates[cat] ?? [])]
        .map((p) => ({ ...p, n: tally[String(p.id)] ?? 0 }))
        .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
    const max = Math.max(1, ...rows.map((r) => r.n));
    const res = vote.result?.[cat];
    const winners = new Set(res?.winners ?? []);
    const names = rows.filter((r) => winners.has(r.id)).map((r) => r.name).join(", ");

    return (
        <div className="rounded-lg border border-[var(--color-border)] p-3">
            <p className="font-bold">{VOTE_LABEL[cat]} <span className="text-xs font-normal text-[var(--color-text-muted)]">{VOTE_DESC[cat]}</span></p>
            <div className="mt-2 space-y-1">
                {rows.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 text-sm">
                        <span className={cn(vote.kind === "TEAM" ? "w-28" : "w-16", "shrink-0 truncate", winners.has(r.id) && "font-bold")}>
                            {r.name}
                        </span>
                        <div className="flex-1 h-4 rounded bg-gray-100 overflow-hidden">
                            <div className={cn("h-full rounded transition-all duration-500", winners.has(r.id) ? "bg-amber-400" : "bg-rose-300")}
                                style={{ width: `${(r.n / max) * 100}%` }} />
                        </div>
                        <span className="w-10 text-right tabular-nums">{r.n}표</span>
                        {winners.has(r.id) && !res?.tie && <Trophy className="w-4 h-4 text-amber-500" />}
                    </div>
                ))}
            </div>
            {res && (
                <div className="mt-3 text-sm">
                    {res.resolved === "auto" && <p className="flex items-center gap-1.5 font-semibold text-amber-700"><Trophy className="w-4 h-4" />{names} 선정 ({res.votes}표)</p>}
                    {res.resolved === "none" && <p className="text-[var(--color-text-muted)]">표가 없어 선정된 사람이 없습니다.</p>}
                    {res.resolved === "all" && <p className="font-semibold text-amber-700">동률자 모두 선정: {names}</p>}
                    {res.resolved === "runoff" && <p className="text-[var(--color-text-secondary)]">동률({names}) — 재투표로 넘겼습니다</p>}
                    {res.tie && !res.resolved && (
                        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-2">
                            <p className="font-semibold text-amber-900">동률: {names} (각 {res.votes}표)</p>
                            <p className="text-xs text-amber-800">동률자끼리 한 번 더 투표할까요, 아니면 모두 정산 상점 목록에 올릴까요?</p>
                            <div className="flex flex-wrap gap-1.5">
                                <Button size="sm" disabled={finalized || resolve.isPending} onClick={() => resolve.mutate({ id: vote.id, [cat]: "runoff" }, {
                                    onSuccess: () => toast.success(`${VOTE_LABEL[cat]} 동률자 재투표를 열었습니다`),
                                    onError: (e) => toast.error(errMsg(e, "재투표를 열지 못했습니다")),
                                })}>동률자끼리 재투표</Button>
                                <Button size="sm" variant="outline" disabled={finalized || resolve.isPending} onClick={() => resolve.mutate({ id: vote.id, [cat]: "all" }, {
                                    onSuccess: () => toast.success(STAGED_NOTE),
                                    onError: (e) => toast.error(errMsg(e, "처리하지 못했습니다")),
                                })}>모두 정산에 올리기</Button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function CandidateEditor({ sessionId, vote, pool, onDone }: { sessionId: number; vote: SessionVote; pool: Person[]; onDone: () => void }) {
    const team = vote.kind === "TEAM";
    const current = vote.candidates.OFF ?? [];
    // 기본 후보(출석자·팀) + 지금 후보(결석 처리됐어도 후보로 남아 있을 수 있다)
    const people = useMemo(() => {
        const m = new Map(pool.map((p) => [p.id, p]));
        current.forEach((p) => { if (!m.has(p.id)) m.set(p.id, p); });
        return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
    }, [pool, current]);
    const [picked, setPicked] = useState(() => new Set(current.map((p) => p.id)));
    const [merit, setMerit] = useState(vote.merit);
    const update = useUpdateCandidates(sessionId);
    return (
        <div className="rounded-lg border border-dashed border-[var(--color-accent)] p-3 space-y-3">
            <p className="text-sm text-[var(--color-text-secondary)]">후보에서 빠진 {team ? "팀" : "사람"}에게 간 표는 지워지고, 그 표를 던진 사람은 다시 골라야 합니다.</p>
            <CandidatePicker people={people} value={picked} onChange={setPicked} unit={team ? "팀" : "명"} />
            {team && <MeritFields value={merit} onChange={setMerit} />}
            <div className="flex gap-1.5">
                <Button size="sm" disabled={picked.size < 2 || (team && !meritValid(merit)) || update.isPending}
                    onClick={() => update.mutate({ id: vote.id, candidates: [...picked], ...(team ? { merit } : {}) }, {
                        onSuccess: () => { toast.success("후보를 바꿨습니다"); onDone(); },
                        onError: (e) => toast.error(errMsg(e, "후보를 바꾸지 못했습니다")),
                    })}>저장</Button>
                <Button size="sm" variant="ghost" onClick={onDone}>취소</Button>
            </div>
        </div>
    );
}
