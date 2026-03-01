import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { toast } from "sonner";

export interface Session {
    id: number;
    title: string; // "1주차 세션", "MT"
    date: string; // YYYY-MM-DD
    week_num: number;
    type: "INDIVIDUAL" | "TEAM";
    status: "SETUP" | "PREP" | "OPS" | "POST" | "SETTLEMENT" | "FINALIZED";
    description?: string;
    teams?: {
        id: number;
        name: string;
        members: {
            id: number;
            name: string;
            is_active: boolean;
            attendance?: { status: string; excuse_type?: string };
        }[];
    }[];
    attendances?: {
        member_id: number;
        status: string;
        excuse_type?: string | null;
        excuse_text?: string | null;
        updated_at?: string | null;
    }[];
    assignments?: {
        id: number;
        session_id: number;
        member_id: number | null;
        team_id: number | null;
        type: string;
        status: string;
        scanned_at?: string;
        target_member_ids?: number[] | null;
        raw_data?: {
            feedback_detail?: { member_id: number; name: string; commented: boolean; is_self: boolean; comments?: string[] }[];
        } | null;
    }[];
    finalized_at?: string | null;
    config?: Record<string, any>;
}

// Keys
export const sessionsKeys = {
    all: ["sessions"] as const,
    lists: () => [...sessionsKeys.all, "list"] as const,
    details: () => [...sessionsKeys.all, "detail"] as const,
    detail: (id: number) => [...sessionsKeys.details(), id] as const,
    current: () => [...sessionsKeys.all, "current"] as const,
};

// Hooks
export function useSessions() {
    return useQuery({
        queryKey: sessionsKeys.lists(),
        queryFn: async () => {
            const { data } = await api.get<Session[]>("/sessions");
            return data;
        },
    });
}

export function useSession(id: number) {
    return useQuery({
        queryKey: sessionsKeys.detail(id),
        queryFn: async () => {
            const { data } = await api.get<Session>(`/sessions/${id}`);
            return data;
        },
        enabled: !!id,
        refetchInterval: 5_000,
    });
}

// Fetch ACTIVE or next UPCOMING session for Dashboard
// Assuming API supports ?status=current or similar logic, or we filter client-side if needed.
// Phase 10 spec mentions `GET /sessions?status=current`
export function useCurrentSession() {
    return useQuery({
        queryKey: sessionsKeys.current(),
        queryFn: async () => {
            // In a real implementation: GET /sessions/current or filter
            // For now, let's grab the list and sort by date, find closest
            const { data } = await api.get<Session[]>("/sessions");

            // Priority 1: In Progress / Active States
            const active = data.find((s) => ["PREP", "OPS", "POST", "SETTLEMENT"].includes(s.status));
            if (active) return active;

            // Priority 2: Upcoming (SETUP)
            const upcoming = data
                .filter((s) => s.status === "SETUP")
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];
            return upcoming || null;
        },
    });
}

export function useCreateSession() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (newSession: Partial<Session>) => {
            const { data } = await api.post<Session>("/sessions", newSession);
            return data;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: sessionsKeys.lists() });
            queryClient.invalidateQueries({ queryKey: sessionsKeys.current() });
            toast.success("세션이 생성되었습니다.");
            return data;
        },
    });
}

export function useUpdateSessionStatus() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ sessionId, status }: { sessionId: number; status: string }) => {
            const { data } = await api.patch<Session>(`/sessions/${sessionId}/status`, { status });
            return data;
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: sessionsKeys.details() });
            queryClient.invalidateQueries({ queryKey: sessionsKeys.lists() });
            toast.success(`세션 상태가 ${variables.status}로 변경되었습니다.`);
        },
    });
}

export function useGenerateTeams() {
    return useMutation({
        mutationFn: async ({ sessionId, numTeams }: { sessionId: number; numTeams: number }) => {
            const { data } = await api.post<any[]>(`/sessions/${sessionId}/teams/generate`, { num_teams: numTeams });
            return data;
        },
        onError: () => {
            toast.error("팀 생성 실패");
        },
    });
}

export interface SettlementPenalty {
    type: string;
    member_id: number;
    member_name: string;
    score_delta: number;
    deposit_delta: number;
    description: string;
}

export interface MeritPreviewItem {
    member_id: number;
    member_name: string;
    score_delta: number;
    description: string;
    source: "streak" | "manual";
}

interface SettlementPreviewResponse {
    penalties: SettlementPenalty[];
    merits: MeritPreviewItem[];
}

export interface SessionStats {
    attendance_rate: number;
    attendance_present: number;
    attendance_total: number;
    ppt_submitted: number;
    ppt_total: number;
    ppt_email_submitted: number;
    ppt_email_total: number;
    homework_submitted: number;
    homework_total: number;
}

export function useSessionStats(sessionId: number) {
    return useQuery({
        queryKey: [...sessionsKeys.detail(sessionId), "stats"],
        queryFn: async () => {
            const { data } = await api.get<SessionStats>(`/sessions/${sessionId}/stats`);
            return data;
        },
        enabled: !!sessionId,
    });
}

export function useSettlementPreview(sessionId: number) {
    return useQuery({
        queryKey: [...sessionsKeys.detail(sessionId), "settlement"],
        queryFn: async () => {
            const { data } = await api.get<SettlementPreviewResponse>(`/sessions/${sessionId}/settlement-preview`);
            return data;
        },
        enabled: !!sessionId,
    });
}

export function useFinalizeSession() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ sessionId, overrides, skip_merit_indices = [] }: { sessionId: number; overrides: any[]; skip_merit_indices?: number[] }) => {
            const { data } = await api.post(`/sessions/${sessionId}/finalize`, { overrides, skip_merit_indices });
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: sessionsKeys.details() });
            queryClient.invalidateQueries({ queryKey: sessionsKeys.lists() });
            toast.success("세션이 마감되었습니다.");
        },
    });
}

export function useDeleteSession() {
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    return useMutation({
        mutationFn: async (sessionId: number) => {
            await api.delete(`/sessions/${sessionId}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: sessionsKeys.lists() });
            queryClient.invalidateQueries({ queryKey: sessionsKeys.current() });
            toast.success("세션이 삭제되었습니다.");
            navigate("/sessions");
        },
        onError: (err: any) => {
            toast.error("삭제 실패: " + (err?.response?.data?.detail ?? "알 수 없는 오류"));
        },
    });
}

export function useUpdateSessionConfig() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ sessionId, config }: { sessionId: number; config: Record<string, any> }) => {
            const { data } = await api.patch(`/sessions/${sessionId}/config`, { config });
            return data;
        },
        onSuccess: (_, vars) => {
            queryClient.invalidateQueries({ queryKey: sessionsKeys.detail(vars.sessionId) });
            toast.success("세션 설정이 업데이트되었습니다.");
        },
        onError: () => {
            toast.error("설정 업데이트 실패");
        },
    });
}

export function useAddStagedMerit() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ sessionId, member_ids, score_delta, reason }: { sessionId: number; member_ids: number[]; score_delta: number; reason: string }) => {
            const { data } = await api.post(`/sessions/${sessionId}/staged-merits`, { member_ids, score_delta, reason });
            return data;
        },
        onSuccess: (_, vars) => {
            queryClient.invalidateQueries({ queryKey: [...sessionsKeys.detail(vars.sessionId), "settlement"] });
            toast.success("상점이 추가되었습니다.");
        },
        onError: () => {
            toast.error("상점 추가 실패");
        },
    });
}

export function useRemoveStagedMerit() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ sessionId, index }: { sessionId: number; index: number }) => {
            await api.delete(`/sessions/${sessionId}/staged-merits/${index}`);
        },
        onSuccess: (_, vars) => {
            queryClient.invalidateQueries({ queryKey: [...sessionsKeys.detail(vars.sessionId), "settlement"] });
            toast.success("상점이 삭제되었습니다.");
        },
        onError: () => {
            toast.error("상점 삭제 실패");
        },
    });
}

export function useSetFeedbackTargets() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({
            sessionId, memberId, targetMemberIds,
        }: { sessionId: number; memberId: number; targetMemberIds: number[] }) => {
            const { data } = await api.patch(
                `/sessions/${sessionId}/assignments/${memberId}/feedback-targets`,
                { target_member_ids: targetMemberIds },
            );
            return data;
        },
        onSuccess: (_, vars) => {
            queryClient.invalidateQueries({ queryKey: sessionsKeys.detail(vars.sessionId) });
            toast.success("피드백 대상이 지정되었습니다.");
        },
        onError: () => {
            toast.error("피드백 대상 지정 실패");
        },
    });
}
