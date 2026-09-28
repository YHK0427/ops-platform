# 기수 포털 사유서 제출 — 설계

## 배경

이번 기수는 사전·사후 사유서를 네이버 카페 게시판이 아니라 카톡으로 개별 제출받는다.
카페에 공개로 올리면 "누가 빠지네, 나도 빠져야지" 하는 연쇄 불참이 생겨서다.
카톡으로 받은 사유서는 운영진이 손으로 출결에 옮겨야 한다.

기수 포털에서 사유서를 직접 내고, 그게 세션 출결에 자동 반영되게 한다.
기수원끼리는 서로의 사유서를 볼 수 없다.

## 목표

- 기수원이 포털에서 사전/사후 사유서를 낸다.
- 세션이 아직 없어도 날짜 기준으로 받아 둔다.
- 세션이 생성되면 그 날짜의 사유서가 즉시 연결·반영된다.
- 세션이 있으면 제출 즉시 반영된다.
- 반영 결과는 카페 사유서와 같은 자리(출결표의 사유서 드롭다운 + 클립보드 아이콘)에 보인다.
- 인정사유는 운영진이 승인해야 공결(EXCUSED)이 된다.

## 범위 밖

- 카페 사유서 스캔(`services/crawler_excuse.py`, `/crawler/scan-excuses`)은 **수정하지 않는다**.
  같은 사람을 카페 스캔이 다시 긁으면 카페 내용으로 덮어써진다. 이번 기수는 카페를
  쓰지 않으므로 받아들인다.
- 운영진 푸시 알림, 세션 날짜 변경 대응(날짜 수정 API가 없음).

## 마감 규칙

기존 규칙을 그대로 쓴다. 대상 날짜 = 세션 날짜.

| 구분 | 기간 |
|---|---|
| 사전(PRE) | 제출 시각 ≤ 대상 날짜 전날 21:59:59 KST |
| 사후(POST) | 그 이후 ~ 대상 날짜 다음날 21:59:59 KST |
| 제출 불가 | 다음날 21:59:59 KST 이후. 날짜 선택기에서 고를 수 없고 서버도 422 |

사후 마감이 지나면 포털로는 낼 수 없다(카톡으로 운영진에게 직접).

사전/사후는 기수원이 고르지 않는다. 서버가 **최초 제출 시각**으로 판정하고, 수정해도 바뀌지 않는다.

## 데이터

새 테이블 `excuse_submissions`.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | int PK | |
| cohort_id | int FK cohorts, not null | 기수 격리 |
| member_id | int FK members, not null | 제출자 |
| target_date | date, not null | 빠지는 세션 날짜 |
| excuse_type | 'PRE' \| 'POST' | 서버 판정 |
| category | 'ABSENT' \| 'LATE' \| 'EARLY_LEAVE' | 결석 / 지각 / 조퇴 |
| reason_kind | 'NORMAL' \| 'RECOGNIZED' | 일반사유 / 인정사유 |
| reason | text, not null | 사유 본문 (최대 2000자) |
| review | NULL \| 'PENDING' \| 'APPROVED' \| 'REJECTED' | 인정사유일 때만. 생성 시 PENDING |
| reviewed_by | varchar, null | 운영진 username |
| reviewed_at | timestamptz, null | |
| session_id | int FK sessions ON DELETE SET NULL, null | 연결된 세션 |
| created_at / updated_at | timestamptz | |

제약: `UNIQUE(member_id, target_date)` — 한 사람 한 날짜 1건. 다시 내면 수정이다.

## 증빙자료

- 선택 사항. 사진만(jpg/png/webp/gif), 사유서 1건당 5장, 장당 10MB.
- 형식은 파일 앞 바이트로 판별한다(확장자·브라우저 content-type 불신). 위장 SVG/HTML 차단.
- 테이블 `excuse_attachments(id, submission_id FK CASCADE, stored_name, original_name, content_type, size, created_at)`.
- 파일은 `/app/files/uploads/excuse` 에 비공개 저장. 공지 이미지(`/notifications/img`)처럼 링크로 열리지 않는다.
- 받기: 기수원 `GET /portal/excuses/{id}/attachments/{aid}`(본인만), 운영진 `GET /excuses/{id}/attachments/{aid}`(같은 기수만). 응답은 `inline` + `CSP sandbox` + `nosniff` + `no-store`.
- 올리기/지우기: 기수원 `POST|DELETE /portal/excuses/{id}/attachments[/{aid}]`, 수정 가능 기간에만.
- 화면: 기수원 폼·목록, 대시보드 사유서 행, 출결표 클립 아이콘·공결 요청 팝오버. 썸네일, 누르면 크게 보기.
- 사유서 취소 시 파일도 삭제.

## 반영 규칙 — `services/portal_excuse.py: apply_submission(db, sub, attendance)`

하나의 함수가 제출 1건을 출결 1행에 반영한다. 모든 반영 경로가 이 함수만 쓴다.

1. 세션이 FINALIZED 면 아무것도 하지 않는다.
2. `attendance.excuse_type = sub.excuse_type`
3. `attendance.excuse_text` = 헤더 + 본문. 예:
   ```
   [포털] 결석 · 사전 · 인정사유(승인 대기)
   제출 2026-09-29 14:03
   ---
   <사유>
   ```
4. 출결 상태:
   - 인정사유 + APPROVED → `EXCUSED`
   - 그 외 → category 에 해당하는 상태(`ABSENT` / `LATE_UNDER10` / `EARLY_LEAVE`).
     단 현재 상태가 `PENDING`, `PRESENT`, 또는 이전에 이 함수가 세팅한 값일 때만 바꾼다.
     운영진이 당일 직접 찍은 지각(10분 이상) 등은 덮지 않는다.
   - 반려(REJECTED)로 바뀌면 `EXCUSED` 였던 것을 category 상태로 되돌린다.

"이전에 이 함수가 세팅한 값" 판정: 반영 직전 출결 상태가 `EXCUSED` 이거나 category 상태와
같으면 이 함수 소관으로 본다. 지각은 `LATE_UNDER10` 으로 세팅한다(정확한 분은 당일 운영진이 조정).

## 반영 시점

| 시점 | 동작 |
|---|---|
| 기수원 제출·수정 | 같은 기수에 `date == target_date` 인 세션이 있으면 `session_id` 연결 + 반영 |
| 세션 생성(`POST /sessions`) | 출결 행 생성 직후, 같은 기수·같은 날짜 제출 전부 연결 + 반영 |
| 공결 승인/반려 | 연결된 세션이 있으면 다시 반영 |
| 기수원 취소 | 연결된 출결의 `excuse_type`, `excuse_text` 비움. 출결 상태는 건드리지 않음 |

## 수정·취소 허용 기간 (기수원)

- 사전 제출: 전날 21:59:59 KST 까지
- 사후 제출: 다음날 21:59:59 KST 까지
- 세션이 FINALIZED 면 불가
- 인정사유가 이미 승인/반려됐으면 불가

## API

기수원 (`get_current_member`):
- `GET  /portal/excuses` — 내 제출 목록
- `POST /portal/excuses` — 제출. body: `target_date, category, reason_kind, reason`. 같은 날짜 있으면 409
- `PUT  /portal/excuses/{id}` — 수정 (category, reason_kind, reason)
- `DELETE /portal/excuses/{id}` — 취소
- `GET  /portal/excuses/preview?date=YYYY-MM-DD` — "지금 내면 사전/사후" 판정 결과 (마감 지난 날짜면 null)

운영진 (`require_staff`, 현재 기수 스코프):
- `GET  /excuses?from=&to=` — 대시보드용 목록 (세션 연결 여부 포함)
- `POST /excuses/{id}/review` — body: `decision: APPROVED | REJECTED`

세션 상세 응답의 출결 행에 `portal_excuse: { id, reason_kind, review } | null` 를 붙인다.

## 화면

**기수 포털 — 내 출결 (`MemberAttendance.tsx`)**
- 상단 "사유서 제출" 버튼 → 폼: 날짜, 결석/지각/조퇴, 일반사유/인정사유, 사유.
- 날짜 선택기 최솟값 = 사후 마감이 아직 안 지난 가장 이른 날짜(KST 22시 전이면 어제, 이후면 오늘). 그보다 이른 날짜는 고를 수 없다.
- 날짜를 고르면 "지금 내면 사전사유서로 접수됩니다" / "사후사유서로 접수됩니다" 표시.
- 아래 "내 사유서" 목록: 날짜·유형·사전/사후·상태(접수됨 / 세션 반영됨 / 인정사유 승인 대기·승인·반려). 허용 기간 안이면 수정·취소 버튼.

**운영진 — 대시보드 (`Dashboard.tsx`)**
- "사유서" 섹션: 오늘 기준 앞뒤 기간의 제출을 날짜별로 묶어 표시. 세션 미생성 건은 "세션 생성 전" 표시.
- 인정사유 PENDING 건은 승인/반려 버튼. 처리 대기 건수를 섹션 제목에 표시.

**운영진 — 출결표 (`AttendanceGrid.tsx`)**
- 기존 사유서 드롭다운·클립보드 그대로. 포털 인정사유 PENDING 이면 클립보드 옆 "공결 요청" 배지 + 승인/반려.

## 권한·보안

- 기수원은 자기 제출만 조회·수정. `member_id` 는 토큰에서만 가져온다.
- 운영진은 자기 기수 제출만. super-admin 은 선택 기수 기준(기존 `get_current_cohort_id`).
- 사유 본문은 개인정보라 기수원 간 노출 경로 없음. 감사 로그 훅은 기존대로 자동 기록.

## 검증

- 백엔드 테스트 1개 파일: 사전/사후/제출 불가 판정 경계값, 세션 생성 시 일괄 연결·반영, 승인/반려에 따른 상태 전환.
- 브라우저: 기수원 제출(세션 없음) → 운영진 세션 생성 → 출결표 반영·클립보드 확인 → 대시보드에서 인정사유 승인 → 공결 반영.
- `npm run build`(tsc -b) 통과.
