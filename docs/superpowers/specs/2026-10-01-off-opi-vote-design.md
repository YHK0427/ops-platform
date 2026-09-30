# 오프·오피 투표 — 설계 · 구현 계획 · 검증 계획

## 1. 요구사항 (사용자 확정)

- 매 세션 오프(오늘의 프레젠터)·오피(오늘의 PPT)를 **기수원 투표로만** 뽑는다.
- 분반이 나뉘어 있으면 **분반별로** 따로 투표. 분반이 없으면 전체 한 번.
- 운영진이 **출석(PREP) 탭**에서 연다. 기존 "PPT 이메일 스캔" 카드를 빼고 그 자리에 투표 카드.
  카드에는 상태 요약 + 버튼, 확인·조작은 **큰 모달**에서.
- 후보: 운영진이 열 때 직접 고름(기본값 = 그 분반 오늘 출석자 전원 체크).
- 투표권: 그 분반의 오늘 출석자(결석·공결 제외). 출결이 바뀌면 투표권도 즉시 따라감.
- 1인 오프 1표 + 오피 1표, 본인 투표 불가, 마감 전까지 수정 가능.
- 결과는 운영진만. 실시간 득표 + 누가 누구를 찍었는지까지. 기수원에게는 결과 비공개.
- 닫으면 1등을 정산 단계 상점 목록(staged_merits)에 "오프/오피 선정" +1로 올림.
  안내문: "정산 단계 상점 목록에 추가되었습니다. 세션을 정산하면 상점이 적용됩니다."
- 한 사람이 오프·오피 둘 다 1등이면 상점 +2(부문별 따로).
- 동률이면 부문별로 운영진에게 묻는다: **동률자끼리 재투표** 또는 **동률자 모두 정산에 올리기**.
  재투표에서 또 동률이면 같은 질문 반복.
- 닫은 투표 다시 열기 가능 → 그 투표(와 그 뒤 재투표)가 올린 상점은 정산 목록에서 빠지고, 다시 닫으면 새 결과로 올라감.
- 기수 포털: 홈 맨 위 배너(새로고침 없이 즉시 뜨고 사라짐), 열릴 때 푸시 알림, 누르면 투표 화면.
- 세션이 FINALIZED 면 열기·다시 열기·수정 불가.

## 2. 데이터

```
session_votes
  id, session_id(FK sessions, CASCADE), group_num(NULL=전체), round(1=본투표, 2+=재투표),
  parent_id(FK session_votes, CASCADE — 재투표의 원 투표),
  candidates JSONB {"OFF":[member_id...], "OPI":[...]}   -- 재투표는 동률 난 부문만 키가 있음
  is_open bool, result JSONB NULL  -- 닫을 때 {"OFF":{"winners":[ids],"tie":bool,"resolved":"auto|all|runoff|null"}, ...}
  opened_at, closed_at, created_at

session_vote_ballots
  id, vote_id(FK CASCADE), voter_member_id(FK members), category('OFF'|'OPI'), candidate_member_id(FK members), updated_at
  UNIQUE(vote_id, voter_member_id, category)
```

- staged_merits 항목에 `"vote_id"` 키를 추가해 출처를 표시. 사유는 `"오프/오피 선정 (오프)"` / `"오프/오피 선정 (오피)"`
  (엑셀 내보내기는 `"오프/오피 선정"` 부분일치라 그대로 집계됨). 정산 미리보기·마감은 추가 키를 무시.
- 집계는 **현재 투표권이 있는 사람의 표만** 센다(나중에 결석 처리된 사람 표는 빠짐).

## 3. API

운영진 (`require_staff`, 기수 격리):
- `GET  /sessions/{sid}/votes` → 분반 목록, 분반별 투표 체인(라운드순), 후보·집계·표 목록·투표권자(투표 여부)
- `POST /sessions/{sid}/votes` `{group_num, candidates:[ids]}` → 본투표 열기 (같은 분반 본투표가 있으면 409)
- `PUT  /session-votes/{id}/candidates` `{candidates:[ids]}` (열려있을 때, 본투표만) → 빠진 후보의 표 삭제
- `POST /session-votes/{id}/close` → 집계, 동률 없는 부문은 staged 에 올림, 동률 부문은 result.tie=true 로 대기
- `POST /session-votes/{id}/resolve` `{"OFF":"runoff"|"all", "OPI":...}` → all: 동률자 모두 staged, runoff: 동률 부문만 후보로 새 라운드 열기
- `POST /session-votes/{id}/reopen` → 이 투표와 하위 재투표가 올린 staged 제거, 하위 재투표 삭제, 다시 열기
- `DELETE /session-votes/{id}` → staged 제거 후 삭제(하위 포함)

기수원 (`get_current_member`):
- `GET /session-votes/member/open` → 내가 투표권 있는 열린 투표 목록(후보에서 본인 제외, 내 표)
- `PUT /session-votes/member/{id}/ballot` `{"OFF":id|null, "OPI":id|null}` → 검증(열림·투표권·후보·본인X) 후 upsert

실시간 WS: `GET /session-votes/ws?token=..&cohort=..` — 방 = 기수.
- `vote.changed` (열기/닫기/재열기/후보수정/정리/출결변경) → 운영진·기수원 모두 → 다시 조회
- `vote.ballot` (표 변경) → 운영진만
- 출결(status·group_num) 변경 시 roster_hook 이 열린 투표가 있는 세션이면 `vote.changed` 방송.
- 기존 live_feedback_ws.ConnectionManager 를 채널 이름만 바꿔 재사용. nginx 에 WS location 추가.

푸시: 열 때(본투표·재투표) 그 투표의 투표권자에게 `{"title":"오프·오피 투표가 열렸어요"...,"url":"/member/vote"}`.

## 4. 화면

운영진 — PrepTab:
- "PPT 이메일 스캔" 카드 제거(수동 PPT 토글·서버 코드·사유서 스캔 카드는 유지).
- "오프·오피 투표" 카드: 분반별 한 줄 상태(열림 N/M명 투표 · 닫힘 · 동률 대기) + `투표 관리` 버튼.
- 모달(큰 창): 분반 탭. 각 분반:
  - 없음: 후보 체크 목록(기본 출석자 전원) + `투표 열기`.
  - 열림: 부문별 득표 막대(실시간), 투표 진행 x/y, 미투표자 명단, 표 목록(투표자 → 오프/오피), `후보 수정`, `투표 닫기`.
  - 닫힘: 부문별 1등(상점 올림 안내), 동률이면 부문별 [동률자 재투표]/[모두 정산에 올리기], `다시 열기`, `삭제`.
  - 재투표 라운드는 같은 분반 안에 "2차 재투표"로 이어서 표시.

기수 포털:
- 홈 맨 위 배너 "오프·오피 투표 진행 중" → `/member/vote`.
- 투표 화면: 부문별 후보 카드 한 명 선택, 저장, 마감 전 수정 가능. 닫히면 "투표가 마감되었습니다".
- MemberLayout 에서 WS 1개 유지 → `vote.changed` 받으면 open 쿼리 무효화.

## 5. 구현 순서

1. 모델 + 마이그레이션(`c9d0e1f2a3b5`)
2. 서비스 `services/session_vote.py`: 투표권자 계산, 집계, staged 추가/제거
3. 라우터 `routers/session_votes.py` + main 등록 + WS 매니저 + roster_hook 연동 + nginx
4. 백엔드 검증 스크립트(아래 A~F)
5. 프론트 훅 `useSessionVotes.ts`, 운영진 모달 `SessionVoteDialog.tsx`, PrepTab 카드 교체
6. 기수 포털 `MemberVote.tsx`, 홈 배너, WS 훅, 라우트
7. 화면 검증(Playwright, PC+모바일 스크린샷), `npm run build`, 커밋

## 6. 검증 계획

백엔드 (스크립트, dev DB):
- A 열기: 정상 / 같은 분반 두 번(409) / FINALIZED(400) / 후보 1명 이하(422) / 다른 기수 세션(404) / 비운영진(403)
- B 투표: 정상 / 수정 덮어쓰기 / 본인(422) / 후보 아님(422) / 다른 분반 사람(403) / 결석·공결자(403) / 닫힌 투표(409) / 한 부문만 투표 / null 로 취소
- C 집계: 단독 1등 → staged 1건(사유·vote_id) / 오프·오피 같은 사람 → 2건 / 표 0개 부문 → 올림 없음 / 투표 후 결석 처리된 사람 표 제외
- D 동률: 닫기 → tie 대기, staged 없음 / all → 동률자 전원 staged / runoff → 2라운드 열림(후보=동률자, 해당 부문만) / 재투표도 동률 → 다시 선택 / 두 부문 다 동률 + 서로 다른 선택
- E 다시 열기·삭제: reopen → staged 제거·하위 재투표 삭제·표 유지 / 다시 닫기 → 새 결과 staged / 삭제 → staged 제거 / 수동 staged 상점은 건드리지 않음 / 후보 수정 → 빠진 후보 표 삭제
- F 연동: 정산 미리보기에 투표 상점 표시 / 세션 마감 → 장부 반영·엑셀 "오프/오피" 칸 / 분반 이동 → 투표권 바뀜 / 기수원 결과 조회 경로 없음(멤버 응답에 득표수 없음)
- G 실시간: 기수원 WS 가 열기·닫기 신호 수신 / 표 신호는 기수원에게 안 감 / 출결 변경 신호

화면 (Playwright, PC 1440 + 모바일 390, 스크린샷 공유):
- H 운영진: 카드(없음/열림/닫힘/동률) · 모달 열기·후보 체크 · 실시간 득표 증가 · 닫기 안내문 · 동률 선택 · 재투표 라운드 · 다시 열기 · 삭제 확인
- I 기수원: 새로고침 없이 배너 등장/사라짐 · 투표 화면 선택·저장·수정 · 본인 미노출 · 마감 후 화면 · 투표권 없는 사람은 배너 없음
- J 회귀: 사유서 스캔 카드 정상 · 정산 탭 상점 목록 체크 해제 동작 · 실시간 피드백 보드 명단 갱신 그대로 · 콘솔 에러 0
- K 빌드: `npm run build`(tsc -b), 백엔드 기존 테스트 스크립트
