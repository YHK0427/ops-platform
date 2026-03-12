import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useOutletContext } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AuthProvider } from "@/context/AuthContext";
import { MemberAuthProvider, useMemberAuth } from "@/context/MemberAuthContext";
import { AuthGuard } from "@/components/AuthGuard";
import { Sidebar } from "@/components/Sidebar";

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
import AdminUsers from "@/pages/AdminUsers";
import Treasury from "@/pages/Treasury";

// ── Lazy-loaded evaluation pages (ops) ─────────────────────────────────
const EvalManagement = lazy(() => import("@/pages/EvalManagement"));
const EvalAudienceForm = lazy(() => import("@/pages/EvalAudienceForm"));

// ── Lazy-loaded member portal pages ────────────────────────────────────
const MemberLoginPage = lazy(() => import("@/pages/member/MemberLoginPage"));
const MemberHome = lazy(() => import("@/pages/member/MemberHome"));
const SelfEvalForm = lazy(() => import("@/pages/member/SelfEvalForm"));
const EvalComplete = lazy(() => import("@/pages/member/EvalComplete"));
const MemberResult = lazy(() => import("@/pages/member/MemberResult"));

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
  if (!member) return <Navigate to="/member/login" replace />;
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
      <div className="flex-1 flex flex-col min-w-0 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}

// ── Hostname-based redirect ────────────────────────────────────────────
// In production: univpt33.* -> member portal
// In dev: access /member/* directly
function HostnameRedirect() {
  const isMemberPortal = window.location.hostname.startsWith("univpt33");
  if (isMemberPortal) {
    return <Navigate to="/member" replace />;
  }
  return <Navigate to="/dashboard" replace />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<LoadingFallback />}>
            <Routes>
              {/* Public */}
              <Route path="/login" element={<LoginPage />} />

              {/* ── Member portal routes ──────────────────────────── */}
              <Route
                path="/member"
                element={
                  <MemberAuthProvider>
                    <Outlet />
                  </MemberAuthProvider>
                }
              >
                <Route path="login" element={<MemberLoginPage />} />
                <Route element={<MemberGuard />}>
                  <Route index element={<MemberHome />} />
                  <Route path="eval/:roundId" element={<SelfEvalForm />} />
                  <Route path="eval/:roundId/complete" element={<EvalComplete />} />
                  <Route path="eval/:roundId/result" element={<MemberResult />} />
                </Route>
              </Route>

              {/* Root: hostname-aware redirect (must be OUTSIDE AuthGuard) */}
              <Route path="/" element={<HostnameRedirect />} />

              {/* ── Ops protected routes ──────────────────────────── */}
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
                  </Route>
                  <Route path="/ledger" element={<Ledger />} />
                  <Route path="/treasury" element={<Treasury />} />
                  <Route path="/admin/users" element={<AdminUsers />} />
                  <Route path="/eval" element={<EvalManagement />} />
                </Route>
                {/* Audience eval form — full-screen (no sidebar) */}
                <Route path="/eval/:roundId/audience" element={<EvalAudienceForm />} />
              </Route>

              {/* Fallback: hostname-aware redirect */}
              <Route path="*" element={<HostnameRedirect />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "rgba(20,20,25,0.9)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#E8E8F0",
              backdropFilter: "blur(16px)",
            },
          }}
        />
      </AuthProvider>
    </QueryClientProvider>
  );
}
