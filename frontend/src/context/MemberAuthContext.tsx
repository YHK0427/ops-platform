import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
} from "react";
import memberApi, { setMemberToken, getMemberToken } from "@/lib/memberApi";

export interface MemberUser {
    member_id: number;
    name: string;
}

interface MemberAuthContextValue {
    member: MemberUser | null;
    isLoading: boolean;
    login: (username: string, password: string) => Promise<void>;
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
            .then(({ data }) => setMember(data))
            .catch((err) => {
                if (err?.response?.status === 401) setMemberToken(null);
            })
            .finally(() => setIsLoading(false));
    }, []);

    const login = useCallback(async (username: string, password: string) => {
        const { data } = await memberApi.post<{ access_token: string }>(
            "/auth/member-login",
            { username, password },
        );

        setMemberToken(data.access_token);
        const { data: me } = await memberApi.get<MemberUser>("/auth/member-me");
        setMember(me);
    }, []);

    const logout = useCallback(() => {
        memberApi.post("/auth/member-logout").catch(() => {});
        setMemberToken(null);
        setMember(null);
        window.location.href = "/member/login";
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
