import { Suspense, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useMemberAuth } from "@/context/MemberAuthContext";
import { motion } from "framer-motion";
import { LogOut, Home, BarChart3, Wallet, KeyRound, MessageSquareHeart, Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";
import memberApi from "@/lib/memberApi";
import ChangePasswordModal from "@/components/ChangePasswordModal";
import { PatchNoteModal } from "@/components/PatchNoteModal";
import { useUnreadAnnouncements, memberAnnouncementsQuery } from "@/hooks/useMemberAnnouncements";
import { pendingEvalsQuery } from "@/hooks/useMemberEvaluation";
import { memberFeedbackBoardsQuery } from "@/hooks/useLiveFeedback";
import { myLedgerQuery, myAttendanceQuery, mySummaryQuery } from "@/hooks/useMemberLedger";
import { myExcusesQuery } from "@/hooks/useExcuses";
import { whenIdle } from "@/lib/lazyPreload";

// 하단 탭·홈 카드가 처음 열릴 때 쓰는 데이터 — 한가할 때 미리 받아 탭을 눌러도 로딩이 안 보이게
const PREFETCH = [
    memberAnnouncementsQuery, pendingEvalsQuery, memberFeedbackBoardsQuery,
    myLedgerQuery, mySummaryQuery, myAttendanceQuery, myExcusesQuery,
];

const TABS = [
    { to: "/member", label: "홈", icon: Home, end: true },
    { to: "/member/announcements", label: "공지", icon: Megaphone, end: false },
    { to: "/member/reports", label: "리포트", icon: BarChart3, end: false },
    { to: "/member/feedback", label: "피드백", icon: MessageSquareHeart, end: false },
    { to: "/member/ledger", label: "내 점수", icon: Wallet, end: false },
];

export default function MemberLayout() {
    const { member, logout } = useMemberAuth();
    const [showPw, setShowPw] = useState(false);
    const { unreadCount } = useUnreadAnnouncements();
    const qc = useQueryClient();
    const { pathname } = useLocation();
    useEffect(() => {
        whenIdle(() => { for (const q of PREFETCH) void qc.prefetchQuery(q as Parameters<typeof qc.prefetchQuery>[0]); });
    }, [qc]);

    return (
        <div className="member-page pb-20">
            {/* 공통 헤더 */}
            <header className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-gray-200">
                <div className="mx-auto max-w-lg flex items-center justify-between px-4 py-3">
                    <div>
                        <p className="text-[11px] text-gray-400 font-medium">UnivPT {member?.cohort_name ?? ""}</p>
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

            <PatchNoteModal side="member" />

            <Suspense fallback={<div className="py-24" />}>
                {/* 화면 전환: 사라지는 애니메이션은 없이(다음 화면을 늦추지 않게) 들어올 때만 살짝 */}
                <motion.div key={pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}>
                    <Outlet />
                </motion.div>
            </Suspense>

            {/* 하단 탭 네비게이션 */}
            <nav className="fixed bottom-0 inset-x-0 z-20 bg-white/90 backdrop-blur-md border-t border-gray-200">
                <div className="mx-auto max-w-lg grid grid-cols-5">
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
                            <span className="relative">
                                <Icon className="w-5 h-5" />
                                {/* 안 읽은 공지가 있으면 '공지' 탭에만 점을 찍는다 */}
                                {to === "/member/announcements" && unreadCount > 0 && (
                                    <span className="absolute -top-0.5 -right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
                                        {unreadCount > 9 ? "9+" : unreadCount}
                                    </span>
                                )}
                            </span>
                            {label}
                        </NavLink>
                    ))}
                </div>
            </nav>
        </div>
    );
}
