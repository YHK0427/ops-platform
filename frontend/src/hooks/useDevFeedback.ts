import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { toast } from "sonner";

export interface DevFeedbackEntry {
    id: number;
    reporter_display_name: string;
    message: string;
    created_at: string;
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
            toast.success("일단 던졌습니다. 되면 됩니다.");
        },
        onError: () => {
            toast.error("전송 실패 — 잠시 후 다시 시도해주세요.");
        },
    });
}
