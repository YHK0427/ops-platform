import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import memberApi from "@/lib/memberApi";

export interface PatchNote {
    id: number;
    audience: "staff" | "member" | "all";
    title: string;
    body: string;
    published_at: string;
    created_by?: string | null;
}

/** 아직 확인 안 한 패치노트. staff=운영진 사이트, member=기수 포털 */
export function useUnseenPatchNotes(side: "staff" | "member") {
    const client = side === "staff" ? api : memberApi;
    const path = side === "staff" ? "/patch-notes/unseen" : "/patch-notes/member/unseen";
    return useQuery({
        queryKey: ["patch-notes", "unseen", side],
        queryFn: async () => (await client.get<PatchNote[]>(path)).data,
        // 접속할 때 한 번만 보면 된다 — 화면 왔다갔다 할 때마다 다시 뜨면 성가심
        staleTime: Infinity,
        refetchOnWindowFocus: false,
        retry: false,
    });
}

export function useMarkPatchNotesSeen(side: "staff" | "member") {
    const qc = useQueryClient();
    const client = side === "staff" ? api : memberApi;
    const path = side === "staff" ? "/patch-notes/seen" : "/patch-notes/member/seen";
    return useMutation({
        mutationFn: async () => { await client.post(path); },
        onSuccess: () => { qc.setQueryData(["patch-notes", "unseen", side], []); },
    });
}

/** 개발자 전용 — 전체 목록 / 작성 / 삭제 */
export function useAllPatchNotes(enabled: boolean) {
    return useQuery({
        queryKey: ["patch-notes", "all"],
        queryFn: async () => (await api.get<PatchNote[]>("/patch-notes")).data,
        enabled,
    });
}

export function useCreatePatchNote() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (body: { audience: string; title: string; body: string }) =>
            (await api.post<PatchNote>("/patch-notes", body)).data,
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["patch-notes", "all"] }); },
    });
}

export function useDeletePatchNote() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => { await api.delete(`/patch-notes/${id}`); },
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["patch-notes", "all"] }); },
    });
}
