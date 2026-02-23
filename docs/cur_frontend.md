# Frontend Project Structure & Architecture

This document serves as the **definitive map** of the `frontend/src` directory for the UnivPT Ops Platform. It is intended to be used by AI assistants and developers to quickly locate components, understand state management, and grasp the routing architecture without needing to scan the entire filesystem repeatedly.

---

## 1. Core Technology Stack
- **Framework:** React 19 + TypeScript
- **Bundler:** Vite
- **Routing:** `react-router-dom` v7
- **State/API Management:** `@tanstack/react-query` v5
- **Styling:** TailwindCSS v4
- **UI Base:** Radix UI primitives + raw Tailwind (assembled in `@/components/ui/`)
- **Toasts:** `sonner`

---

## 2. Exhaustive Directory Map (`frontend/src`)

### 2.1. Root Files
- **`App.tsx`**: The main application entry point. Configures `QueryClient`, sets up `react-router-dom` `<Routes>`, and wraps everything in `<AuthProvider>` and `<AuthGuard>`. Defines the main dashboard layout and tabbed layouts for sessions.
- **`main.tsx`**: Standard React DOM render entry.
- **`index.css`**: Global stylesheet. Defines fundamental CSS variables (e.g., `--color-base`, `--color-surface`, `--color-primary`, `--color-accent`) used heavily across Tailwind utility classes.

### 2.2. `/lib` (Utilities & Configuration)
- **`api.ts`**: Configures the global Axios instance. Sets the `baseURL` to `/api/v1` and attaches an interceptor that automatically reads the JWT token from `localStorage` (`ops_token`) and injects it into the `Authorization: Bearer` header.
- **`utils.ts`**: Contains the `cn()` utility (usually `clsx` + `tailwind-merge`) used throughout UI components for dynamic class name merging.

### 2.3. `/context` (React Contexts)
- **`AuthContext.tsx`**: Manages global authentication state (`token`, `isAuthenticated`). Provides `login()` and `logout()` methods that persist the JWT to `localStorage` and configure Axios.

### 2.4. `/hooks` (Data Fetching & Mutations)
All API interactions are encapsulated in these hooks using React Query. Component files *do not* call `api.ts` directly.
- **`useAuth.ts` / `index.ts`**: general hook exports.
- **`useCrawler.ts`**: Reaches `/crawler` endpoints. Handles Naver login (`useNaverLogin`), polling ARQ task status (`useCrawlerTask`), and triggering automation scripts (`useScanPPT`, `useScanHomework`, `useUploadVideos`).
- **`useLedger.ts`**: Interacts with `/ledger`. Fetches financial logs (`useLedger`), and provides mutations for manual score changes (`useGiveMerit`) and manual financial transactions (`useCreateTransaction`).
- **`useMembers.ts`**: Interacts with `/members`. Handles fetching members (`useMembers`, `useMember`, `useStreakCandidates`) and lifecycle management (`useCreateMember`, `useUpdateMember`, `useDeactivateMember`).
- **`useSessions.ts`**: Interacts with `/sessions`. Fetches all sessions (`useSessions`), specific session details (`useSession`), active dashboard session (`useCurrentSession`), and provides actions like status updates (`useUpdateSessionStatus`), team generation (`useGenerateTeams`), statistics gathering (`useSessionStats`), penalty preview (`useSettlementPreview`), and finalization (`useFinalizeSession`).

### 2.5. `/components` (Shared UI Elements)
Elements used globally across different pages.
- **`/ui/`**: Reusable generic atoms (often wrappers around Radix UI):
  - `badge.tsx`, `button.tsx`, `card.tsx`, `checkbox.tsx`, `dialog.tsx`, `input.tsx`, `label.tsx`, `select.tsx`, `sheet.tsx`, `skeleton.tsx`, `table.tsx`, `tooltip.tsx`.
- **`AuthGuard.tsx`**: Wrapper route that redirects unauthenticated users to `/login`.
- **`Sidebar.tsx`**: The main left-side navigation menu logic and layout.
- **`PageHeader.tsx`**: Standardized header used at the top of main pages.
- **`WarningBanner.tsx`**: Colored banner component for alerts (warnings, errors, info) heavily used on the Dashboard.
- **`StatusBadge.tsx`**: Renders colored labels representing session statuses (`PREP`, `OPS`, etc.).
- **`ScoreDisplay.tsx`**: Visual component highlighting member scores (+/-).
- **`GrantMeritDialog.tsx`**: Dialog popup to give/deduct scores for selected members.
- **`MemberAddSheet.tsx` / `MemberEditSheet.tsx`**: Slide-out panels for member CRUD operations.

### 2.6. `/pages` (Route Components)
The primary views mapped directly to URLs.

**Main Views:**
- **`LoginPage.tsx`** (`/login`): Authentication form.
- **`Dashboard.tsx`** (`/dashboard`): Status overview. Shows Naver session status, active warnings (low deposit, streak candidates, eviction risks), and a summary card for the current/upcoming active session.
- **`Members.tsx`** (`/members`): Data table listing all members with tools to filter, add, edit, and deactivate.
- **`MemberDetail.tsx`** (`/members/:id`): Deep dive into a single member's history, scores, and personal ledger.
- **`Ledger.tsx`** (`/ledger`): Unified financial ledger view showing every transaction across the organization, supporting date/type filtering and manual transaction creation.
- **`SessionList.tsx`** (`/sessions`): Kanban-like or grid card view of all historical and upcoming sessions.

**Session Creation Wizard (`/pages/wizard/`)** (`/sessions/new`):
- **`SessionWizard.tsx`**: The parent wrapper managing multi-step state.
- **`StepBasic.tsx`**: Step 1 - Session title, date, type input.
- **`StepTeamBuilding.tsx`**: Step 2 - Dynamic team allocation algorithm/UI (if type is `TEAM`).
- **`StepConfirmation.tsx`**: Step 3 - Final review before creating the session.
- **`types.ts`**: TypeScript definitions for the wizard state.

**Detailed Session Management (`/pages/session/`)** (`/sessions/:id`):
- **`SessionLayout.tsx`**: The main shell for a specific session. Renders the top title and the 4 navigation tabs (Prep, Ops, Post, Settlement).
- **`PrepTab.tsx`** (`.../prep`): Pre-session phase. Manages team finalization and transitions status to `OPS`.
- **`OpsTab.tsx`** (`.../ops`): Live session phase. Used during the meeting. Monitors attendance.
- **`AttendanceGrid.tsx`**: Shared component used likely in OpsTab to display visual grid or list of who is present/absent/late.
- **`PostTab.tsx`** (`.../post`): Post-session automation phase. Triggers the ARQ crawler tasks: "Scan PPT", "Scan Homework", "Upload Videos".
- **`SettlementTab.tsx`** (`.../settlement`): Final financial phase. Fetches `useSettlementPreview` to show calculated score deductions and deposit fines. Contains the "Finalize Session" button that makes permanent changes to the Ledger.

---

## 3. Design Philosophy & Development Rules

1.  **State is Server-Driven**: Do NOT utilize `useState` or `useEffect` to manually fetch and store API data. Always use the hooks inside `/hooks/` (React Query). If a new API endpoint is added to the backend FastApi, replicate its definition in the corresponding hook file.
2.  **Color System**: Rely on `--color-surface`, `--color-base`, `--color-text-*`, `--color-border`, and `--color-accent` variables. Avoid raw hex values or standard Tailwind colors (e.g., `bg-blue-500`) unless explicitly designing an alert/status badge.
3.  **Authentication**: If building a new feature requiring auth data, use `useAuth()` from `context/AuthContext.tsx`. Axios interceptors automatically handle the `Bearer` token injection.
4.  **Routing Updates**: When adding a new view, place the component in `/pages/`, then register the `<Route>` element inside the `DashboardLayout` in `App.tsx`. If it is a Session sub-tab, register it inside the `SessionLayout` routes.
