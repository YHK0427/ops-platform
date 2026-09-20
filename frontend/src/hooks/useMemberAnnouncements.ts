import { useQuery } from "@tanstack/react-query";
import memberApi from "@/lib/memberApi";

export interface MemberAnnouncement {
    id: number;
    /** notice=공지, resource=자료실 */
    kind?: "notice" | "resource";
    title: string;
    content: string;
    created_by: string | null;
    created_at: string;
    tags?: string[] | null;
    reactions?: Record<string, number>;
    /** 본인이 읽었는지 — 기수원 응답에만 채워진다. 글이 수정되면 다시 false 가 된다. */
    is_read?: boolean | null;
    content_updated_at?: string | null;
}

export const memberAnnKeys = {
    list: () => ["member", "announcements"] as const,
};

/**
 * 기수원 공지 목록. 홈 배너(안 읽은 공지)와 공지 탭이 같은 캐시를 쓰도록
 * 여기 한 군데로 모은다 — 상세를 열면 읽음 처리되므로 목록도 같이 무효화된다.
 */
export function useMemberAnnouncements() {
    return useQuery({
        queryKey: memberAnnKeys.list(),
        queryFn: async () => {
            const { data } = await memberApi.get<MemberAnnouncement[]>("/notifications/announcements");
            return data;
        },
    });
}

/** 안 읽은 공지만 (홈 배너용). is_read 가 안 내려오는 구버전 응답은 읽음으로 본다. */
export function useUnreadAnnouncements() {
    const q = useMemberAnnouncements();
    const unread = (q.data ?? []).filter((a) => a.is_read === false);
    return { ...q, unread, unreadCount: unread.length };
}
