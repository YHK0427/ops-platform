import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

export function AuthGuard() {
    const { user, isLoading } = useAuth();
    const location = useLocation();

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <span className="inline-block w-6 h-6 border-2 border-[var(--color-border)] border-t-[var(--color-accent)] rounded-full animate-spin" />
            </div>
        );
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    // Admin-only routes
    if (location.pathname.startsWith("/admin") && user.role !== "admin") {
        return <Navigate to="/dashboard" replace />;
    }

    // scoring_only(외부 임시 · 심사 전용) — 심사 탭 밖은 전부 막는다. 서버도 동일하게
    // 막지만(app/deps.py), 클라이언트에서도 막아야 다른 화면이 잠깐이라도 안 보인다.
    if (user.role === "scoring_only" && !location.pathname.startsWith("/scoring")) {
        return <Navigate to="/scoring" replace />;
    }

    return <Outlet />;
}
