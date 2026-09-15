# UnivPT OPS

> **기수가 바뀌어도, 운영은 이어집니다.**
> 대학 연합 프레젠테이션 동아리 **UnivPT**의 운영 전 과정 — 출결·과제·정산·평가·소통 — 을 하나로 묶은 풀스택 웹 플랫폼.

| | |
|---|---|
| **Role** | 기획 · 디자인 · 풀스택 개발 (1인) |
| **Platform** | 반응형 웹 + PWA (홈 화면 설치) |
| **Scale** | 40개 테이블 · Docker 5-service |
| **Tenancy** | 운영진/기수원 2-포털 · 기수(cohort)별 데이터 완전 격리 |

---

## 주요 기능

### 운영진 대시보드
- **세션 라이프사이클**: `SETUP → PREP → OPS → POST → SETTLEMENT → FINALIZED` 상태 머신. 개인(INDIVIDUAL)/팀(TEAM) 세션, 분반·발표 순서 드래그 편집
- **출결 관리**: 출석/지각(10분 기준)/조퇴/결석/공결(사전·사후), 일괄 처리, 네이버 카페 사유서 자동 스캔
- **과제 추적**: PPT 이메일 제출(IMAP 스캔), 게시판(리뷰/피드백/PPT) 자동 스캔, 상태 수동 보정
- **자동 정산**: 출결×공결사유 페널티 매트릭스, 과제 미제출 벌점, 마일스톤 누적 벌금, 연속 출석 상점 — `finalize()` 원자 처리로 장부 확정 후 불가역
- **장부·금고**: 모든 거래 영구 기록(soft 정정은 ADJUSTMENT 행으로만), 디파짓(보증금) 잔액 추적, 총무부 지출 관리
- **발표 성장 리포트**: 초기/후기 평가 라운드, 자기평가·청중평가 배정, 레이더 차트로 성장 비교, PDF 내보내기
- **심사·채점**: 공개 링크(무로그인) 채점 폼 + 운영진 실시간 집계 대시보드, 감점 규정 엔진
- **실시간 피드백**: 발표 중 익명 상호 피드백 보드(패들렛 스타일), 이모지 반응, 댓글 스레드, 발표 화면 전체화면 라이브 뷰
- **팀 빌딩 도우미**: 과거 팀 세션 간 멤버 겹침을 회피하는 자동 배정, 운영진 드래그 수동 조정
- **공지·웹푸시**: 리치 에디터 공지 작성, 반응/댓글/해시태그, VAPID 자체 웹푸시(파이어베이스 미사용)
- **개발자 호출**: 운영진이 버그/개선사항을 남기면 담당 개발자에게만 답변 권한 부여

### 기수(멤버) 포털
- 개인 대시보드(출결·점수·디파짓 요약), 주차별 출결 내역, 내 장부
- 발표 성장 리포트 열람(PDF 다운로드), 실시간 피드백 작성/열람
- 공지 열람(반응·댓글·본문 임베드), 웹푸시 알림 구독

### 인프라 전반
- **멀티테넌시**: 기수마다 세션·멤버·장부·평가·피드백을 `cohort_id`로 완전 격리. 슈퍼관리자만 전 기수 열람/전환 가능. username은 기수별로만 유일(다른 기수끼리 동일 아이디 허용, 로그인 시 비밀번호로 자동 판별)
- **인증**: JWT + TOTP 2FA, 역할 기반 접근 제어(Admin/Manager/Viewer/Scoring-only), 운영진/기수원 별도 토큰 체계
- **실시간**: WebSocket + Redis Pub/Sub — uvicorn 멀티 워커 간 이벤트 fanout, 역할별(운영진=실명/기수=익명) 페이로드 분기, 낙관적 업데이트 + 재연결 시 놓친 이벤트 동기화

---

## 기술 스택

| 레이어 | 기술 |
|---|---|
| Frontend | React 19, TypeScript, Vite 7, Tailwind CSS 4, shadcn/ui(Radix), TanStack Query, Framer Motion |
| Backend | FastAPI, SQLAlchemy 2.0(async), Pydantic v2, Alembic |
| Worker | ARQ(Redis 기반 비동기 태스크 큐) — 크롤링·영상압축·푸시 발송·이메일 스캔 |
| Database | PostgreSQL 16 |
| Cache/Queue/PubSub | Redis 7 |
| 파일 스토리지 | Cloudflare R2 (발표 영상) |
| 외부 연동 | 네이버 카페(크롤링/자동 로그인), Gmail IMAP, 텔레그램 봇, Web Push(VAPID) |
| Infra | Docker Compose, Nginx, Cloudflare Tunnel |
| CI/CD | GitHub Actions → SSH(cloudflared) 배포 |

## 아키텍처

```
[Cloudflare Tunnel] → [Nginx :80]  ─┬→ 정적 파일 (React SPA)
                                     └→ /api/* 리버스 프록시 → [FastAPI :8000] ─┬→ [PostgreSQL 16]
                                                                                ├→ [Redis 7]  (Pub/Sub · 큐 · 블랙리스트)
                                                                                └→ [ARQ Worker] → 네이버 카페 · Cloudflare R2 · 텔레그램
```

Docker Compose 5-service 구성 — `frontend`(Nginx) / `backend`(FastAPI) / `worker`(ARQ) / `db`(PostgreSQL, 내부망 전용) / `redis`(내부망 전용). `healthcheck`로 기동 순서 보장, named volume으로 데이터 영속.

### 실시간(WebSocket) 브로드캐스트

```
클라이언트(React) ──WSS──▶ FastAPI 워커 ×N (ConnectionManager, 인메모리 rooms)
                                   │
                                   ▼
                           Redis Pub/Sub ──▶ 워커 간 이벤트 fanout ──▶ 전 구독자 즉시 반영
```

uvicorn 멀티 워커 환경에서 워커별 인메모리 room만으로는 이벤트가 누락되므로, 변경은 항상 Redis에 발행하고 모든 워커가 구독해 로컬 연결에 전달한다(Redis 장애 시 로컬 폴백). 역할별로 다른 payload를 전송해 운영진=실명, 기수원=보드별 익명 alias만 노출한다.

### 데이터 모델 · 멀티테넌시

`cohorts` 테이블이 모든 리소스를 `cohort_id`로 스코프 격리하는 멀티테넌시 루트다.

| 도메인 | 주요 테이블 |
|---|---|
| 인증·계정 | `users`, `generation_accounts`, `naver_sessions` |
| 세션·팀·출결 | `sessions`, `teams`, `team_members`, `team_history`, `team_building_boards`, `attendance`, `assignments` |
| 점수·재정 | `members`, `ledger`, `treasury_expenses`, `cafe_posts` |
| 평가·성장 | `eval_rounds`, `eval_assignments`, `eval_responses` |
| 심사·채점 | `scoring_rounds`, `scoring_areas`, `scoring_criteria`, `scoring_scores`, `scoring_ranks`, `scoring_deductions` 등 |
| 피드백·공지·푸시 | `live_feedback_boards/posts/reactions/comments/anon_aliases`, `announcements`, `announcement_reactions/comments`, `push_subscriptions` |
| 소통 | `dev_feedback` |

- **전 쿼리 기수 스코프**: 슈퍼관리자(cohort_id NULL)만 전 기수 열람/전환
- **부분 unique 인덱스**: `(cohort_id, username)` 조합 유일 — 다른 기수끼리는 동일 아이디 허용, 슈퍼관리자 계정끼리는 별도 partial index로 유일성 보장
- **불변 원장**: 장부는 append-only, 정정은 새 ADJUSTMENT 행으로만
- **Soft-delete + 감사**: 멤버 이탈/수료는 `is_active` 보존, 모든 운영 행위는 audit 로그(+텔레그램 알림)

### 세션 상태 머신 · 페널티 정산 엔진

```
SETUP → PREP → OPS → POST → SETTLEMENT → FINALIZED(불가역)
```

정산 파이프라인(`finalize()`)이 한 트랜잭션으로: ① `PenaltyEngine`으로 출결×공결사유 매트릭스 적용 → ② 과제(PPT·리뷰·피드백) 페널티 적용 → ③ 마일스톤 누적 벌금 산정 → ④ 디파짓·상벌점 갱신 + 원장 기록 → ⑤ status를 `FINALIZED`로 전환. `settlement-preview`로 커밋 전 결과 검증 및 멤버별 페널티 스킵(오버라이드) 지원.

### 엔지니어링 하이라이트

| 문제 | 해결 |
|---|---|
| Cloudflare 터널 100MB 업로드 한계로 발표 영상 업로드 실패 | R2 presigned 직접 업로드 → 워커가 디스크로 pull → ffmpeg 압축(Redis 락으로 동시성 제어) → 네이버 카페 자동 업로드 |
| uvicorn 멀티 워커 환경에서 워커별 인메모리 WS room이 서로 다른 워커의 이벤트를 놓침 | Redis Pub/Sub으로 워커 간 fanout, 재연결 시 놓친 이벤트를 쿼리로 재동기화 |
| iOS PWA suspend·안드로이드 doze·구독 만료로 웹푸시 미수신 | TTL 28일 + `urgency: high`, 앱 재오픈 시 자동 재구독, 404/410 응답 시 죽은 구독 자동 정리 |
| 익명 피드백이 다른 기능(장부·평가)과 연결되면 작성자 역추적 가능 | 보드별 alias 매핑을 서버 전용 테이블로 분리, 역할별 payload 분기로 클라이언트에 실명 데이터 자체를 전송하지 않음 |
| bcrypt(CPU-bound) 해싱이 이벤트 루프를 블로킹 — 계정 일괄 생성/초기화 시 다른 기수 트래픽까지 지연 | `asyncio.to_thread`로 스레드 위임, 전 로그인·계정 라우터에 일괄 적용 |
| 기수 분리 후 같은 아이디를 여러 기수가 쓸 수 있어 로그인 시 계정 특정 불가 | 비밀번호로 후보를 먼저 좁히고(대부분 즉시 특정), 여전히 모호할 때만 기수 선택 UI 노출 |

---

## 프로젝트 구조

```
ops-platform/
├── backend/
│   ├── app/
│   │   ├── main.py                # FastAPI 앱 진입점
│   │   ├── models.py              # SQLAlchemy ORM 모델 (40개 테이블)
│   │   ├── config.py              # 환경변수 설정
│   │   ├── deps.py                # JWT 인증, 권한, DB 의존성
│   │   ├── worker.py              # ARQ 태스크 정의(크롤링/영상/푸시/이메일)
│   │   ├── logging_config.py      # JSON 로깅 + 텔레그램 핸들러
│   │   ├── routers/               # API 라우터 (14개)
│   │   │   ├── auth.py            #   인증, 사용자 CRUD, TOTP
│   │   │   ├── cohorts.py         #   기수 공간 관리(슈퍼관리자 전용)
│   │   │   ├── sessions.py        #   세션 CRUD, 상태 전환, 발표/팀 순서
│   │   │   ├── members.py         #   멤버 CRUD, 이탈/수료 처리
│   │   │   ├── generation.py      #   기수원 계정 생성/일괄 관리
│   │   │   ├── ledger.py          #   장부, 상벌점 부여
│   │   │   ├── assignments.py     #   과제 상태 관리
│   │   │   ├── evaluation.py      #   발표 성장 리포트(평가 라운드)
│   │   │   ├── scoring.py         #   심사·채점(공개 폼 + 실시간 집계)
│   │   │   ├── team_building.py   #   팀 빌딩 도우미
│   │   │   ├── live_feedback.py   #   실시간 익명 피드백 보드
│   │   │   ├── notifications.py   #   공지 + 웹푸시
│   │   │   ├── dev_feedback.py    #   개발자 호출(소통창구)
│   │   │   └── crawler.py         #   네이버 크롤러 태스크 트리거
│   │   └── services/              # 비즈니스 로직
│   │       ├── finalize.py        #   세션 정산 파이프라인
│   │       ├── penalty_engine.py  #   페널티 계산 매트릭스
│   │       ├── streak_checker.py  #   연속 출석 상점
│   │       ├── group_builder.py / team_builder.py  # 분반·팀 자동 배정
│   │       ├── scoring_engine.py / scoring_deductions.py / scoring_excel.py / scoring_ws.py
│   │       ├── eval_analysis.py   #   성장 리포트 분석
│   │       ├── live_feedback_ws.py #  WS ConnectionManager + Redis Pub/Sub
│   │       ├── crawler_*.py       #   네이버 카페 크롤러(과제/사유서/PPT/영상/로그인)
│   │       ├── r2.py / video_compress.py  # 영상 업로드·압축
│   │       ├── push.py            #   웹푸시 발송(VAPID)
│   │       └── excel_export.py / email_scanner.py
│   ├── alembic/                   # DB 마이그레이션
│   ├── Dockerfile
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── pages/                 # 운영진 페이지(Dashboard/Members/Ledger/Treasury/…)
│   │   │   ├── session/           #   세션 탭(Prep/Ops/Post/Settlement/팀·분반 편집)
│   │   │   └── member/            #   기수 포털 페이지(홈/리포트/피드백/장부/출결)
│   │   ├── components/            # 공통 컴포넌트(ui/ shadcn 프리미티브 포함)
│   │   ├── hooks/                 # TanStack Query 훅
│   │   ├── context/                # AuthContext / MemberAuthContext
│   │   └── lib/                    # API 클라이언트, 유틸
│   ├── nginx.conf
│   └── Dockerfile
├── docker-compose.yml              # frontend/backend/worker/db/redis 5-service
├── .env.example
├── .github/workflows/deploy.yml    # CI/CD (build-check → SSH 배포)
└── docs/plans/                     # 진행 중인 개선 계획 문서
```

## 빠른 시작

### 사전 요구사항
- Docker & Docker Compose
- Git

### 1. 저장소 클론

```bash
git clone <repo-url>
cd ops-platform
```

### 2. 환경변수 설정

```bash
cp .env.example .env
```

| 그룹 | 변수 | 비고 |
|---|---|---|
| DB/Redis | `POSTGRES_*`, `DATABASE_URL`, `REDIS_PASSWORD`, `REDIS_URL` | 강력한 비밀번호 사용 |
| 인증 | `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `JWT_SECRET_KEY`, `JWT_ALGORITHM`, `JWT_EXPIRE_MINUTES`, `JWT_REMEMBER_EXPIRE_MINUTES` | `JWT_SECRET_KEY`: `python -c "import secrets; print(secrets.token_hex(32))"` / `ADMIN_PASSWORD_HASH`: `python -c "import bcrypt; print(bcrypt.hashpw(b'yourpw', bcrypt.gensalt()).decode())"` |
| 네이버 연동 | `NAVER_IMAP_EMAIL`, `NAVER_IMAP_PASSWORD`, `NAVER_ID`, `NAVER_PWD`, `NAVER_CAFE_ID`, `NAVER_CAFE_MENU_*` | 카페 크롤링/자동 로그인/PPT 이메일 스캔 |
| Google | `GOOGLE_DRIVE_FOLDER_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON` | 영상 원본 연동 |
| Cloudflare R2 | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | 발표 영상 스토리지 (bucket CORS에 `ExposeHeaders: etag` 필요) |
| 텔레그램 | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALERT_CHAT_ID`, `TELEGRAM_AUDIT_CHAT_ID` | 선택 — 에러/경고·운영 감사 로그 채널 분리 |
| 웹푸시 | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `vapid_gen.py` 등으로 키쌍 생성 |
| 기타 | `CORS_ORIGINS`, `ENV` | |

### 3. 빌드 및 실행

```bash
docker compose build
docker compose up -d
```

### 4. DB 마이그레이션

```bash
docker compose exec backend alembic upgrade head
```

### 5. 접속

- 로컬: `http://localhost:3000` (dev 서버는 `http://localhost:5173`)
- 프로덕션: Cloudflare Tunnel 설정 후 도메인으로 접속

## 배포 (CI/CD)

`main` 브랜치에 push하면 GitHub Actions가 자동 배포한다.

```
git push → main
   │
   ├─ build-check: frontend/backend Docker 이미지 빌드(GHA 캐시) — TS·의존성·빌드 에러 선차단
   │
   └─ deploy: cloudflared로 Access 터널 SSH 접속(공개 포트 없음)
        → git pull → docker compose build(캐시) → down → up -d
        → alembic upgrade head → 이전 이미지/빌드 캐시 정리
```

필요한 GitHub Secrets: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`.

## 세션 라이프사이클

```
SETUP → PREP → OPS → POST → SETTLEMENT → FINALIZED
         │       │      │        │             │
         │       │      │        │             └─ 장부 영구 기록(불가역)
         │       │      │        └─ 페널티 미리보기, 멤버별 면제 처리
         │       │      └─ 과제 스캔(네이버 카페), 발표 순서 편집
         │       └─ 영상 업로드(R2), 실시간 피드백 보드 오픈
         └─ 출결 관리, PPT이메일 확인, 사유서 스캔, 분반 배정
```

## 사용 가이드

상세한 사용 가이드(스크린샷 포함)는 Notion에서 확인할 수 있다:
- [Ops Platform 사용 가이드](https://www.notion.so/317b4343591681099d4dc2b7da731839)

## 라이선스

Private — UnivPT 내부 사용 전용
