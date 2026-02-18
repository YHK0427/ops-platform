# UnivPT Ops — 프론트엔드 구조 (B-10)
> 라우트 맵, 탭별 컴포넌트, 핵심 인터페이스

## B-10. 프론트엔드 전체 구조

### 라우트 맵

```tsx
<Routes>
  <Route path="/login" element={<LoginPage />} />
  <Route element={<AuthGuard />}>
    <Route path="/" element={<Dashboard />} />          {/* A-4 참고 */}
    <Route path="/ledger" element={<Ledger />} />
    <Route path="/members" element={<Members />} />
    <Route path="/members/:id" element={<MemberDetail />} />
    <Route path="/sessions/new" element={<SessionWizard />} />  {/* 3단계 */}
    <Route path="/sessions/:id" element={<SessionLayout />}>
      <Route index element={<Navigate to="prep" replace />} />
      <Route path="prep"       element={<PrepTab />} />       {/* STEP 2~5 */}
      <Route path="ops"        element={<OpsTab />} />        {/* STEP 6~7 */}
      <Route path="post"       element={<PostTab />} />       {/* STEP 8 */}
      <Route path="settlement" element={<SettlementTab />} /> {/* STEP 9 */}
    </Route>
    <Route path="/settings/naver" element={<NaverSessionSettings />} />
  </Route>
</Routes>
```

### 탭별 컴포넌트 책임

| 탭 | 주요 컴포넌트 | 주요 API |
|----|--------------|---------|
| **Prep** | AttendanceGrid, PPTScanPanel, ExcuseToggle | `GET/PATCH attendance`, `POST crawler/scan-ppt` |
| **Ops** | VideoUploadPanel, FileDropzone, MeritGrantModal | `POST crawler/upload-videos`, `POST ledger/merit` |
| **Post** | HomeworkScanPanel, AssignmentTable | `POST crawler/scan-homework`, `PATCH assignments/{id}` |
| **Settlement** | PenaltyPreviewTable, FinalizeModal | `GET settlement-preview`, `POST finalize` |

### 핵심 컴포넌트 인터페이스

```tsx
// AttendanceGrid: 드롭다운 즉시 저장 (낙관적 업데이트)
interface AttendanceRow {
  member: Member;
  status: AttendanceStatus;      // 드롭다운
  excuse_type: 'PRE'|'POST'|null; // 드롭다운
  excuse_text: string;           // 텍스트 입력
}
// PATCH /sessions/{id}/attendance/{mid} on change

// PenaltyPreviewTable: 체크박스로 면제 처리
interface PenaltySummaryItem {
  member: Member;
  team?: Team;
  lines: {
    type: string;
    description: string;
    score_delta: number;
    deposit_delta: number;
    skip: boolean;  // 체크 해제 = 면제
  }[];
  total_score: number;
  total_deposit: number;
  milestone_fine?: number;  // 별도 강조 표시
}

// TaskPoller: 크롤러 결과 실시간 폴링
const useTaskPoller = (taskId: string | null) =>
  useQuery({
    queryKey: ['task', taskId],
    queryFn: () => api.get(`/crawler/task/${taskId}`),
    refetchInterval: (data) => data?.status === 'pending' ? 2000 : false,
    enabled: !!taskId,
  });

// ScoreDisplay: 3분리 점수 표시
// 상점: +7 | 벌점: -5 | 총점: +2
// net_score ≤ -12: "퇴출 대상" 빨간 뱃지
// net_score ≤ -10: "경고" 노란 뱃지
```

---

