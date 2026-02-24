import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AuthProvider } from "@/context/AuthContext";
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

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<LoginPage />} />

            {/* Protected */}
            <Route element={<AuthGuard />}>
              <Route element={<DashboardLayout />}>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/members" element={<Members />} />
                <Route path="/members/:id" element={<MemberDetail />} />
                <Route path="/sessions" element={<SessionList />} />
                <Route path="/sessions/new" element={<SessionWizard />} />
                <Route path="/sessions/:id" element={<SessionLayout />}>
                  <Route index element={<Navigate to="prep" replace />} />
                  <Route path="prep" element={<PrepTab />} />
                  <Route path="ops" element={<OpsTab />} />
                  <Route path="post" element={<PostTab />} />
                  <Route path="settlement" element={<SettlementTab />} />
                  <Route path="team-edit" element={<TeamEditPage />} />
                </Route>
                <Route path="/ledger" element={<Ledger />} />
              </Route>
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
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
