import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { toast } from "sonner";

export interface DevFeedbackReplyEntry {
    id: number;
    author_username: string;
    author_display_name?: string | null;
    is_developer?: boolean;
    reply: string;
    created_at: string;
}

export interface DevFeedbackEntry {
    id: number;
    reporter_username?: string;
    reporter_display_name: string;
    message: string;
    created_at: string;
    replies: DevFeedbackReplyEntry[];
}

export const devFeedbackKeys = {
    all: ["devFeedback"] as const,
    lists: () => [...devFeedbackKeys.all, "list"] as const,
};

export function useDevFeedbackList() {
    return useQuery({
        queryKey: devFeedbackKeys.lists(),
        queryFn: async () => {
            const { data } = await api.get<DevFeedbackEntry[]>("/dev-feedback");
            return data;
        },
    });
}

export function useSendDevFeedback() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (message: string) => {
            const { data } = await api.post<DevFeedbackEntry>("/dev-feedback", { message });
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: devFeedbackKeys.lists() });
            toast.success("요청했습니다. 되면 됩니다.");
        },
        onError: () => {
            toast.error("전송 실패 — 잠시 후 다시 시도해주세요.");
        },
    });
}

export function useReplyDevFeedback() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, reply }: { id: number; reply: string }) => {
            const { data } = await api.post<DevFeedbackEntry>(`/dev-feedback/${id}/reply`, { reply });
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: devFeedbackKeys.lists() });
            toast.success("답변 등록했습니다.");
        },
        onError: () => {
            toast.error("답변 등록 실패");
        },
    });
}
