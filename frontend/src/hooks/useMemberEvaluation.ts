import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import memberApi from "@/lib/memberApi";
import { toast } from "sonner";

// ── Types (aligned with backend schemas) ────────────────────────────────

export interface PendingEval {
    round_id: number;
    round_title: string;
    session_title: string | null;
    submitted: boolean;
    is_open: boolean;
    results_open: boolean;
}

export interface SelfEvalQuestion {
    key: string;
    domain: string;
    label: string;
    text: string;      // self_text from backend
    order: number;
}

export interface SelfEvalFormData {
    questions: SelfEvalQuestion[];
    responses: Record<string, number>;   // existing responses {question_key: score}
    round_type: "INITIAL" | "FINAL" | "COMBINED";
    growth_reflection: string | null;
}

export interface MemberResultDetail {
    member_id: number;
    member_name: string;
    self_scores_by_question: Record<string, number | null>;
    self_scores_by_domain: Record<string, number | null>;
    audience_scores_by_question: Record<string, number | null>;
    audience_scores_by_domain: Record<string, number | null>;
    combined_scores_by_domain: Record<string, number | null>;
    stage: string | null;
    type: string | null;
    growth_reflection: string | null;
    round_type?: "INITIAL" | "FINAL" | "COMBINED" | null;
    initial?: MemberResultDetail | null;
}

// ── Query Keys ─────────────────────────────────────────────────────────

export const memberEvalKeys = {
    all: ["member-evaluation"] as const,
    pending: () => [...memberEvalKeys.all, "pending"] as const,
    selfForm: (roundId: number) => [...memberEvalKeys.all, "self-form", roundId] as const,
    result: (roundId: number) => [...memberEvalKeys.all, "result", roundId] as const,
};

// ── Query Hooks ────────────────────────────────────────────────────────

export function usePendingEvals() {
    return useQuery({
        queryKey: memberEvalKeys.pending(),
        queryFn: async () => {
            const { data } = await memberApi.get<PendingEval[]>(
                "/evaluations/member/pending",
            );
            return data;
        },
    });
}

export function useSelfEvalForm(roundId: number | string) {
    const id = Number(roundId);
    return useQuery({
        queryKey: memberEvalKeys.selfForm(id),
        queryFn: async () => {
            const { data } = await memberApi.get<SelfEvalFormData>(
                `/evaluations/member/round/${id}`,
            );
            return data;
        },
        enabled: !!id,
    });
}

export function useMemberOwnResult(roundId: number | string) {
    const id = Number(roundId);
    return useQuery({
        queryKey: memberEvalKeys.result(id),
        queryFn: async () => {
            const { data } = await memberApi.get<MemberResultDetail>(
                `/evaluations/member/round/${id}/result`,
            );
            return data;
        },
        enabled: !!id,
    });
}

// ── Mutation Hooks ─────────────────────────────────────────────────────

export function useSubmitSelfEval() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({
            roundId,
            scores,
            growth_reflection,
        }: {
            roundId: number | string;
            scores: Record<string, number>;
            growth_reflection?: string | null;
        }) => {
            const id = Number(roundId);
            const { data } = await memberApi.post(
                `/evaluations/member/round/${id}/submit`,
                { scores, growth_reflection },
            );
            return { ...data, roundId: id };
        },
        onSuccess: (result) => {
            queryClient.invalidateQueries({ queryKey: memberEvalKeys.pending() });
            queryClient.invalidateQueries({ queryKey: memberEvalKeys.selfForm(result.roundId) });
            toast.success("자기평가가 제출되었습니다.");
        },
        onError: (err: any) => {
            toast.error("제출 실패: " + (err?.response?.data?.detail ?? "알 수 없는 오류"));
        },
    });
}
