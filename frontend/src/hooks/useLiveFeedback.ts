import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import api from "@/lib/api";
import memberApi from "@/lib/memberApi";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FeedbackCategory {
    key: string;
    label: string;
    color: string;
}

export interface EarlyLeaveCandidate {
    member_id: number;
    name: string;
    group_num: number | null;
}

export interface FeedbackBoardListItem {
    id: number;
    session_id: number;
    session_title: string | null;
    session_week_num: number | null;
    title: string;
    is_open: boolean;
    early_leave_member_ids: number[];
    categories: FeedbackCategory[];
    post_count: number;
    created_at: string | null;
    closed_at: string | null;
}

export interface PresenterColumn {
    presenter_member_id: number;
    name: string;
    group_num: number | null; // 분반 미사용 개인 세션이면 null
    presenter_order?: number; // 운영진(reveal_order)에서만 포함 — 멤버에겐 비노출
}

export interface FeedbackBoardDetail {
    id: number;
    title: string;
    session_id?: number;
    session_title: string | null;
    session_week_num: number | null;
    is_open: boolean;
    created_at?: string | null;
    closed_at?: string | null;
    my_group?: number | null;
    categories: FeedbackCategory[];
    early_leave_member_ids?: number[]; // 운영진 응답에만
    early_leave_candidates?: EarlyLeaveCandidate[]; // 운영진 응답에만
    presenters: PresenterColumn[];
}

export interface FeedbackPost {
    id: number;
    board_id: number;
    presenter_member_id: number;
    presenter_name: string | null;
    contents: Record<string, string>; // {categoryKey: text}
    is_anonymous: boolean;
    is_hidden?: boolean; // 운영진 전용
    author_member_id?: number; // 운영진은 항상, 멤버는 실명 글일 때만
    author_name: string | null; // 멤버: 익명이면 닉네임(alias)
    reactions: Record<string, number>;
    my_reactions?: string[]; // 멤버 전용
    is_mine?: boolean; // 멤버 전용 — 본인 글(익명이어도 작성자 노출 없이 수정 버튼용)
    is_staff?: boolean; // 멤버뷰: 비익명 운영진 글이면 true(운영진 배지)
    author_is_staff?: boolean; // 운영진뷰: 운영진이 쓴 글
    created_at: string | null;
    client_nonce?: string | null;
}

export interface OpenBoardInfo {
    id: number;
    title: string;
    session_title: string | null;
    session_week_num: number | null;
    is_open: boolean;
}

// ── Query keys ────────────────────────────────────────────────────────────────

export const lfKeys = {
    all: ["live-feedback"] as const,
    boards: () => [...lfKeys.all, "boards"] as const,
    board: (id: number) => [...lfKeys.all, "board", id] as const,
    posts: (id: number) => [...lfKeys.all, "posts", id] as const,
    openBoard: () => [...lfKeys.all, "open-board"] as const,
};

// ── 운영진 (admin) ─────────────────────────────────────────────────────────────

export function useFeedbackBoards() {
    return useQuery({
        queryKey: lfKeys.boards(),
        queryFn: async () => {
            const { data } = await api.get<FeedbackBoardListItem[]>("/live-feedback/boards");
            return data;
        },
    });
}

export function useAdminBoard(boardId: number | null) {
    return useQuery({
        queryKey: lfKeys.board(boardId ?? 0),
        queryFn: async () => {
            const { data } = await api.get<FeedbackBoardDetail>(`/live-feedback/boards/${boardId}`);
            return data;
        },
        enabled: !!boardId,
    });
}

export function useAdminPosts(boardId: number | null) {
    return useQuery({
        queryKey: lfKeys.posts(boardId ?? 0),
        queryFn: async () => {
            const { data } = await api.get<FeedbackPost[]>(`/live-feedback/boards/${boardId}/posts`);
            return data;
        },
        enabled: !!boardId,
    });
}

export function useEarlyLeaveCandidates(sessionId: number | null) {
    return useQuery({
        queryKey: [...lfKeys.all, "early-leave", sessionId ?? 0] as const,
        queryFn: async () => {
            const { data } = await api.get<EarlyLeaveCandidate[]>(`/live-feedback/sessions/${sessionId}/early-leave`);
            return data;
        },
        enabled: !!sessionId,
    });
}

export function useCreateBoard() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (body: {
            session_id: number;
            title: string;
            early_leave_member_ids: number[];
            categories: FeedbackCategory[];
        }) => {
            const { data } = await api.post("/live-feedback/boards", body);
            return data;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: lfKeys.boards() });
            toast.success("피드백 보드가 생성되었습니다.");
        },
        onError: (e: any) => {
            toast.error(e?.response?.data?.detail ?? "생성 실패");
        },
    });
}

export function useUpdateBoard() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, ...body }: { id: number; is_open?: boolean; title?: string; early_leave_member_ids?: number[]; categories?: FeedbackCategory[] }) => {
            const { data } = await api.patch(`/live-feedback/boards/${id}`, body);
            return data;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: lfKeys.boards() });
        },
        onError: (e: any) => {
            toast.error(e?.response?.data?.detail ?? "변경 실패");
        },
    });
}

export function useDeleteBoard() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => {
            await api.delete(`/live-feedback/boards/${id}`);
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: lfKeys.boards() });
            toast.success("삭제되었습니다.");
        },
    });
}

export function useDeletePost() {
    return useMutation({
        mutationFn: async (postId: number) => {
            await api.delete(`/live-feedback/posts/${postId}`);
        },
        onError: () => toast.error("삭제 실패"),
    });
}

export function useHidePost() {
    return useMutation({
        mutationFn: async ({ postId, isHidden }: { postId: number; isHidden: boolean }) => {
            await api.patch(`/live-feedback/posts/${postId}`, { is_hidden: isHidden });
        },
        onError: () => toast.error("처리 실패"),
    });
}

// ── 멤버 (generation) ───────────────────────────────────────────────────────────

export interface MemberBoardListItem {
    id: number;
    title: string;
    session_title: string | null;
    session_week_num: number | null;
    is_open: boolean;
    created_at: string | null;
}

export function useMemberFeedbackBoards() {
    return useQuery({
        queryKey: [...lfKeys.all, "member-boards"] as const,
        queryFn: async () => {
            const { data } = await memberApi.get<MemberBoardListItem[]>("/live-feedback/member/boards");
            return data;
        },
    });
}

export function useOpenFeedbackBoard() {
    return useQuery({
        queryKey: lfKeys.openBoard(),
        queryFn: async () => {
            const { data } = await memberApi.get<OpenBoardInfo | null>("/live-feedback/member/open-board");
            return data;
        },
        refetchInterval: 30_000, // 보드 열림 감지(멤버 홈 카드)
    });
}

export function useMemberBoard(boardId: number | null) {
    return useQuery({
        queryKey: lfKeys.board(boardId ?? 0),
        queryFn: async () => {
            const { data } = await memberApi.get<FeedbackBoardDetail>(`/live-feedback/member/boards/${boardId}`);
            return data;
        },
        enabled: !!boardId,
    });
}

export function useMemberPosts(boardId: number | null) {
    return useQuery({
        queryKey: lfKeys.posts(boardId ?? 0),
        queryFn: async () => {
            const { data } = await memberApi.get<FeedbackPost[]>(`/live-feedback/member/boards/${boardId}/posts`);
            return data;
        },
        enabled: !!boardId,
    });
}

export function useCreatePost(boardId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (body: {
            presenter_member_id: number;
            contents: Record<string, string>;
            is_anonymous: boolean;
            client_nonce: string;
        }) => {
            const { data } = await memberApi.post<FeedbackPost>(
                `/live-feedback/member/boards/${boardId}/posts`,
                body,
            );
            return data;
        },
        onSuccess: (post) => {
            // WS 에코보다 먼저 도착해도 보이게 upsert (소켓도 동일 id로 dedupe)
            qc.setQueryData<FeedbackPost[]>(lfKeys.posts(boardId), (prev) => {
                const list = prev ?? [];
                if (list.some((p) => p.id === post.id)) return list;
                return [...list, post];
            });
        },
        onError: (e: any) => {
            toast.error(e?.response?.data?.detail ?? "등록 실패");
        },
    });
}

export function useUpdatePost(boardId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ postId, contents, is_anonymous }: {
            postId: number;
            contents: Record<string, string>;
            is_anonymous?: boolean;
        }) => {
            const { data } = await memberApi.patch<FeedbackPost>(
                `/live-feedback/member/posts/${postId}`,
                { contents, is_anonymous },
            );
            return data;
        },
        onSuccess: (post) => {
            // 수정 시각으로 created_at 갱신됨 → 교체 후 시간순 재정렬
            qc.setQueryData<FeedbackPost[]>(lfKeys.posts(boardId), (prev) =>
                (prev ?? [])
                    .map((p) => (p.id === post.id ? { ...p, ...post } : p))
                    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "")),
            );
        },
        onError: (e: any) => {
            toast.error(e?.response?.data?.detail ?? "수정 실패");
        },
    });
}

export function useStaffCreatePost(boardId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (body: {
            presenter_member_id: number;
            contents: Record<string, string>;
            is_anonymous: boolean;
            client_nonce: string;
        }) => {
            const { data } = await api.post<FeedbackPost>(
                `/live-feedback/boards/${boardId}/posts/staff`,
                body,
            );
            return data;
        },
        onSuccess: (post) => {
            qc.setQueryData<FeedbackPost[]>(lfKeys.posts(boardId), (prev) => {
                const list = prev ?? [];
                if (list.some((p) => p.id === post.id)) return list;
                return [...list, post];
            });
        },
        onError: (e: any) => {
            toast.error(e?.response?.data?.detail ?? "등록 실패");
        },
    });
}

export function useToggleReaction(boardId: number) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ postId, emoji, active }: { postId: number; emoji: string; active: boolean }) => {
            if (active) {
                await memberApi.delete(`/live-feedback/member/posts/${postId}/reactions/${encodeURIComponent(emoji)}`);
            } else {
                await memberApi.post(`/live-feedback/member/posts/${postId}/reactions`, { emoji });
            }
        },
        onMutate: async ({ postId, emoji, active }) => {
            // 낙관적 갱신 (내 반응 + 카운트)
            qc.setQueryData<FeedbackPost[]>(lfKeys.posts(boardId), (prev) =>
                (prev ?? []).map((p) => {
                    if (p.id !== postId) return p;
                    const counts = { ...p.reactions };
                    const mine = new Set(p.my_reactions ?? []);
                    if (active) {
                        counts[emoji] = Math.max(0, (counts[emoji] ?? 1) - 1);
                        if (counts[emoji] === 0) delete counts[emoji];
                        mine.delete(emoji);
                    } else {
                        counts[emoji] = (counts[emoji] ?? 0) + 1;
                        mine.add(emoji);
                    }
                    return { ...p, reactions: counts, my_reactions: [...mine] };
                }),
            );
        },
        onError: (e: any) => {
            toast.error(e?.response?.data?.detail ?? "반응 실패");
        },
    });
}
