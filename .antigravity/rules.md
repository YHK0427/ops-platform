# UnivPT Ops Platform — 프로젝트 규칙 (AI 헌법)
> 모든 작업 시작 전 반드시 이 파일을 읽는다.

---

## 1. 프로젝트 개요

대학생 연합 발표 동아리 내부 운영 플랫폼. 외부 공개 서비스 아님.
단일 어드민이 사용하는 백오피스 툴.

**설계서 위치:**
- `docs/spec_schema.md` — DB 스키마, 페널티 매트릭스
- `docs/spec_api.md` — API 엔드포인트 전체
- `docs/spec_crawler.md` — 크롤러, 네이버 세션, 영상 업로드
- `docs/spec_business_logic.md` — PenaltyEngine, Finalize, 팀빌더
- `docs/spec_frontend.md` — 라우트 맵, 컴포넌트 구조
- `docs/spec_infra.md` — Docker 3-Tier, Cloudflare Tunnel
- `docs/spec_workflow.md` — 관리자 주간 워크플로우
- `docs/design.md` — 디자인 시스템 전체

---

## 2. 기술 스택 (변경 금지)

**Backend:**
- Python 3.12, FastAPI, SQLAlchemy 2.0 (async), Alembic
- Pydantic v2, ARQ (task queue), requests, Playwright

**Frontend:**
- React 18, Vite, TypeScript
- Tailwind CSS, shadcn/ui, TanStack Query v5
- @dnd-kit/core (팀빌더), sonner (토스트), lucide-react

**Infra:**
- Docker Compose, PostgreSQL 16, Redis 7
- Nginx (frontend), Cloudflare Tunnel (외부 접근)

---

## 3. MUST DO (반드시 준수)

- DB 스키마 변경은 **반드시 Alembic 마이그레이션**으로 (직접 ALTER 금지)
- pip install 시 **반드시 `--break-system-packages`** 플래그 포함
- 코드는 **영어**, 주석과 커밋 메시지는 **한국어**
- 모든 수치(점수, 금액)는 **`font-mono`** 클래스 적용
- 테이블 행은 **`hover:bg-hover/40 transition-colors`**
- 로딩 상태는 **항상 명시** (스켈레톤 or 인라인 스피너)
- 새 기능 구현 전 **`docs/spec_*.md` 해당 섹션 먼저 확인**

---

## 4. DO NOT (절대 금지)

### 백엔드
- FINALIZED 세션에 일반 PATCH로 데이터 변경 금지 → `/force` 엔드포인트 사용
- `excuse_type` 변경 시 마감 시각(일요일 22:00) 체크 없이 저장 금지
- DB 스키마 직접 ALTER 금지 → Alembic 마이그레이션
- Finalize 처리 순서 임의 변경 금지 (before저장→점수→milestone→디파짓→ledger)
- INDIVIDUAL 세션에 팀빌딩 API 호출 금지 (API 레벨 type 체크 필수)
- net_score 직접 계산/업데이트 금지 → DB 트리거가 자동 처리

### 프론트엔드
- `text-white`, `bg-white`, `bg-gray-*` 직접 사용 금지 → CSS 변수 사용
- 드롭다운/체크박스 변경에 toast 사용 금지 → 인라인 스피너
- `shadow-*` 남용 금지 → border로 구분
- font-family에 Inter, Roboto, Arial 사용 금지 → Pretendard + Geist Mono
- localStorage, sessionStorage 사용 금지

### 인프라
- `db`, `redis` 서비스에 `ports:` 절 추가 금지 (외부 노출 금지)
- `backend-net`의 `internal: true` 제거 금지
- `.env` 파일 git 커밋 금지

---

## 5. 핵심 도메인 규칙 (비즈니스 로직)

### 점수 체계
- `total_plus_score`: 상점 (항상 ≥ 0)
- `total_minus_score`: 벌점 (항상 ≤ 0, 음수로 저장)
- `net_score`: 자동 갱신 (DB 트리거). 직접 건드리지 않는다
- 퇴출 기준: `net_score <= -12`

### 출결 마감
- 사후사유서(`excuse_type=POST`) 마감: **session.date(토) + 1일 21:59:59 (일요일)**
- 마감 이후 `excuse_type` 변경 시 → 422 에러
- 단, FINALIZED 세션은 `/force` 엔드포인트로 수정 가능 (ADJUSTMENT ledger 자동 생성)

### 피드백 개수
- 출석자: 1개 / 결석자 또는 PPT 미제출자: 2개 / 결석+PPT 미제출: 2개 (누적 아님)

### 과제 패널티
- 리뷰/과제/피드백 중 하나라도 미제출 = -1점, -1,000원 (전부 미제출도 동일)

### 팀 매칭
- `leader` 태그 보유 멤버를 Snake Draft에서 우선 배분
- `team_history`에서 2회 이상 같이 한 쌍 → 충돌 경고 (자동 교체 없음)

### 영상 업로드
- 소스: 구글 드라이브 폴더 (파일명: `김민준(8번째).mp4`)
- 발표자명 파싱: 정규식 `^(.+?)\s*\(`
- 게시글 제목: `{week_num}주차_{session.title}_{발표자명}`

---

## 6. 디렉토리 구조 규칙

```
backend/app/
├── main.py          # FastAPI 앱 + 라우터 등록
├── config.py        # Pydantic BaseSettings
├── database.py      # async session, Base
├── models.py        # SQLAlchemy 모델 전체
├── schemas/         # Pydantic 스키마 (request/response)
├── routers/         # 엔드포인트 (members, sessions, crawler, ledger, settlement)
├── services/        # 비즈니스 로직 (penalty_engine, team_builder, crawler_*, streak_checker)
├── deps.py          # 의존성 (get_db, get_current_user)
└── worker.py        # ARQ WorkerSettings

frontend/src/
├── main.tsx
├── App.tsx          # 라우터 설정
├── components/      # 공용 컴포넌트 (StatusBadge, ScoreDisplay, WarningBanner 등)
├── pages/           # 페이지 (Dashboard, Members, MemberDetail, Ledger, SessionLayout 등)
├── hooks/           # TanStack Query hooks
├── lib/             # api.ts (axios instance), utils.ts
└── index.css        # CSS 변수 + shadcn 오버라이드
```
