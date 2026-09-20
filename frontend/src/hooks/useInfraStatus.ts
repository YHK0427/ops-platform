import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

export interface InfraStatus {
    backend_uptime_seconds: number;
    git_sha: string | null;
    server_time: string;
    cpu_load_1m: number;
    cpu_load_5m: number;
    cpu_load_15m: number;
    cpu_count: number;
    memory_total_mb: number | null;
    memory_available_mb: number | null;
    memory_used_percent: number | null;
    disk_total_gb: number;
    disk_used_gb: number;
    disk_used_percent: number;
    db_ok: boolean;
    db_latency_ms: number | null;
    db_size_mb: number | null;
    db_active_connections: number | null;
    db_max_connections: number | null;
    db_connections_percent: number | null;
    db_longest_query_seconds: number | null;
    db_idle_in_transaction: number | null;
    db_cache_hit_percent: number | null;
    db_deadlocks: number | null;
    redis_ok: boolean;
    redis_latency_ms: number | null;
    redis_used_memory_mb: number | null;
    redis_max_memory_mb: number | null;
    redis_used_percent: number | null;
    redis_connected_clients: number | null;
    redis_blocked_clients: number | null;
    redis_evicted_keys: number | null;
    redis_aof_last_write_ok: boolean | null;
    queue_depth: number | null;
    worker_alive: boolean | null;
    worker_jobs_complete: number | null;
    worker_jobs_failed: number | null;
    worker_jobs_retried: number | null;
    worker_jobs_ongoing: number | null;
    backup_age_hours: number | null;
    backup_size_mb: number | null;
    /** 서버가 내린 판정 — 임계값이 백엔드 한 곳에만 있도록 화면에서 재계산하지 않는다 */
    problems: string[];
    warnings: string[];
}

export function useInfraStatus(enabled: boolean) {
    return useQuery({
        queryKey: ["infra-status"],
        queryFn: async () => {
            const { data } = await api.get<InfraStatus>("/infra/status");
            return data;
        },
        enabled,
        refetchInterval: 15_000,
    });
}

// ── 접속 기록 ────────────────────────────────────────────────────────────────

export interface AccessLog {
    id: number;
    created_at: string;
    last_seen_at: string | null;
    actor_kind: "staff" | "member" | "anon";
    actor_username: string | null;
    actor_label: string | null;
    cohort_id: number | null;
    method: string;
    path: string;
    status_code: number | null;
    duration_ms: number | null;
    ip: string | null;
    user_agent: string | null;
    /** 짧은 시간 안에 같은 요청이 반복되면 한 줄로 묶고 이 값이 올라간다 */
    hits: number;
}

export interface ActiveUser {
    actor_kind: string;
    actor_username: string | null;
    actor_label: string | null;
    last_seen_at: string;
    hits: number;
    last_path: string;
}

export function useAccessLogs(params: {
    actor_kind?: string; actor_username?: string; path?: string;
    only_errors?: boolean; days?: number; limit?: number; offset?: number;
}, enabled: boolean) {
    return useQuery({
        queryKey: ["access-logs", params],
        queryFn: async () => {
            const { data } = await api.get<{ items: AccessLog[]; total: number }>(
                "/audit-logs/access", { params },
            );
            return data;
        },
        enabled,
    });
}

export function useActiveUsers(enabled: boolean, minutes = 30) {
    return useQuery({
        queryKey: ["access-active", minutes],
        queryFn: async () => {
            const { data } = await api.get<ActiveUser[]>("/audit-logs/access/active", { params: { minutes } });
            return data;
        },
        enabled,
        refetchInterval: 30_000,
    });
}

export function useAccessDaily(enabled: boolean, days = 14) {
    return useQuery({
        queryKey: ["access-daily", days],
        queryFn: async () => {
            const { data } = await api.get<{ date: string; users: number; hits: number }[]>(
                "/audit-logs/access/daily", { params: { days } },
            );
            return data;
        },
        enabled,
    });
}
