# Phase 01: 인프라 구축
> 참조: `docs/spec_infra.md`
> 모델: **claude-sonnet-4-5** (구조적 작업, Opus 불필요)
> 예상 소요: 1-2시간

---

## 작업 목표

3-Tier Docker 구성 전체를 세팅한다.
프론트(nginx) → 백엔드(FastAPI) → 데이터(PostgreSQL + Redis) 레이어 분리.

---

## 핵심 제약 (설계서 발췌, 반드시 준수)

```
네트워크:
- frontend-net: bridge (frontend ↔ backend)
- backend-net:  bridge + internal: true (backend ↔ db ↔ redis, 외부 라우팅 차단)
- frontend는 backend-net 미연결 (DB 직접 접근 원천 차단)

포트 바인딩:
- frontend: "127.0.0.1:3000:80" (로컬호스트만, Cloudflare Tunnel 전용)
- backend:  expose: 8000 only (호스트 바인딩 없음)
- db, redis: ports: 절 없음 (절대 외부 노출 금지)

컨테이너:
- backend healthcheck: GET /health → 200
- db healthcheck: pg_isready
- worker는 frontend-net 미연결 (backend-net만)
```

---

## 수행 작업 목록

1. **`docker-compose.yml`** 생성
   - 위 네트워크 제약 그대로
   - `docs/spec_infra.md`의 전체 yaml 참조

2. **`backend/Dockerfile`** 생성
   - python:3.12-slim 기반
   - Playwright Chromium 설치 포함
   - `--break-system-packages` 사용

3. **`frontend/Dockerfile`** 생성
   - Node 20 빌드 → nginx:1.25-alpine 멀티스테이지

4. **`frontend/nginx.conf`** 생성
   - `/api/` 프록시 → backend:8000
   - `proxy_read_timeout 600s` (크롤러 장시간 실행 대비)
   - SPA 라우팅: `try_files $uri $uri/ /index.html`

5. **`.env.example`** 생성 (`docs/spec_infra.md` `.env 전체` 섹션 참조)

6. **`.gitignore`** 생성
   - `.env`, `pg_data/`, `redis_data/`, `files/`, `*.json` (서비스 어카운트) 포함

7. **디렉토리 생성**: `pg_data/`, `redis_data/`, `files/video/`

8. **`scripts/reset_db.sh`** 생성
   ```bash
   docker compose run --rm backend alembic downgrade base
   docker compose run --rm backend alembic upgrade head
   ```

9. **`scripts/deploy.sh`** 생성 (`docs/spec_infra.md` deploy.sh 섹션 참조)

---

## 완료 조건 (직접 실행해서 확인)

```bash
# 1. DB/Redis 기동
docker compose up -d db redis

# 2. 헬스체크
docker compose ps
# → db: healthy, redis: healthy

# 3. 네트워크 격리 확인
docker network ls | grep univpt
# → frontend-net, backend-net 두 개 존재

# 4. backend-net internal 확인
docker network inspect <프로젝트명>_backend-net | grep '"Internal"'
# → "Internal": true
```

모두 통과하면 Phase 02로 이동.
