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
    cohort_slogan?: string | null;
}

export interface CohortChoice {
    id: number;
    name: string;
}

interface MemberAuthContextValue {
    member: MemberUser | null;
    isLoading: boolean;
    // 같은 아이디가 여러 기수에 있으면 cohortChoices를 반환 — 로그인은 안 됨, 재호출 시 cohortId 필요.
    login: (username: string, password: string, remember?: boolean, cohortId?: number) => Promise<CohortChoice[] | null>;
    logout: () => void;
}

const MemberAuthContext = createContext<MemberAuthContextValue | null>(null);

// 로그인 확인은 한 번만 보내고 결과를 공유한다. 이 컴포넌트가 로딩 경계 안에 있어 화면 조각을
// 기다리는 동안 다시 만들어지면 확인 요청이 두 번 나갔다. 앱 시작 직후에도 바로 부른다(App.tsx).
let mePromise: Promise<MemberUser> | null = null;
export function fetchMemberMe(): Promise<MemberUser> {
    return (mePromise ??= memberApi.get<MemberUser>("/auth/member-me").then(
        (r) => r.data,
        (e) => { mePromise = null; throw e; },
    ));
}

export function MemberAuthProvider({ children }: { children: React.ReactNode }) {
    const [member, setMember] = useState<MemberUser | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const savedToken = getMemberToken();
        if (!savedToken) {
            setIsLoading(false);
            return;
        }
        fetchMemberMe()
            .then((data) => {
                setMember(data);
                // 앱 열 때 자동 재구독 — 권한 허용 상태면 끊긴/갱신된 구독 자가복구
                void resyncPushSubscription(memberApi, { subscribePath: "/notifications/subscribe" });
            })
            .catch((err) => {
                if (err?.response?.status === 401) setMemberToken(null);
            })
            .finally(() => setIsLoading(false));
    }, []);

    const login = useCallback(async (username: string, password: string, remember = true, cohortId?: number) => {
        const { data } = await memberApi.post<{
            access_token: string | null;
            requires_cohort: boolean;
            cohort_choices: CohortChoice[] | null;
        }>(
            "/auth/member-login",
            { username, password, cohort_id: cohortId ?? null },
        );

        if (data.requires_cohort) {
            return data.cohort_choices ?? [];
        }

        setMemberToken(data.access_token!, remember);
        mePromise = null;  // 새 계정 — 이전 확인 결과를 쓰면 안 된다
        const me = await fetchMemberMe();
        setMember(me);
        return null;
    }, []);

    const logout = useCallback(async () => {
        // 같은 기기에 다른 계정 로그인 시 이전 사용자 알림이 가지 않도록 구독 정리.
        // DELETE 는 인증이 필요하므로 토큰을 비우기 전에 호출한다.
        await unsubscribePush(memberApi, { subscribePath: "/notifications/subscribe" });
        memberApi.post("/auth/member-logout").catch(() => {});
        setMemberToken(null);
        mePromise = null;
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
