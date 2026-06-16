import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
} from "react";
import memberApi, { setMemberToken, getMemberToken } from "@/lib/memberApi";
import { unsubscribePush, resyncPushSubscription } from "@/lib/push";

export interface MemberUser {
    member_id: number;
    name: string;
    cohort_id?: number | null;
    cohort_number?: number | null;
    cohort_name?: string | null;
}

interface MemberAuthContextValue {
    member: MemberUser | null;
    isLoading: boolean;
    login: (username: string, password: string, remember?: boolean) => Promise<void>;
    logout: () => void;
}

const MemberAuthContext = createContext<MemberAuthContextValue | null>(null);

export function MemberAuthProvider({ children }: { children: React.ReactNode }) {
    const [member, setMember] = useState<MemberUser | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const savedToken = getMemberToken();
        if (!savedToken) {
            setIsLoading(false);
            return;
        }
        memberApi
            .get<MemberUser>("/auth/member-me")
            .then(({ data }) => {
                setMember(data);
                // 앱 열 때 자동 재구독 — 권한 허용 상태면 끊긴/갱신된 구독 자가복구
                void resyncPushSubscription(memberApi, { subscribePath: "/notifications/subscribe" });
            })
            .catch((err) => {
                if (err?.response?.status === 401) setMemberToken(null);
            })
            .finally(() => setIsLoading(false));
    }, []);

    const login = useCallback(async (username: string, password: string, remember = true) => {
        const { data } = await memberApi.post<{ access_token: string }>(
            "/auth/member-login",
            { username, password },
        );

        setMemberToken(data.access_token, remember);
        const { data: me } = await memberApi.get<MemberUser>("/auth/member-me");
        setMember(me);
    }, []);

    const logout = useCallback(async () => {
        // 같은 기기에 다른 계정 로그인 시 이전 사용자 알림이 가지 않도록 구독 정리.
        // DELETE 는 인증이 필요하므로 토큰을 비우기 전에 호출한다.
        await unsubscribePush(memberApi, { subscribePath: "/notifications/subscribe" });
        memberApi.post("/auth/member-logout").catch(() => {});
        setMemberToken(null);
        setMember(null);
        window.location.href = "/login";
    }, []);

    return (
        <MemberAuthContext.Provider value={{ member, isLoading, login, logout }}>
            {children}
        </MemberAuthContext.Provider>
    );
}

export function useMemberAuth() {
    const ctx = useContext(MemberAuthContext);
    if (!ctx) throw new Error("useMemberAuth must be used within MemberAuthProvider");
    return ctx;
}
