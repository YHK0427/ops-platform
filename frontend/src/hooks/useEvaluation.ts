import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { toast } from "sonner";

// ── Types (aligned with backend schemas) ─────────────────────────────────────

export interface EvalRound {
    id: number;
    session_id: number;
    round_type: "INITIAL" | "FINAL";
    title: string;
    is_open: boolean;
    results_open: boolean;
    created_at: string | null;
    closed_at: string | null;
    // list response extras
    total_assignments?: number;
    submitted_count?: number;
    // detail response extras
    self_total?: number;
    self_submitted?: number;
    audience_total?: number;
    audience_submitted?: number;
}

export interface EvalAssignment {
    id: number;
    round_id: number;
    evaluator_user_id: number | null;
    presenter_member_id: number;
    eval_type: "SELF" | "AUDIENCE";
    submitted_at: string | null;
    presenter_name: string | null;
    evaluator_display_name: string | null;
}

export interface MyAssignment {
    id: number;
    round_id: number;
    presenter_member_id: number;
    presenter_name: string | null;
    submitted: boolean;
    responses: Record<string, number>;
}

export interface MemberResultSummary {
    member_id: number;
    member_name: string;
    self_scores: Record<string, number | null>;
    audience_scores: Record<string, number | null>;
    combined_scores: Record<string, number | null>;
}

export interface OpsResultDetail {
    member_id: number;
    member_name: string;
    self_scores_by_question: Record<string, number | null>;
    self_scores_by_domain: Record<string, number | null>;
    audience_scores_by_question: Record<string, number | null>;
    audience_scores_by_domain: Record<string, number | null>;
    combined_scores_by_domain: Record<string, number | null>;
    stage: string | null;
    type: string | null;
}

// ── Query Keys ───────────────────────────────────────────────────────────────

export interface MyPendingRound {
    round_id: number;
    round_title: string;
    round_type: string;
    total: number;
    submitted: number;
}

export const evalKeys = {
    all: ["evaluations"] as const,
    rounds: () => [...evalKeys.all, "rounds"] as const,
    round: (id: number) => [...evalKeys.all, "round", id] as const,
    assignments: (roundId: number) => [...evalKeys.all, "assignments", roundId] as const,
    myAssignments: (roundId: number) => [...evalKeys.all, "my-assignments", roundId] as const,
    myPending: () => [...evalKeys.all, "my-pending"] as const,
    results: (roundId: number) => [...evalKeys.all, "results", roundId] as const,
    memberResult: (roundId: number, memberId: number) =>
        [...evalKeys.all, "result", roundId, memberId] as const,
};

// ── Rounds ───────────────────────────────────────────────────────────────────

export function useEvalRounds() {
    return useQuery({
        queryKey: evalKeys.rounds(),
        queryFn: async () => {
            const { data } = await api.get<EvalRound[]>("/evaluations/rounds");
            return data;
        },
    });
}

export function useEvalRound(roundId: number) {
    return useQuery({
        queryKey: evalKeys.round(roundId),
        queryFn: async () => {
            const { data } = await api.get<EvalRound>(`/evaluations/rounds/${roundId}`);
            return data;
        },
        enabled: !!roundId,
    });
}

export function useCreateRound() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (body: { session_id?: number | null; round_type: string; title: string }) => {
            const { data } = await api.post<EvalRound>("/evaluations/rounds", body);
            return data;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: evalKeys.rounds() });
            toast.success("평가 라운드가 생성되었습니다.");
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.detail ?? "라운드 생성 실패");
        },
    });
}

export function useUpdateRound() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({
            roundId,
            ...body
        }: {
            roundId: number;
            is_open?: boolean;
            results_open?: boolean;
            title?: string;
        }) => {
            const { data } = await api.patch<EvalRound>(`/evaluations/rounds/${roundId}`, body);
            return data;
        },
        onSuccess: (data) => {
            qc.invalidateQueries({ queryKey: evalKeys.rounds() });
            qc.invalidateQueries({ queryKey: evalKeys.round(data.id) });
            toast.success("라운드가 업데이트되었습니다.");
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.detail ?? "업데이트 실패");
        },
    });
}

export function useDeleteRound() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (roundId: number) => {
            await api.delete(`/evaluations/rounds/${roundId}`);
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: evalKeys.rounds() });
            toast.success("라운드가 삭제되었습니다.");
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.detail ?? "삭제 실패");
        },
    });
}

// ── Assignments ──────────────────────────────────────────────────────────────

export function useEvalAssignments(roundId: number) {
    return useQuery({
        queryKey: evalKeys.assignments(roundId),
        queryFn: async () => {
            const { data } = await api.get<EvalAssignment[]>(
                `/evaluations/rounds/${roundId}/assignments`
            );
            return data;
        },
        enabled: !!roundId,
    });
}

export function useAutoAssign() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (roundId: number) => {
            const { data } = await api.post<{ created: number }>(
                `/evaluations/rounds/${roundId}/auto-assign`
            );
            return data;
        },
        onSuccess: (data, roundId) => {
            qc.invalidateQueries({ queryKey: evalKeys.assignments(roundId) });
            qc.invalidateQueries({ queryKey: evalKeys.rounds() });
            toast.success(`${data.created}건의 청중 평가가 자동 배정되었습니다.`);
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.detail ?? "자동 배정 실패");
        },
    });
}

export function useBulkAssign() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({
            roundId,
            assignments,
        }: {
            roundId: number;
            assignments: { evaluator_user_id: number; presenter_member_id: number }[];
        }) => {
            const { data } = await api.post<{ created: number; skipped: number }>(
                `/evaluations/rounds/${roundId}/assignments/bulk`,
                { assignments }
            );
            return data;
        },
        onSuccess: (data, vars) => {
            qc.invalidateQueries({ queryKey: evalKeys.assignments(vars.roundId) });
            qc.invalidateQueries({ queryKey: evalKeys.rounds() });
            toast.success(`${data.created}건 추가, ${data.skipped}건 중복 스킵`);
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.detail ?? "배정 추가 실패");
        },
    });
}

export function useDeleteAssignment() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({
            roundId,
            assignmentId,
        }: {
            roundId: number;
            assignmentId: number;
        }) => {
            await api.delete(
                `/evaluations/rounds/${roundId}/assignments/${assignmentId}`
            );
            return { roundId };
        },
        onSuccess: (data) => {
            qc.invalidateQueries({ queryKey: evalKeys.assignments(data.roundId) });
            qc.invalidateQueries({ queryKey: evalKeys.rounds() });
            toast.success("배정이 삭제되었습니다.");
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.detail ?? "삭제 실패");
        },
    });
}

export function useReplaceAudienceAssignments() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({
            roundId,
            assignments,
        }: {
            roundId: number;
            assignments: { evaluator_user_id: number; presenter_member_id: number }[];
        }) => {
            const { data } = await api.put<{ deleted: number; created: number }>(
                `/evaluations/rounds/${roundId}/audience-assignments`,
                { assignments }
            );
            return data;
        },
        onSuccess: (data, vars) => {
            qc.invalidateQueries({ queryKey: evalKeys.assignments(vars.roundId) });
            qc.invalidateQueries({ queryKey: evalKeys.rounds() });
            qc.invalidateQueries({ queryKey: evalKeys.myPending() });
            toast.success(`배정 저장 완료 (${data.created}건)`);
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.detail ?? "배정 저장 실패");
        },
    });
}

// ── My Assignments (Ops user audience eval) ──────────────────────────────────

export function useMyAssignments(roundId: number) {
    return useQuery({
        queryKey: evalKeys.myAssignments(roundId),
        queryFn: async () => {
            const { data } = await api.get<MyAssignment[]>(
                `/evaluations/rounds/${roundId}/my-assignments`
            );
            return data;
        },
        enabled: !!roundId,
    });
}

export function useSubmitAudienceEval() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({
            roundId,
            presenter_member_id,
            scores,
        }: {
            roundId: number;
            presenter_member_id: number;
            scores: Record<string, number>;
        }) => {
            const { data } = await api.post(`/evaluations/rounds/${roundId}/audience-submit`, {
                presenter_member_id,
                scores,
            });
            return data;
        },
        onSuccess: (_, vars) => {
            qc.invalidateQueries({ queryKey: evalKeys.myAssignments(vars.roundId) });
            qc.invalidateQueries({ queryKey: evalKeys.assignments(vars.roundId) });
            toast.success("청중 평가가 제출되었습니다.");
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.detail ?? "제출 실패");
        },
    });
}

// ── Results ──────────────────────────────────────────────────────────────────

export function useEvalResults(roundId: number) {
    return useQuery({
        queryKey: evalKeys.results(roundId),
        queryFn: async () => {
            const { data } = await api.get<MemberResultSummary[]>(
                `/evaluations/rounds/${roundId}/results`
            );
            return data;
        },
        enabled: !!roundId,
    });
}

export function useMemberResult(roundId: number, memberId: number) {
    return useQuery({
        queryKey: evalKeys.memberResult(roundId, memberId),
        queryFn: async () => {
            const { data } = await api.get<OpsResultDetail>(
                `/evaluations/rounds/${roundId}/results/${memberId}`
            );
            return data;
        },
        enabled: !!roundId && !!memberId,
    });
}
