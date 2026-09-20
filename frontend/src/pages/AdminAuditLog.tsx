import { useState } from "react";
import { History, ChevronLeft, ChevronRight, Cpu, HardDrive, MemoryStick, Database, Activity, CheckCircle2, AlertTriangle, XCircle, ListTodo, Archive, Users, Globe, Boxes, Gauge, RotateCw, ScrollText, Play, Pause } from "lucide-react";
import {
    ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, BarChart, Bar,
    AreaChart, Area,
} from "recharts";
import { useAuditLogs, useAuditLogTables, useAuditDailyCounts, useInfraStatus, useMembers, useAccessLogs, useActiveUsers, useAccessDaily, useInfraHistory, useContainers, useApiHealth, useContainerLogs } from "@/hooks";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
    Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const OP_COLORS: Record<string, string> = {
    INSERT: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
    UPDATE: "bg-blue-500/15 text-blue-600 border-blue-500/30",
    DELETE: "bg-rose-500/15 text-rose-600 border-rose-500/30",
    LOGIN: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
    LOGIN_FAILED: "bg-rose-500/15 text-rose-600 border-rose-500/30",
    LOGOUT: "bg-zinc-500/15 text-zinc-600 border-zinc-500/30",
    PWA_INSTALL: "bg-violet-500/15 text-violet-600 border-violet-500/30",
};

const OP_LABELS: Record<string, string> = {
    INSERT: "생성", UPDATE: "수정", DELETE: "삭제",
    LOGIN: "로그인", LOGIN_FAILED: "로그인 실패", LOGOUT: "로그아웃",
    PWA_INSTALL: "PWA 설치",
};

const PAGE_SIZE = 50;

function formatUptime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 24) return `${Math.floor(h / 24)}일 ${h % 24}시간`;
    if (h > 0) return `${h}시간 ${m}분`;
    return `${m}분`;
}

type Level = "ok" | "warn" | "bad";

function StatCard({ icon: Icon, label, value, sub, warn, level }: {
    icon: any; label: string; value: string; sub?: string; warn?: boolean; level?: Level;
}) {
    const lv: Level = level ?? (warn ? "bad" : "ok");
    return (
        <div className={cn(
            "p-4 rounded-xl border bg-[var(--color-surface)]",
            lv === "bad" ? "border-rose-300" : lv === "warn" ? "border-amber-300" : "border-[var(--color-border)]",
        )}>
            <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] mb-1">
                <Icon className="w-3.5 h-3.5" />
                {label}
            </div>
            <div className={cn("text-xl font-bold", lv === "bad" && "text-rose-600", lv === "warn" && "text-amber-600")}>
                {value}
            </div>
            {sub && <div className="text-xs text-[var(--color-text-muted)] mt-0.5">{sub}</div>}
        </div>
    );
}

/** 가로 막대 게이지 — 숫자만 나열하면 스캔이 안 된다. '얼마나 찼나'는 길이로 보는 게 빠르다. */
function Meter({ icon: Icon, label, percent, value, hint, level }: {
    icon: any; label: string; percent: number | null; value: string; hint?: string; level: Level;
}) {
    const pct = Math.max(0, Math.min(100, percent ?? 0));
    const bar = level === "bad" ? "bg-rose-500" : level === "warn" ? "bg-amber-500" : "bg-emerald-500";
    return (
        <div className="py-2.5">
            <div className="flex items-baseline gap-2 mb-1.5">
                <Icon className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0 self-center" />
                <span className="text-sm font-medium w-[104px] shrink-0">{label}</span>
                <span className={cn(
                    "text-sm font-bold tabular-nums w-[72px] shrink-0",
                    level === "bad" && "text-rose-600", level === "warn" && "text-amber-600",
                )}>
                    {value}
                </span>
                {hint && <span className="text-xs text-[var(--color-text-muted)] truncate">{hint}</span>}
            </div>
            <div className="h-2 rounded-full bg-[var(--color-border)] overflow-hidden ml-[126px]">
                <div className={cn("h-full rounded-full transition-all", bar)} style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
}

/** 살았나 죽었나만 보는 한 줄짜리 표시등 */
function Pill({ label, ok, note }: { label: string; ok: boolean | null; note?: string }) {
    return (
        <div className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-xl border bg-white",
            ok === false ? "border-rose-300" : ok === null ? "border-[var(--color-border)]" : "border-emerald-200",
        )}>
            <span className={cn(
                "w-2 h-2 rounded-full shrink-0",
                ok === false ? "bg-rose-500" : ok === null ? "bg-gray-300" : "bg-emerald-500",
            )} />
            <span className="text-sm font-medium">{label}</span>
            <span className={cn(
                "text-xs",
                ok === false ? "text-rose-600 font-bold" : "text-[var(--color-text-muted)]",
            )}>
                {ok === false ? "장애" : ok === null ? "확인 불가" : note || "정상"}
            </span>
        </div>
    );
}

/** 백업 경과 시간을 사람 말로 */
function backupAge(h: number | null): string {
    if (h == null) return "없음";
    if (h < 1) return "방금";
    if (h < 24) return `${Math.floor(h)}시간 전`;
    return `${Math.floor(h / 24)}일 전`;
}

function ActivityLogTab() {
    const [tableName, setTableName] = useState<string>("");
    const [operation, setOperation] = useState<string>("");
    const [actorUsername, setActorUsername] = useState("");
    const [memberId, setMemberId] = useState<string>("");
    const [page, setPage] = useState(0);

    const { data: tables } = useAuditLogTables();
    const { data: members } = useMembers(false); // 이탈·수료 멤버도 과거 기록 조회 가능해야 하므로 false
    const activeFilters = {
        table_name: tableName || undefined,
        operation: operation || undefined,
        actor_username: actorUsername || undefined,
        member_id: memberId ? Number(memberId) : undefined,
    };
    const { data, isLoading } = useAuditLogs({ ...activeFilters, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
    const { data: dailyCounts } = useAuditDailyCounts(activeFilters);

    const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

    return (
        <div className="space-y-4">
            {dailyCounts && dailyCounts.length >= 2 && (
                <div className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
                    <p className="text-xs text-[var(--color-text-muted)] mb-2">최근 14일 일별 활동 건수</p>
                    <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={dailyCounts} margin={{ left: -20, right: 10, top: 5, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => d.slice(5)} />
                            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                            <Tooltip />
                            <Bar dataKey="count" name="활동 건수" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2 bg-[var(--color-surface)] p-3 rounded-xl border border-[var(--color-border)]">
                <Input
                    placeholder="아이디로 검색..."
                    value={actorUsername}
                    onChange={(e) => { setActorUsername(e.target.value); setPage(0); }}
                    className="w-48 h-9"
                />
                <Select value={tableName || "__all__"} onValueChange={(v) => { setTableName(v === "__all__" ? "" : v); setPage(0); }}>
                    <SelectTrigger className="w-44 h-9">
                        <SelectValue placeholder="전체 종류" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="__all__">전체 종류</SelectItem>
                        {(tables ?? []).map((t) => (
                            <SelectItem key={t.name} value={t.name}>{t.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Select value={operation || "__all__"} onValueChange={(v) => { setOperation(v === "__all__" ? "" : v); setPage(0); }}>
                    <SelectTrigger className="w-36 h-9">
                        <SelectValue placeholder="전체 동작" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="__all__">전체 동작</SelectItem>
                        <SelectItem value="INSERT">생성</SelectItem>
                        <SelectItem value="UPDATE">수정</SelectItem>
                        <SelectItem value="DELETE">삭제</SelectItem>
                        <SelectItem value="LOGIN">로그인</SelectItem>
                        <SelectItem value="LOGIN_FAILED">로그인 실패</SelectItem>
                        <SelectItem value="LOGOUT">로그아웃</SelectItem>
                        <SelectItem value="PWA_INSTALL">PWA 설치</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={memberId || "__all__"} onValueChange={(v) => { setMemberId(v === "__all__" ? "" : v); setPage(0); }}>
                    <SelectTrigger className="w-40 h-9">
                        <SelectValue placeholder="전체 멤버" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="__all__">전체 멤버</SelectItem>
                        {(members ?? []).map((m) => (
                            <SelectItem key={m.id} value={m.id.toString()}>{m.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {data && (
                    <span className="text-xs text-[var(--color-text-muted)] ml-auto">
                        총 {data.total.toLocaleString()}건
                    </span>
                )}
            </div>

            <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>시각</TableHead>
                            <TableHead>누가</TableHead>
                            <TableHead>무엇을</TableHead>
                            <TableHead>대상</TableHead>
                            <TableHead>상세</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableRow><TableCell colSpan={5} className="text-center py-8 text-[var(--color-text-muted)]">불러오는 중...</TableCell></TableRow>
                        ) : !data || data.items.length === 0 ? (
                            <TableRow><TableCell colSpan={5} className="text-center py-8 text-[var(--color-text-muted)]">기록이 없습니다.</TableCell></TableRow>
                        ) : (
                            data.items.map((row) => (
                                <TableRow key={row.id}>
                                    <TableCell className="text-xs whitespace-nowrap text-[var(--color-text-muted)]">
                                        {new Date(row.created_at).toLocaleString("ko-KR")}
                                    </TableCell>
                                    <TableCell className="text-sm whitespace-nowrap">{row.actor_label}</TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className={OP_COLORS[row.operation]}>
                                            {OP_LABELS[row.operation] ?? row.operation}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-sm font-medium whitespace-nowrap">
                                        {row.entity_label ?? `${row.table_name}#${row.row_id ?? "?"}`}
                                    </TableCell>
                                    <TableCell>
                                        {row.changes ? (
                                            <Popover>
                                                <PopoverTrigger asChild>
                                                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                                                        <History className="w-3.5 h-3.5 mr-1" />
                                                        보기
                                                    </Button>
                                                </PopoverTrigger>
                                                <PopoverContent className="w-96 max-h-80 overflow-auto">
                                                    <p className="text-[10px] text-[var(--color-text-muted)] mb-1 font-mono">
                                                        {row.table_name}#{row.row_id ?? "?"}
                                                    </p>
                                                    <pre className="text-xs whitespace-pre-wrap break-all">
                                                        {JSON.stringify(row.changes, null, 2)}
                                                    </pre>
                                                </PopoverContent>
                                            </Popover>
                                        ) : (
                                            <span className="text-xs text-[var(--color-text-muted)]">-</span>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3">
                    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                        <ChevronLeft className="w-4 h-4 mr-1" />
                        이전
                    </Button>
                    <span className="text-sm text-[var(--color-text-muted)]">{page + 1} / {totalPages}</span>
                    <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
                        다음
                        <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                </div>
            )}
        </div>
    );
}

const RANGES = [
    { h: 6, label: "6시간" },
    { h: 24, label: "24시간" },
    { h: 24 * 7, label: "7일" },
    { h: 24 * 30, label: "30일" },
] as const;

function fmtTick(iso: string, hours: number): string {
    const d = new Date(iso);
    if (hours <= 24) return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 서버가 1분마다 쌓아둔 이력으로 그린다. 화면을 꺼도 남는다 — 이게 없으면
 *  "어제부터 메모리가 새고 있다" 같은 건 영영 못 본다. */
function InfraCharts() {
    const [hours, setHours] = useState<number>(24);
    const { data, isLoading } = useInfraHistory(true, hours);
    const pts = data ?? [];

    return (
        <div className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] space-y-4">
            <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold">추이</h3>
                <div className="ml-auto inline-flex rounded-lg border border-[var(--color-border)] bg-gray-50 p-0.5">
                    {RANGES.map((r) => (
                        <button key={r.h} onClick={() => setHours(r.h)}
                            className={cn("px-2.5 py-1 rounded-md text-xs font-semibold transition",
                                hours === r.h ? "bg-white shadow-sm" : "text-[var(--color-text-muted)]")}>
                            {r.label}
                        </button>
                    ))}
                </div>
            </div>

            {isLoading ? (
                <div className="py-10 text-center text-sm text-[var(--color-text-muted)]">불러오는 중...</div>
            ) : pts.length < 2 ? (
                <div className="py-10 text-center text-sm text-[var(--color-text-muted)]">
                    아직 쌓인 기록이 부족합니다. 1분마다 한 점씩 쌓이니 잠시 뒤 다시 보세요.
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <ChartBox title="CPU · 메모리 · 디스크">
                        <LineChart data={pts} margin={{ left: -14, right: 8, top: 5, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                            <XAxis dataKey="t" tick={{ fontSize: 10 }} tickFormatter={(v) => fmtTick(v, hours)} minTickGap={40} />
                            <YAxis yAxisId="pct" domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
                            <YAxis yAxisId="load" orientation="right" tick={{ fontSize: 10 }} />
                            <Tooltip labelFormatter={(v) => new Date(v as string).toLocaleString("ko-KR")} />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Line yAxisId="pct" type="monotone" dataKey="mem" name="메모리%" stroke="#3b82f6" dot={false} connectNulls />
                            <Line yAxisId="pct" type="monotone" dataKey="disk" name="디스크%" stroke="#f59e0b" dot={false} connectNulls />
                            <Line yAxisId="load" type="monotone" dataKey="cpu" name="CPU 부하" stroke="#ef4444" dot={false} connectNulls />
                        </LineChart>
                    </ChartBox>

                    <ChartBox title="요청 수 · 실패">
                        <AreaChart data={pts} margin={{ left: -14, right: 8, top: 5, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                            <XAxis dataKey="t" tick={{ fontSize: 10 }} tickFormatter={(v) => fmtTick(v, hours)} minTickGap={40} />
                            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                            <Tooltip labelFormatter={(v) => new Date(v as string).toLocaleString("ko-KR")} />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Area type="monotone" dataKey="requests" name="요청" stroke="#10b981" fill="#10b98122" connectNulls />
                            <Area type="monotone" dataKey="errors" name="실패" stroke="#ef4444" fill="#ef444433" connectNulls />
                        </AreaChart>
                    </ChartBox>

                    <ChartBox title="응답 속도 (p95) · 대기 작업">
                        <LineChart data={pts} margin={{ left: -14, right: 8, top: 5, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                            <XAxis dataKey="t" tick={{ fontSize: 10 }} tickFormatter={(v) => fmtTick(v, hours)} minTickGap={40} />
                            <YAxis yAxisId="ms" tick={{ fontSize: 10 }} unit="ms" />
                            <YAxis yAxisId="q" orientation="right" tick={{ fontSize: 10 }} allowDecimals={false} />
                            <Tooltip labelFormatter={(v) => new Date(v as string).toLocaleString("ko-KR")} />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Line yAxisId="ms" type="monotone" dataKey="p95_ms" name="p95 응답" stroke="#8b5cf6" dot={false} connectNulls />
                            <Line yAxisId="q" type="monotone" dataKey="queue" name="대기 작업" stroke="#f97316" dot={false} connectNulls />
                        </LineChart>
                    </ChartBox>

                    <ChartBox title="DB 크기 · 연결 수">
                        <LineChart data={pts} margin={{ left: -14, right: 8, top: 5, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                            <XAxis dataKey="t" tick={{ fontSize: 10 }} tickFormatter={(v) => fmtTick(v, hours)} minTickGap={40} />
                            <YAxis yAxisId="mb" tick={{ fontSize: 10 }} unit="MB" />
                            <YAxis yAxisId="c" orientation="right" tick={{ fontSize: 10 }} allowDecimals={false} />
                            <Tooltip labelFormatter={(v) => new Date(v as string).toLocaleString("ko-KR")} />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Line yAxisId="mb" type="monotone" dataKey="db_mb" name="DB 크기" stroke="#0ea5e9" dot={false} connectNulls />
                            <Line yAxisId="c" type="monotone" dataKey="db_conn" name="DB 연결" stroke="#64748b" dot={false} connectNulls />
                        </LineChart>
                    </ChartBox>
                </div>
            )}
        </div>
    );
}

function ChartBox({ title, children }: { title: string; children: React.ReactElement }) {
    return (
        <div>
            <p className="text-xs font-medium text-[var(--color-text-muted)] mb-1">{title}</p>
            <ResponsiveContainer width="100%" height={190}>{children}</ResponsiveContainer>
        </div>
    );
}

/** 컨테이너별 상태. 재시작 횟수와 OOM 은 여기서만 보인다 —
 *  "서비스는 떠 있는데 자꾸 죽었다 살아나는 중"을 잡는 유일한 단서다. */
function ContainerTable() {
    const { data, isLoading } = useContainers(true);
    const rows = data ?? [];

    if (!isLoading && rows.length === 0) {
        return (
            <div className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text-muted)]">
                컨테이너 정보를 읽을 수 없습니다 — docker.sock 이 백엔드에 연결되지 않았습니다.
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
            <div className="px-4 py-3 flex items-center gap-2">
                <Boxes className="w-4 h-4 text-[var(--color-accent)]" />
                <h3 className="text-sm font-bold">컨테이너</h3>
                <span className="text-xs text-[var(--color-text-muted)]">
                    재시작이 계속 늘면 어딘가 반복해서 죽고 있는 것입니다
                </span>
            </div>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>서비스</TableHead>
                        <TableHead className="w-[110px]">상태</TableHead>
                        <TableHead className="w-[90px]">재시작</TableHead>
                        <TableHead className="w-[100px]">가동시간</TableHead>
                        <TableHead className="w-[100px]">메모리</TableHead>
                        <TableHead className="w-[80px]">CPU</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map((c) => {
                        const down = c.state !== "running";
                        return (
                            <TableRow key={`${c.project}-${c.name}`} className={cn(!c.is_ours && "opacity-50")}>
                                <TableCell className="text-sm">
                                    <span className="font-medium">{c.service}</span>
                                    {!c.is_ours && (
                                        <span className="ml-1.5 text-[10px] text-[var(--color-text-muted)]">
                                            {c.project} (다른 스택)
                                        </span>
                                    )}
                                    <div className="text-[10px] text-[var(--color-text-muted)] truncate max-w-[280px]">
                                        {c.image}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <Badge variant="outline" className={cn("text-[11px]",
                                        down ? "bg-rose-500/15 text-rose-600 border-rose-500/30"
                                            : c.health === "unhealthy" ? "bg-amber-500/15 text-amber-600 border-amber-500/30"
                                            : "bg-emerald-500/15 text-emerald-600 border-emerald-500/30")}>
                                        {down ? (c.state === "exited" ? `종료(${c.exit_code})` : c.state)
                                            : c.health ? (c.health === "healthy" ? "정상" : c.health) : "동작 중"}
                                    </Badge>
                                    {c.oom_killed && (
                                        <div className="text-[10px] text-rose-600 font-bold mt-0.5">메모리 부족으로 강제 종료됨</div>
                                    )}
                                </TableCell>
                                <TableCell className="text-sm tabular-nums">
                                    <span className={cn((c.restart_count ?? 0) > 3 && "text-rose-600 font-bold")}>
                                        {c.restart_count ?? "-"}
                                    </span>
                                    {(c.restart_count ?? 0) > 0 && <RotateCw className="inline w-3 h-3 ml-1 text-[var(--color-text-muted)]" />}
                                </TableCell>
                                <TableCell className="text-sm">
                                    {c.uptime_seconds != null ? formatUptime(c.uptime_seconds) : "-"}
                                </TableCell>
                                <TableCell className="text-sm tabular-nums">
                                    {c.memory_mb != null ? `${c.memory_mb}MB` : "-"}
                                </TableCell>
                                <TableCell className="text-sm tabular-nums">
                                    {c.cpu_percent != null ? `${c.cpu_percent}%` : "-"}
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}

/** 우리 API 가 얼마나 건강한가. 접속 기록에 이미 상태코드와 응답시간이 있어서
 *  새로 계측할 게 없다 — 읽어서 집계만 한다. */
function ApiHealthPanel() {
    const [hours, setHours] = useState(24);
    const { data } = useApiHealth(true, hours);
    if (!data) return null;

    const bad = data.error_rate >= 5;
    return (
        <div className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] space-y-3">
            <div className="flex items-center gap-2">
                <Gauge className="w-4 h-4 text-[var(--color-accent)]" />
                <h3 className="text-sm font-bold">API 응답 상태</h3>
                <div className="ml-auto inline-flex rounded-lg border border-[var(--color-border)] bg-gray-50 p-0.5">
                    {[6, 24, 24 * 7].map((h) => (
                        <button key={h} onClick={() => setHours(h)}
                            className={cn("px-2.5 py-1 rounded-md text-xs font-semibold transition",
                                hours === h ? "bg-white shadow-sm" : "text-[var(--color-text-muted)]")}>
                            {h < 24 ? `${h}시간` : `${h / 24}일`}
                        </button>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {([
                    ["요청 수", data.requests.toLocaleString(), false],
                    ["실패율", `${data.error_rate}%`, bad],
                    ["보통 응답(p50)", `${data.p50_ms ?? "-"}ms`, false],
                    ["느린 편(p95)", `${data.p95_ms ?? "-"}ms`, (data.p95_ms ?? 0) > 1000],
                    ["가장 느림(p99)", `${data.p99_ms ?? "-"}ms`, (data.p99_ms ?? 0) > 3000],
                ] as const).map(([k, v, warn]) => (
                    <div key={k} className={cn("p-3 rounded-lg border bg-white",
                        warn ? "border-amber-300" : "border-[var(--color-border)]")}>
                        <div className="text-xs text-[var(--color-text-muted)]">{k}</div>
                        <div className={cn("text-lg font-bold tabular-nums", warn && "text-amber-600")}>{v}</div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <p className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5">느린 화면 순</p>
                    <div className="space-y-1">
                        {data.slowest.slice(0, 6).map((e) => (
                            <div key={e.path} className="flex items-center gap-2 text-xs">
                                <span className="w-[62px] shrink-0 text-right font-bold tabular-nums">{e.avg_ms}ms</span>
                                <div className="flex-1 h-1.5 rounded-full bg-[var(--color-border)] overflow-hidden">
                                    <div className="h-full rounded-full bg-violet-400"
                                        style={{ width: `${Math.min(100, (e.avg_ms / Math.max(1, data.slowest[0].avg_ms)) * 100)}%` }} />
                                </div>
                                <span className="w-[150px] truncate text-[var(--color-text-muted)]">{screenName(e.path)}</span>
                            </div>
                        ))}
                    </div>
                </div>
                <div>
                    <p className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5">오류가 난 곳</p>
                    {data.most_errors.length === 0 ? (
                        <p className="text-xs text-[var(--color-text-muted)]">없습니다.</p>
                    ) : (
                        <div className="space-y-1">
                            {data.most_errors.slice(0, 6).map((e) => (
                                <div key={e.path} className="flex items-center gap-2 text-xs">
                                    <span className="w-[42px] shrink-0 text-right font-bold tabular-nums text-rose-600">{e.errors}건</span>
                                    <span className="flex-1 truncate">{screenName(e.path)}</span>
                                    <span className="text-[10px] text-[var(--color-text-muted)] font-mono truncate max-w-[160px]">{e.path}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

/** 컨테이너 로그. 별도 로그 뷰어를 띄워 iframe 으로 끼우는 대신 여기서 바로 본다 —
 *  로그인이 두 번 필요하지 않고, 화면 언어도 그대로다. */
function LogViewer() {
    const { data: containers } = useContainers(true);
    const ours = (containers ?? []).filter((c) => c.is_ours);
    const [picked, setPicked] = useState<string | null>(null);
    const [errorsOnly, setErrorsOnly] = useState(false);
    const [q, setQ] = useState("");
    const [live, setLive] = useState(true);

    const name = picked ?? ours.find((c) => c.service === "backend")?.name ?? ours[0]?.name ?? null;
    const { data: lines, isFetching } = useContainerLogs(name, { tail: 300, errors_only: errorsOnly, q }, live);

    return (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
            <div className="px-4 py-3 flex flex-wrap items-center gap-2">
                <ScrollText className="w-4 h-4 text-[var(--color-accent)]" />
                <h3 className="text-sm font-bold">로그</h3>
                <div className="inline-flex rounded-lg border border-[var(--color-border)] bg-gray-50 p-0.5 ml-1">
                    {ours.map((c) => (
                        <button key={c.name} onClick={() => setPicked(c.name)}
                            className={cn("px-2.5 py-1 rounded-md text-xs font-semibold transition",
                                name === c.name ? "bg-white shadow-sm" : "text-[var(--color-text-muted)]")}>
                            {c.service}
                        </button>
                    ))}
                </div>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer ml-1">
                    <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />
                    오류만
                </label>
                <Input className="w-[180px] h-8 text-xs" placeholder="내용으로 찾기"
                    value={q} onChange={(e) => setQ(e.target.value)} />
                <Button variant="outline" size="sm" className="ml-auto h-8" onClick={() => setLive((v) => !v)}>
                    {live ? <><Pause className="w-3.5 h-3.5 mr-1" />멈춤</> : <><Play className="w-3.5 h-3.5 mr-1" />따라가기</>}
                </Button>
            </div>
            <div className="bg-[#0f172a] text-[#e2e8f0] font-mono text-[11px] leading-relaxed max-h-[420px] overflow-auto px-3 py-2">
                {!lines || lines.length === 0 ? (
                    <div className="text-gray-500 py-6 text-center">
                        {isFetching ? "불러오는 중..." : "보여줄 로그가 없습니다"}
                    </div>
                ) : lines.map((l, i) => (
                    <div key={i} className="flex gap-2 hover:bg-white/5 px-1 -mx-1 rounded">
                        <span className="text-gray-500 shrink-0">
                            {l.ts.length > 19 ? l.ts.slice(11, 19) : l.ts}
                        </span>
                        <span className={cn("whitespace-pre-wrap break-all",
                            /ERROR|CRITICAL|Traceback|Exception/.test(l.message) ? "text-rose-400"
                                : /WARNING|WARN/.test(l.message) ? "text-amber-300" : "")}>
                            {l.message}
                        </span>
                    </div>
                ))}
            </div>
            <div className="px-4 py-2 text-[11px] text-[var(--color-text-muted)]">
                최근 300줄 · {live ? "3초마다 갱신" : "멈춤"}
                {" · 터미널에서 보려면 "}
                <code className="font-mono">docker compose logs -f {ours.find((c) => c.name === name)?.service}</code>
            </div>
        </div>
    );
}

function InfraStatusTab({ active }: { active: boolean }) {
    const { data, isLoading, dataUpdatedAt } = useInfraStatus(active);

    if (isLoading || !data) {
        return <div className="text-center py-12 text-[var(--color-text-muted)] text-sm">불러오는 중...</div>;
    }

    return (
        <div className="space-y-4">
            {/* 맨 위 한 줄로 '지금 괜찮은가'에 답한다. 숫자를 읽고 판단하게 하지 않는다 —
                임계값 판정은 서버가 하고 화면은 그대로 보여주기만 한다. */}
            {data.problems.length > 0 ? (
                <div className="p-4 rounded-xl border border-rose-300 bg-rose-50">
                    <div className="flex items-center gap-2 font-bold text-rose-700">
                        <XCircle className="w-4 h-4" /> 조치가 필요합니다
                    </div>
                    <ul className="mt-2 space-y-1 text-sm text-rose-700">
                        {data.problems.map((p) => <li key={p}>· {p}</li>)}
                    </ul>
                </div>
            ) : data.warnings.length > 0 ? (
                <div className="p-4 rounded-xl border border-amber-300 bg-amber-50">
                    <div className="flex items-center gap-2 font-bold text-amber-700">
                        <AlertTriangle className="w-4 h-4" /> 지켜볼 것
                    </div>
                    <ul className="mt-2 space-y-1 text-sm text-amber-700">
                        {data.warnings.map((w) => <li key={w}>· {w}</li>)}
                    </ul>
                </div>
            ) : (
                <div className="p-4 rounded-xl border border-emerald-300 bg-emerald-50 flex items-center gap-2 font-bold text-emerald-700">
                    <CheckCircle2 className="w-4 h-4" /> 모두 정상입니다
                </div>
            )}

            {data.problems.length > 0 && data.warnings.length > 0 && (
                <ul className="space-y-1 text-sm text-amber-700 px-1">
                    {data.warnings.map((w) => <li key={w}>· {w}</li>)}
                </ul>
            )}

            {/* 살았나 죽었나부터. 세부 숫자는 그 다음 문제다. */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Pill label="백엔드" ok={true} note={formatUptime(data.backend_uptime_seconds)} />
                <Pill label="데이터베이스" ok={data.db_ok} note={`${data.db_latency_ms ?? "-"}ms`} />
                <Pill label="Redis" ok={data.redis_ok} note={`${data.redis_latency_ms ?? "-"}ms`} />
                <Pill label="작업 워커" ok={data.worker_alive}
                    note={data.queue_depth ? `대기 ${data.queue_depth}건` : "대기 없음"} />
            </div>

            <p className="text-xs text-[var(--color-text-muted)]">
                15초마다 자동 갱신 · 마지막 갱신 {new Date(dataUpdatedAt).toLocaleTimeString("ko-KR")}
                {data.git_sha && <> · 배포된 버전 <code className="font-mono">{data.git_sha}</code></>}
            </p>

            {/* 조용히 실패하는 것들을 맨 앞에 둔다 — 화면이 깨지면 사람이 알려주지만
                워커가 멈추거나 백업이 안 도는 건 아무도 알려주지 않는다. */}
            {/* 화면이 깨지면 기수원이 몇 분 안에 알려준다. 아래 둘은 아무도 안 알려준다. */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <StatCard
                    icon={Archive}
                    label="마지막 백업"
                    value={backupAge(data.backup_age_hours)}
                    sub={data.backup_size_mb != null
                        ? `${data.backup_size_mb}MB · 매일 새벽 4시 자동`
                        : "자동 백업이 걸려 있지 않습니다 (docs/monitoring.md)"}
                    level={data.backup_age_hours == null ? "warn"
                        : data.backup_age_hours > 48 ? "bad"
                        : data.backup_age_hours > 30 ? "warn" : "ok"}
                />
                <StatCard
                    icon={ListTodo}
                    label="작업 처리 (크롤링·영상·푸시)"
                    value={data.worker_alive === false ? "멈춤" : `대기 ${data.queue_depth ?? 0}건`}
                    sub={data.worker_alive === false
                        ? "과제 검사와 푸시 알림이 처리되지 않습니다"
                        : `완료 ${data.worker_jobs_complete ?? 0} · 실패 ${data.worker_jobs_failed ?? 0} · 진행 중 ${data.worker_jobs_ongoing ?? 0}`}
                    level={data.worker_alive === false ? "bad"
                        : data.worker_jobs_failed ? "warn"
                        : (data.queue_depth ?? 0) > 100 ? "warn" : "ok"}
                />
            </div>

            {/* 얼마나 찼나 — 숫자를 읽고 판단하게 하지 않는다. 길이로 보면 훑는 데 1초면 된다. */}
            <div className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
                <h3 className="text-sm font-bold mb-1">얼마나 찼나</h3>
                <p className="text-xs text-[var(--color-text-muted)] mb-2">
                    한도 대비 비율입니다. 막대가 노랗거나 빨개지기 전엔 신경 안 써도 됩니다.
                </p>
                <div className="divide-y divide-[var(--color-border)]">
                    <Meter
                        icon={HardDrive} label="디스크"
                        percent={data.disk_used_percent}
                        value={`${data.disk_used_percent}%`}
                        hint={`${data.disk_used_gb}GB / ${data.disk_total_gb}GB`}
                        level={data.disk_used_percent >= 90 ? "bad" : data.disk_used_percent >= 80 ? "warn" : "ok"}
                    />
                    <Meter
                        icon={MemoryStick} label="메모리"
                        percent={data.memory_used_percent}
                        value={data.memory_used_percent != null ? `${data.memory_used_percent}%` : "-"}
                        hint={data.memory_total_mb
                            ? `${((data.memory_total_mb - (data.memory_available_mb ?? 0)) / 1024).toFixed(1)}GB / ${(data.memory_total_mb / 1024).toFixed(1)}GB`
                            : undefined}
                        level={(data.memory_used_percent ?? 0) >= 90 ? "warn" : "ok"}
                    />
                    <Meter
                        icon={Cpu} label="CPU"
                        percent={(data.cpu_load_1m / data.cpu_count) * 100}
                        value={data.cpu_load_1m.toFixed(2)}
                        hint={`코어 ${data.cpu_count}개 기준 · 5분 ${data.cpu_load_5m.toFixed(2)} · 15분 ${data.cpu_load_15m.toFixed(2)}`}
                        level={data.cpu_load_1m > data.cpu_count ? "warn" : "ok"}
                    />
                    <Meter
                        icon={Database} label="DB 연결"
                        percent={data.db_connections_percent}
                        value={`${data.db_active_connections ?? "-"} / ${data.db_max_connections ?? "-"}`}
                        hint={`한도의 ${data.db_connections_percent ?? 0}%`}
                        level={(data.db_connections_percent ?? 0) >= 80 ? "warn" : "ok"}
                    />
                    <Meter
                        icon={Activity} label="Redis 메모리"
                        percent={data.redis_used_percent}
                        value={data.redis_used_percent != null ? `${data.redis_used_percent}%` : `${data.redis_used_memory_mb ?? "-"}MB`}
                        hint={`${data.redis_used_memory_mb ?? "-"}MB / ${data.redis_max_memory_mb ?? "무제한"}MB${data.redis_evicted_keys ? ` · 버려진 키 ${data.redis_evicted_keys}` : ""}`}
                        level={data.redis_evicted_keys ? "bad" : (data.redis_used_percent ?? 0) >= 70 ? "warn" : "ok"}
                    />
                </div>
            </div>

            {/* 나머지 잔지표 — 평소엔 안 보지만 이상할 때 여기서 실마리가 나온다 */}
            <details className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
                <summary className="px-4 py-3 text-sm font-bold cursor-pointer select-none">
                    자세한 숫자
                </summary>
                <div className="px-4 pb-4 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 text-sm">
                    {([
                        ["DB 응답", `${data.db_latency_ms ?? "-"}ms`],
                        ["DB 크기", `${data.db_size_mb ?? "-"}MB`],
                        ["DB 캐시 적중", data.db_cache_hit_percent != null ? `${data.db_cache_hit_percent}%` : "-"],
                        ["교착 발생", `${data.db_deadlocks ?? 0}회`],
                        ["가장 오래 도는 쿼리", data.db_longest_query_seconds != null
                            ? (data.db_longest_query_seconds >= 60
                                ? `${Math.floor(data.db_longest_query_seconds / 60)}분`
                                : `${Math.round(data.db_longest_query_seconds)}초`)
                            : "-"],
                        ["방치된 트랜잭션", `${data.db_idle_in_transaction ?? 0}개`],
                        ["Redis 응답", `${data.redis_latency_ms ?? "-"}ms`],
                        ["Redis 연결", `${data.redis_connected_clients ?? "-"}개`],
                        ["Redis 대기 클라이언트", `${data.redis_blocked_clients ?? 0}개`],
                        ["Redis 저장 상태", data.redis_aof_last_write_ok == null ? "-" : data.redis_aof_last_write_ok ? "정상" : "실패"],
                        ["누적 처리 작업", `${data.worker_jobs_complete ?? 0}건`],
                        ["재시도한 작업", `${data.worker_jobs_retried ?? 0}건`],
                    ] as const).map(([k, v]) => (
                        <div key={k}>
                            <div className="text-xs text-[var(--color-text-muted)]">{k}</div>
                            <div className="font-bold tabular-nums">{v}</div>
                        </div>
                    ))}
                </div>
            </details>

            <InfraCharts />
            <ContainerTable />
            <LogViewer />
            <ApiHealthPanel />
        </div>
    );
}


// ── 접속 기록 탭 ──────────────────────────────────────────────────────────────
// 활동 로그가 '무엇이 바뀌었나'라면 여기는 '누가 들어와서 뭘 봤나'다.
// 로그인은 한 번만 찍히고 기수원 토큰은 사실상 만료가 없어서, 이게 없으면
// "요즘 누가 쓰고 있나"에 답할 방법이 없었다.

const KIND_LABEL_KO: Record<string, string> = { staff: "운영진", member: "기수원", anon: "비로그인" };

/** API 경로를 사람이 읽는 화면 이름으로. 모르는 건 경로 그대로 보여준다. */
function screenName(path: string): string {
    const p = path.replace(/^\/api\/v1/, "");
    const table: [RegExp, string][] = [
        [/^\/notifications\/announcements\/\{id\}/, "공지 상세 (기수원)"],
        [/^\/notifications\/announcements/, "공지 목록 (기수원)"],
        [/^\/notifications\/manage\/announcements/, "공지 관리"],
        [/^\/notifications\/manage\/pdf-to-images/, "PDF 변환"],
        [/^\/notifications/, "알림"],
        [/^\/sessions\/\{id\}\/stats/, "세션 통계"],
        [/^\/sessions\/\{id\}/, "세션 상세"],
        [/^\/sessions/, "세션 목록"],
        [/^\/members/, "멤버"],
        [/^\/ledger\/treasury/, "금고"],
        [/^\/ledger/, "장부"],
        [/^\/scoring/, "심사/채점"],
        [/^\/live-feedback/, "실시간 피드백"],
        [/^\/team-building/, "팀 빌딩"],
        [/^\/evaluation|^\/eval/, "성장리포트"],
        [/^\/assignments/, "과제"],
        [/^\/crawler/, "크롤러"],
        [/^\/dev-feedback/, "개발자 요청"],
        [/^\/patch-notes/, "패치노트"],
        [/^\/audit-logs\/access/, "접속 기록"],
        [/^\/audit-logs/, "활동 로그"],
        [/^\/infra/, "인프라 상태"],
        [/^\/auth/, "로그인"],
        [/^\/cohorts/, "기수 공간"],
    ];
    for (const [re, name] of table) if (re.test(p)) return name;
    return p;
}

function relTimeKo(iso: string): string {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "방금";
    if (s < 3600) return `${Math.floor(s / 60)}분 전`;
    if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
    return `${Math.floor(s / 86400)}일 전`;
}

function AccessLogTab({ active }: { active: boolean }) {
    const [kind, setKind] = useState("");
    const [q, setQ] = useState("");
    const [onlyErrors, setOnlyErrors] = useState(false);
    const [days, setDays] = useState(7);
    const [page, setPage] = useState(0);
    const LIMIT = 100;

    const { data: activeUsers } = useActiveUsers(active, 30);
    const { data: daily } = useAccessDaily(active, days);
    const { data, isLoading } = useAccessLogs({
        actor_kind: kind || undefined,
        path: q || undefined,
        only_errors: onlyErrors || undefined,
        days,
        limit: LIMIT,
        offset: page * LIMIT,
    }, active);

    const items = data?.items ?? [];
    const total = data?.total ?? 0;

    return (
        <div className="space-y-4">
            {/* 지금 누가 쓰고 있나 — 제일 자주 궁금한 것 */}
            <div className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
                <div className="flex items-center gap-2 text-sm font-bold mb-2">
                    <Users className="w-4 h-4 text-[var(--color-accent)]" />
                    최근 30분 접속 {activeUsers?.length ? `· ${activeUsers.length}명` : ""}
                </div>
                {!activeUsers || activeUsers.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-muted)]">최근 30분 동안 아무도 들어오지 않았습니다.</p>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        {activeUsers.map((u) => (
                            <div key={`${u.actor_kind}-${u.actor_username}`}
                                className="px-2.5 py-1.5 rounded-lg border border-[var(--color-border)] bg-white text-xs">
                                <span className="font-bold">{u.actor_label || u.actor_username}</span>
                                <span className="text-[var(--color-text-muted)]">
                                    {" · "}{screenName(u.last_path)}{" · "}{relTimeKo(u.last_seen_at)}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* 날짜별 접속자 수 */}
            {daily && daily.length >= 2 && (
                <div className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
                    <p className="text-xs text-[var(--color-text-muted)] mb-2">최근 {days}일 · 날짜별 접속자 수(중복 제외)와 요청 수</p>
                    <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={daily} margin={{ left: -10, right: 10, top: 5, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                            <YAxis yAxisId="u" tick={{ fontSize: 11 }} allowDecimals={false} />
                            <YAxis yAxisId="h" orientation="right" tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                            <Bar yAxisId="u" dataKey="users" name="접속자 수" fill="var(--color-accent)" radius={[4, 4, 0, 0]} />
                            <Bar yAxisId="h" dataKey="hits" name="요청 수" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* 필터 */}
            <div className="flex flex-wrap items-center gap-2">
                <Select value={kind || "all"} onValueChange={(v) => { setKind(v === "all" ? "" : v); setPage(0); }}>
                    <SelectTrigger className="w-[140px]"><SelectValue placeholder="전체" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">전체</SelectItem>
                        <SelectItem value="staff">운영진</SelectItem>
                        <SelectItem value="member">기수원</SelectItem>
                        <SelectItem value="anon">비로그인</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={String(days)} onValueChange={(v) => { setDays(Number(v)); setPage(0); }}>
                    <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {[1, 7, 14, 30, 90].map((d) => <SelectItem key={d} value={String(d)}>{d}일</SelectItem>)}
                    </SelectContent>
                </Select>
                <Input className="w-[220px]" placeholder="경로로 찾기 (예: sessions)"
                    value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="checkbox" checked={onlyErrors}
                        onChange={(e) => { setOnlyErrors(e.target.checked); setPage(0); }} />
                    오류만 (400 이상)
                </label>
                <span className="ml-auto text-sm text-[var(--color-text-muted)]">총 {total}건</span>
            </div>

            {isLoading ? (
                <div className="text-center py-12 text-[var(--color-text-muted)] text-sm">불러오는 중...</div>
            ) : items.length === 0 ? (
                <div className="text-center py-12 text-[var(--color-text-muted)] text-sm">기록이 없습니다</div>
            ) : (
                <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[150px]">시각</TableHead>
                                <TableHead className="w-[170px]">누가</TableHead>
                                <TableHead>무엇을 봤나</TableHead>
                                <TableHead className="w-[90px]">결과</TableHead>
                                <TableHead className="w-[130px]">접속 위치</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {items.map((r) => (
                                <TableRow key={r.id}>
                                    <TableCell className="text-xs text-[var(--color-text-muted)]">
                                        {relTimeKo(r.last_seen_at || r.created_at)}
                                        <div className="text-[10px]">
                                            {new Date(r.last_seen_at || r.created_at).toLocaleTimeString("ko-KR")}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        {r.actor_label || <span className="text-[var(--color-text-muted)]">비로그인</span>}
                                        <div className="text-[10px] text-[var(--color-text-muted)]">
                                            {KIND_LABEL_KO[r.actor_kind] ?? r.actor_kind}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        {screenName(r.path)}
                                        {r.hits > 1 && (
                                            <span className="ml-1.5 text-[10px] text-[var(--color-text-muted)]">
                                                {r.hits}회
                                            </span>
                                        )}
                                        <div className="text-[10px] text-[var(--color-text-muted)] font-mono">
                                            {r.method} {r.path}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className={cn(
                                            "text-[11px]",
                                            (r.status_code ?? 0) >= 500 ? "bg-rose-500/15 text-rose-600 border-rose-500/30"
                                                : (r.status_code ?? 0) >= 400 ? "bg-amber-500/15 text-amber-600 border-amber-500/30"
                                                : "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
                                        )}>
                                            {r.status_code ?? "-"}
                                        </Badge>
                                        <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{r.duration_ms}ms</div>
                                    </TableCell>
                                    <TableCell className="text-[11px] text-[var(--color-text-muted)]">
                                        <div className="flex items-center gap-1">
                                            <Globe className="w-3 h-3" />{r.ip || "-"}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}

            {total > LIMIT && (
                <div className="flex items-center justify-center gap-2">
                    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                        <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="text-sm text-[var(--color-text-muted)]">
                        {page + 1} / {Math.ceil(total / LIMIT)}
                    </span>
                    <Button variant="outline" size="sm" disabled={(page + 1) * LIMIT >= total} onClick={() => setPage((p) => p + 1)}>
                        <ChevronRight className="w-4 h-4" />
                    </Button>
                </div>
            )}
        </div>
    );
}

export default function AdminAuditLog() {
    const [tab, setTab] = useState<"activity" | "access" | "infra">("activity");

    return (
        <div className="space-y-4">
            <PageHeader title="모니터링" subtitle="누가 언제 무엇을 바꿨는지, 서버 상태는 어떤지 한눈에 봅니다" />

            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
                {([["activity", "활동 로그"], ["access", "접속 기록"], ["infra", "인프라 상태"]] as const).map(([k, label]) => (
                    <button
                        key={k}
                        onClick={() => setTab(k)}
                        className={cn(
                            "px-4 py-1.5 rounded-md text-sm font-medium transition-colors",
                            tab === k ? "bg-white text-[var(--color-accent)] shadow-sm" : "text-gray-500 hover:text-gray-700"
                        )}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {tab === "activity" ? <ActivityLogTab />
                : tab === "access" ? <AccessLogTab active={tab === "access"} />
                : <InfraStatusTab active={tab === "infra"} />}
        </div>
    );
}
