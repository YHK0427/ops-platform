import { Suspense, useEffect, useState } from "react";
import { lazyPreload, preloadAll, whenIdle } from "@/lib/lazyPreload";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation, useOutletContext } from "react-router-dom";
import { PatchNoteModal } from "@/components/PatchNoteModal";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AuthProvider } from "@/context/AuthContext";
import { MemberAuthProvider, useMemberAuth, fetchMemberMe } from "@/context/MemberAuthContext";
import { memberAnnouncementsQuery } from "@/hooks/useMemberAnnouncements";
import { pendingEvalsQuery } from "@/hooks/useMemberEvaluation";
import { memberFeedbackBoardsQuery, openFeedbackBoardQuery } from "@/hooks/useLiveFeedback";
import { myLedgerQuery, myAttendanceQuery, mySummaryQuery } from "@/hooks/useMemberLedger";
import { myExcusesQuery } from "@/hooks/useExcuses";
import { AuthGuard } from "@/components/AuthGuard";
import { Sidebar } from "@/components/Sidebar";
import { CohortGate } from "@/components/CohortGate";
import { getToken } from "@/lib/api";
import { getMemberToken } from "@/lib/memberApi";

import LoginPage from "@/pages/LoginPage";

// ── Lazy-loaded ops pages (로그인 직후 대시보드 외엔 첫 진입 시 안 씀) ──────
const SessionList = lazyPreload(() => import("@/pages/SessionList"));
const Dashboard = lazyPreload(() => import("@/pages/Dashboard"));
const Members = lazyPreload(() => import("@/pages/Members"));
const MemberDetail = lazyPreload(() => import("@/pages/MemberDetail"));
const Ledger = lazyPreload(() => import("@/pages/Ledger"));
const SessionWizard = lazyPreload(() => import("@/pages/SessionWizard"));
const SessionLayout = lazyPreload(() => import("@/pages/session/SessionLayout"));
const PrepTab = lazyPreload(() => import("@/pages/session/PrepTab"));
const OpsTab = lazyPreload(() => import("@/pages/session/OpsTab"));
const PostTab = lazyPreload(() => import("@/pages/session/PostTab").then((m) => ({ default: m.PostTab })));
const SettlementTab = lazyPreload(() => import("@/pages/session/SettlementTab"));
const TeamEditPage = lazyPreload(() => import("@/pages/session/TeamEditPage"));
const GroupEditPage = lazyPreload(() => import("@/pages/session/GroupEditPage"));
const AdminUsers = lazyPreload(() => import("@/pages/AdminUsers"));
const AdminCohorts = lazyPreload(() => import("@/pages/AdminCohorts"));
const AdminAuditLog = lazyPreload(() => import("@/pages/AdminAuditLog"));
const Treasury = lazyPreload(() => import("@/pages/Treasury"));

// ── Lazy-loaded evaluation pages (ops) ─────────────────────────────────
const TeamBuilding = lazyPreload(() => import("@/pages/TeamBuilding"));
const TeamBuildingBoard = lazyPreload(() => import("@/pages/TeamBuildingBoard"));
const EvalManagement = lazyPreload(() => import("@/pages/EvalManagement"));
const EvalAudienceForm = lazyPreload(() => import("@/pages/EvalAudienceForm"));
const LiveFeedbackManagement = lazyPreload(() => import("@/pages/LiveFeedbackManagement"));
const LiveFeedbackPresent = lazyPreload(() => import("@/pages/LiveFeedbackPresent"));
const Announcements = lazyPreload(() => import("@/pages/Announcements"));
const ScoringManagement = lazyPreload(() => import("@/pages/ScoringManagement"));
const ScoringRoundDetail = lazyPreload(() => import("@/pages/ScoringRoundDetail"));

// ── 공개(무로그인) 채점 폼 — 어떤 가드에도 들어가면 안 된다 ──────────────
const PublicScoringForm = lazyPreload(() => import("@/pages/PublicScoringForm"));

// ── Lazy-loaded member portal pages ────────────────────────────────────
const MemberLayout = lazyPreload(() => import("@/pages/member/MemberLayout"));
const MemberHome = lazyPreload(() => import("@/pages/member/MemberHome"));
const MemberReports = lazyPreload(() => import("@/pages/member/MemberReports"));
const MemberLedger = lazyPreload(() => import("@/pages/member/MemberLedger"));
const MemberAttendance = lazyPreload(() => import("@/pages/member/MemberAttendance"));
const SelfEvalForm = lazyPreload(() => import("@/pages/member/SelfEvalForm"));
const EvalComplete = lazyPreload(() => import("@/pages/member/EvalComplete"));
const MemberResult = lazyPreload(() => import("@/pages/member/MemberResult"));
const MemberFeedbackBoard = lazyPreload(() => import("@/pages/member/MemberFeedbackBoard"));
const MemberFeedbackList = lazyPreload(() => import("@/pages/member/MemberFeedbackList"));
const MemberAnnouncements = lazyPreload(() => import("@/pages/member/MemberAnnouncements"));
const MemberAnnouncementDetail = lazyPreload(() => import("@/pages/member/MemberAnnouncementDetail"));
const DevFeedback = lazyPreload(() => import("@/pages/DevFeedback"));

// ── 화면 조각 미리 받기 ─────────────────────────────────────────────────
// 지금 들어온 쪽(기수 포털/운영진)의 화면은 로그인 확인과 동시에 받기 시작하고,
// 나머지는 한가할 때 받는다. 한 번 받은 화면은 대체 화면 없이 바로 그려진다(lazyPreload).
// 평가 결과(차트 라이브러리 101KB)·자기평가·완료 화면은 드물게 열어서 뺀다 — import() 는 받기만이 아니라
// 실행까지 해서, 넣어두면 첫 화면 직후 메인 스레드를 잡아먹었다(Lighthouse TBT 80ms → 350ms).
const MEMBER_PAGES = [
  MemberLayout, MemberHome, MemberAnnouncements, MemberAnnouncementDetail, MemberReports,
  MemberFeedbackList, MemberFeedbackBoard, MemberLedger, MemberAttendance,
];
const OPS_PAGES = [
  Dashboard, SessionList, Members, MemberDetail, Ledger, Treasury, Announcements, SessionLayout, PrepTab, OpsTab,
  PostTab, SettlementTab, SessionWizard, TeamBuilding, TeamBuildingBoard, LiveFeedbackManagement, LiveFeedbackPresent,
  EvalManagement, ScoringManagement, ScoringRoundDetail, TeamEditPage, GroupEditPage, AdminUsers, AdminCohorts,
  AdminAuditLog, DevFeedback, EvalAudienceForm,
];
// 첫 접속 때는 지금 주소의 화면만 바로 받는다. 전부 한꺼번에 받으면 지금 필요한 파일과
// 대역폭을 다퉈 첫 화면이 오히려 늦어졌다(측정: 2.1초 → 2.6초). 나머지는 레이아웃이 뜬 뒤 한가할 때.
const MEMBER_ENTRY: [RegExp, { preload: () => Promise<void> }][] = [
  [/^\/member\/?$/, MemberHome],
  [/^\/member\/announcements\/./, MemberAnnouncementDetail],
  [/^\/member\/announcements/, MemberAnnouncements],
  [/^\/member\/reports/, MemberReports],
  [/^\/member\/feedback\/./, MemberFeedbackBoard],
  [/^\/member\/feedback/, MemberFeedbackList],
  [/^\/member\/ledger/, MemberLedger],
  [/^\/member\/attendance/, MemberAttendance],
];
if (typeof window !== "undefined") {
  const path = window.location.pathname;
  if (path.startsWith("/member")) {
    const entry = MEMBER_ENTRY.find(([re]) => re.test(path))?.[1];
    preloadAll(entry ? [MemberLayout, entry] : [MemberLayout]);
  } else if (path !== "/login" && !path.startsWith("/s/") && getToken()) {
    preloadAll(path === "/" || path.startsWith("/dashboard") ? [Dashboard] : []);
  } else if (path === "/login") {
    // 로그인 화면: 로그인 직후 첫 화면만 한가할 때 받아둔다(기수원이 대부분이라 운영진 화면 전체는 안 받음)
    whenIdle(() => preloadAll([MemberLayout, MemberHome, Dashboard]));
  }
}

// ── Loading fallback ───────────────────────────────────────────────────
function LoadingFallback({ inline = false }: { inline?: boolean }) {
  // 0.2초 안에 끝나는 로딩은 아예 안 보여준다 — 짧은 깜빡임이 '버벅임'으로 느껴진다
  const [show, setShow] = useState(false);
  useEffect(() => { const t = window.setTimeout(() => setShow(true), 200); return () => window.clearTimeout(t); }, []);
  return (
    <div className={inline ? "flex-1 flex items-center justify-center py-24" : "min-h-screen flex items-center justify-center"}>
      {show && <span className="inline-block w-6 h-6 border-2 border-[var(--color-border)] border-t-[var(--color-accent)] rounded-full animate-spin" />}
    </div>
  );
}

export function ContentFallback() {
  return <LoadingFallback inline />;
}

// ── Member auth guard ──────────────────────────────────────────────────
function MemberGuard() {
  const { member, isLoading } = useMemberAuth();
  // 로그인 화면을 거쳐 들어왔어도 나머지 포털 화면을 한가할 때 받아둔다
  useEffect(() => { if (member) whenIdle(() => preloadAll(MEMBER_PAGES)); }, [member]);

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

// 기수 포털 첫 접속: 로그인 확인을 기다리지 않고 지금 화면이 쓸 데이터를 같이 출발시킨다
// (둘을 줄줄이 보내면 왕복 한 번이 더 든다). 토큰이 틀리면 401 → 로그인 화면으로 가는 건 똑같다.
const MEMBER_ENTRY_DATA: [RegExp, object[]][] = [
  [/^\/member\/?$/, [mySummaryQuery, memberAnnouncementsQuery, openFeedbackBoardQuery]],
  [/^\/member\/announcements\/?$/, [memberAnnouncementsQuery]],
  [/^\/member\/reports/, [pendingEvalsQuery]],
  [/^\/member\/feedback\/?$/, [memberFeedbackBoardsQuery]],
  [/^\/member\/ledger/, [myLedgerQuery, mySummaryQuery]],
  [/^\/member\/attendance/, [myAttendanceQuery, myExcusesQuery]],
];
if (typeof window !== "undefined" && window.location.pathname.startsWith("/member") && getMemberToken()) {
  fetchMemberMe().catch(() => {});
  const path = window.location.pathname;
  for (const q of MEMBER_ENTRY_DATA.find(([re]) => re.test(path))?.[1] ?? []) {
    void queryClient.prefetchQuery(q as Parameters<typeof queryClient.prefetchQuery>[0]);
  }
}

function DashboardLayout() {
  useEffect(() => { whenIdle(() => preloadAll(OPS_PAGES)); }, []);
  const section = useLocation().pathname.split("/")[1] ?? "";
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-auto pt-[45px] md:pt-0">
        <CohortGate>
          <PatchNoteModal side="staff" />
          {/* 본문만 로딩 — 바깥 Suspense 로 올라가면 사이드바까지 통째로 사라진다 */}
          <Suspense fallback={<ContentFallback />}>
            {/* 주소 첫 단계가 바뀔 때만 전환 — 세션 안 탭 이동으로 세션 화면이 새로 만들어지지 않게 */}
            <div key={section} className="page-in flex-1 flex flex-col min-h-0">
              <Outlet />
            </div>
          </Suspense>
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
              {/* /go/announcement/:id 는 서버(backend/app/routers/share.py)가 처리한다.
                  카카오톡 미리보기 태그를 붙이려면 HTML 을 서버가 내려줘야 해서다.
                  nginx 가 /go/ 를 백엔드로 보내므로 여기에 라우트를 두면 안 된다. */}

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
                  <Route path="/admin/audit-log" element={<AdminAuditLog />} />
                  <Route path="/dev-feedback" element={<DevFeedback />} />
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
