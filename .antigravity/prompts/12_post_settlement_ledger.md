# Phase 12: Post/Settlement 탭 + Ledger 페이지
> 참조: `docs/spec_workflow.md` (STEP 8~9), `docs/design.md` (섹션 5-4, 5-5)
> 모델: **claude-sonnet-4-5**
> 예상 소요: 3시간

---

## 작업 목표

과제 스캔 탭, 정산 Preview 탭, Ledger 페이지를 구현한다.
Settlement 탭의 면제 체크박스 로직이 핵심.

---

## 핵심 제약

### Settlement Preview 면제 체크박스
```typescript
// 체크 해제 → skip=true → 해당 페널티 합계에서 제외
// 낙관적 업데이트: API 호출 없이 로컬 상태로 즉시 합계 재계산
// [Finalize Session] 클릭 시 overrides 배열 전송:
// overrides: [{member_id, skip_types: ["PPT", "HOMEWORK"]}]
```

### MILESTONE_FINE 행 강조
```typescript
// line.type === "MILESTONE_FINE" → 배경 bg-yellow-dim/25
// "⚠" 접두사 표시
// 면제 체크박스로 건너뛸 수 없음 (disabled)
```

### Finalize 확인 모달
```typescript
// "되돌릴 수 없습니다. 계속하시겠습니까?" 
// 총 차감액, 총 벌점 표시
// 확인 → POST /sessions/{id}/finalize
// 성공 → toast.success("Week N 정산 완료")
```

### FINALIZED 후 수동 수정
```typescript
// FINALIZED 세션 상단에 잠금 배너 표시
// 출결 드롭다운은 여전히 조작 가능 (ADJUSTMENT ledger 자동 생성)
// 수정 시 "⚠ 정산 완료 후 수정" 인라인 경고
```

---

## 수행 작업 목록

1. **`pages/PostTab.tsx`**
   - [Scan Homework] 버튼 → POST /crawler/scan-homework
   - TaskProgressPanel 연동
   - 스캔 결과 테이블: 멤버 × (리뷰/과제/피드백) 상태
   - 각 셀 StatusBadge 클릭 → 수동 토글 (PASS ↔ MISSING)

2. **`pages/SettlementTab.tsx`** (`docs/design.md` 섹션 5-4 참조)
   - GET /sessions/{id}/settlement-preview 로 데이터 로드
   - PenaltyPreviewTable: 체크박스, MILESTONE_FINE 강조, 합계 footer
   - 면제 상태는 local state로 관리 (서버 전송은 Finalize 시에만)
   - [Finalize Session] → 확인 Dialog → POST finalize

3. **`pages/Ledger.tsx`**
   - 필터: 멤버, 타입 배지, 기간
   - 테이블: 날짜, 멤버, 타입 배지, 설명, 벌점, 차감, 잔액
   - [Grant Merit] 버튼 (상단)
   - [수동 조정] 버튼 → Sheet (DEPOSIT_RECHARGE, DEPOSIT_ADJUST)

---

## 완료 조건

```
1. Post 탭 → 스캔 결과 테이블 표시
2. 결과 셀 클릭 → PASS ↔ MISSING 토글 (즉시 저장)
3. Settlement 탭 → 페널티 목록 표시
4. 체크박스 해제 → 합계 즉시 변경 (API 호출 없이)
5. MILESTONE_FINE 행 → 노란 배경, 체크박스 disabled
6. Finalize 버튼 → 확인 Dialog → 처리 → toast.success
7. Ledger 페이지 → 타입 필터 작동
8. FINALIZED 세션 → 잠금 배너 표시
```
