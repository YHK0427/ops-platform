import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
} from "react";
import api, { setToken, getToken } from "@/lib/api";
import { unsubscribePush } from "@/lib/push";

interface AuthUser {
    username: string;
    role: "admin" | "manager" | "viewer";
    display_name: string;
    department: string | null;
    cohort_id: number | null;
    cohort_number: number | null;
    cohort_name: string | null;
    is_superadmin: boolean;
}

interface TotpPending {
    token: string;
}

interface AuthContextValue {
    user: AuthUser | null;
    isLoading: boolean;
    totpPending: TotpPending | null;
    login: (username: string, password: string, remember?: boolean) => Promise<boolean>; // returns true if TOTP needed
    verifyTotp: (code: string) => Promise<void>;
    cancelTotp: () => void;
    logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [totpPending, setTotpPending] = useState<TotpPending | null>(null);

    useEffect(() => {
        const savedToken = getToken();
        if (!savedToken) {
            setIsLoading(false);
            return;
        }
        api.get<AuthUser>("/members/me")
            .then(({ data }) => setUser(data))
            .catch((err) => {
                if (err?.response?.status === 401) setToken(null);
            })
            .finally(() => setIsLoading(false));
    }, []);

    const login = useCallback(async (username: string, password: string, remember?: boolean): Promise<boolean> => {
        const { data } = await api.post<{
            access_token: string | null;
            requires_totp: boolean;
            totp_pending_token: string | null;
        }>("/auth/login", { username, password, remember: !!remember });

        if (data.requires_totp && data.totp_pending_token) {
            // remember 값을 미리 저장해두어 TOTP 완료 후 사용
            if (remember !== undefined) {
                localStorage.setItem("ops_remember", remember ? "1" : "0");
            }
            setTotpPending({ token: data.totp_pending_token });
            return true; // TOTP needed
        }

        if (data.access_token) {
            setToken(data.access_token, remember);
            const { data: me } = await api.get<AuthUser>("/members/me");
            setUser(me);
        }
        return false; // no TOTP needed, logged in
    }, []);

    const verifyTotp = useCallback(async (code: string) => {
        if (!totpPending) throw new Error("No TOTP pending");

        const remember = localStorage.getItem("ops_remember") === "1";
        const { data } = await api.post<{
            access_token: string | null;
        }>("/auth/verify-totp", { token: totpPending.token, totp_code: code, remember });

        if (data.access_token) {
            setTotpPending(null);
            setToken(data.access_token, remember);
            const { data: me } = await api.get<AuthUser>("/members/me");
            setUser(me);
        }
    }, [totpPending]);

    const cancelTotp = useCallback(() => {
        setTotpPending(null);
    }, []);

    const logout = useCallback(async () => {
        // 같은 기기 공용 사용 대비 — 토큰 비우기 전에 푸시 구독 정리(인증 필요).
        await unsubscribePush(api, { subscribePath: "/notifications/ops/subscribe" });
        try { await api.delete("/auth/logout"); } catch { /* ignore */ }
        setToken(null);
        setUser(null);
        window.location.href = "/login";
    }, []);

    return (
        <AuthContext.Provider value={{ user, isLoading, totpPending, login, verifyTotp, cancelTotp, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used within AuthProvider");
    return ctx;
}
