# 성능 전수 감사 + 개선 계획 (2026-09-14)

> 프론트(React/Vite)·백엔드(FastAPI/SQLAlchemy)·인프라(nginx/Docker) 전체를 실제 코드 기준으로 조사한 결과. 발견 순서가 아니라 **영향도(High/Medium/Low)** 기준으로 정리, 순차적으로 하나씩 처리한다.

## 이미 처리 완료

- **nginx gzip 압축 활성화** (`frontend/nginx.conf`).
- 폰트 FOUC/희귀 한글 미표시 — Paperlogy 빈 글리프 patch + 마운트 지연 (별도 이슈).
- **#1 bcrypt 이벤트루프 블로킹** — `deps.py`에 `hash_password`(to_thread) 추가, auth.py/generation.py/cohorts.py 전체 호출부(로그인 후보 검증 포함 총 10곳+) 교체. 실제 bulk-create/bulk-reset API로 검증. (`97d3e13`)
- **#4 Ledger 인덱스** — `member_id`/`session_id` 인덱스 추가 완료 (이전 세션, 마이그레이션 적용됨).
- **#5 streak_checker 기수 미필터** — `Member` 조인으로 `cohort_id` 필터 추가, 전체 Ledger 풀스캔 방지. (`8b70be3`)
- **#6 evaluation.py 라운드 결과 N+1** — 멤버당 2쿼리 → 그룹핑 1쿼리. curl로 3개 라운드 검증. (`0499543`)
- **#7 App.tsx eager import 17개** — 전부 `lazy()` 전환 (LoginPage만 최초 진입점이라 eager 유지). Playwright로 로그인→대시보드→멤버→세션 목록 네비게이션 확인. (`d081e48`)
- **#8/#9 ledger.py give_merit N+1 + 중복 조회** — `IN` 쿼리 배치 + `members_by_id` 재사용. 멀티 멤버 부여 API 검증. (`75f8e3f`)
- **#10 sessions.py delete_session N+1** — Ledger→Member 배치 조회. 임시 세션 생성/삭제로 잔고 원복 검증. (`907686a`)
- **#12 크롤러 동기 requests 블로킹** — crawler_cafe/crawler_homework/crawler_excuse의 `fetch_board_articles`/`fetch_article_detail` 전부 `to_thread` 래핑. ARQ 큐 등록해 실제 크롤링 동작 확인. (`021a99c`)
- **#13 BulkPenaltyDialog 순차 대기** — `Promise.all` 병렬화. 2명 동시 부여로 검증. (`75e8e6a`)
- **#14 useSession 무조건 5초 폴링** — `FINALIZED`면 폴링 중단. (`83923d1`)
- **presenter-order/team-order 개별 UPDATE 루프** (Phase 3 항목) — Core 테이블 대상 bindparam 일괄 UPDATE로 교체. 실제 세션에 PATCH 검증. (`7fdc4a6`)
- **누락 FK 인덱스 6개** (Phase 3 항목) — `team_members`/`assignments`/`attendance`/`generation_accounts`/`cafe_posts.member_id`, `eval_assignments.evaluator_user_id`. (`e4cdbc7`)

---

## 남은 항목

| # | 위치 | 문제 | 비고 |
|---|------|------|------|
| 3 | `backend/app/services/ledger_utils.py:9-36` (`recalculate_deposit_after`) | 호출마다 해당 멤버 전체 이력 재계산 O(누적 건수). | **의도적 보류** — 백데이트 항목 정합성 리스크 때문에 증분화 대신 인덱스만 추가해둔 상태. 건드리려면 백데이트 시나리오 먼저 정리 필요. |
| 11 | `backend/app/services/crawler_cafe.py` `sync_board_to_db` | 아이템마다 존재확인 쿼리 — 확인 결과 이 함수 자체가 호출부 없는 죽은 코드. 실제 사용 경로(crawler_homework/crawler_excuse)는 각자 자체 upsert 로직 사용, 별도 확인 필요시 그쪽 우선. | 낮은 우선순위. |
| — | `backend/app/services/penalty_engine.py` TEAM PPT_EMAIL 블록 | 비-PASS 팀 PPT_EMAIL 과제마다 TeamMember 개별 조회. | 팀 수(5-15개) 자체가 작고 그중 미제출 팀만 대상이라 영향 미미, 낮은 우선순위. |

**#2 (penalty_engine.py 멤버별 N+1)는 이전 세션에서 이미 수정 완료** (`27113a9`) — 문서 갱신 누락이었을 뿐 실제로는 처리됨.

## 확인됨 — 문제 없음 / 우선순위 낮음 (재조사 불필요)

- Eager loading(`selectinload` 누락) — 양호.
- Redis/ARQ 커넥션 관리, 영상 압축/R2/웹푸시 — 이미 분리됨.
- WebSocket 재연결, react-query 캐싱 — 정상.
- `AttendanceGrid.tsx` 배치 처리 — 이미 `Promise.all`.
- 프론트 코멘트 mutation 낙관적 업데이트 부재, `AdminFeedbackWall` 카드당 mutation hook 5개, WS 브로드캐스트 그룹 미스코프, comment 생성/삭제 시 post 풀재조회 — 실사용 규모(수십명, 세션당 코멘트 수십 건)에서 체감 영향 미미로 판단, 보류.
- `public/help/*.png` WebP 재인코딩, `vite.config.ts` manualChunks 벤더 분리 — 여유 있을 때.

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
