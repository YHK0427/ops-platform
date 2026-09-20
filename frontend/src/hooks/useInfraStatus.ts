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
