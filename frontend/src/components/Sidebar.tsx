import { NavLink, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
    LayoutDashboard,
    Users,
    BookOpen,
    LogOut,
    Plus,
    CalendarDays,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

interface NavItem {
    label: string;
    to: string;
    icon: React.ElementType;
}

const NAV_ITEMS: NavItem[] = [
    { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
    { label: "Members", to: "/members", icon: Users },
    { label: "Ledger", to: "/ledger", icon: BookOpen },
];

export function Sidebar() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    return (
        <aside className="flex flex-col w-56 shrink-0 h-full bg-black/50 backdrop-blur-xl border-r border-[var(--color-border-subtle)]">
            {/* Logo */}
            <div className="px-5 py-5 border-b border-[var(--color-border-subtle)]">
                <span className="text-sm font-bold tracking-widest text-[var(--color-text-secondary)] uppercase">
                    UnivPT
                </span>
                <span className="ml-2 text-xs text-[var(--color-accent)] font-mono">Ops</span>
            </div>

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
                                    ? "text-white bg-gradient-to-r from-[var(--color-accent)]/10 to-transparent"
                                    : "text-[var(--color-text-secondary)] hover:text-white hover:bg-[var(--color-hover)]"
                            )
                        }
                    >
                        {({ isActive }) => (
                            <>
                                {isActive && (
                                    <motion.div
                                        layoutId="active-indicator"
                                        className="absolute left-0 top-1 bottom-1 w-1 rounded-r-full bg-[var(--color-accent)] shadow-[0_0_10px_var(--color-accent)]"
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
                        Sessions
                    </p>
                </div>
                <button
                    onClick={() => navigate("/sessions/new")}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-[var(--color-text-secondary)] hover:text-white hover:bg-[var(--color-hover)] transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    New Session
                </button>
                <NavLink
                    to="/sessions"
                    className={({ isActive }) =>
                        cn(
                            "relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                            isActive
                                ? "text-white bg-gradient-to-r from-[var(--color-accent)]/10 to-transparent"
                                : "text-[var(--color-text-secondary)] hover:text-white hover:bg-[var(--color-hover)]"
                        )
                    }
                >
                    <CalendarDays className="w-4 h-4" />
                    All Sessions
                </NavLink>
            </nav>

            {/* Footer */}
            <div className="px-3 py-4 border-t border-[var(--color-border-subtle)] space-y-1">
                {user && (
                    <button
                        onClick={logout}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-[var(--color-text-secondary)] hover:text-rose-400 hover:bg-rose-500/5 transition-colors"
                    >
                        <LogOut className="w-4 h-4" />
                        Logout
                    </button>
                )}
            </div>
        </aside>
    );
}
