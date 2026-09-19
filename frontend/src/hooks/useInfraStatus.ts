import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

export interface InfraStatus {
    backend_uptime_seconds: number;
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
    redis_ok: boolean;
    redis_latency_ms: number | null;
    redis_used_memory_mb: number | null;
    redis_connected_clients: number | null;
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
