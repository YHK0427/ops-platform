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

    return <Outlet />;
}
