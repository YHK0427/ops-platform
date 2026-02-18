# UnivPT Ops Platform — 디자인 가이드라인
> 개발 시 참고용 | Tailwind CSS + ShadcnUI + React 기준

---

## 1. 디자인 콘셉트: "작전 본부"

운영진이 쓰는 내부 도구다. 공개 서비스가 아니므로 **화려함보다 밀도와 가독성**이 최우선.
발표 시즌 규칙을 집행하는 플랫폼인 만큼, 느낌은 **군더더기 없는 지휘소**처럼.

> 키워드: `Dark`, `Dense`, `Precise`, `Functional`, `Controlled`

참고 레퍼런스:
- Linear (앱 전체 레이아웃, 좌측 사이드바, 미니멀 테이블)
- Vercel Dashboard (상태 배지, 다크 배경, 폰트 처리)
- Raycast (검색 인터페이스, 키보드 중심 UX)

---

## 2. 컬러 시스템

### 팔레트

```css
/* globals.css 에 등록 */
:root {
  /* Background */
  --bg-base:       #0C0C0F;   /* 최하단 배경 */
  --bg-surface:    #131318;   /* 카드, 패널 배경 */
  --bg-elevated:   #1C1C24;   /* 모달, 드롭다운 배경 */
  --bg-hover:      #22222C;   /* hover 상태 */

  /* Border */
  --border-subtle: #242430;   /* 기본 구분선 */
  --border-default:#2E2E3E;   /* 카드 테두리 */
  --border-strong: #3A3A50;   /* 강조 구분선 */

  /* Text */
  --text-primary:  #F0F0F5;   /* 주요 텍스트 */
  --text-secondary:#9090A8;   /* 보조 텍스트, 레이블 */
  --text-muted:    #55556A;   /* 비활성, placeholder */

  /* Accent — 딱 한 색 */
  --accent:        #6B5FFF;   /* 인디고-퍼플 */
  --accent-hover:  #5A4EE8;
  --accent-dim:    rgba(107, 95, 255, 0.13);

  /* Semantic */
  --green:      #22C55E;
  --yellow:     #F59E0B;
  --red:        #EF4444;
  --red-dim:    rgba(239, 68, 68, 0.12);
  --green-dim:  rgba(34, 197, 94, 0.12);
  --yellow-dim: rgba(245, 158, 11, 0.12);
}
```

### tailwind.config.ts 확장

```ts
import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base:    "var(--bg-base)",
        surface: "var(--bg-surface)",
        elevated:"var(--bg-elevated)",
        hover:   "var(--bg-hover)",
        border: {
          subtle:  "var(--border-subtle)",
          DEFAULT: "var(--border-default)",
          strong:  "var(--border-strong)",
        },
        text: {
          primary:   "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted:     "var(--text-muted)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          hover:   "var(--accent-hover)",
          dim:     "var(--accent-dim)",
        },
        green:  "var(--green)",
        yellow: "var(--yellow)",
        danger: "var(--red)",
      },
    },
  },
} satisfies Config;
```

### 색상 사용 규칙

| 상황 | 사용 |
|------|------|
| 기본 배경 | `bg-base` |
| 카드 / 테이블 | `bg-surface` |
| 모달 / 드롭다운 | `bg-elevated` |
| 행 hover | `hover:bg-hover/50` |
| 주요 CTA 버튼 | `bg-accent hover:bg-accent-hover text-white` |
| 보조 버튼 | `bg-elevated border border-border text-text-primary` |
| 위험 버튼 | `text-danger border-danger/30 hover:bg-red-dim` |
| PASS 배지 | `bg-green-dim text-green border border-green/20` |
| LATE / PENDING | `bg-yellow-dim text-yellow border border-yellow/20` |
| MISSING / ERROR | `bg-red-dim text-danger border border-danger/20` |

---

## 3. 타이포그래피

```html
<!-- index.html head에 추가 -->
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600&family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/variable/pretendardvariable.css" />
```

```css
/* globals.css */
body {
  font-family: 'Pretendard Variable', 'Geist', -apple-system, sans-serif;
  font-feature-settings: "tnum";  /* 숫자 고정폭: 점수/금액 세로 정렬 */
  background-color: var(--bg-base);
  color: var(--text-primary);
}

.mono {
  font-family: 'Geist Mono', monospace;
}
```

### 타입 스케일

| 역할 | 클래스 |
|------|--------|
| 페이지 타이틀 | `text-xl font-semibold text-text-primary` |
| 섹션 헤더 | `text-xs font-medium text-text-secondary uppercase tracking-widest` |
| 본문 | `text-sm text-text-primary` |
| 보조 텍스트 | `text-xs text-text-secondary` |
| 점수 / 금액 (수치) | `text-sm font-mono` |
| placeholder / 비활성 | `text-xs text-text-muted` |

---

## 4. 레이아웃 구조

### 전체 쉘

```
┌──────────────────────────────────────────────────┐
│ Sidebar (220px, fixed)  │  Main (flex-1, scroll) │
│                          │                        │
│ 로고                     │  PageHeader (sticky)   │
│ ──────                   │  ─────────────────     │
│ Dashboard                │  Content               │
│ Members                  │                        │
│ Ledger                   │                        │
│ Sessions ▾               │                        │
│   Week 20 (진행중)       │                        │
│   Week 19                │                        │
│ ──────                   │                        │
│ Settings / Naver         │                        │
└──────────────────────────────────────────────────┘
```

```tsx
// App 루트 레이아웃
<div className="flex h-screen bg-base text-text-primary overflow-hidden">
  <Sidebar />                          {/* w-[220px] shrink-0 border-r border-border */}
  <div className="flex-1 flex flex-col overflow-hidden">
    <PageHeader />                     {/* sticky top-0 z-10 h-12 */}
    <main className="flex-1 overflow-y-auto p-6 space-y-6">
      {children}
    </main>
  </div>
</div>
```

### Sidebar

```tsx
<aside className="w-[220px] h-full bg-surface border-r border-border flex flex-col py-3">
  {/* 로고 */}
  <div className="px-4 mb-5">
    <span className="text-sm font-semibold tracking-tight">
      UnivPT <span className="text-accent">Ops</span>
    </span>
  </div>

  {/* 메인 네비 */}
  <nav className="flex-1 px-2 space-y-0.5">
    <NavItem to="/"         icon={LayoutDashboard} label="Dashboard" />
    <NavItem to="/members"  icon={Users}           label="Members" />
    <NavItem to="/ledger"   icon={Wallet}          label="Ledger" />

    {/* 세션 섹션 */}
    <div className="pt-3 pb-1 px-3">
      <span className="text-xs text-text-muted uppercase tracking-widest">Sessions</span>
    </div>
    {recentSessions.map(s => (
      <NavItem key={s.id} to={`/sessions/${s.id}`}
        label={`Week ${s.week_num}`}
        sublabel={s.title}
        badge={<SessionStatusDot status={s.status} />}
      />
    ))}
    <NavItem to="/sessions/new" icon={Plus} label="새 세션" className="text-text-muted" />
  </nav>

  {/* 하단 */}
  <div className="px-3 pt-3 border-t border-border-subtle space-y-1">
    <NaverSessionIndicator />
    <NavItem to="/settings/naver" icon={Settings} label="Settings" />
  </div>
</aside>
```

```tsx
// NavItem 스타일
function NavItem({ to, icon: Icon, label, sublabel, badge, className }) {
  return (
    <NavLink to={to} className={({ isActive }) => cn(
      "flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors",
      isActive
        ? "bg-accent/10 text-accent font-medium"
        : "text-text-secondary hover:text-text-primary hover:bg-hover",
      className
    )}>
      {Icon && <Icon className="w-4 h-4 shrink-0" />}
      <span className="flex-1 truncate">{label}</span>
      {badge}
    </NavLink>
  );
}
```

---

## 5. 컴포넌트 명세

### 5-1. StatusBadge

```tsx
const BADGE = {
  PASS:        "bg-green-dim text-green border-green/20",
  LATE:        "bg-yellow-dim text-yellow border-yellow/20",
  MISSING:     "bg-red-dim text-danger border-danger/20",
  PENDING:     "bg-hover text-text-secondary border-border",
  PRESENT:     "bg-green-dim text-green border-green/20",
  ABSENT:      "bg-red-dim text-danger border-danger/20",
  EXCUSED:     "bg-accent/10 text-accent border-accent/20",
  LATE_UNDER10:"bg-yellow-dim text-yellow border-yellow/20",
  LATE_OVER10: "bg-yellow-dim text-yellow border-yellow/20",
  EARLY_LEAVE: "bg-yellow-dim text-yellow border-yellow/20",
  FINALIZED:   "bg-hover text-text-muted border-border-subtle",
} as const;

export function StatusBadge({ status }: { status: keyof typeof BADGE }) {
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border",
      BADGE[status]
    )}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

// 한글 레이블
const STATUS_LABEL = {
  PASS: "제출", LATE: "지각제출", MISSING: "미제출", PENDING: "미확인",
  PRESENT: "출석", ABSENT: "결석", EXCUSED: "인정결석",
  LATE_UNDER10: "지각(10분미만)", LATE_OVER10: "지각(10분이상)",
  EARLY_LEAVE: "조퇴", FINALIZED: "완료",
};
```

### 5-2. ScoreDisplay

```tsx
// 상점 +7 / 벌점 -5 / 총점 +2
export function ScoreDisplay({ plus, minus, net }: {
  plus: number; minus: number; net: number;
}) {
  const netCls =
    net <= -12 ? "text-danger font-bold" :
    net <= -8  ? "text-danger/70" :
    net <= -4  ? "text-yellow" : "text-text-primary";

  return (
    <div className="flex items-center gap-2 font-mono text-sm">
      <span className="text-green">+{plus}</span>
      <span className="text-text-muted text-xs">/</span>
      <span className="text-danger">{minus}</span>
      <span className="text-text-muted text-xs">=</span>
      <span className={netCls}>{net >= 0 ? `+${net}` : net}</span>
      {net <= -12 && (
        <span className="ml-1 text-xs px-1.5 py-0.5 rounded bg-red-dim text-danger border border-danger/20">
          퇴출대상
        </span>
      )}
      {net > -12 && net <= -8 && (
        <span className="ml-1 text-xs px-1.5 py-0.5 rounded bg-yellow-dim text-yellow border border-yellow/20">
          경고
        </span>
      )}
    </div>
  );
}
```

### 5-3. WarningBanner

```tsx
const BANNER_STYLE = {
  error:   "bg-red-dim border-danger/30 text-danger",
  warning: "bg-yellow-dim border-yellow/30 text-yellow",
  info:    "bg-accent/10 border-accent/30 text-accent",
};

export function WarningBanner({ level, message, action }: {
  level: "error" | "warning" | "info";
  message: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className={cn(
      "flex items-center justify-between px-4 py-2.5 rounded-lg border text-sm",
      BANNER_STYLE[level]
    )}>
      <span>{message}</span>
      {action && (
        <button onClick={action.onClick}
          className="ml-4 text-xs shrink-0 underline underline-offset-2 opacity-75 hover:opacity-100">
          {action.label} →
        </button>
      )}
    </div>
  );
}

// Dashboard에서 사용 예
<div className="space-y-2">
  {naverExpired && (
    <WarningBanner level="error" message="네이버 세션 만료"
      action={{ label: "재로그인", onClick: () => nav("/settings/naver") }} />
  )}
  {lowDepositMembers.map(m => (
    <WarningBanner key={m.id} level="warning"
      message={`${m.name} 디파짓 ${m.current_deposit.toLocaleString()}원 (재충전 필요)`}
      action={{ label: "처리", onClick: () => openRecharge(m) }} />
  ))}
  {streakCandidates.length > 0 && (
    <WarningBanner level="info"
      message={`연속출석 상점 대기 ${streakCandidates.length}명`}
      action={{ label: "승인", onClick: () => openStreak() }} />
  )}
</div>
```

### 5-4. AttendanceGrid

```tsx
// 출결표 — 드롭다운 변경 즉시 저장
// 사후사유서 마감(일요일 22:00) 이후 excuse_type 드롭다운 disabled

<div className="bg-surface rounded-lg border border-border overflow-hidden">
  <table className="w-full text-sm">
    <thead className="border-b border-border bg-elevated">
      <tr>
        {["이름", "출결 상태", "사유서", "비고"].map(h => (
          <th key={h} className="text-left px-4 py-2.5 text-xs text-text-secondary uppercase tracking-wider font-medium">
            {h}
          </th>
        ))}
      </tr>
    </thead>
    <tbody className="divide-y divide-border-subtle">
      {rows.map(row => <AttendanceRow key={row.member.id} {...row} />)}
    </tbody>
  </table>
</div>

function AttendanceRow({ member, attendance, excuseDeadlinePassed }) {
  const [saving, setSaving] = useState(false);

  return (
    <tr className="hover:bg-hover/40 transition-colors">
      <td className="px-4 py-2.5 font-medium text-text-primary">
        <div className="flex items-center gap-2">
          {member.name}
          {saving && <Loader2 className="w-3 h-3 animate-spin text-text-muted" />}
        </div>
      </td>
      <td className="px-4 py-2.5">
        <StatusSelect value={attendance?.status} onChange={...} />
      </td>
      <td className="px-4 py-2.5">
        <ExcuseSelect
          value={attendance?.excuse_type}
          disabled={excuseDeadlinePassed}
          onChange={...}
        />
        {excuseDeadlinePassed && (
          <span className="text-xs text-text-muted ml-1.5">마감</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-xs text-text-secondary">
        {attendance?.excuse_text ?? "—"}
      </td>
    </tr>
  );
}
```

### 5-5. Settlement Preview Table

```tsx
// MILESTONE_FINE 행은 배경 강조
// 면제 체크 해제 시 즉시 합계 재계산
// 면제된 행은 취소선 + 흐리게

<div className="bg-surface rounded-lg border border-border overflow-hidden">
  <table className="w-full text-sm">
    <thead className="bg-elevated border-b border-border">
      <tr>
        <th className="w-8 px-3 py-2.5" /> {/* 체크박스 */}
        <th className="text-left px-4 py-2.5 text-xs text-text-secondary uppercase tracking-wider">멤버</th>
        <th className="text-left px-4 py-2.5 text-xs text-text-secondary uppercase tracking-wider">항목</th>
        <th className="text-right px-4 py-2.5 text-xs text-text-secondary uppercase tracking-wider">벌점</th>
        <th className="text-right px-4 py-2.5 text-xs text-text-secondary uppercase tracking-wider">차감</th>
      </tr>
    </thead>
    <tbody className="divide-y divide-border-subtle">
      {flatLines.map(line => (
        <tr key={line.id} className={cn(
          "transition-colors",
          line.type === "MILESTONE_FINE"
            ? "bg-yellow-dim/25 hover:bg-yellow-dim/40"
            : "hover:bg-hover/40",
          line.skip && "opacity-35"
        )}>
          <td className="px-3 py-2.5">
            <Checkbox checked={!line.skip}
              onCheckedChange={v => toggleLine(line.id, !v)} />
          </td>
          <td className={cn("px-4 py-2.5 font-medium", line.skip && "line-through")}>
            {line.memberName}
          </td>
          <td className={cn("px-4 py-2.5 text-text-secondary", line.skip && "line-through")}>
            {line.type === "MILESTONE_FINE" && "⚠ "}
            {line.description}
          </td>
          <td className={cn("px-4 py-2.5 text-right font-mono", line.skip ? "text-text-muted" : "text-danger")}>
            {line.score_delta !== 0 ? line.score_delta : "—"}
          </td>
          <td className={cn("px-4 py-2.5 text-right font-mono", line.skip ? "text-text-muted" : "text-danger")}>
            {line.deposit_delta !== 0 ? `${line.deposit_delta.toLocaleString()}원` : "—"}
          </td>
        </tr>
      ))}
    </tbody>
    <tfoot className="border-t border-border-strong bg-elevated">
      <tr className="font-semibold">
        <td colSpan={3} className="px-4 py-3 text-text-secondary text-sm">합계</td>
        <td className="px-4 py-3 text-right font-mono text-danger">{totalScore}</td>
        <td className="px-4 py-3 text-right font-mono text-danger">{totalDeposit.toLocaleString()}원</td>
      </tr>
    </tfoot>
  </table>

  {/* Finalize 버튼 */}
  <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
    <button className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors">
      취소
    </button>
    <button
      onClick={openFinalizeModal}
      className="px-4 py-2 text-sm bg-accent hover:bg-accent-hover text-white rounded-md font-medium transition-colors"
    >
      Finalize Session
    </button>
  </div>
</div>
```

### 5-6. TeamBuilder Kanban

```tsx
// @dnd-kit/core + @dnd-kit/sortable
// 충돌 경고: 카드에 노란 테두리 + 텍스트

<div className="grid gap-3" style={{ gridTemplateColumns: `180px repeat(${numTeams}, 1fr)` }}>
  {/* 미배정 */}
  <div className="bg-surface border border-border rounded-lg p-3">
    <h3 className="text-xs text-text-muted uppercase tracking-wider mb-2">미배정</h3>
    <DroppableZone id="unassigned">
      {unassigned.map(m => <MemberChip key={m.id} member={m} />)}
    </DroppableZone>
  </div>

  {/* 팀 컬럼 */}
  {teams.map(team => (
    <div key={team.id} className="bg-surface border border-border rounded-lg p-3">
      <h3 className="text-xs font-medium text-text-primary mb-2">{team.name}</h3>
      <DroppableZone id={team.id}>
        {team.members.map(m => (
          <MemberChip key={m.id} member={m}
            hasCollision={collisions.some(c => c.includes(m.id))} />
        ))}
      </DroppableZone>
    </div>
  ))}
</div>

function MemberChip({ member, hasCollision = false }) {
  return (
    <div className={cn(
      "px-3 py-2 rounded-md border mb-1.5 cursor-grab active:cursor-grabbing transition-colors",
      hasCollision
        ? "border-yellow/40 bg-yellow-dim/20"
        : "border-border bg-elevated hover:border-border-strong"
    )}>
      <div className="text-sm font-medium text-text-primary">{member.name}</div>
      <div className="flex flex-wrap gap-1 mt-1">
        {member.tags.map(tag => (
          <span key={tag} className={cn(
            "text-xs px-1.5 py-0.5 rounded",
            tag === "leader"
              ? "bg-accent/15 text-accent"
              : "bg-hover text-text-muted"
          )}>
            {tag}
          </span>
        ))}
      </div>
      {hasCollision && (
        <p className="text-xs text-yellow mt-1">⚠ 과거 같은 팀</p>
      )}
    </div>
  );
}
```

### 5-7. 크롤러 태스크 진행 패널

```tsx
// 버튼 → 태스크 시작 → 실시간 폴링 → 완료 시 결과 표시
function ScanPanel({ label, onScan, taskId, result }) {
  return (
    <div className="space-y-3">
      <button
        onClick={onScan}
        disabled={!!taskId}
        className="flex items-center gap-2 px-4 py-2 text-sm bg-elevated border border-border hover:border-border-strong rounded-md transition-colors disabled:opacity-50"
      >
        {taskId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        {label}
      </button>

      {taskId && !result && (
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Loader2 className="w-4 h-4 animate-spin" />
          스캔 중...
        </div>
      )}
      {result?.status === "failed" && (
        <div className="text-sm text-danger">
          ✗ {result.error}
          {result.error?.includes("세션") && (
            <Link to="/settings/naver" className="ml-2 underline">재로그인 →</Link>
          )}
        </div>
      )}
    </div>
  );
}
```

### 5-8. 비디오 업로드 진행 표시

```tsx
// 구글 드라이브 → 카페 업로드 진행상황
// 각 파일별 상태 표시

{uploadResults.map(r => (
  <div key={r.file} className="flex items-center gap-3 text-sm">
    {r.success === undefined
      ? <Loader2 className="w-4 h-4 animate-spin text-text-muted shrink-0" />
      : r.success
      ? <CheckCircle2 className="w-4 h-4 text-green shrink-0" />
      : <XCircle className="w-4 h-4 text-danger shrink-0" />
    }
    <div className="flex-1 min-w-0">
      <p className="text-text-primary truncate">{r.file}</p>
      <p className="text-xs text-text-secondary truncate">{r.title}</p>
    </div>
    {r.success === false && (
      <button className="text-xs text-accent hover:underline shrink-0">재시도</button>
    )}
  </div>
))}

{/* D+1 마감 경고 */}
{showUrgencyWarning && (
  <div className="flex items-center gap-2 text-xs text-yellow mt-2">
    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
    오늘 자정까지 업로드 권장 (D+1 마감)
  </div>
)}
```

---

## 6. 인터랙션 원칙

### 저장 피드백 패턴

```
빈번한 변경 (드롭다운, 체크박스)
→ 낙관적 업데이트 → 인라인 스피너 → 실패 시 롤백 + 인라인 에러
→ ❌ 토스트 사용 금지

일회성 액션 (Finalize, Merit 부여, 세션 생성, Deactivate)
→ 확인 모달 → API 호출 → 성공 시 토스트
→ ✅ 토스트 사용
```

### 토스트 (sonner)

```tsx
import { toast } from "sonner";

// 성공
toast.success("Week 20 정산 완료")
toast.success(`${member.name} +${score}점 상점 부여`)

// 실패
toast.error("네이버 세션 만료 — 재로그인 필요")
toast.error("스캔 실패: " + errorMessage)

// Sonner 설정
<Toaster
  position="bottom-right"
  theme="dark"
  toastOptions={{
    style: {
      background: "var(--bg-elevated)",
      border: "1px solid var(--border-default)",
      color: "var(--text-primary)",
    }
  }}
/>
```

### 모달 vs Sheet

| 상황 | UI |
|------|-----|
| 파괴적 액션 (Finalize, Deactivate, Force 수정) | **Dialog (모달)** |
| 데이터 입력 (Merit 부여, 수동 트랜잭션, Add Member) | **Sheet (우측 슬라이드)** |
| 단순 확인/알림 | **Dialog (작은 것)** |

### FINALIZED 세션 잠금 표시

```tsx
{session.status === "FINALIZED" && (
  <div className="flex items-center gap-2 px-4 py-2 text-xs text-text-muted
                  bg-surface border-b border-border-subtle">
    <Lock className="w-3 h-3" />
    정산 완료된 세션입니다. 수정 시 Ledger에 자동 기록됩니다.
  </div>
)}
```

### 빈 상태 (Empty State)

```tsx
<div className="flex flex-col items-center justify-center py-16 text-center">
  <Icon className="w-8 h-8 text-text-muted mb-3 opacity-50" />
  <p className="text-sm text-text-secondary">{message}</p>
  {action && (
    <button onClick={action.onClick}
      className="mt-4 text-sm text-accent hover:underline">
      {action.label}
    </button>
  )}
</div>
```

---

## 7. 세션 상태 표시

```tsx
const SESSION_STATUS = {
  SETUP:      { label: "준비 중",  dotCls: "bg-text-muted" },
  PREP:       { label: "준비",    dotCls: "bg-accent" },
  OPS:        { label: "진행 중", dotCls: "bg-green animate-pulse" },
  POST:       { label: "후처리", dotCls: "bg-yellow" },
  SETTLEMENT: { label: "정산 중", dotCls: "bg-yellow animate-pulse" },
  FINALIZED:  { label: "완료",    dotCls: "bg-text-muted" },
};

function SessionStatusDot({ status }) {
  const s = SESSION_STATUS[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", s.dotCls)} />
      {s.label}
    </span>
  );
}
```

---

## 8. 페이지별 레이아웃 요약

### Dashboard
```
경고 배너 스택 (있을 때)
─────────────────────────────
현재 세션 카드 (넓게, 전체 너비)
  Week 20 · 개인발표세션 · [PREP]
  PPT 12/16  |  출결 처리중  |  과제 미스캔
                              [Session Manager →]
─────────────────────────────
연속출석 승인 대기 (있을 때)
─────────────────────────────
[최근 세션 목록]     [멤버 디파짓 현황 요약]
  2열 그리드
```

### Members
```
[검색]  [태그 필터: frontend x, design x]  [비활성 포함 □]    [+ Add]
─────────────────────────────────────────────────────────────────
이름 | 태그 | 디파짓 | 상점/벌점/총점 | 상태 | ⋯
─────────────────────────────────────────────────────────────────
각 행 클릭 → /members/:id 이동
```

### MemberDetail
```
← Back  김민준                        [Edit]  [Deactivate]
        [frontend] [기획]
────────────────────────────────────────────────
디파짓: ₩18,000  [재충전]  |  상점+7 / 벌점-5 / 총점+2
────────────────────────────────────────────────
Ledger 내역                   [Grant Merit]  [수동 조정]
날짜 | 타입 | 설명 | 벌점 | 차감 | 잔액
```

### Session Manager
```
← Sessions  Week 20 · 개인발표세션        [PREP]  [→ OPS]
──────────────────────────────────────────────────────────
[Prep]  [Ops]  [Post]  [Settlement]
──────────────────────────────────────────────────────────
탭 컨텐츠
```

### Ledger
```
[멤버 필터 ▾]  [타입 필터 ▾]  [기간 ▾]     [Grant Merit]  [수동 조정]
─────────────────────────────────────────────────────────────────────
날짜 | 멤버 | 타입 배지 | 설명 | 벌점 | 차감액 | 잔액
```

---

## 9. ShadcnUI 설정

```json
// components.json
{
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/index.css",
    "baseColor": "slate",
    "cssVariables": true
  }
}
```

```css
/* index.css — shadcn dark 오버라이드 */
.dark {
  --background:         0 0% 5%;
  --foreground:         240 10% 96%;
  --card:               240 6% 7%;
  --card-foreground:    240 10% 96%;
  --border:             240 6% 15%;
  --input:              240 6% 10%;
  --primary:            248 100% 69%;
  --primary-foreground: 0 0% 100%;
  --muted:              240 6% 13%;
  --muted-foreground:   240 5% 55%;
  --accent:             248 100% 69%;
  --ring:               248 100% 69%;
  --radius:             0.375rem;
}
```

필수 설치 컴포넌트:
```bash
npx shadcn@latest add button input select dialog sheet table
npx shadcn@latest add checkbox dropdown-menu badge toast tabs
```

추가 패키지:
```bash
npm install @dnd-kit/core @dnd-kit/sortable   # 팀빌더 드래그&드롭
npm install sonner                             # 토스트
npm install lucide-react                       # 아이콘
```

---

## 10. 개발 금지 / 필수 체크리스트

**하지 말 것:**
- `text-white`, `bg-white`, `bg-gray-*` 직접 사용 → CSS 변수 사용
- `shadow-*` 남용 → 어두운 테마에서 border로 구분
- 드롭다운 변경마다 토스트 → 인라인 스피너
- 과한 애니메이션 → `transition-colors`, `transition-opacity`만

**반드시 할 것:**
- 모든 수치 (점수, 금액) → `font-mono` 클래스
- 테이블 행 → `hover:bg-hover/40 transition-colors`
- 로딩 상태 → 항상 명시 (스켈레톤 or 인라인 스피너)
- FINALIZED 세션 → 상단 잠금 배너
- `excuse_type` 드롭다운 → 일요일 22:00 이후 `disabled`
- `<html>` 태그에 `class="dark"` 추가 (shadcn dark mode)

---

*디자인 가이드라인 끝 — 설계서 v4.0 FINAL과 함께 사용*
