# Phase 10: Dashboard + Members 페이지
> 참조: `docs/design.md` (섹션 5-4, 8), `docs/spec_workflow.md` (A-4)
> 모델: **claude-sonnet-4-5**
> 예상 소요: 3시간

---

## 작업 목표

Dashboard와 Members 페이지를 구현한다.

---

## 핵심 제약

### Dashboard 경고 배너 우선순위
```
1. 🔴 네이버 세션 만료 (level="error")
2. 🔴 멤버 디파짓 10,000원 이하 (level="warning", 멤버별 1개씩)
3. 🟡 멤버 net_score <= -8 (level="warning")
4. 🔵 연속출석 승인 대기 (level="info")
```

### 저장 피드백 패턴
```
드롭다운/체크박스 변경 → 낙관적 업데이트 → 인라인 스피너
실패 시 값 롤백 + 인라인 에러
토스트는 일회성 액션(생성, Finalize, Merit)만
```

### Members 비활성화 모달
```
현재 디파짓 표시
"환불 처리 후 비활성화" 버튼 → DELETE /members/{id}
→ 서버에서 DEPOSIT_REFUND ledger 자동 생성
```

---

## 수행 작업 목록

1. **`pages/Dashboard.tsx`**
   - 경고 배너 스택 (WarningBanner 컴포넌트 재사용)
   - 현재 세션 카드: week_num, title, status, PPT/출결/과제 현황
   - `[Create New Session]` 버튼 → `/sessions/new`
   - 연속출석 승인 대기 카드 (streak-candidates API 연동)
   - `useQuery`로 `/sessions`, `/members`, `/crawler/naver/session-status` 폴링

2. **`pages/Members.tsx`**
   - 검색 (이름), 태그 필터, 비활성 포함 토글
   - 테이블: 이름, 태그 배지, 디파짓, ScoreDisplay, 상태, 액션
   - `[Add Member]` → Sheet 사이드패널 (MemberForm)
   - 각 행 클릭 → `/members/:id`

3. **`pages/MemberDetail.tsx`** (`docs/design.md` 섹션 5-8 레이아웃 참조)
   - 헤더: 이름, 태그 배지, [Edit], [Deactivate]
   - 디파짓 카드 + ScoreDisplay
   - Ledger 내역 테이블 (무한 스크롤 or 페이지네이션)
   - [Grant Merit] 버튼 → MeritGrantSheet
   - [Deactivate] → 비활성화 확인 모달 (현재 디파짓 표시)

4. **`hooks/useMembers.ts`**, **`hooks/useSessions.ts`**
   - TanStack Query hooks
   - 낙관적 업데이트 패턴

---

## 완료 조건

```
1. Dashboard 접속 → 경고 배너 표시 (네이버 세션 만료 시 빨간 배너)
2. Members 페이지 → 멤버 목록 표시
3. 멤버 추가 → Sheet 열림 → 저장 → 목록 갱신
4. 멤버 상세 → Ledger 내역 표시
5. 비활성화 → 확인 모달 → 처리 후 목록에서 숨김
6. ScoreDisplay에서 net_score <= -12 → "퇴출대상" 빨간 배지 표시
```
