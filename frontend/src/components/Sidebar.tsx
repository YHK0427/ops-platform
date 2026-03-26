import { useState, useEffect } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import {
    LayoutDashboard,
    Users,
    BookOpen,
    PiggyBank,
    LogOut,
    Plus,
    CalendarDays,
    Shield,
    ClipboardCheck,
    Menu,
    X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

interface NavItem {
    label: string;
    to: string;
    icon: React.ElementType;
}

const NAV_ITEMS: NavItem[] = [
    { label: "대시보드", to: "/dashboard", icon: LayoutDashboard },
    { label: "멤버", to: "/members", icon: Users },
    { label: "장부(기수시점)", to: "/ledger", icon: BookOpen },
    { label: "금고(총무부시점)", to: "/treasury", icon: PiggyBank },
];

export function Sidebar() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [mobileOpen, setMobileOpen] = useState(false);

    // Close mobile sidebar on route change
    useEffect(() => {
        setMobileOpen(false);
    }, [location.pathname]);

    const sidebarContent = (
        <>
            {/* Navigation */}
            <nav className="flex-1 px-3 py-4 space-y-1">
                {NAV_ITEMS.map((item) => (
                    <NavLink
                        key={item.to}
                        to={item.to}
                        className={({ isActive }) =>
                            cn(
                                "relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                                isActive
                                    ? "text-[var(--color-accent)] bg-[var(--color-accent-dim)]"
                                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)]"
                            )
                        }
                    >
                        {({ isActive }) => (
                            <>
                                {isActive && (
                                    <motion.div
                                        layoutId="active-indicator"
                                        className="absolute left-0 top-1 bottom-1 w-1 rounded-r-full bg-[var(--color-accent)] shadow-none"
                                        transition={{ type: "spring", stiffness: 380, damping: 30 }}
                                    />
                                )}
                                <item.icon className="w-4 h-4 shrink-0" />
                                {item.label}
                            </>
                        )}
                    </NavLink>
                ))}

                {/* Sessions divider */}
                <div className="pt-4 pb-1">
                    <p className="px-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                        세션
                    </p>
                </div>
                <button
                    onClick={() => navigate("/sessions/new")}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)] transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    새 세션
                </button>
                <NavLink
                    to="/sessions"
                    className={({ isActive }) =>
                        cn(
                            "relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                            isActive
                                ? "text-[var(--color-accent)] bg-[var(--color-accent-dim)]"
                                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)]"
                        )
                    }
                >
                    <CalendarDays className="w-4 h-4" />
                    전체 세션
                </NavLink>

                {/* 평가 divider */}
                <div className="pt-4 pb-1">
                    <p className="px-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                        평가
                    </p>
                </div>
                <NavLink
                    to="/eval"
                    className={({ isActive }) =>
                        cn(
                            "relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                            isActive
                                ? "text-[var(--color-accent)] bg-[var(--color-accent-dim)]"
                                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)]"
                        )
                    }
                >
                    {({ isActive }) => (
                        <>
                            {isActive && (
                                <motion.div
                                    layoutId="active-indicator"
                                    className="absolute left-0 top-1 bottom-1 w-1 rounded-r-full bg-[var(--color-accent)] shadow-none"
                                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                                />
                            )}
                            <ClipboardCheck className="w-4 h-4 shrink-0" />
                            성장리포트
                        </>
                    )}
                </NavLink>
            </nav>

            {/* Admin */}
            {user?.role === "admin" && (
                <div className="px-3">
                    <div className="pt-4 pb-1">
                        <p className="px-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                            관리
                        </p>
                    </div>
                    <NavLink
                        to="/admin/users"
                        className={({ isActive }) =>
                            cn(
                                "relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                                isActive
                                    ? "text-[var(--color-accent)] bg-[var(--color-accent-dim)]"
                                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)]"
                            )
                        }
                    >
                        <Shield className="w-4 h-4" />
                        사용자 관리
                    </NavLink>
                </div>
            )}

            {/* Footer */}
            <div className="px-3 py-4 border-t border-[var(--color-border-subtle)] space-y-1">
                {user && (
                    <button
                        onClick={logout}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-[var(--color-text-secondary)] hover:text-rose-600 hover:bg-rose-50 transition-colors"
                    >
                        <LogOut className="w-4 h-4" />
                        로그아웃
                    </button>
                )}
            </div>
        </>
    );

    return (
        <>
            {/* Mobile top bar - only visible on mobile */}
            <div className="fixed top-0 left-0 right-0 z-30 md:hidden bg-white/80 backdrop-blur-xl border-b border-[var(--color-border-subtle)]">
                <div className="flex items-center gap-3 px-4 py-2.5">
                    <button
                        onClick={() => setMobileOpen(true)}
                        className="p-1.5 rounded-lg hover:bg-[var(--color-hover)] text-[var(--color-text-secondary)]"
                    >
                        <Menu className="w-5 h-5" />
                    </button>
                    <span className="text-sm font-bold text-[var(--color-text-primary)]">
                        UnivPT <span className="text-[var(--color-accent)]">Ops</span>
                    </span>
                </div>
            </div>

            {/* Desktop sidebar - hidden on mobile */}
            <aside className="hidden md:flex flex-col w-56 shrink-0 h-full bg-white/80 backdrop-blur-xl border-r border-[var(--color-border-subtle)]">
                {/* Logo */}
                <NavLink to="/dashboard" className="block px-5 py-5 border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-hover)] transition-colors">
                    <span className="text-sm font-bold tracking-widest text-[var(--color-text-secondary)] uppercase">
                        UnivPT
                    </span>
                    <span className="ml-2 text-xs font-semibold text-[var(--color-accent)]">Ops</span>
                </NavLink>
                {sidebarContent}
            </aside>

            {/* Mobile overlay sidebar */}
            {mobileOpen && (
                <div className="fixed inset-0 z-40 md:hidden" onClick={() => setMobileOpen(false)}>
                    <div className="absolute inset-0 bg-black/40" />
                    <aside
                        className="absolute inset-y-0 left-0 w-64 bg-white/95 backdrop-blur-xl border-r border-[var(--color-border-subtle)] shadow-xl flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-subtle)]">
                            <span className="text-sm font-bold text-[var(--color-text-primary)]">
                                UnivPT <span className="text-[var(--color-accent)]">Ops</span>
                            </span>
                            <button
                                onClick={() => setMobileOpen(false)}
                                className="p-1 rounded-lg hover:bg-[var(--color-hover)] text-[var(--color-text-muted)]"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        {sidebarContent}
                    </aside>
                </div>
            )}
        </>
    );
}
