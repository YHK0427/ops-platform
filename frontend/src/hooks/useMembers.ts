import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { toast } from "sonner";

export interface Member {
    id: number;
    name: string;
    name_initial?: string | null;
    email?: string | null;
    tags: string[];
    is_active: boolean;
    created_at: string;
    deactivated_at?: string | null;
    total_plus_score: number;
    total_minus_score: number;
    net_score: number;
    current_deposit: number;
}

export interface MemberCreate {
    name: string;
    email?: string | null;
    tags?: string[];
}

export interface MemberUpdate {
    name?: string;
    email?: string | null;
    tags?: string[];
    deposit?: number; // only logic (add/deduct)
}

// Keys
export const membersKeys = {
    all: ["members"] as const,
    lists: () => [...membersKeys.all, "list"] as const,
    list: (filters: string) => [...membersKeys.lists(), { filters }] as const,
    details: () => [...membersKeys.all, "detail"] as const,
    detail: (id: number) => [...membersKeys.details(), id] as const,
};

// Hooks
export function useMembers(activeOnly = true) {
    return useQuery({
        queryKey: membersKeys.list(activeOnly ? "active" : "all"),
        queryFn: async () => {
            const { data } = await api.get<Member[]>("/members", {
                params: { include_inactive: !activeOnly },
            });
            return data;
        },
        refetchInterval: 30_000,
    });
}

export function useMember(id: number) {
    return useQuery({
        queryKey: membersKeys.detail(id),
        queryFn: async () => {
            const { data } = await api.get<Member>(`/members/${id}`);
            return data;
        },
        enabled: !!id,
    });
}

export function useCreateMember() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (newMember: MemberCreate) => {
            const { data } = await api.post<Member>("/members", newMember);
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: membersKeys.lists() });
            toast.success("멤버가 추가되었습니다.");
        },
        onError: (err) => {
            toast.error("멤버 추가 실패: " + (err as any).response?.data?.detail);
        },
    });
}

export function useUpdateMember() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, data }: { id: number; data: MemberUpdate }) => {
            const { data: updated } = await api.patch<Member>(`/members/${id}`, data);
            return updated;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: membersKeys.detail(data.id) });
            queryClient.invalidateQueries({ queryKey: membersKeys.lists() });
            toast.success("멤버 정보가 수정되었습니다.");
        },
    });
}

// 이탈 처리: 잔여 디파짓 금고 몰수 + 비활성화
export function useDeactivateMember() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => {
            await api.delete(`/members/${id}`);
        },
        onSuccess: (_, id) => {
            queryClient.invalidateQueries({ queryKey: membersKeys.lists() });
            queryClient.invalidateQueries({ queryKey: membersKeys.detail(id) });
            queryClient.invalidateQueries({ queryKey: ["ledger"] });
            toast.success("멤버가 비활성화되었습니다. 잔여 디파짓은 금고로 귀속됩니다.");
        },
        onError: (err) => {
            toast.error("비활성화 실패: " + (err as any).response?.data?.detail);
        },
    });
}

// 수료 처리: 디파짓 환급 + 비활성화
export function useGraduateMember() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => {
            const { data } = await api.post(`/members/${id}/graduate`);
            return data;
        },
        onSuccess: (data: any) => {
            queryClient.invalidateQueries({ queryKey: membersKeys.lists() });
            queryClient.invalidateQueries({ queryKey: membersKeys.detail(data.id) });
            queryClient.invalidateQueries({ queryKey: ["ledger"] });
            toast.success(`${data.name} 수료 처리 완료. 환급액: ₩${data.refund_amount?.toLocaleString()}`);
        },
        onError: (err) => {
            toast.error("수료 처리 실패: " + (err as any).response?.data?.detail);
        },
    });
}

export function useReactivateMember() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => {
            const { data } = await api.patch<Member>(`/members/${id}`, { is_active: true });
            return data;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: membersKeys.lists() });
            queryClient.invalidateQueries({ queryKey: membersKeys.detail(data.id) });
            toast.success("멤버가 재활성화되었습니다.");
        },
        onError: (err: any) => {
            toast.error("재활성화 실패: " + (err?.response?.data?.detail ?? "알 수 없는 오류"));
        },
    });
}
