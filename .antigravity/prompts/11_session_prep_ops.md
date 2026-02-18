# Phase 11: Session Wizard + Prep/Ops 탭
> 참조: `docs/spec_workflow.md` (STEP 1~7), `docs/design.md` (섹션 5-3, 5-6)
> 모델: **claude-sonnet-4-5**
> 예상 소요: 4시간

---

## 작업 목표

세션 생성 Wizard, Prep 탭(출결+PPT스캔), Ops 탭(영상+상점)을 구현한다.

---

## 핵심 제약

### Session Wizard (3단계)
```
Step 1: 기본 설정 (week_num, title, date, type, config)
        - title 입력 시 영상 제목 미리보기 표시:
          "{week_num}주차_{title}_{발표자명}"
Step 2: 팀빌딩 (type=TEAM일 때만)
        - @dnd-kit Kanban UI
        - [Auto Generate] → POST /sessions/{id}/teams/generate
        - 충돌 경고 카드에 노란 테두리
Step 3: 확인 → POST /sessions
        - type=INDIVIDUAL이면 Step 2 스킵
```

### AttendanceGrid 드롭다운 즉시 저장
```typescript
// 변경 즉시 PATCH /sessions/{id}/attendance/{mid}
// 저장 중: 해당 행에 인라인 스피너
// 저장 실패: 값 롤백 + 인라인 에러
// excuse_type 드롭다운: isAfterExcuseDeadline(session.date) → disabled
// isAfterExcuseDeadline: session.date(토) + 1일 22:00 이후 true
```

### 크롤러 태스크 폴링
```typescript
// TaskProgressPanel: useQuery refetchInterval
// status === "pending" → 2초마다 폴링
// status === "done" → 폴링 중지, 결과 표시
// status === "failed" + "세션" 포함 → "재로그인" 링크 표시
```

### D+1 업로드 경고
```typescript
// session.date + 1일이 오늘이면 "오늘 자정까지 업로드 권장" 경고 표시
```

---

## 수행 작업 목록

1. **`pages/SessionWizard.tsx`**
   - 3단계 Wizard UI
   - Step 2 팀빌딩 Kanban (`docs/design.md` 섹션 5-6 참조)
   - MemberChip: tags 배지, leader=accent, 충돌=노란 테두리

2. **`pages/SessionLayout.tsx`**
   - `Outlet` + 탭 네비게이션 (Prep / Ops / Post / Settlement)
   - FINALIZED 세션 → 상단 잠금 배너

3. **`pages/PrepTab.tsx`**
   - AttendanceGrid (`docs/design.md` 섹션 5-3 참조)
   - PPT 스캔 패널 (regular / late 모드 버튼)
   - TaskProgressPanel 연동

4. **`pages/OpsTab.tsx`**
   - [Upload to Cafe] 버튼 → POST /crawler/upload-videos
   - 업로드 진행 파일 목록 (파일명 + 게시글 제목 표시)
   - D+1 마감 경고 배너
   - [Grant Merit] 버튼 → MeritGrantSheet

---

## 완료 조건

```
1. Session Wizard 3단계 진행 → 세션 생성 확인
2. INDIVIDUAL 타입 → Step 2 스킵 확인
3. TEAM 타입 → Kanban에서 드래그&드롭 작동
4. Prep 탭 → 출결 드롭다운 변경 즉시 저장 (스피너 확인)
5. excuse_type 드롭다운 → 마감 후 disabled 표시
6. PPT 스캔 버튼 → 진행상황 폴링 확인
7. Ops 탭 → D+1 경고 배너 표시 (날짜 조건 충족 시)
```
