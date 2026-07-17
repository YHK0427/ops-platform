import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useOutletContext, useParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AuthProvider } from "@/context/AuthContext";
import { MemberAuthProvider, useMemberAuth } from "@/context/MemberAuthContext";
import { AuthGuard } from "@/components/AuthGuard";
import { Sidebar } from "@/components/Sidebar";
import { CohortGate } from "@/components/CohortGate";
import { getToken } from "@/lib/api";
import { getMemberToken } from "@/lib/memberApi";

import LoginPage from "@/pages/LoginPage";
import SessionList from "@/pages/SessionList";
import Dashboard from "@/pages/Dashboard";
import Members from "@/pages/Members";
import MemberDetail from "@/pages/MemberDetail";
import Ledger from "@/pages/Ledger";
import SessionWizard from "@/pages/SessionWizard";
import SessionLayout from "@/pages/session/SessionLayout";
import PrepTab from "@/pages/session/PrepTab";
import OpsTab from "@/pages/session/OpsTab";
import { PostTab } from "@/pages/session/PostTab";
import SettlementTab from "@/pages/session/SettlementTab";
import TeamEditPage from "@/pages/session/TeamEditPage";
import GroupEditPage from "@/pages/session/GroupEditPage";
import AdminUsers from "@/pages/AdminUsers";
import AdminCohorts from "@/pages/AdminCohorts";
import Treasury from "@/pages/Treasury";

// ── Lazy-loaded evaluation pages (ops) ─────────────────────────────────
const TeamBuilding = lazy(() => import("@/pages/TeamBuilding"));
const TeamBuildingBoard = lazy(() => import("@/pages/TeamBuildingBoard"));
const EvalManagement = lazy(() => import("@/pages/EvalManagement"));
const EvalAudienceForm = lazy(() => import("@/pages/EvalAudienceForm"));
const LiveFeedbackManagement = lazy(() => import("@/pages/LiveFeedbackManagement"));
const LiveFeedbackPresent = lazy(() => import("@/pages/LiveFeedbackPresent"));
const Announcements = lazy(() => import("@/pages/Announcements"));
const ScoringManagement = lazy(() => import("@/pages/ScoringManagement"));
const ScoringRoundDetail = lazy(() => import("@/pages/ScoringRoundDetail"));

// ── 공개(무로그인) 채점 폼 — 어떤 가드에도 들어가면 안 된다 ──────────────
const PublicScoringForm = lazy(() => import("@/pages/PublicScoringForm"));

// ── Lazy-loaded member portal pages ────────────────────────────────────
const MemberLayout = lazy(() => import("@/pages/member/MemberLayout"));
const MemberHome = lazy(() => import("@/pages/member/MemberHome"));
const MemberReports = lazy(() => import("@/pages/member/MemberReports"));
const MemberLedger = lazy(() => import("@/pages/member/MemberLedger"));
const MemberAttendance = lazy(() => import("@/pages/member/MemberAttendance"));
const SelfEvalForm = lazy(() => import("@/pages/member/SelfEvalForm"));
const EvalComplete = lazy(() => import("@/pages/member/EvalComplete"));
const MemberResult = lazy(() => import("@/pages/member/MemberResult"));
const MemberFeedbackBoard = lazy(() => import("@/pages/member/MemberFeedbackBoard"));
const MemberFeedbackList = lazy(() => import("@/pages/member/MemberFeedbackList"));
const MemberAnnouncements = lazy(() => import("@/pages/member/MemberAnnouncements"));
const MemberAnnouncementDetail = lazy(() => import("@/pages/member/MemberAnnouncementDetail"));

// ── Loading fallback ───────────────────────────────────────────────────
function LoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <span className="inline-block w-6 h-6 border-2 border-[var(--color-border)] border-t-[var(--color-accent)] rounded-full animate-spin" />
    </div>
  );
}

// ── Member auth guard ──────────────────────────────────────────────────
function MemberGuard() {
  const { member, isLoading } = useMemberAuth();

  if (isLoading) return <LoadingFallback />;
  if (!member) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function SessionDefaultTab() {
  const { session } = useOutletContext<{ session: { status: string } }>();
  const tab = (() => {
    switch (session?.status) {
      case "SETUP": case "PREP": return "prep";
      case "OPS": return "ops";
      case "POST": return "post";
      case "SETTLEMENT": return "settlement";
      case "FINALIZED": return "settlement";
      default: return "prep";
    }
  })();
  return <Navigate to={tab} replace />;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 1000 * 60, // 1 min
    },
    mutations: {
      networkMode: "always", // Don't pause mutations on offline detection (Tailscale VPN can confuse navigator.onLine)
    },
  },
});

function DashboardLayout() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-auto pt-[45px] md:pt-0">
        <CohortGate>
          <Outlet />
        </CohortGate>
      </div>
    </div>
  );
}

// ── 토큰 기반 루트 redirect (단일 도메인) ───────────────────────────────
// 기수(member) 토큰 있으면 포털, 운영진(ops) 토큰 있으면 대시보드, 없으면 로그인
function RootRedirect() {
  if (getMemberToken()) return <Navigate to="/member" replace />;
  if (getToken()) return <Navigate to="/dashboard" replace />;
  return <Navigate to="/login" replace />;
}

// 푸시 알림 클릭 랜딩 — 세션에 맞는 화면으로 라우팅.
// 멤버 토큰 있으면 멤버 공지 상세, 운영진 토큰 있으면 운영진 공지 페이지, 없으면 로그인.
function AnnouncementLanding() {
  const { id } = useParams();
  if (getMemberToken()) return <Navigate to={`/member/announcements/${id}`} replace />;
  if (getToken()) return <Navigate to="/announcements" replace />;
  return <Navigate to="/login" replace />;
}

export default function App() {
  useEffect(() => {
    document.title = "UnivPT Ops";
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<LoadingFallback />}>
            <Routes>
              {/* 통합 로그인 + 루트 redirect (단일 도메인) */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/" element={<RootRedirect />} />
              {/* 푸시 알림 클릭 랜딩 (세션별 라우팅) */}
              <Route path="/go/announcement/:id" element={<AnnouncementLanding />} />

              {/* ── 공개 채점 폼 (로그인 불필요) ────────────────────────
                  주의: AuthGuard/MemberGuard 바깥, catch-all(*) 앞에 두어야 한다.
                  가드 안에 들어가면 외부 심사위원이 로그인 화면으로 튕긴다. */}
              <Route path="/s/:publicToken" element={<PublicScoringForm />} />
              <Route path="/s/:publicToken/feedback" element={<PublicScoringForm feedbackOnly />} />

              {/* ── 기수 포털 ──────────────────────────── */}
              <Route
                path="/member"
                element={
                  <MemberAuthProvider>
                    <Outlet />
                  </MemberAuthProvider>
                }
              >
                <Route path="login" element={<Navigate to="/login" replace />} />
                <Route element={<MemberGuard />}>
                  {/* 하단 탭 포털 (홈/성장리포트/내 점수) */}
                  <Route element={<MemberLayout />}>
                    <Route index element={<MemberHome />} />
                    <Route path="announcements" element={<MemberAnnouncements />} />
                    <Route path="announcements/:id" element={<MemberAnnouncementDetail />} />
                    <Route path="reports" element={<MemberReports />} />
                    <Route path="feedback" element={<MemberFeedbackList />} />
                    <Route path="ledger" element={<MemberLedger />} />
                    <Route path="attendance" element={<MemberAttendance />} />
                  </Route>
                  {/* 전체화면 (탭 없음) */}
                  <Route path="eval/:roundId" element={<SelfEvalForm />} />
                  <Route path="eval/:roundId/complete" element={<EvalComplete />} />
                  <Route path="eval/:roundId/result" element={<MemberResult />} />
                  <Route path="feedback/:boardId" element={<MemberFeedbackBoard />} />
                </Route>
              </Route>

              {/* ── 운영진 ──────────────────────────── */}
              <Route element={<AuthGuard />}>
                <Route element={<DashboardLayout />}>
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/members" element={<Members />} />
                  <Route path="/members/:id" element={<MemberDetail />} />
                  <Route path="/sessions" element={<SessionList />} />
                  <Route path="/sessions/new" element={<SessionWizard />} />
                  <Route path="/sessions/:id" element={<SessionLayout />}>
                    <Route index element={<SessionDefaultTab />} />
                    <Route path="prep" element={<PrepTab />} />
                    <Route path="ops" element={<OpsTab />} />
                    <Route path="post" element={<PostTab />} />
                    <Route path="settlement" element={<SettlementTab />} />
                    <Route path="team-edit" element={<TeamEditPage />} />
                    <Route path="group-edit" element={<GroupEditPage />} />
                  </Route>
                  <Route path="/ledger" element={<Ledger />} />
                  <Route path="/treasury" element={<Treasury />} />
                  <Route path="/admin/users" element={<AdminUsers />} />
                  <Route path="/admin/cohorts" element={<AdminCohorts />} />
                  <Route path="/team-building" element={<TeamBuilding />} />
                  <Route path="/team-building/:boardId" element={<TeamBuildingBoard />} />
                  <Route path="/eval" element={<EvalManagement />} />
                  <Route path="/live-feedback" element={<LiveFeedbackManagement />} />
                  <Route path="/scoring" element={<ScoringManagement />} />
                  <Route path="/scoring/:roundId" element={<ScoringRoundDetail />} />
                  <Route path="/announcements" element={<Announcements />} />
                </Route>
                {/* Audience eval form — full-screen (no sidebar) */}
                <Route path="/eval/:roundId/audience" element={<EvalAudienceForm />} />
                {/* 실시간 피드백 발표용 전체화면 (no sidebar) */}
                <Route path="/live-feedback/:boardId/present" element={<LiveFeedbackPresent />} />
              </Route>

              {/* Fallback */}
              <Route path="*" element={<RootRedirect />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster
          theme="light"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "rgba(255,255,255,0.95)",
              border: "1px solid rgba(0,0,0,0.08)",
              color: "#1A1A2E",
              backdropFilter: "blur(16px)",
            },
          }}
        />
      </AuthProvider>
    </QueryClientProvider>
  );
}
