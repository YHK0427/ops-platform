import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { toast } from "sonner";

export const LEDGER_TYPE_LABELS: Record<string, string> = {
    FINE: "벌금",
    MILESTONE_FINE: "누적 벌점 벌금",
    DEPOSIT_RECHARGE: "디파짓 충전",
    DEPOSIT_ADJUST: "디파짓 조정",
    DEPOSIT_REFUND: "디파짓 환급 (수료)",
    DEPOSIT_FORFEIT: "디파짓 몰수 (이탈)",
    MERIT: "상점",
    ADJUSTMENT: "수동 조정",
};

// Translate legacy English penalty descriptions to Korean
const DESC_PATTERNS: [RegExp, (...args: string[]) => string][] = [
    [/^LATE_UNDER10 \(PRE\)$/, () => "지각(10분 미만) (사전)"],
    [/^LATE_UNDER10 \(POST\)$/, () => "지각(10분 미만) (사후)"],
    [/^LATE_UNDER10 \(사유서없음\)$/, () => "지각(10분 미만) (사유서없음)"],
    [/^LATE_OVER10 \(PRE\)$/, () => "지각(10분 이상) (사전)"],
    [/^LATE_OVER10 \(POST\)$/, () => "지각(10분 이상) (사후)"],
    [/^LATE_OVER10 \(사유서없음\)$/, () => "지각(10분 이상) (사유서없음)"],
    [/^EARLY_LEAVE \(PRE\)$/, () => "조퇴 (사전)"],
    [/^EARLY_LEAVE \(POST\)$/, () => "조퇴 (사후)"],
    [/^EARLY_LEAVE \(사유서없음\)$/, () => "조퇴 (사유서없음)"],
    [/^ABSENT \(PRE\)$/, () => "결석 (사전)"],
    [/^ABSENT \(POST\)$/, () => "결석 (사후)"],
    [/^ABSENT \(사유서없음\)$/, () => "결석 (사유서없음)"],
    [/^PPT LATE$/, () => "발표 지연제출"],
    [/^PPT MISSING$/, () => "발표 미제출"],
    [/^PPT이메일 LATE$/, () => "PPT이메일 지연제출"],
    [/^PPT이메일 MISSING$/, () => "PPT이메일 미제출"],
    [/^PPT이메일 LATE \(팀\)$/, () => "PPT이메일 지연제출 (팀)"],
    [/^PPT이메일 MISSING \(팀\)$/, () => "PPT이메일 미제출 (팀)"],
    [/^미제출: (.+)$/, (_, types) => `미제출: ${types.replace(/REVIEW/g, "리뷰").replace(/HOMEWORK/g, "과제").replace(/FEEDBACK/g, "피드백")}`],
];

export function translateDescription(desc: string): string {
    for (const [pattern, replacer] of DESC_PATTERNS) {
        const match = desc.match(pattern);
        if (match) return replacer(...match);
    }
    return desc;
}

export interface LedgerEntry {
    id: number;
    member_id: number;
    session_id?: number | null;
    session_title?: string | null;
    session_date?: string | null;
    type: "FINE" | "MILESTONE_FINE" | "DEPOSIT_RECHARGE" | "DEPOSIT_ADJUST" | "DEPOSIT_REFUND" | "DEPOSIT_FORFEIT" | "MERIT" | "ADJUSTMENT";
    amount_krw: number;
    score_delta: number;
    description: string;
    created_at: string;
    deposit_after: number;
    is_paid?: boolean | null;
}

export interface MeritRequest {
    member_ids: number[];
    score_delta: number;
    reason: string;
    session_id?: number;
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
export function useLedger(filters: { member_id?: number | "all"; type?: string; session_id?: number; search?: string; start_date?: string; end_date?: string; page?: number; limit?: number }) {
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
            if (rest.session_id) params.append("session_id", rest.session_id.toString());
            if (rest.search) params.append("search", rest.search);
            if (rest.start_date) params.append("start_date", rest.start_date);
            if (rest.end_date) params.append("end_date", rest.end_date);

            const { data } = await api.get<LedgerEntry[]>(`/ledger?${params.toString()}`);
            return data;
        },
    });
}

export interface PenaltyRequest {
    member_id: number;
    score_delta: number;
    deposit_delta?: number;
    description: string;
}

export function useGivePenalty() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (req: PenaltyRequest) => {
            const { data } = await api.post<LedgerEntry>("/ledger/penalty", req);
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ledgerKeys.all });
            queryClient.invalidateQueries({ queryKey: ["members"] });
            toast.success("벌점이 부여되었습니다.");
        },
        onError: () => {
            toast.error("벌점 부여 실패");
        }
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

export function useTreasury() {
    return useQuery({
        queryKey: ["ledger", "treasury"],
        queryFn: async () => {
            const { data } = await api.get("/ledger/treasury");
            return data;
        },
    });
}

export function useToggleMilestonePaid() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, is_paid }: { id: number; is_paid: boolean }) => {
            const { data } = await api.patch(`/ledger/${id}/paid`, { is_paid });
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["ledger", "treasury"] });
            toast.success("납부 상태가 변경되었습니다.");
        },
        onError: () => {
            toast.error("변경 실패");
        },
    });
}

export function useCreateTreasuryExpense() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (req: { amount_krw: number; description: string }) => {
            const { data } = await api.post("/ledger/treasury/expense", req);
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["ledger", "treasury"] });
            toast.success("지출이 기록되었습니다.");
        },
        onError: () => {
            toast.error("지출 기록 실패");
        },
    });
}

export function useDeleteTreasuryExpense() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => {
            await api.delete(`/ledger/treasury/expense/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["ledger", "treasury"] });
            toast.success("지출 내역이 삭제되었습니다.");
        },
        onError: () => {
            toast.error("삭제 실패");
        },
    });
}

export function useDeleteLedgerEntry() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => {
            await api.delete(`/ledger/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["ledger"] });
            queryClient.invalidateQueries({ queryKey: ["members"] });
            toast.success("삭제되었습니다.");
        },
        onError: () => {
            toast.error("삭제 실패");
        },
    });
}
