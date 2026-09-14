# UnivPT Ops Platform

대학 연합 프레젠테이션 동아리 **UnivPT**의 내부 운영 관리 플랫폼입니다.
세션(발표회) 생성부터 출결 관리, 과제 추적, 자동 정산까지 전체 운영 워크플로를 자동화합니다.

## 주요 기능

- **세션 관리**: 개인(INDIVIDUAL) / 팀(TEAM) 세션 생성 → 출결 → 과제 → 정산 → 마감
- **출결 관리**: 출석/결석/지각/조퇴/사유, 일괄 출석 처리, 네이버 카페 사유서 자동 스캔
- **과제 추적**: PPT 이메일 제출, 게시판(리뷰/피드백/PPT) 자동 스캔
- **자동 정산**: 벌점/벌금 자동 계산, 마일스톤 벌금(-10/-20/-30점), 연속 출석 상점
- **멤버 관리**: 디파짓(보증금) 잔액, 점수 현황, 충전, 수료/이탈 처리
- **장부(Ledger)**: 모든 거래 내역 영구 기록, 수동 거래/상벌점 부여
- **대시보드**: 운영 현황 한눈에 파악, 디파짓 부족/퇴출 위험 자동 알림
- **네이버 연동**: 카페 게시판 스캔, 사유서 스캔, 영상 업로드(Google Drive → 네이버 카페)
- **텔레그램 알림**: 운영 행위 audit 로그 + 에러/경고 실시간 알림 (2채널)
- **보안**: JWT 인증, TOTP 2FA, 역할 기반 접근 제어 (Admin/Manager/Viewer)

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| Backend | FastAPI, SQLAlchemy (async), Pydantic v2 |
| Worker | ARQ (Redis-based async task queue) |
| Database | PostgreSQL 16 |
| Cache/Queue | Redis 7 |
| Infra | Docker Compose, Nginx, Cloudflare Tunnel |
| CI/CD | GitHub Actions (SSH deploy) |

## 아키텍처

```
[Cloudflare Tunnel] → [Nginx :80] → [FastAPI :8000] → [PostgreSQL]
                                   → [ARQ Worker]    → [Redis]
```

4-tier Docker 구성:
- **Tier 1 (Presentation)**: Nginx — 정적 파일 서빙 + `/api/*` 리버스 프록시
- **Tier 2 (Application)**: FastAPI + ARQ Worker — 비즈니스 로직 + 비동기 태스크
- **Tier 3 (Data)**: PostgreSQL + Redis — 내부 네트워크만 접근 가능

## 프로젝트 구조

```
ops-platform/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI 앱 진입점
│   │   ├── models.py            # SQLAlchemy ORM 모델
│   │   ├── config.py            # 환경변수 설정
│   │   ├── deps.py              # JWT 인증, DB 의존성
│   │   ├── worker.py            # ARQ 비동기 태스크
│   │   ├── logging_config.py    # JSON 로깅 + 텔레그램 핸들러
│   │   ├── routers/             # API 라우터
│   │   │   ├── auth.py          # 인증, 사용자 CRUD, TOTP
│   │   │   ├── sessions.py      # 세션 CRUD, 상태 전환
│   │   │   ├── members.py       # 멤버 CRUD
│   │   │   ├── ledger.py        # 장부, 상벌점
│   │   │   ├── assignments.py   # 과제 상태 관리
│   │   │   └── crawler.py       # 네이버 크롤러 태스크 트리거
│   │   └── services/            # 비즈니스 로직
│   │       ├── finalize.py      # 세션 정산
│   │       ├── penalty_engine.py # 페널티 계산
│   │       ├── crawler_*.py     # 네이버 크롤러
│   │       └── email_scanner.py # 이메일 스캔
│   ├── alembic/                 # DB 마이그레이션
│   ├── Dockerfile
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── pages/               # React 페이지
│   │   ├── components/          # 공통 컴포넌트
│   │   ├── context/             # AuthContext
│   │   └── lib/                 # API 클라이언트, 유틸
│   ├── nginx.conf
│   └── Dockerfile
├── docker-compose.yml
├── .env.example
├── .github/workflows/deploy.yml # CI/CD
└── docs/
```

## 빠른 시작

### 사전 요구사항

- Docker & Docker Compose
- Git

### 1. 저장소 클론

```bash
git clone https://github.com/your-org/ops-platform.git
cd ops-platform
```

### 2. 환경변수 설정

```bash
cp .env.example .env
# .env 파일을 열고 모든 CHANGE_ME 값을 실제 값으로 변경
```

주요 설정:
- `POSTGRES_PASSWORD`, `REDIS_PASSWORD`: 강력한 비밀번호
- `JWT_SECRET_KEY`: 64자 랜덤 hex (`python -c "import secrets; print(secrets.token_hex(32))"`)
- `ADMIN_PASSWORD_HASH`: bcrypt 해시 (`python -c "import bcrypt; print(bcrypt.hashpw(b'yourpw', bcrypt.gensalt()).decode())"`)
- `NAVER_*`: 네이버 카페 연동 정보
- `GOOGLE_SERVICE_ACCOUNT_JSON`: Google Drive 서비스 계정 키
- `TELEGRAM_*`: 텔레그램 봇 토큰 및 채널 ID (선택)

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

- 로컬: `http://localhost:3000`
- 프로덕션: Cloudflare Tunnel 설정 후 도메인으로 접속

## 세션 라이프사이클

```
SETUP → PREP → OPS → POST → SETTLEMENT → FINALIZED
         │       │      │        │             │
         │       │      │        │             └─ 장부 영구 기록
         │       │      │        └─ 페널티 미리보기, 면제 처리
         │       │      └─ 과제 스캔 (네이버 카페)
         │       └─ 영상 업로드, 피드백 배정
         └─ 출결 관리, PPT이메일 확인, 사유서 스캔
```

## 배포 (CI/CD)

`main` 브랜치에 push하면 GitHub Actions가 자동 배포합니다.

```yaml
# .github/workflows/deploy.yml
on:
  push:
    branches: [main]
# → SSH로 서버 접속 → git pull → docker compose build → up -d → alembic upgrade head
```

필요한 GitHub Secrets:
- `DEPLOY_HOST`: 서버 IP/도메인
- `DEPLOY_USER`: SSH 사용자명
- `DEPLOY_SSH_KEY`: SSH 개인키

## 사용 가이드

상세한 사용 가이드(스크린샷 포함)는 Notion에서 확인할 수 있습니다:
- [Ops Platform 사용 가이드](https://www.notion.so/317b4343591681099d4dc2b7da731839)

## 라이선스

Private — UnivPT 내부 사용 전용


