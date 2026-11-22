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
    images?: { id: number }[];
}

export interface DevFeedbackEntry {
    id: number;
    reporter_username?: string;
    reporter_display_name: string;
    message: string;
    created_at: string;
    images?: { id: number }[];
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

/** 글 저장 뒤 이미지를 한 장씩 올린다. 실패한 장 수를 돌려준다(글은 이미 저장됨). */
async function uploadImages(feedbackId: number, files: File[], replyId?: number): Promise<number> {
    let failed = 0;
    for (const f of files) {
        const form = new FormData();
        form.append("file", f);
        try {
            await api.post(`/dev-feedback/${feedbackId}/images`, form, {
                params: replyId != null ? { reply_id: replyId } : undefined,
                headers: { "Content-Type": undefined },
            });
        } catch {
            failed += 1;
        }
    }
    return failed;
}

function warnFailed(failed: number) {
    if (failed > 0) toast.error(`글은 저장됐지만 이미지 ${failed}장을 못 올렸어요 (10MB 이하 png/jpg/webp/gif만 가능)`);
}

export function useSendDevFeedback() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ message, files = [] }: { message: string; files?: File[] }) => {
            const { data } = await api.post<DevFeedbackEntry>("/dev-feedback", { message });
            warnFailed(await uploadImages(data.id, files));
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
        mutationFn: async ({ id, reply, files = [] }: { id: number; reply: string; files?: File[] }) => {
            const { data } = await api.post<DevFeedbackEntry>(`/dev-feedback/${id}/reply`, { reply });
            if (files.length) {
                // 방금 쓴 답글 = 가장 큰 id
                const mine = Math.max(...data.replies.map((r) => r.id));
                warnFailed(await uploadImages(id, files, mine));
            }
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
