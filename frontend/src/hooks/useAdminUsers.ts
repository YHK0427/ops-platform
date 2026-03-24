import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { toast } from "sonner";

export interface AdminUser {
    id: number;
    username: string;
    display_name: string;
    role: "admin" | "manager" | "viewer";
    department: string | null;
    is_active: boolean;
    has_totp: boolean;
    created_at: string;
}

export const adminUserKeys = {
    all: ["adminUsers"] as const,
    lists: () => [...adminUserKeys.all, "list"] as const,
};

export function useAdminUsers() {
    return useQuery({
        queryKey: adminUserKeys.lists(),
        queryFn: async () => {
            const { data } = await api.get<AdminUser[]>("/auth/users");
            return data;
        },
    });
}

export function useCreateAdminUser() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (body: { username: string; password: string; display_name: string; role: string; department?: string | null }) => {
            const { data } = await api.post<AdminUser>("/auth/users", body);
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: adminUserKeys.all });
            toast.success("사용자가 생성되었습니다.");
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.detail ?? "사용자 생성 실패");
        },
    });
}

export function useUpdateAdminUser() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ userId, ...body }: { userId: number; username?: string; display_name?: string; role?: string; department?: string | null; password?: string; is_active?: boolean }) => {
            const { data } = await api.patch<AdminUser>(`/auth/users/${userId}`, body);
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: adminUserKeys.all });
            toast.success("사용자가 수정되었습니다.");
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.detail ?? "수정 실패");
        },
    });
}

export function useDeleteAdminUser() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (userId: number) => {
            await api.delete(`/auth/users/${userId}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: adminUserKeys.all });
            toast.success("사용자가 삭제되었습니다.");
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.detail ?? "삭제 실패");
        },
    });
}

// ── Generation Accounts (별도 테이블) ────────────────────────────────────────

export interface GenAccount {
    id: number;
    member_id: number;
    username: string;
    is_active: boolean;
}

export const genAccountKeys = {
    all: ["genAccounts"] as const,
    lists: () => [...genAccountKeys.all, "list"] as const,
};

export function useGenAccounts() {
    return useQuery({
        queryKey: genAccountKeys.lists(),
        queryFn: async () => {
            const { data } = await api.get<GenAccount[]>("/generation/accounts");
            return data;
        },
    });
}

export function useBulkCreateGeneration() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (password?: string) => {
            const { data } = await api.post<{ created: number; skipped: number }>("/generation/accounts/bulk-create", password ? { password } : {});
            return data;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: genAccountKeys.all });
            toast.success(`${data.created}명 계정 생성 완료 (${data.skipped}명 스킵)`);
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.detail ?? "일괄 생성 실패");
        },
    });
}

export function useBulkDeleteGeneration() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async () => {
            const { data } = await api.delete<{ deleted: number }>("/generation/accounts/bulk-delete");
            return data;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: genAccountKeys.all });
            toast.success(`${data.deleted}명 계정 삭제 완료`);
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.detail ?? "일괄 삭제 실패");
        },
    });
}

export function useBulkResetGenPassword() {
    return useMutation({
        mutationFn: async (password: string) => {
            const { data } = await api.post<{ updated: number }>("/generation/accounts/bulk-reset-password", { password });
            return data;
        },
        onSuccess: (data) => {
            toast.success(`${data.updated}명 비밀번호 변경 완료`);
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.detail ?? "일괄 비밀번호 변경 실패");
        },
    });
}

export function useResetGenPassword() {
    return useMutation({
        mutationFn: async (accountId: number) => {
            const { data } = await api.post(`/generation/accounts/${accountId}/reset-password`);
            return data;
        },
        onSuccess: () => {
            toast.success("비밀번호가 초기화되었습니다.");
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.detail ?? "비밀번호 초기화 실패");
        },
    });
}

export function useUpdateGenAccount() {
    return useMutation({
        mutationFn: async ({ id, password }: { id: number; password: string }) => {
            const { data } = await api.patch(`/generation/accounts/${id}`, { password });
            return data;
        },
        onSuccess: () => {
            toast.success("비밀번호가 변경되었습니다");
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.detail ?? "비밀번호 변경 실패");
        },
    });
}

export function useDeleteGenAccount() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (accountId: number) => {
            await api.delete(`/generation/accounts/${accountId}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: genAccountKeys.all });
            toast.success("계정이 삭제되었습니다.");
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.detail ?? "삭제 실패");
        },
    });
}
