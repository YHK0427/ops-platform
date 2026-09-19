import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

export interface AuditLogEntry {
    id: number;
    created_at: string;
    actor_label: string;
    actor_username: string | null;
    actor_role: string | null;
    cohort_id: number | null;
    operation: "INSERT" | "UPDATE" | "DELETE";
    table_name: string;
    row_id: string | null;
    entity_label: string | null;
    changes: Record<string, unknown> | null;
    request_path: string | null;
}

export interface AuditLogTableOption {
    name: string;
    label: string;
}

export interface AuditLogFilters {
    actor_username?: string;
    table_name?: string;
    operation?: string;
    cohort_id?: number;
    member_id?: number;
    limit?: number;
    offset?: number;
}

export function useAuditLogs(filters: AuditLogFilters) {
    return useQuery({
        queryKey: ["audit-logs", filters],
        queryFn: async () => {
            const { data } = await api.get<{ items: AuditLogEntry[]; total: number }>("/audit-logs", {
                params: filters,
            });
            return data;
        },
    });
}

export interface DailyCount {
    date: string;
    count: number;
}

export function useAuditDailyCounts(filters: Omit<AuditLogFilters, "limit" | "offset">) {
    return useQuery({
        queryKey: ["audit-logs", "daily-counts", filters],
        queryFn: async () => {
            const { data } = await api.get<DailyCount[]>("/audit-logs/daily-counts", {
                params: filters,
            });
            return data;
        },
    });
}

export function useAuditLogTables() {
    return useQuery({
        queryKey: ["audit-logs", "tables"],
        queryFn: async () => {
            const { data } = await api.get<AuditLogTableOption[]>("/audit-logs/tables");
            return data;
        },
        staleTime: 60_000,
    });
}
