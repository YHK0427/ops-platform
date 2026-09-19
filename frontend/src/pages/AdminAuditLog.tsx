import { useEffect, useRef, useState } from "react";
import { History, ChevronLeft, ChevronRight, Cpu, HardDrive, MemoryStick, Database, Server, Activity } from "lucide-react";
import {
    ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, BarChart, Bar,
} from "recharts";
import { useAuditLogs, useAuditLogTables, useAuditDailyCounts, useInfraStatus } from "@/hooks";
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
};

const OP_LABELS: Record<string, string> = {
    INSERT: "생성", UPDATE: "수정", DELETE: "삭제",
    LOGIN: "로그인", LOGIN_FAILED: "로그인 실패", LOGOUT: "로그아웃",
};

const PAGE_SIZE = 50;

function formatUptime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 24) return `${Math.floor(h / 24)}일 ${h % 24}시간`;
    if (h > 0) return `${h}시간 ${m}분`;
    return `${m}분`;
}

function StatCard({ icon: Icon, label, value, sub, warn }: { icon: any; label: string; value: string; sub?: string; warn?: boolean }) {
    return (
        <div className={cn("p-4 rounded-xl border bg-[var(--color-surface)]", warn ? "border-rose-300" : "border-[var(--color-border)]")}>
            <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] mb-1">
                <Icon className="w-3.5 h-3.5" />
                {label}
            </div>
            <div className={cn("text-xl font-bold", warn && "text-rose-600")}>{value}</div>
            {sub && <div className="text-xs text-[var(--color-text-muted)] mt-0.5">{sub}</div>}
        </div>
    );
}

function ActivityLogTab() {
    const [tableName, setTableName] = useState<string>("");
    const [operation, setOperation] = useState<string>("");
    const [actorUsername, setActorUsername] = useState("");
    const [page, setPage] = useState(0);

    const { data: tables } = useAuditLogTables();
    const activeFilters = {
        table_name: tableName || undefined,
        operation: operation || undefined,
        actor_username: actorUsername || undefined,
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

interface InfraHistoryPoint {
    time: string;
    cpu: number;
    mem: number | null;
    disk: number;
}

// ponytail: 히스토리는 세션 메모리에만 쌓임(새로고침하면 초기화) — 서버에 저장 안 함, 화면 켜둔 동안 추세만 보여주면 충분
const HISTORY_LIMIT = 30;

function InfraStatusTab({ active }: { active: boolean }) {
    const { data, isLoading, dataUpdatedAt } = useInfraStatus(active);
    const [history, setHistory] = useState<InfraHistoryPoint[]>([]);
    const lastRecordedAt = useRef<number>(0);

    useEffect(() => {
        if (!data || dataUpdatedAt === lastRecordedAt.current) return;
        lastRecordedAt.current = dataUpdatedAt;
        setHistory((prev) => [
            ...prev,
            {
                time: new Date(dataUpdatedAt).toLocaleTimeString("ko-KR", { hour12: false }),
                cpu: data.cpu_load_1m,
                mem: data.memory_used_percent,
                disk: data.disk_used_percent,
            },
        ].slice(-HISTORY_LIMIT));
    }, [data, dataUpdatedAt]);

    if (isLoading || !data) {
        return <div className="text-center py-12 text-[var(--color-text-muted)] text-sm">불러오는 중...</div>;
    }

    return (
        <div className="space-y-4">
            <p className="text-xs text-[var(--color-text-muted)]">
                15초마다 자동 갱신 · 마지막 갱신 {new Date(dataUpdatedAt).toLocaleTimeString("ko-KR")}
                <br />
                컨테이너별 개별 지표(재시작 횟수 등)는 이 화면 범위 밖입니다 — 백엔드 프로세스 기준 지표입니다.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard icon={Server} label="백엔드 가동시간" value={formatUptime(data.backend_uptime_seconds)} />
                <StatCard
                    icon={Cpu}
                    label={`CPU 부하 (코어 ${data.cpu_count}개)`}
                    value={data.cpu_load_1m.toFixed(2)}
                    sub={`5분 ${data.cpu_load_5m.toFixed(2)} · 15분 ${data.cpu_load_15m.toFixed(2)}`}
                    warn={data.cpu_load_1m > data.cpu_count}
                />
                <StatCard
                    icon={MemoryStick}
                    label="메모리"
                    value={data.memory_used_percent != null ? `${data.memory_used_percent}%` : "-"}
                    sub={data.memory_total_mb ? `${((data.memory_total_mb - (data.memory_available_mb ?? 0)) / 1024).toFixed(1)}GB / ${(data.memory_total_mb / 1024).toFixed(1)}GB` : undefined}
                    warn={(data.memory_used_percent ?? 0) > 85}
                />
                <StatCard
                    icon={HardDrive}
                    label="디스크"
                    value={`${data.disk_used_percent}%`}
                    sub={`${data.disk_used_gb}GB / ${data.disk_total_gb}GB`}
                    warn={data.disk_used_percent > 85}
                />
                <StatCard
                    icon={Database}
                    label="DB"
                    value={data.db_ok ? "정상" : "장애"}
                    sub={data.db_ok ? `${data.db_latency_ms}ms · ${data.db_size_mb}MB · 연결 ${data.db_active_connections}개` : undefined}
                    warn={!data.db_ok}
                />
                <StatCard
                    icon={Activity}
                    label="Redis"
                    value={data.redis_ok ? "정상" : "장애"}
                    sub={data.redis_ok ? `${data.redis_latency_ms}ms · ${data.redis_used_memory_mb}MB · 클라이언트 ${data.redis_connected_clients}개` : undefined}
                    warn={!data.redis_ok}
                />
            </div>

            {history.length >= 2 && (
                <div className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
                    <p className="text-xs text-[var(--color-text-muted)] mb-2">
                        CPU 부하 · 메모리/디스크 사용률 추이 (화면 켜둔 동안)
                    </p>
                    <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={history} margin={{ left: -10, right: 10, top: 5, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                            <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                            <YAxis yAxisId="pct" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                            <YAxis yAxisId="load" orientation="right" tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                            <Line yAxisId="pct" type="monotone" dataKey="mem" name="메모리%" stroke="#3b82f6" dot={false} connectNulls />
                            <Line yAxisId="pct" type="monotone" dataKey="disk" name="디스크%" stroke="#f59e0b" dot={false} />
                            <Line yAxisId="load" type="monotone" dataKey="cpu" name="CPU 부하" stroke="#ef4444" dot={false} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}

export default function AdminAuditLog() {
    const [tab, setTab] = useState<"activity" | "infra">("activity");

    return (
        <div className="space-y-4">
            <PageHeader title="모니터링" subtitle="누가 언제 무엇을 바꿨는지, 서버 상태는 어떤지 한눈에 봅니다" />

            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
                {([["activity", "활동 로그"], ["infra", "인프라 상태"]] as const).map(([k, label]) => (
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

            {tab === "activity" ? <ActivityLogTab /> : <InfraStatusTab active={tab === "infra"} />}
        </div>
    );
}
