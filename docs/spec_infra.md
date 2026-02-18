# UnivPT Ops — 인프라 & 배포 (B-11, B-12, B-13)
> 3-Tier Docker, 네트워크 격리, Cloudflare Tunnel, 보안 체크리스트

## B-11. 배포 & 인프라 — 홈서버 3-Tier Docker 구성

### 아키텍처 개요

```
외부 인터넷
     │  HTTPS (Cloudflare Tunnel)
     ▼
┌─────────────────────────────────────────────┐
│  TIER 1 — Presentation                      │
│  frontend (nginx)                           │
│  - React 빌드 서빙                           │
│  - /api/* → backend 프록시                   │
│  Networks: frontend-net                     │
└─────────────────┬───────────────────────────┘
                  │ frontend-net
┌─────────────────▼───────────────────────────┐
│  TIER 2 — Application                       │
│  backend (FastAPI)  +  worker (ARQ)         │
│  - API 처리                                  │
│  - 크롤러 태스크 (Playwright, requests)       │
│  Networks: frontend-net + backend-net       │
└─────────────────┬───────────────────────────┘
                  │ backend-net (DB/Redis 전용)
┌─────────────────▼───────────────────────────┐
│  TIER 3 — Data                              │
│  db (PostgreSQL 16)  +  redis (Redis 7)     │
│  - 외부 포트 노출 없음                        │
│  - backend-net 안에서만 접근 가능             │
│  Networks: backend-net only                 │
└─────────────────────────────────────────────┘
```

**네트워크 격리 원칙:**
- `frontend-net`: frontend ↔ backend 통신 전용
- `backend-net`: backend ↔ db ↔ redis 통신 전용
- frontend는 `backend-net`에 접근 불가 → DB 직접 접근 원천 차단
- db / redis는 호스트 포트 바인딩 없음 → 외부 노출 없음

---

### docker-compose.yml

```yaml
version: "3.9"

networks:
  frontend-net:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/24   # Tier1 ↔ Tier2
  backend-net:
    driver: bridge
    internal: true                # 외부 라우팅 완전 차단 (Tier2 ↔ Tier3)
    ipam:
      config:
        - subnet: 172.20.1.0/24

services:

  # ── TIER 1: Presentation ─────────────────────────
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      args:
        VITE_API_BASE: ""           # 같은 origin → "" (nginx가 /api/* 프록시)
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:80"        # 호스트의 localhost:3000만 바인딩
                                   # 외부 직접 접근 차단 → Cloudflare Tunnel이 유일한 진입점
    depends_on:
      backend:
        condition: service_healthy
    networks:
      - frontend-net

  # ── TIER 2: Application ──────────────────────────
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    restart: unless-stopped
    volumes:
      - ./files:/app/files         # 영상 임시 저장
    env_file: .env
    expose:
      - "8000"                     # 호스트 포트 바인딩 없음 — frontend-net 안에서만 접근
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 20s
    networks:
      - frontend-net               # frontend와 통신
      - backend-net                # db/redis와 통신

  worker:
    build:
      context: ./backend
      dockerfile: Dockerfile
    command: arq app.worker.WorkerSettings
    restart: unless-stopped
    volumes:
      - ./files:/app/files
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
    networks:
      - backend-net                # worker는 frontend와 통신 불필요 → backend-net만

  # ── TIER 3: Data ─────────────────────────────────
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    volumes:
      - ./pg_data:/var/lib/postgresql/data
      - ./scripts/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    environment:
      POSTGRES_DB:       ${POSTGRES_DB}
      POSTGRES_USER:     ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    # ports: 절대 노출하지 않음 (backend-net 내부에서만 접근)
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s
    networks:
      - backend-net

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --requirepass ${REDIS_PASSWORD} --appendonly yes
    volumes:
      - ./redis_data:/data
    # ports: 절대 노출하지 않음
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3
    networks:
      - backend-net
```

---

### frontend/Dockerfile

```dockerfile
# ─── Stage 1: Build ───────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --frozen-lockfile

COPY . .
ARG VITE_API_BASE=""
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

# ─── Stage 2: Serve ───────────────────────────────
FROM nginx:1.25-alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### frontend/nginx.conf

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # React SPA 라우팅
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API 프록시 → backend (Tier2)
    location /api/ {
        proxy_pass         http://backend:8000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        # 크롤러 장시간 실행 대비 (영상 업로드 최대 10분)
        proxy_read_timeout    600s;
        proxy_connect_timeout 10s;
        proxy_send_timeout    600s;

        # SSE / 실시간 폴링 대비
        proxy_buffering    off;
        proxy_cache        off;
    }

    # 정적 자산 캐시
    location ~* \.(js|css|png|svg|ico|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # 보안 헤더
    add_header X-Frame-Options        "DENY"        always;
    add_header X-Content-Type-Options "nosniff"     always;
    add_header Referrer-Policy        "same-origin" always;
}
```

---

### backend/Dockerfile

```dockerfile
FROM python:3.12-slim

# Playwright 의존성 (Chromium)
RUN apt-get update && apt-get install -y --no-install-recommends     curl wget gnupg ca-certificates     && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml ./
RUN pip install --no-cache-dir -e ".[all]" --break-system-packages

# Playwright Chromium 설치
RUN playwright install chromium --with-deps

COPY . .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
```

---

### Cloudflare Tunnel 연동

```
외부 요청 → Cloudflare Edge → Tunnel → 홈서버 localhost:3000 → nginx
```

```yaml
# cloudflared 설정 (~/.cloudflared/config.yml)
tunnel: <TUNNEL_UUID>
credentials-file: /home/user/.cloudflared/<TUNNEL_UUID>.json

ingress:
  - hostname: ops.univpt.com    # 실제 도메인
    service: http://localhost:3000
  - service: http_status:404
```

```bash
# Cloudflare Tunnel 설치 & 등록 (최초 1회)
# 1. cloudflared 설치
wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb

# 2. 로그인 & 터널 생성
cloudflared tunnel login
cloudflared tunnel create univpt-ops
cloudflared tunnel route dns univpt-ops ops.univpt.com

# 3. 시스템 서비스 등록 (재부팅 후에도 자동 시작)
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

> **포트 포워딩 불필요**: Cloudflare Tunnel은 홈 라우터 설정 없이 동작.
> `localhost:3000`은 외부에서 직접 접근 불가, Tunnel만 통과 가능.

---

### .env 전체 (최종)

```env
# ── Database ──────────────────────────────────────
POSTGRES_DB=univpt_ops
POSTGRES_USER=univpt
POSTGRES_PASSWORD=CHANGE_ME_STRONG_32CHAR+
DATABASE_URL=postgresql+asyncpg://univpt:CHANGE_ME_STRONG_32CHAR+@db:5432/univpt_ops

# ── Redis ─────────────────────────────────────────
REDIS_PASSWORD=CHANGE_ME_REDIS_PW
REDIS_URL=redis://:CHANGE_ME_REDIS_PW@redis:6379/0

# ── Auth ──────────────────────────────────────────
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=$2b$12$...   # bcrypt 해시
# 생성: python -c "import bcrypt; print(bcrypt.hashpw(b'yourpw', bcrypt.gensalt()).decode())"
JWT_SECRET_KEY=CHANGE_ME_64CHAR_RANDOM_HEX
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=1440          # 24시간

# ── Naver ─────────────────────────────────────────
NAVER_CAFE_ID=31668555
NAVER_CAFE_MENU_VIDEO=1
NAVER_CAFE_MENU_REVIEW=2
NAVER_CAFE_MENU_HOMEWORK=3

# ── Google Drive ──────────────────────────────────
GOOGLE_DRIVE_FOLDER_ID=your_drive_folder_id
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}

# ── App ───────────────────────────────────────────
GENERATION=33
CORS_ORIGINS=https://ops.univpt.com   # Cloudflare Tunnel 도메인만 허용
```

---

### deploy.sh (운영 배포 스크립트)

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "=== UnivPT Ops Deploy ==="

# 1. 최신 코드 Pull
git pull origin main

# 2. 이미지 빌드 (변경된 것만)
docker compose build --no-cache backend frontend

# 3. DB 마이그레이션 (서비스 시작 전)
docker compose run --rm backend alembic upgrade head

# 4. 서비스 재시작 (DB/Redis는 재시작 안 함 → 데이터 보존)
docker compose up -d --no-deps backend worker frontend

# 5. 헬스체크
sleep 5
curl -sf http://localhost:3000 > /dev/null && echo "✓ Frontend OK"
curl -sf http://localhost:3000/api/health > /dev/null && echo "✓ Backend OK"

echo "=== Deploy Complete ==="
```

---

### 홈서버 최초 세팅 순서

```bash
# 1. Docker 설치 (Ubuntu 기준)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# 2. 프로젝트 클론
git clone https://github.com/your-repo/ops-platform.git
cd ops-platform

# 3. .env 생성
cp .env.example .env
# → .env 직접 편집 (비밀번호, JWT 시크릿 등)

# 4. 디렉토리 준비 (git이 추적 안 하는 것들)
mkdir -p pg_data redis_data files/video

# 5. 최초 실행
docker compose up -d db redis     # DB/Redis 먼저
sleep 5
docker compose run --rm backend alembic upgrade head  # 스키마 생성
docker compose up -d              # 전체 서비스 시작

# 6. Cloudflare Tunnel 설정 (위 섹션 참고)

# 7. 확인
docker compose ps
docker compose logs backend --tail=20
```

---

### 네트워크 보안 체크리스트

- [ ] `backend-net`에 `internal: true` → Redis/DB 외부 접근 원천 차단
- [ ] `db`, `redis` 서비스에 `ports:` 절 없음 (외부 바인딩 없음)
- [ ] `frontend` 포트를 `127.0.0.1:3000:80`으로 바인딩 → 로컬호스트만 접근
- [ ] Cloudflare Tunnel이 유일한 외부 진입점
- [ ] `CORS_ORIGINS`에 Tunnel 도메인만 등록
- [ ] Redis에 `requirepass` 설정
- [ ] `.env`, `pg_data/`, `redis_data/`, `files/`, `*.json` → `.gitignore`
- [ ] `JWT_SECRET_KEY` 64자 이상 랜덤 hex
- [ ] Admin 패스워드 bcrypt `$2b$12$` 이상 라운드

---

## B-12. 개발 착수 순서

```
Day 1-2: 인프라
  □ docker-compose.yml + Dockerfile 작성
  □ .env 생성
  □ docker compose up -d db redis
  □ FastAPI 기본 구조 + /health
  □ Alembic init + 전체 스키마 마이그레이션

Day 3-4: 백엔드 코어
  □ Auth (로그인, JWT)
  □ Members CRUD (3분리 점수)
  □ Sessions CRUD + 상태 머신

Day 5-6: 크롤러
  □ naver_session import API
  □ requests 기반 카페 API (fetch_article_detail, fetch_board_articles)
  □ find_posts_by_author, find_feedback_comments_by_author
  □ ARQ Task 연동

Day 7: PPT 스캐너 + 영상 업로드
  □ 메일 API 연동 (네이버 메일)
  □ Playwright 영상 업로드 (2단계 등록)

Day 8-9: PenaltyEngine + Settlement
  □ ATTENDANCE/PPT/HOMEWORK 매트릭스 구현
  □ Milestone 벌금 로직 (순서 주의)
  □ Finalize API
  □ 팀 히스토리 저장

Day 10: 팀 빌더
  □ build_teams (Snake Draft)
  □ get_collision_warnings
  □ POST /sessions/{id}/teams/generate API

Day 11-13: 프론트엔드
  □ Vite + TanStack Query + 라우팅
  □ Auth 페이지
  □ Dashboard (경고 배너, 현재 세션 카드)
  □ Members (ScoreDisplay 3분리)
  □ Ledger
  □ Session Wizard (팀빌딩 Kanban 포함)
  □ Prep / Ops / Post / Settlement 탭

Day 14: UI 폴리시 + 배포
  □ Noir 디자인 시스템
  □ 에러/로딩 처리
  □ Cloudflare Tunnel + deploy.sh
```

---

## B-13. 보안 체크리스트

- [ ] `.env`, `pg_data/`, `redis_data/`, `files/`, `login_helper.py` → `.gitignore`
- [ ] JWT Secret 64자 이상 랜덤
- [ ] Admin 패스워드 bcrypt 해시
- [ ] FINALIZED 세션 API 레벨 쓰기 차단
- [ ] CORS origins 프로덕션만 허용
- [ ] `naver_sessions` 테이블 Docker 내부 네트워크 격리
- [ ] `files/video/` 업로드 완료 후 파일 자동 삭제
- [ ] `DELETE /sessions/{id}` SETUP 상태에서만 허용
- [ ] TEAM 세션에서만 팀빌딩 API 허용 (type 체크)

---

*설계서 v3.0 끝*  
*워크플로우(섹션 A) + 기술 명세(섹션 B) 완전 통합 | 허점 12개 해결*
