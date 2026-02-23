import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
} from "react";
import api, { setToken, getToken } from "@/lib/api";

interface AuthUser {
    id: number;
    name: string;
    email: string;
    is_admin: boolean;
}

interface AuthContextValue {
    user: AuthUser | null;
    isLoading: boolean;
    login: (email: string, password: string) => Promise<void>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const savedToken = getToken(); // reads from localStorage via the module-level init
        if (!savedToken) {
            setIsLoading(false);
            return;
        }
        // Token exists in localStorage: verify with backend
        api.get<AuthUser>("/members/me")
            .then(({ data }) => setUser(data))
            .catch(() => setToken(null)) // invalid/expired token → clear it
            .finally(() => setIsLoading(false));
    }, []);

    const login = useCallback(async (email: string, password: string) => {
        // 백엔드는 username="admin"을 기대함. 이메일 입력 시 매핑 처리
        const usernameToSend = email === "admin@univpt.kr" ? "admin" : email;

        const payload = {
            username: usernameToSend,
            password: password
        };

        const { data } = await api.post<{ access_token: string }>(
            "/auth/login",
            payload
        );

        setToken(data.access_token);

        const { data: me } = await api.get<AuthUser>("/members/me");
        setUser(me);
    }, []);

    const logout = useCallback(() => {
        setToken(null);
        setUser(null);
        window.location.href = "/login";
    }, []);

    return (
        <AuthContext.Provider value={{ user, isLoading, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used within AuthProvider");
    return ctx;
}
