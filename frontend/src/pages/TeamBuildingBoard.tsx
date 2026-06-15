import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
    DndContext, DragOverlay, useDraggable, useDroppable, pointerWithin,
    PointerSensor, TouchSensor, useSensor, useSensors, type DragStartEvent, type DragEndEvent,
} from "@dnd-kit/core";
import { ArrowLeft, Dices, RotateCcw, ClipboardCopy, Loader2, HelpCircle, ChevronDown, Check, X } from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface MemberLite { id: number; name: string; tags: string[]; }
interface StaffLite { id: number; name: string; department: string | null; }
interface PastTeam { team_id: number; name: string; members: { id: number; name: string }[]; }
interface PastSessionTeams { session_id: number; label: string; teams: PastTeam[]; }
interface PastSession { session_id: number; week_num: number; title: string; }
type Slot = "pool" | number;
type Kind = "trainee" | "mixed" | "staff";
interface Participant { key: string; id: number; name: string; staff: boolean; }

const pkey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const PENALTY: Record<Kind, number> = { trainee: 1000, mixed: 5, staff: 2 };

export default function TeamBuildingBoard() {
    const { boardId } = useParams();
    const navigate = useNavigate();

    const [name, setName] = useState("");
    const [selected, setSelected] = useState<number[]>([]);
    const [numTeams, setNumTeams] = useState(6);
    const [assignment, setAssignment] = useState<Record<string, Slot>>({});
    const [excludedStaff, setExcludedStaff] = useState<Set<number>>(new Set());
    const [pastStaff, setPastStaff] = useState<Record<number, Record<number, number[]>>>({});
    const [consider, setConsider] = useState<{ mixed: boolean; staff: boolean }>({ mixed: true, staff: true });
    const [members, setMembers] = useState<MemberLite[]>([]);
    const [staff, setStaff] = useState<StaffLite[]>([]);
    const [pastTeams, setPastTeams] = useState<PastSessionTeams[]>([]);
    const [hover, setHover] = useState<string | null>(null);
    const [activeDrag, setActiveDrag] = useState<string | null>(null);
    const [helpOpen, setHelpOpen] = useState(true);
    const [recordOpen, setRecordOpen] = useState(true);
    const [loaded, setLoaded] = useState(false);
    const savedAsgnRef = useRef<Record<string, Slot> | null>(null);

    // 마우스 + 터치 둘 다 지원
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    );

    const pastQ = useQuery<PastSession[]>({ queryKey: ["tb-past"], queryFn: async () => (await api.get("/team-building/past-sessions")).data });
    const boardQ = useQuery({ queryKey: ["tb-board", boardId], queryFn: async () => (await api.get(`/team-building/boards/${boardId}`)).data });

    useEffect(() => {
        if (boardQ.data && !loaded) {
            const d = boardQ.data.data || {};
            setName(boardQ.data.name);
            setSelected(Array.isArray(d.selected_session_ids) ? d.selected_session_ids : []);
            setNumTeams(typeof d.num_teams === "number" ? d.num_teams : 6);
            setExcludedStaff(new Set(Array.isArray(d.excluded_staff) ? d.excluded_staff : []));
            setPastStaff(d.past_staff && typeof d.past_staff === "object" ? d.past_staff : {});
            setConsider({ mixed: d.consider?.mixed ?? true, staff: d.consider?.staff ?? true });
            savedAsgnRef.current = d.assignment || null;
            setLoaded(true);
        }
    }, [boardQ.data, loaded]);

    const selKey = selected.slice().sort((a, b) => a - b).join(",");
    useEffect(() => {
        if (!loaded) return;
        api.get("/team-building/data", { params: { session_ids: selKey } }).then(({ data }) => {
            setMembers(data.members); setStaff(data.staff); setPastTeams(data.past_teams);
        });
    }, [selKey, loaded]);

    const roster: Participant[] = useMemo(() => [
        ...members.map((m) => ({ key: `m${m.id}`, id: m.id, name: m.name, staff: false })),
        ...staff.filter((s) => !excludedStaff.has(s.id)).map((s) => ({ key: `u${s.id}`, id: s.id, name: s.name, staff: true })),
    ], [members, staff, excludedStaff]);

    useEffect(() => {
        if (roster.length === 0) return;
        setAssignment((prev) => {
            const saved = savedAsgnRef.current || {};
            const next: Record<string, Slot> = {};
            for (const p of roster) {
                const cur = prev[p.key] ?? saved[p.key] ?? "pool";
                next[p.key] = typeof cur === "number" && (cur < 1 || cur > numTeams) ? "pool" : cur;
            }
            return next;
        });
        savedAsgnRef.current = null;
    }, [roster, numTeams]);

    const saveTimer = useRef<number | null>(null);
    useEffect(() => {
        if (!loaded) return;
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
            api.put(`/team-building/boards/${boardId}`, {
                data: { selected_session_ids: selected, num_teams: numTeams, assignment, excluded_staff: [...excludedStaff], past_staff: pastStaff, consider },
            }).catch(() => {});
        }, 700);
        return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
    }, [assignment, numTeams, selKey, excludedStaff, pastStaff, consider, loaded, boardId, selected]);

    const staffName = useCallback((id: number) => staff.find((s) => s.id === id)?.name ?? `#${id}`, [staff]);

    const overlapMap = useMemo(() => {
        const m = new Map<string, { labels: Set<string>; kind: Kind }>();
        for (const ps of pastTeams) for (const t of ps.teams) {
            const parts = [
                ...t.members.map((mm) => ({ key: `m${mm.id}`, staff: false })),
                ...((pastStaff[ps.session_id]?.[t.team_id]) || []).map((uid) => ({ key: `u${uid}`, staff: true })),
            ];
            for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
                const a = parts[i], b = parts[j];
                const kind: Kind = a.staff && b.staff ? "staff" : !a.staff && !b.staff ? "trainee" : "mixed";
                const k = pkey(a.key, b.key);
                if (!m.has(k)) m.set(k, { labels: new Set(), kind });
                m.get(k)!.labels.add(ps.label);
            }
        }
        return m;
    }, [pastTeams, pastStaff]);

    const considered = useCallback((kind: Kind) => kind === "trainee" || consider[kind], [consider]);
    const teamOf = useCallback((key: string): Slot => assignment[key] ?? "pool", [assignment]);
    const byKey = useMemo(() => Object.fromEntries(roster.map((p) => [p.key, p])), [roster]);

    const { conflicts, badges } = useMemo(() => {
        const conflicts: { a: Participant; b: Participant; team: number; kind: Kind; labels: string[] }[] = [];
        const badges: Record<string, { n: number; major: boolean }> = {};
        for (let t = 1; t <= numTeams; t++) {
            const ps = roster.filter((p) => teamOf(p.key) === t);
            for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
                const ov = overlapMap.get(pkey(ps[i].key, ps[j].key));
                if (!ov || !considered(ov.kind)) continue;
                conflicts.push({ a: ps[i], b: ps[j], team: t, kind: ov.kind, labels: [...ov.labels] });
                for (const k of [ps[i].key, ps[j].key]) {
                    const cur = badges[k] || { n: 0, major: false };
                    badges[k] = { n: cur.n + 1, major: cur.major || ov.kind === "trainee" };
                }
            }
        }
        return { conflicts, badges };
    }, [roster, numTeams, overlapMap, teamOf, considered]);

    const randomize = () => {
        const ids = roster.map((p) => p.key);
        const penalty = (asgn: Record<string, Slot>) => {
            let p = 0;
            for (let t = 1; t <= numTeams; t++) {
                const ts = ids.filter((k) => asgn[k] === t);
                for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
                    const ov = overlapMap.get(pkey(ts[i], ts[j]));
                    if (ov && considered(ov.kind)) p += ov.labels.size * PENALTY[ov.kind];
                }
            }
            return p;
        };
        const base = Math.floor(ids.length / numTeams), extra = ids.length - base * numTeams;
        let best: Record<string, Slot> | null = null, bestP = Infinity;
        for (let attempt = 0; attempt < 3000; attempt++) {
            const sh = ids.slice();
            for (let i = sh.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [sh[i], sh[j]] = [sh[j], sh[i]]; }
            const asgn: Record<string, Slot> = {};
            let idx = 0;
            for (let t = 1; t <= numTeams; t++) { const cnt = base + (t <= extra ? 1 : 0); for (let k = 0; k < cnt; k++) asgn[sh[idx++]] = t; }
            const pen = penalty(asgn);
            if (pen < bestP) { bestP = pen; best = asgn; if (pen === 0) break; }
        }
        if (best) { setAssignment(best); toast.success(bestP === 0 ? "겹침 0으로 배정!" : `최소 겹침으로 배정 (점수 ${bestP})`); }
    };

    const resetPool = () => setAssignment(Object.fromEntries(roster.map((p) => [p.key, "pool" as Slot])));
    const copyResult = () => {
        const lines: string[] = [];
        for (let t = 1; t <= numTeams; t++) {
            const ps = roster.filter((p) => teamOf(p.key) === t).sort((a, b) => Number(a.staff) - Number(b.staff) || a.name.localeCompare(b.name, "ko"));
            lines.push(`팀 ${t}: ${ps.map((p) => p.name + (p.staff ? "(운영)" : "")).join(", ")}`);
        }
        const pool = roster.filter((p) => teamOf(p.key) === "pool").map((p) => p.name);
        if (pool.length) lines.push(`미배정: ${pool.join(", ")}`);
        navigator.clipboard.writeText(lines.join("\n")).then(() => toast.success("결과 복사됨"));
    };

    const recordStaff = (sid: number, tid: number, uid: number) => setPastStaff((prev) => {
        const next = JSON.parse(JSON.stringify(prev)) as Record<number, Record<number, number[]>>;
        const sess = next[sid] || (next[sid] = {});
        for (const t in sess) sess[t] = sess[t].filter((x) => x !== uid);
        sess[tid] = [...(sess[tid] || []), uid];
        return next;
    });
    const unrecordStaff = (sid: number, tid: number, uid: number) => setPastStaff((prev) => {
        const next = JSON.parse(JSON.stringify(prev)) as Record<number, Record<number, number[]>>;
        if (next[sid]?.[tid]) next[sid][tid] = next[sid][tid].filter((x) => x !== uid);
        return next;
    });

    // ── dnd-kit (마우스+터치) ──
    const onDragStart = (e: DragStartEvent) => setActiveDrag(String(e.active.id));
    const onDragEnd = (e: DragEndEvent) => {
        setActiveDrag(null);
        const a = String(e.active.id), o = e.over ? String(e.over.id) : "";
        if (!o) return;
        if (a.startsWith("b:") && o.startsWith("slot:")) {
            const key = a.slice(2); const dst = o.slice(5);
            if (byKey[key]) setAssignment((p) => ({ ...p, [key]: dst === "pool" ? "pool" : Number(dst) }));
        } else if (a.startsWith("p:") && o.startsWith("pt:")) {
            const uid = Number(a.split(":")[2]);
            const [, sid, tid] = o.split(":");
            recordStaff(Number(sid), Number(tid), uid);
        }
    };
    const activeLabel = activeDrag?.startsWith("b:") ? byKey[activeDrag.slice(2)]?.name
        : activeDrag?.startsWith("p:") ? staffName(Number(activeDrag.split(":")[2])) : null;

    const pool = roster.filter((p) => teamOf(p.key) === "pool");
    const conflictCount = conflicts.length;
    const totalRecorded = Object.values(pastStaff).reduce((acc, teams) => acc + Object.values(teams).reduce((a, arr) => a + arr.length, 0), 0);
    const stat = { trainee: conflicts.filter((c) => c.kind === "trainee").length, mixed: conflicts.filter((c) => c.kind === "mixed").length, staff: conflicts.filter((c) => c.kind === "staff").length };

    if (boardQ.isLoading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin" /></div>;

    return (
        <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd}>
            <div className="flex flex-col h-full">
                <div className="px-4 md:px-6 py-4 border-b border-[var(--color-border-subtle)] flex items-center gap-3">
                    <Button size="sm" variant="ghost" onClick={() => navigate("/team-building")}><ArrowLeft className="w-4 h-4" /></Button>
                    <div className="flex-1 min-w-0"><h1 className="text-lg font-bold text-[var(--color-text-primary)] break-keep truncate">{name}</h1>
                        <p className="text-xs text-[var(--color-text-muted)] break-keep">선택한 과거 팀세션과 안 겹치게 · 운영진은 과거 팀에 기록하면 겹침 계산</p></div>
                    <div className={`shrink-0 text-sm font-bold px-3 py-1.5 rounded-lg ${conflictCount === 0 ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600"}`}>겹침 {conflictCount}</div>
                </div>

                <div className="flex-1 overflow-auto px-4 md:px-6 py-4 space-y-5">
                    <HelpPanel open={helpOpen} onToggle={() => setHelpOpen((v) => !v)} />

                    <section>
                        <div className="flex items-center justify-between mb-2 gap-2">
                            <div className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">겹침 기준 과거 팀세션 <span className="font-medium normal-case tracking-normal">— 포함할 세션 선택</span></div>
                            <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${selected.length ? "bg-[var(--color-accent-dim)] text-[var(--color-accent)]" : "bg-[var(--color-hover)] text-[var(--color-text-muted)]"}`}>{selected.length}개 포함</span>
                        </div>
                        {(pastQ.data ?? []).length === 0 ? <span className="text-sm text-[var(--color-text-muted)]">완료된 팀세션이 없습니다</span> : (
                            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
                                {(pastQ.data ?? []).map((s) => {
                                    const on = selected.includes(s.session_id);
                                    const sub = s.title.replace(/^\s*\d+\s*주차\s*[·.\-]?\s*/, "");
                                    return (<button key={s.session_id} onClick={() => setSelected((p) => on ? p.filter((x) => x !== s.session_id) : [...p, s.session_id])}
                                        className={`flex items-center gap-2.5 p-3 rounded-xl border-2 text-left transition-all ${on ? "border-[var(--color-accent)] bg-[var(--color-accent-dim)]" : "border-[var(--color-border)] bg-white hover:border-[var(--color-accent)]/40"}`}>
                                        <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 ${on ? "bg-[var(--color-accent)] border-[var(--color-accent)]" : "border-[var(--color-border)]"}`}>
                                            {on && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                                        </div>
                                        <div className="min-w-0">
                                            <div className={`text-sm font-bold break-keep ${on ? "text-[var(--color-accent)]" : "text-[var(--color-text-primary)]"}`}>{s.week_num}주차</div>
                                            <div className="text-[11px] text-[var(--color-text-muted)] break-keep truncate">{sub || s.title}</div>
                                        </div>
                                    </button>);
                                })}
                            </div>
                        )}
                    </section>

                    {pastTeams.length > 0 && (
                        <section className="rounded-xl border-2 border-amber-200 bg-amber-50/30">
                            <button onClick={() => setRecordOpen((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 gap-2">
                                <span className="font-bold text-sm break-keep text-left flex items-center gap-2 flex-wrap">
                                    📌 과거 팀에 운영진 기록
                                    {totalRecorded > 0
                                        ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-200 text-amber-900">운영진 {totalRecorded}명 기록됨</span>
                                        : <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300">선택사항 · 운영진 겹침 보려면 여기서 배치</span>}
                                </span>
                                <ChevronDown className={`w-4 h-4 shrink-0 text-[var(--color-text-muted)] transition-transform ${recordOpen ? "rotate-180" : ""}`} />
                            </button>
                            {recordOpen && (
                                <div className="px-4 pb-4 space-y-4">
                                    {pastTeams.map((ps) => {
                                        const placed = new Set(Object.values(pastStaff[ps.session_id] || {}).flat());
                                        const unplaced = staff.filter((s) => !excludedStaff.has(s.id) && !placed.has(s.id));
                                        return (
                                            <div key={ps.session_id} className="rounded-lg border border-[var(--color-border-subtle)] p-3">
                                                <div className="text-sm font-bold text-[var(--color-text-primary)] mb-2 break-keep">{ps.label}</div>
                                                <div className="mb-2.5 flex flex-wrap items-center gap-1.5 p-2 rounded-lg bg-amber-50/60 border border-dashed border-amber-300">
                                                    <span className="text-[11px] font-bold text-amber-700 mr-1">미배치 운영진 →</span>
                                                    {unplaced.length === 0 ? <span className="text-[11px] text-[var(--color-text-muted)]">모두 배치됨 ✓</span>
                                                        : unplaced.map((s) => <DragPill key={s.id} id={`p:${ps.session_id}:${s.id}`} label={s.name} />)}
                                                </div>
                                                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
                                                    {ps.teams.map((t) => { const here = pastStaff[ps.session_id]?.[t.team_id] || [];
                                                        return (
                                                            <Droppable key={t.team_id} id={`pt:${ps.session_id}:${t.team_id}`}
                                                                className={`rounded-lg border p-2 min-h-[92px] ${here.length ? "border-amber-300 bg-amber-50/30" : "border-[var(--color-border-subtle)]"}`} overClass="border-amber-400 bg-amber-50">
                                                                <div className="text-[11px] font-bold text-[var(--color-text-muted)] mb-1">{t.name}</div>
                                                                <div className="flex flex-wrap gap-1">
                                                                    {t.members.map((mm) => <span key={mm.id} className="px-1.5 py-0.5 rounded bg-[var(--color-hover)] text-[11px] text-[var(--color-text-secondary)]">{mm.name}</span>)}
                                                                </div>
                                                                {here.length > 0 && (<div className="mt-1.5 pt-1.5 border-t border-dashed border-amber-300 flex flex-wrap gap-1">
                                                                    {here.map((uid) => <span key={uid} className="px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 text-[11px] font-bold flex items-center gap-1">🧑‍💼 {staffName(uid)}<button onClick={() => unrecordStaff(ps.session_id, t.team_id, uid)} className="hover:text-rose-600"><X className="w-2.5 h-2.5" /></button></span>)}
                                                                </div>)}
                                                            </Droppable>); })}
                                                </div>
                                            </div>);
                                    })}
                                </div>
                            )}
                        </section>
                    )}

                    {staff.length > 0 && (
                        <section className="flex flex-col gap-3">
                            <div>
                                <div className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">운영진 참여 설정 <span className="font-medium normal-case tracking-normal">— 넣을 운영진 (제외=점선)</span></div>
                                <div className="flex flex-wrap gap-2 p-3 rounded-xl border border-[var(--color-border-subtle)] bg-white">
                                    {staff.map((s) => { const ex = excludedStaff.has(s.id); return (
                                        <button key={s.id} onClick={() => setExcludedStaff((p) => { const n = new Set(p); ex ? n.delete(s.id) : n.add(s.id); return n; })}
                                            className={`px-3 py-1.5 rounded-full text-[13px] font-semibold border flex items-center gap-1.5 ${ex ? "bg-white text-[var(--color-text-muted)] border-dashed border-[var(--color-border)] line-through" : "bg-amber-100 text-amber-800 border-amber-300"}`}>
                                            {ex ? <X className="w-3 h-3 text-rose-500" /> : <Check className="w-3 h-3" />}{s.name}</button>); })}
                                    <span className="text-xs text-[var(--color-text-muted)] self-center ml-1">참여 {staff.length - excludedStaff.size} · 제외 {excludedStaff.size}</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mr-1">충돌 고려:</span>
                                <span className="px-3 py-1.5 rounded-full text-[13px] font-bold bg-[var(--color-text-primary)] text-white">● 기수↔기수 (항상)</span>
                                <ConsiderToggle on={consider.mixed} label="기수↔운영진" onClick={() => setConsider((c) => ({ ...c, mixed: !c.mixed }))} />
                                <ConsiderToggle on={consider.staff} label="운영진↔운영진" onClick={() => setConsider((c) => ({ ...c, staff: !c.staff }))} />
                            </div>
                        </section>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" onClick={randomize}><Dices className="w-4 h-4 mr-1" /> 충돌 최소화 랜덤</Button>
                        <Button size="sm" variant="outline" onClick={resetPool}><RotateCcw className="w-4 h-4 mr-1" /> 전부 풀로</Button>
                        <Button size="sm" variant="outline" onClick={copyResult}><ClipboardCopy className="w-4 h-4 mr-1" /> 결과 복사</Button>
                        <div className="flex items-center gap-2 ml-2"><span className="text-sm text-[var(--color-text-secondary)]">팀 수</span>
                            <input type="number" min={2} max={12} value={numTeams} onChange={(e) => setNumTeams(Math.max(2, Math.min(12, Number(e.target.value) || 2)))} className="w-16 px-2 py-1.5 rounded-lg border border-[var(--color-border)] text-sm text-center" /></div>
                    </div>

                    <section>
                        <div className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">미배정 ({pool.length})</div>
                        <Droppable id="slot:pool" className="min-h-[56px] rounded-xl border-2 border-dashed border-[var(--color-border)] bg-white p-3 flex flex-wrap gap-2" overClass="border-[var(--color-accent)] bg-[var(--color-accent-dim)]">
                            {pool.map((p) => <BuildChip key={p.key} p={p} badge={badges[p.key]} hovered={hover === p.key}
                                partner={hover != null && hover !== p.key && overlapMap.has(pkey(hover, p.key)) && teamOf(hover) === teamOf(p.key) && considered(overlapMap.get(pkey(hover, p.key))!.kind)} onHover={setHover} />)}
                        </Droppable>
                    </section>

                    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                        {Array.from({ length: numTeams }, (_, i) => i + 1).map((t) => {
                            const ps = roster.filter((p) => teamOf(p.key) === t).sort((a, b) => Number(a.staff) - Number(b.staff) || a.name.localeCompare(b.name, "ko"));
                            const tn = ps.filter((p) => !p.staff).length;
                            return (<Droppable key={t} id={`slot:${t}`} className="min-h-[200px] rounded-xl border border-[var(--color-border-subtle)] p-3 bg-white shadow-sm flex flex-col" overClass="border-[var(--color-accent)] bg-[var(--color-accent-dim)]">
                                <div className="flex items-center justify-between pb-2 mb-2 border-b border-[var(--color-border-subtle)]"><span className="font-bold text-sm">팀 {t}</span>
                                    <span className="text-[11px] text-[var(--color-text-muted)] bg-[var(--color-hover)] px-1.5 py-0.5 rounded">기수 {tn}·운영 {ps.length - tn}</span></div>
                                <div className="flex flex-col gap-1.5 flex-1">{ps.map((p) => <BuildChip key={p.key} p={p} badge={badges[p.key]} hovered={hover === p.key}
                                    partner={hover != null && hover !== p.key && overlapMap.has(pkey(hover, p.key)) && teamOf(hover) === t && considered(overlapMap.get(pkey(hover, p.key))!.kind)} onHover={setHover} />)}</div>
                            </Droppable>);
                        })}
                    </div>

                    <HoverPanel hover={hover} roster={roster} byKey={byKey} overlapMap={overlapMap} teamOf={teamOf} considered={considered} />

                    <section>
                        <div className="flex items-center gap-3 mb-2">
                            <Stat n={stat.trainee} label="기수↔기수" cls="text-rose-600" />
                            <Stat n={stat.mixed} label="기수↔운영" cls="text-amber-600" />
                            <Stat n={stat.staff} label="운영↔운영" cls="text-slate-500" />
                        </div>
                        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-white max-h-72 overflow-auto">
                            {conflicts.length === 0 ? <div className="text-center py-8 text-emerald-600 font-bold">✓ 겹침 없음</div> :
                                conflicts.sort((a, b) => ({ trainee: 0, mixed: 1, staff: 2 }[a.kind] - { trainee: 0, mixed: 1, staff: 2 }[b.kind]) || a.team - b.team).map((c, i) => (
                                    <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-border-subtle)] last:border-0 text-sm">
                                        <span className={`shrink-0 px-2 py-0.5 rounded text-[11px] font-bold ${c.kind === "trainee" ? "bg-rose-500/10 text-rose-600" : c.kind === "mixed" ? "bg-amber-500/10 text-amber-600" : "bg-slate-500/10 text-slate-500"}`}>
                                            {c.kind === "trainee" ? "기수↔기수" : c.kind === "mixed" ? "기수↔운영" : "운영↔운영"}</span>
                                        <span className="flex-1 break-keep"><b>{c.a.name}</b> ↔ <b>{c.b.name}</b></span>
                                        <span className="text-xs text-[var(--color-text-muted)] shrink-0">팀 {c.team}</span>
                                    </div>))}
                        </div>
                    </section>
                </div>
            </div>
            <DragOverlay>{activeLabel ? <div className="px-2.5 py-1.5 rounded-lg text-[13px] font-bold bg-[var(--color-text-primary)] text-white shadow-lg">{activeLabel}</div> : null}</DragOverlay>
        </DndContext>
    );
}

function Droppable({ id, className, overClass, children }: { id: string; className: string; overClass: string; children: React.ReactNode }) {
    const { setNodeRef, isOver } = useDroppable({ id });
    return <div ref={setNodeRef} className={`${className} ${isOver ? overClass : ""} transition-colors`}>{children}</div>;
}

function DragPill({ id, label }: { id: string; label: string }) {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
    return <div ref={setNodeRef} {...attributes} {...listeners} style={{ touchAction: "none" }}
        className={`px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 text-[12px] font-semibold cursor-grab ${isDragging ? "opacity-30" : ""}`}>{label}</div>;
}

function BuildChip({ p, badge, hovered, partner, onHover }: { p: Participant; badge?: { n: number; major: boolean }; hovered: boolean; partner: boolean; onHover: (k: string | null) => void }) {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `b:${p.key}` });
    const conflict = !!badge;
    return (
        <div ref={setNodeRef} {...attributes} {...listeners} style={{ touchAction: "none" }}
            onMouseEnter={() => onHover(p.key)} onMouseLeave={() => onHover(null)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[13px] font-semibold cursor-grab select-none border transition-all ${isDragging ? "opacity-30" : ""}
                ${hovered ? "bg-[var(--color-text-primary)] text-white border-[var(--color-text-primary)] scale-[1.03]"
                    : partner ? "bg-sky-100 text-sky-800 border-sky-400"
                    : conflict && badge!.major ? "bg-rose-50 text-rose-700 border-rose-300"
                    : conflict ? "bg-amber-50 text-amber-700 border-amber-300"
                    : p.staff ? "bg-amber-50/70 text-amber-800 border-amber-200" : "bg-[var(--color-hover)] text-[var(--color-text-primary)] border-transparent"}`}>
            <span className="flex-1 whitespace-nowrap">{p.name}{p.staff && <span className="opacity-60 text-[11px]"> 운영</span>}</span>
            {conflict && <span className={`text-[10px] font-bold px-1 rounded ${hovered ? "bg-white text-rose-600" : badge!.major ? "bg-rose-200 text-rose-700" : "bg-amber-200 text-amber-700"}`}>{badge!.n}</span>}
        </div>
    );
}

function ConsiderToggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
    return <button onClick={onClick} className={`px-3 py-1.5 rounded-full text-[13px] font-bold border flex items-center gap-1.5 ${on ? "bg-[var(--color-text-primary)] text-white border-[var(--color-text-primary)]" : "bg-white text-[var(--color-text-muted)] border-[var(--color-border)]"}`}>
        <span className={`w-2 h-2 rounded-full ${on ? "bg-emerald-400" : "bg-[var(--color-border)]"}`} />{label}</button>;
}
function Stat({ n, label, cls }: { n: number; label: string; cls: string }) {
    return <div className="flex-1 rounded-xl border border-[var(--color-border-subtle)] bg-white px-4 py-2.5"><div className={`text-xl font-black ${n === 0 ? "text-emerald-600" : cls}`}>{n}</div><div className="text-[11px] text-[var(--color-text-muted)] font-bold break-keep">{label}</div></div>;
}

function HoverPanel({ hover, roster, byKey, overlapMap, teamOf, considered }: {
    hover: string | null; roster: Participant[]; byKey: Record<string, Participant>;
    overlapMap: Map<string, { labels: Set<string>; kind: Kind }>; teamOf: (k: string) => Slot; considered: (k: Kind) => boolean;
}) {
    if (hover == null || !byKey[hover]) return <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] py-4 text-center text-sm text-[var(--color-text-muted)]">💡 멤버에 마우스를 올리면 누구와 어느 세션에서 겹쳤는지 보여줘요</div>;
    const me = byKey[hover]; const team = teamOf(hover);
    const items: { name: string; labels: string[]; kind: Kind }[] = [];
    if (team !== "pool") for (const p of roster) {
        if (p.key === hover || teamOf(p.key) !== team) continue;
        const ov = overlapMap.get(pkey(me.key, p.key));
        if (ov && considered(ov.kind)) items.push({ name: p.name, labels: [...ov.labels], kind: ov.kind });
    }
    return (
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-white p-4">
            <div className="font-bold mb-2 flex items-center gap-2 flex-wrap"><span className="px-2 py-0.5 rounded bg-[var(--color-text-primary)] text-white text-sm">{me.name}</span>
                <span className="text-xs text-[var(--color-text-muted)]">{team === "pool" ? "미배정" : `팀 ${team}`} · 같은 팀 겹침 {items.length}건</span></div>
            {items.length === 0 ? <p className="text-sm text-[var(--color-text-secondary)]">{team === "pool" ? "팀에 배정하면 겹침을 확인할 수 있어요" : "이 팀 안에서 겹치는 사람이 없어요 ✓"}</p>
                : <div className="flex flex-col gap-1.5">{items.map((it, i) => (<div key={i} className={`flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm ${it.kind === "trainee" ? "bg-rose-50" : it.kind === "mixed" ? "bg-amber-50" : "bg-slate-50"}`}>
                    <span className="font-bold flex-1 break-keep">{it.name}</span><span className="text-xs text-[var(--color-text-muted)]">{it.labels.join(", ")} 동일팀</span></div>))}</div>}
        </div>
    );
}

const HELP_ITEMS: [string, string][] = [
    ["과거 세션 선택", "겹침 기준으로 삼을 과거 팀세션을 켜요. 그 세션에서 같은 팀이었던 사람끼리 안 만나게 피합니다."],
    ["과거 팀에 운영진 기록", "team_history엔 기수만 있어서, 그 세션 팀에 운영진을 끌어다 넣어 '이 운영진=이 팀'을 기록하면 운영진 겹침도 계산돼요."],
    ["운영진 참여 / 충돌 고려", "이 팀빌딩에 넣을 운영진을 고르고, 기수↔운영진·운영진↔운영진 겹침을 켜고 끌 수 있어요. (기수↔기수는 항상 회피)"],
    ["충돌 최소화 랜덤", "현재 설정 기준으로 겹침이 가장 적은 조합을 자동 계산해 배치해요."],
    ["드래그 (PC·모바일)", "칩을 끌어 팀을 옮겨요(폰은 길게 누른 뒤 끌기). 결과는 자동 저장돼요."],
    ["보드 저장", "리슨업·BP처럼 보드를 여러 개 만들어 따로 관리할 수 있어요."],
];
function HelpPanel({ open, onToggle }: { open: boolean; onToggle: () => void }) {
    return (
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-gradient-to-br from-white to-[var(--color-surface)]">
            <button onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3"><span className="flex items-center gap-2 font-bold text-sm"><HelpCircle className="w-4 h-4 text-[var(--color-accent)]" /> 사용법</span>
                <ChevronDown className={`w-4 h-4 text-[var(--color-text-muted)] transition-transform ${open ? "rotate-180" : ""}`} /></button>
            {open && <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">{HELP_ITEMS.map(([t, d], i) => (<div key={i} className="flex gap-2.5">
                <div className="w-5 h-5 shrink-0 rounded-full bg-[var(--color-text-primary)] text-white flex items-center justify-center text-[11px] font-bold">{i + 1}</div>
                <div><b className="text-[13px] text-[var(--color-text-primary)] block break-keep">{t}</b><p className="text-xs text-[var(--color-text-secondary)] leading-snug break-keep">{d}</p></div></div>))}</div>}
        </div>
    );
}
