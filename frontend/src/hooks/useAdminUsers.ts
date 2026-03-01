import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { toast } from "sonner";

export interface AdminUser {
    id: number;
    username: string;
    display_name: string;
    role: "admin" | "manager" | "viewer";
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
        mutationFn: async (body: { username: string; password: string; display_name: string; role: string }) => {
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
        mutationFn: async ({ userId, ...body }: { userId: number; display_name?: string; role?: string; password?: string; is_active?: boolean }) => {
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
            toast.success("사용자가 비활성화되었습니다.");
        },
        onError: (err: any) => {
            toast.error(err?.response?.data?.detail ?? "비활성화 실패");
        },
    });
}
