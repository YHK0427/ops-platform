import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import memberApi from "@/lib/memberApi";

export interface ExcuseAttachment {
    id: number;
    name: string;
    content_type: string;
    size: number;
}

export interface Excuse {
    id: number;
    member_id: number;
    member_name: string;
    target_date: string;
    excuse_type: "PRE" | "POST";
    category: "ABSENT" | "LATE" | "EARLY_LEAVE";
    reason_kind: "NORMAL" | "RECOGNIZED";
    reason: string;
    review: "PENDING" | "APPROVED" | "REJECTED" | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
    session_id: number | null;
    created_at: string;
    editable: boolean;
    session_finalized: boolean;
    attachments: ExcuseAttachment[];
}

// FastAPI 422 검증 오류는 detail 이 배열이라 그대로 토스트에 넣으면 React 가 죽는다
export function errMsg(error: any, fallback: string): string {
    const d = error?.response?.data?.detail;
    return typeof d === "string" ? d : fallback;
}

export const CATEGORY_LABEL = { ABSENT: "결석", LATE: "지각", EARLY_LEAVE: "조퇴" } as const;
// 결석 인정사유는 공결, 지각·조퇴 인정사유는 출결 그대로 두고 벌점만 면제("인정")
export const approvalWord = (e: Pick<Excuse, "category">) => (e.category === "ABSENT" ? "공결" : "인정");
export function reviewLabel(e: Pick<Excuse, "category" | "review">): string {
    if (e.review === "PENDING") return "승인 대기";
    return `${approvalWord(e)} ${e.review === "APPROVED" ? "승인" : "반려"}`;
}

export const myExcusesQuery = {
        queryKey: ["member", "excuses"],
        queryFn: async () => (await memberApi.get<Excuse[]>("/portal/excuses")).data,
};

export function useMyExcuses() {
    return useQuery(myExcusesQuery);
}

export function useExcusePreview(date: string) {
    return useQuery({
        queryKey: ["member", "excuses", "preview", date],
        queryFn: async () =>
            (await memberApi.get<{ excuse_type: "PRE" | "POST" | null }>("/portal/excuses/preview", { params: { date } })).data,
        enabled: !!date,
    });
}

export function useStaffExcuses(params: { session_id?: number; date_from?: string; date_to?: string; review?: "PENDING" }, enabled = true) {
    return useQuery({
        queryKey: ["excuses", params],
        enabled,
        queryFn: async () => (await api.get<Excuse[]>("/excuses", { params })).data,
    });
}

export function useReviewExcuse() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, decision }: { id: number; decision: "APPROVED" | "REJECTED" }) =>
            (await api.post<Excuse>(`/excuses/${id}/review`, { decision })).data,
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["excuses"] });
            qc.invalidateQueries({ queryKey: ["sessions"] });
        },
    });
}
