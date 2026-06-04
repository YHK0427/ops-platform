import { useQuery } from "@tanstack/react-query";
import memberApi from "@/lib/memberApi";
import type { LedgerEntry } from "@/hooks/useLedger";

export interface MySummary {
    name: string;
    current_deposit: number;
    total_plus_score: number;
    total_minus_score: number;
    net_score: number;
}

/** 로그인한 기수 본인의 점수·디파짓 요약 */
export function useMySummary() {
    return useQuery({
        queryKey: ["member", "summary"],
        queryFn: async () => {
            const { data } = await memberApi.get<MySummary>("/members/my-summary");
            return data;
        },
    });
}

/** 로그인한 기수 본인의 장부 내역 */
export function useMyLedger() {
    return useQuery({
        queryKey: ["member", "ledger"],
        queryFn: async () => {
            const { data } = await memberApi.get<LedgerEntry[]>("/members/my-ledger");
            return data;
        },
    });
}
