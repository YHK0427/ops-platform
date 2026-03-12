import { Navigate, Outlet } from "react-router-dom";
import { useMemberAuth } from "@/context/MemberAuthContext";

export function MemberGuard() {
    const { member, isLoading } = useMemberAuth();

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <span className="inline-block w-6 h-6 border-2 border-[var(--color-border)] border-t-[var(--color-accent)] rounded-full animate-spin" />
            </div>
        );
    }

    if (!member) {
        return <Navigate to="/member/login" replace />;
    }

    return <Outlet />;
}
