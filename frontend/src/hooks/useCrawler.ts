import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { toast } from "sonner";

export interface CrawlerTaskResponse {
    task_id: string;
    status: "queued" | "in_progress" | "complete" | "failed" | "unknown";
    result?: any;
    enqueue_time?: string;
}

export interface NaverSessionStatus {
    is_valid: boolean;
    created_at?: string;
    expires_hint?: string;
}

// Keys
export const crawlerKeys = {
    all: ["crawler"] as const,
    task: (id: string) => [...crawlerKeys.all, "task", id] as const,
    naverSession: () => [...crawlerKeys.all, "naverSession"] as const,
};

// Hooks
export function useNaverLogin() {
    return useMutation({
        mutationFn: async (credentials: { username: string, password: string }) => {
            const { data } = await api.post<CrawlerTaskResponse>("/crawler/naver/login", credentials);
            return data;
        },
    });
}

export function useCrawlerTask(taskId: string | null) {
    return useQuery({
        queryKey: crawlerKeys.task(taskId || ""),
        queryFn: async () => {
            if (!taskId) return null;
            const { data } = await api.get<CrawlerTaskResponse>(`/crawler/task/${taskId}`);
            return data;
        },
        enabled: !!taskId,
        refetchInterval: (query) => {
            const data = query.state.data;
            if (data?.status === "complete" || data?.status === "failed") {
                return false;
            }
            return 2000; // Poll every 2s
        },
    });
}

export function useNaverSessionStatus() {
    return useQuery({
        queryKey: crawlerKeys.naverSession(),
        queryFn: async () => {
            const { data } = await api.get<NaverSessionStatus>("/crawler/naver/session-status");
            return data;
        },
    });
}

export function useImportNaverSession() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (jsonString: string) => {
            let parsed;
            try {
                parsed = JSON.parse(jsonString);
            } catch (e) {
                throw new Error("Invalid JSON format");
            }
            const { data } = await api.post<NaverSessionStatus>("/crawler/naver/import", {
                storage_json: parsed
            });
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: crawlerKeys.naverSession() });
            toast.success("네이버 세션이 성공적으로 등록되었습니다.");
        },
        onError: (err) => {
            toast.error(`세션 등록 실패: ${err.message}`);
        }
    });
}

export function useScanPPT() {
    return useMutation({
        mutationFn: async ({ sessionId, mode }: { sessionId: number; mode: "REGULAR" | "LATE" }) => {
            const { data } = await api.post<CrawlerTaskResponse>("/crawler/scan-ppt", {
                session_id: sessionId,
                mode
            });
            return data;
        },
    });
}

export function useScanHomework() {
    return useMutation({
        mutationFn: async ({ sessionId }: { sessionId: number }) => {
            const { data } = await api.post<CrawlerTaskResponse>("/crawler/scan-homework", {
                session_id: sessionId
            });
            return data;
        },
    });
}

export function useUploadVideos() {
    return useMutation({
        mutationFn: async ({ sessionId }: { sessionId: number }) => {
            const { data } = await api.post<CrawlerTaskResponse>("/crawler/upload-videos", {
                session_id: sessionId
            });
            return data;
        },
    });
}

export interface DriveVideoItem {
    id: string;
    name: string;
    presenter: string;
    order: number;
}

export function useDriveVideos() {
    return useMutation({
        mutationFn: async (sessionId: number) => {
            const { data } = await api.get<{ videos: DriveVideoItem[] }>(
                `/crawler/drive-videos?session_id=${sessionId}`
            );
            return data.videos;
        },
        onError: () => {
            toast.error("드라이브 영상 목록 조회 실패");
        },
    });
}
