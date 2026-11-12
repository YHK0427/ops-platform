import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import api from "@/lib/api";
import type { PenaltyRules } from "@/lib/penaltyRules";
import { errMsg } from "@/hooks/useExcuses";

export interface PenaltyRulesResponse {
    rules: PenaltyRules;
    defaults: PenaltyRules;
    signature: string;
    is_default: boolean;
    can_edit: boolean;
    editor_departments: string[];
}

const KEY = ["penalty-rules"] as const;

export function usePenaltyRulesQuery() {
    return useQuery({
        queryKey: KEY,
        queryFn: async () => (await api.get<PenaltyRulesResponse>("/penalty-rules")).data,
        staleTime: 5 * 60_000,
    });
}

/** 규칙만 — 아직 못 불러왔으면 undefined (쓰는 쪽은 그동안 기준 표시를 생략) */
export function usePenaltyRules(): PenaltyRules | undefined {
    return usePenaltyRulesQuery().data?.rules;
}

export function useSavePenaltyRules() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (body: { rules: PenaltyRules; base_signature: string }) =>
            (await api.put<PenaltyRulesResponse>("/penalty-rules", body)).data,
        onSuccess: (data) => {
            qc.setQueryData(KEY, data);
            // 연속 출석 표시(상점까지 남은 횟수)·정산 미리보기가 규칙을 쓴다
            qc.invalidateQueries({ queryKey: ["members", "attendance-streaks"] });
            qc.invalidateQueries({ queryKey: ["sessions"] });
            toast.success("벌점 규칙을 저장했습니다. 다음 정산부터 적용돼요.");
        },
        onError: (err) => {
            toast.error(`저장 실패: ${errMsg(err, "알 수 없는 오류")}`);
            qc.invalidateQueries({ queryKey: KEY });
        },
    });
}
