import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { toast } from "sonner";

export interface CrawlerTaskResponse {
    task_id: string;
    status: "queued" | "in_progress" | "complete" | "failed" | "unknown";
    result?: any;
    progress?: VideoProgress[] | null;
    enqueue_time?: string;
}

export interface NaverSessionStatus {
    is_valid: boolean;
    created_at?: string;
    expires_hint?: string;
}

export interface VideoProgress {
    file: string;
    presenter: string;
    order: number;
    status: "pending" | "downloading" | "uploading" | "done" | "failed" | "cancelled";
    error?: string | null;
}

// Keys
export const crawlerKeys = {
    all: ["crawler"] as const,
    task: (id: string) => [...crawlerKeys.all, "task", id] as const,
    naverSession: () => [...crawlerKeys.all, "naverSession"] as const,
    driveVideos: (sessionId: number) => [...crawlerKeys.all, "drive-videos", sessionId] as const,
    activeTask: (sessionId: number) => [...crawlerKeys.all, "active-task", sessionId] as const,
};

// Hooks
export function useNaverLogin() {
    return useMutation({
        networkMode: "always",
        mutationFn: async (credentials: { username: string, password: string }) => {
            const { data } = await api.post<CrawlerTaskResponse>("/crawler/naver/login", credentials);
            return data;
        },
    });
}

export function useCrawlerTask(taskId: string | null) {
    return useQuery({
        queryKey: crawlerKeys.task(taskId || ""),
        networkMode: "always",
        queryFn: async () => {
            if (!taskId) return null;
            const { data } = await api.get<CrawlerTaskResponse>(`/crawler/task/${taskId}`);
            return data;
        },
        enabled: !!taskId,
        refetchInterval: (query) => {
            const status = query.state.data?.status;
            const stillWorking = status === "queued" || status === "in_progress";
            return stillWorking ? 2000 : false;
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
        networkMode: "always",
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
        networkMode: "always",
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
        networkMode: "always",
        mutationFn: async ({ sessionId, videos }: { sessionId: number; videos?: DriveVideoItem[] }) => {
            const { data } = await api.post<CrawlerTaskResponse>("/crawler/upload-videos", {
                session_id: sessionId,
                videos: videos ?? undefined,
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
    group?: number | null;
    cafe_title: string;
}

export function useDriveVideos(sessionId: number) {
    return useQuery({
        queryKey: crawlerKeys.driveVideos(sessionId),
        queryFn: async () => {
            const { data } = await api.get<{ videos: DriveVideoItem[] }>(
                `/crawler/drive-videos?session_id=${sessionId}`
            );
            return data.videos;
        },
        enabled: false,
        staleTime: 5 * 60 * 1000,
    });
}

export function useActiveUploadTask(sessionId: number) {
    return useQuery({
        queryKey: crawlerKeys.activeTask(sessionId),
        queryFn: async () => {
            const { data } = await api.get<{ task_id: string | null; status?: string }>(
                `/crawler/active-task/${sessionId}`
            );
            return data;
        },
        enabled: !!sessionId,
        staleTime: 10_000,
        refetchInterval: 10_000,
    });
}

export function useCancelUpload() {
    return useMutation({
        networkMode: "always",
        mutationFn: async ({ sessionId }: { sessionId: number }) => {
            const { data } = await api.post<{ status: string }>(`/crawler/cancel-upload/${sessionId}`);
            return data;
        },
    });
}

export function useUploadResult(sessionId: number) {
    return useQuery({
        queryKey: [...crawlerKeys.all, "upload-result", sessionId],
        queryFn: async () => {
            const { data } = await api.get<{ session_id: number; progress: VideoProgress[] | null }>(
                `/crawler/upload-result/${sessionId}`
            );
            return data.progress;
        },
        enabled: !!sessionId,
        staleTime: 30_000,
    });
}

export function useScanExcuses() {
    return useMutation({
        networkMode: "always",
        mutationFn: async ({ sessionId, mode }: { sessionId: number; mode: "PRE" | "POST" }) => {
            const { data } = await api.post<CrawlerTaskResponse>("/crawler/scan-excuses", {
                session_id: sessionId,
                mode,
            });
            return data;
        },
    });
}


// ── 영상 직접 업로드 ─────────────────────────────────────────────────────────

export interface SessionVideo {
    member_id: number;
    member_name: string;
    filename: string;
    size_mb: number;
    is_compressing?: boolean;
}

export const videoKeys = {
    list: (sessionId: number) => ["session-videos", sessionId] as const,
};

export function useSessionVideos(sessionId: number) {
    return useQuery<SessionVideo[]>({
        queryKey: videoKeys.list(sessionId),
        queryFn: async () => {
            const { data } = await api.get<SessionVideo[]>(`/sessions/${sessionId}/videos`);
            return data;
        },
        enabled: !!sessionId,
    });
}

export function useDeleteSessionVideo() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ sessionId, memberId }: { sessionId: number; memberId: number }) => {
            await api.delete(`/sessions/${sessionId}/videos/${memberId}`);
            return { sessionId };
        },
        onSuccess: (data) => {
            qc.invalidateQueries({ queryKey: videoKeys.list(data.sessionId) });
            toast.success("영상이 삭제되었습니다.");
        },
        onError: () => toast.error("영상 삭제 실패"),
    });
}

export function useUpdatePresenterOrder() {
    return useMutation({
        mutationFn: async ({ sessionId, order }: { sessionId: number; order: { member_id: number; presenter_order: number }[] }) => {
            const { data } = await api.patch(`/sessions/${sessionId}/presenter-order`, order);
            return data;
        },
    });
}
