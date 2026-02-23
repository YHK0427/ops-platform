import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { toast } from "sonner";

export interface LedgerEntry {
    id: number;
    member_id: number;
    type: "DEPOSIT" | "WITHDRAW" | "PENALTY" | "MERIT" | "ADJUSTMENT" | "FINE" | "MILESTONE_FINE" | "DEPOSIT_RECHARGE" | "DEPOSIT_ADJUST" | "DEPOSIT_REFUND";
    amount_krw: number;
    score_delta: number;
    description: string;
    created_at: string;
    deposit_after: number;
    created_by: string;
    member_name?: string; // Ideally backend sends this, or we map it
}

export interface MeritRequest {
    member_ids: number[];
    score_delta: number;
    reason: string;
}

export interface TransactionRequest {
    member_id: number;
    type: string;
    amount_krw: number;
    score_delta: number;
    description: string;
}

// Keys
export const ledgerKeys = {
    all: ["ledger"] as const,
    list: (filters: any) => [...ledgerKeys.all, "list", filters] as const,
};

// Hooks
export function useLedger(filters: { member_id?: number | "all"; type?: string; start_date?: string; end_date?: string; page?: number; limit?: number }) {
    const { page = 1, limit = 20, ...rest } = filters;
    return useQuery({
        queryKey: ledgerKeys.list({ ...rest, page, limit }),
        queryFn: async () => {
            const params = new URLSearchParams({
                page: page.toString(),
                limit: limit.toString()
            });
            if (rest.member_id && rest.member_id !== "all") params.append("member_id", rest.member_id.toString());
            if (rest.type && rest.type !== "all") params.append("type", rest.type);
            if (rest.start_date) params.append("start_date", rest.start_date);
            if (rest.end_date) params.append("end_date", rest.end_date);

            const { data } = await api.get<LedgerEntry[]>(`/ledger?${params.toString()}`);
            return data;
        },
    });
}

export function useGiveMerit() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (req: MeritRequest) => {
            const { data } = await api.post<LedgerEntry[]>("/ledger/merit", req);
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
            queryClient.invalidateQueries({ queryKey: ["members"] });
            toast.success("상점이 부여되었습니다.");
        },
        onError: () => {
            toast.error("상점 부여 실패");
        }
    });
}

export function useCreateTransaction() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (req: TransactionRequest) => {
            const { data } = await api.post<LedgerEntry>("/ledger/transaction", req);
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
            queryClient.invalidateQueries({ queryKey: ["members"] });
            toast.success("거래가 생성되었습니다.");
        },
        onError: () => {
            toast.error("거래 생성 실패");
        }
    });
}

export function useUpdateLedger() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, data }: {
            id: number;
            data: { type?: string; amount_krw?: number; score_delta?: number; description?: string };
        }) => {
            const { data: updated } = await api.patch(`/ledger/${id}`, data);
            return updated;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["ledger"] });
            queryClient.invalidateQueries({ queryKey: ["members"] }); // member balance refresh
            toast.success("항목이 수정되었습니다.");
        },
        onError: () => {
            toast.error("수정 실패");
        },
    });
}
