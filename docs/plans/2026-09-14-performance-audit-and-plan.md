# 성능 전수 감사 + 개선 계획 (2026-09-14)

> 프론트(React/Vite)·백엔드(FastAPI/SQLAlchemy)·인프라(nginx/Docker) 전체를 실제 코드 기준으로 조사한 결과. 발견 순서가 아니라 **영향도(High/Medium/Low)** 기준으로 정리, 순차적으로 하나씩 처리한다.

## 이미 처리 완료

- **nginx gzip 압축 활성화** (`frontend/nginx.conf`) — 베이스 이미지(`nginx:1.25-alpine`)의 gzip 기본값이 off라 JS 번들(1MB+)·API JSON 응답이 전부 무압축으로 나가고 있었음. `gzip on` + text 계열 MIME 지정 + `gzip_proxied any`로 백엔드 프록시 응답까지 커버. 배포 대기 중.
- 폰트 FOUC/희귀 한글 미표시 — Paperlogy 빈 글리프 patch + 마운트 지연으로 해결·배포 완료 (별도 이슈, 이 문서 범위 아님).

---

## Phase 1 — High impact (다음 작업 대상)

| # | 위치 | 문제 | 조치 |
|---|------|------|------|
| 1 | `backend/app/routers/auth.py` login/member_login (오늘 이 세션에서 추가된 코드) | 기수 중복 아이디 판별을 위해 후보마다 `verify_password`(bcrypt) 순차 호출 — bcrypt는 CPU-bound라 이벤트 루프를 매 로그인마다 수백ms 블로킹. 동시 로그인이 몰리면 서버 전체가 멈춤. | `asyncio.to_thread(bcrypt.checkpw, ...)`로 감싸기. auth.py의 기존 `verify_password` 호출부(TOTP 등) 전체에 동일 적용. |
| 2 | `backend/app/services/penalty_engine.py:97-126` | `calculate_all()`이 활성 멤버 전원(30-90명)을 순회하며 멤버당 Attendance 1쿼리 + Assignment 1쿼리 → 세션당 최대 180쿼리. `get_settlement_preview`(운영진이 반복 조회)와 `finalize.py`(정산 확정) 양쪽에서 호출됨. | `session_id` 기준으로 Attendance/Assignment를 한 번씩만 조회 후 `member_id`로 그룹핑. |
| 3 | `backend/app/services/ledger_utils.py:9-36` (`recalculate_deposit_after`) | 호출마다 해당 멤버의 **전체 이력**을 재조회+재계산 (O(누적 건수)). `finalize.py`가 정산 대상 멤버 전원 루프 안에서 이 함수를 호출 → 시즌이 쌓일수록 최악 O(N²). ledger 개별 수정(merit/penalty/adjust) 엔드포인트도 매번 전체 재계산. | 마지막 `deposit_after`만 읽어 증분 계산. 최소한 finalize 시점엔 배치 처리로 전환. |
| 4 | `backend/app/models.py` `Ledger.member_id`, `Ledger.session_id` | 위 #3이 계속 필터하는 두 컬럼에 인덱스가 없음 — 누적 테이블(시즌 전체 이력)인데 매 조회가 풀스캔. | `Index("ix_ledger_member_id", "member_id")`, session_id 동일. alembic 마이그레이션 1개로 처리. |
| 5 | `backend/app/services/streak_checker.py:65-70` | `Ledger.description.startswith(PREFIX)` — 인덱스 없는 컬럼에 LIKE, **cohort 필터도 없이 전체 Ledger 테이블 스캔**. 정산 프리뷰/확정마다 호출됨. | description 대신 별도 boolean/enum 플래그 컬럼으로 관리하거나, 최소 cohort_id 필터 추가 + 부분 인덱스 검토. |
| 6 | `backend/app/routers/evaluation.py:1166-1200` | 라운드 결과(성장리포트) 조회 시 배정 멤버(30-90명)마다 SELF/AUDIENCE 응답을 개별 쿼리 — 멤버당 2쿼리, 최대 180쿼리. 결과 열람 페이지라 반복 접근 가능성 높음. | `EvalResponse`+`EvalAssignment`를 `presenter_member_id`/`eval_type` 기준으로 1회 조회 후 그룹핑. |
| 7 | `frontend/src/App.tsx:14-29` | `Dashboard, Members, MemberDetail, Ledger, SessionWizard, SessionLayout, PrepTab, OpsTab, PostTab, SettlementTab, TeamEditPage, GroupEditPage, AdminUsers, AdminCohorts, Treasury, SessionList`가 전부 즉시 import(eager) — 로그인 직후 진입점까지 포함해 1.09MB 메인 청크에 눌러 담김. `Announcements` 등 이미 `lazy()`로 잘 분리된 페이지들과 패턴이 다름. | 위 15개 페이지를 동일한 `lazy(() => import(...))` 패턴으로 전환 — 이미 적용된 다른 라우트 복붙 수준. |

## Phase 2 — Medium impact

| # | 위치 | 문제 | 조치 |
|---|------|------|------|
| 8 | `backend/app/routers/ledger.py:85-90` (`give_merit`) | `member_ids` 루프마다 `db.get(Member, mid)` 개별 조회. | `select(Member).where(Member.id.in_(ids))` 1회로 배치. |
| 9 | `backend/app/routers/ledger.py:125-127` | 바로 위에서 이미 로드한 `members_to_update`가 있는데 `created_entries` 루프에서 동일 멤버를 `db.get`으로 재조회(완전 중복). | 이미 로드된 dict 재사용. |
| 10 | `backend/app/routers/sessions.py:250-251` (`delete_session`) | 연결된 Ledger 항목마다 `db.get(Member, entry.member_id)` — 누적 테이블이라 시즌이 지날수록 N 증가. | member_id 목록으로 배치 조회. |
| 11 | `backend/app/services/crawler_cafe.py:185-215` | 크롤링 아이템(최대 수백 건)마다 upsert 존재 확인 쿼리 1개씩(ARQ 백그라운드, 사용자 응답은 안 막지만 워커 점유시간 증가). | `article_id IN (...)`로 기존 레코드 맵 선조회 후 upsert. |
| 12 | `backend/app/services/crawler_cafe.py`, `naver_session.py` | 동기 `requests` 호출이 async 함수 안에서 그대로 실행 — ARQ 워커의 이벤트 루프를 페이지당 최대 10초 블로킹, 동시에 도는 다른 백그라운드 작업(푸시 발송 등) 지연. | `asyncio.to_thread`로 래핑 (r2.py/worker.py에 이미 적용된 패턴 재사용). |
| 13 | `frontend/src/components/BulkPenaltyDialog.tsx:129-149` | 선택된 멤버 전체를 `for...of` + `await`로 순차 호출(직렬 왕복). | `Promise.all(selectedMembers.map(...))`로 병렬화, 또는 백엔드 벌크 엔드포인트. |
| 14 | `frontend/src/hooks/useSessions.ts:70-80` (`useSession`) | `refetchInterval: 5_000`이 세션 상태 무관하게 항상 고정 — 종료된(`FINALIZED`) 세션을 열람 중에도 5초마다 폴링. | 활성 상태(`OPS` 등)일 때만 폴링, `FINALIZED`면 `refetchInterval: false`. |

## Phase 3 — Low impact (여유 있을 때)

- 인덱스 보강: `Attendance.member_id`, `Assignment.member_id`(복합 unique의 leftmost가 아니라 단독 필터 시 못 씀), `TeamMember.member_id`, `Users.cohort_id`, `GenerationAccount.member_id`, `CafePost.member_id`, `EvalAssignment.evaluator_user_id`.
- `sessions.py` presenter-order/team-order 저장 시 항목마다 개별 UPDATE → `bulk_update_mappings` 또는 단일 CASE WHEN UPDATE.
- `scoring.py`/`excel_export.py`/`crawler_homework.py`의 팀별 TeamMember 재조회 소규모 N+1 (N이 작아 영향 낮음).
- 프론트 `Members.tsx`/`Ledger.tsx`의 `useMemo` 누락 (현재 회원 규모(수십~백 명)에선 체감 영향 작음).
- `public/help/*.png` 13개(~1.4MB) WebP 재인코딩 — 이미 lazy 라우트 + `loading="lazy"`라 초기 로드엔 영향 없음, 여유 있을 때.
- `vite.config.ts` manualChunks로 `radix-ui`/`@dnd-kit`/`@tiptap` 등 벤더 청크 분리 (Phase 1 #7 적용 후 재평가).
- DB 커넥션 풀: uvicorn 2 workers + ARQ worker 각각 독립 엔진(pool_size=10+overflow=20) → 최대 90 커넥션. 현재 규모에선 여유 있으나 확장 시 재검토.

## 확인됨 — 문제 없음 (재조사 불필요)

- Eager loading(관계 접근 시 `selectinload` 누락) — 전반적으로 양호, `MissingGreenlet` 위험 없음.
- Redis/ARQ 커넥션 관리 — 싱글턴/lazy-init 패턴, 요청마다 재생성 없음.
- 영상 압축/R2 업로드/웹푸시 — 이미 ARQ 태스크 또는 `to_thread`로 분리돼 요청 블로킹 없음.
- WebSocket 재연결(`useLiveFeedbackSocket`, `useScoringSocket`) — 지수 백오프 + cleanup 정상, 재연결 폭주/누수 없음.
- react-query 사용 전반 — 캐싱 정상, 컴포넌트 마운트마다 raw axios 재호출하는 패턴 없음.
- `AttendanceGrid.tsx`의 배치 처리는 이미 `Promise.all` 병렬화됨 (BulkPenaltyDialog와 대조되는 좋은 예).

---

## 진행 방식

Phase 1부터 순서대로, 한 항목씩 구현 → 로컬 dev 검증(가능하면 실측 전후 비교) → 커밋 → 배포 → 프로덕션 확인. 백엔드 쿼리 최적화는 alembic 마이그레이션이 필요한 인덱스(#4)를 먼저 넣고 나머지는 코드만 수정.
