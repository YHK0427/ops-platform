import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useMemberAuth } from "@/context/MemberAuthContext";
import { motion } from "framer-motion";
import { LogOut, Home, BarChart3, Wallet, KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";
import memberApi from "@/lib/memberApi";
import ChangePasswordModal from "@/components/ChangePasswordModal";

const TABS = [
    { to: "/member", label: "홈", icon: Home, end: true },
    { to: "/member/reports", label: "성장 리포트", icon: BarChart3, end: false },
    { to: "/member/ledger", label: "내 점수", icon: Wallet, end: false },
];

export default function MemberLayout() {
    const { member, logout } = useMemberAuth();
    const [showPw, setShowPw] = useState(false);

    return (
        <div className="member-page pb-20">
            {/* 공통 헤더 */}
            <header className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-gray-200">
                <div className="mx-auto max-w-lg flex items-center justify-between px-4 py-3">
                    <div>
                        <p className="text-[11px] text-gray-400 font-medium">UnivPT 33기</p>
                        <h1 className="text-base font-bold text-gray-900">
                            안녕하세요, {member?.name}님
                        </h1>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setShowPw(true)}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                        >
                            <KeyRound className="w-3.5 h-3.5" />
                            비밀번호
                        </button>
                        <motion.button
                            whileTap={{ scale: 0.97 }}
                            onClick={logout}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                        >
                            <LogOut className="w-3.5 h-3.5" />
                            로그아웃
                        </motion.button>
                    </div>
                </div>
            </header>

            {showPw && (
                <ChangePasswordModal
                    onClose={() => setShowPw(false)}
                    onSubmit={async (current_password, new_password) => {
                        await memberApi.post("/auth/member-change-password", { current_password, new_password });
                    }}
                />
            )}

            <Outlet />

            {/* 하단 탭 네비게이션 */}
            <nav className="fixed bottom-0 inset-x-0 z-20 bg-white/90 backdrop-blur-md border-t border-gray-200">
                <div className="mx-auto max-w-lg grid grid-cols-3">
                    {TABS.map(({ to, label, icon: Icon, end }) => (
                        <NavLink
                            key={to}
                            to={to}
                            end={end}
                            className={({ isActive }) =>
                                cn(
                                    "flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
                                    isActive ? "text-rose-500" : "text-gray-400 hover:text-gray-600",
                                )
                            }
                        >
                            <Icon className="w-5 h-5" />
                            {label}
                        </NavLink>
                    ))}
                </div>
            </nav>
        </div>
    );
}
