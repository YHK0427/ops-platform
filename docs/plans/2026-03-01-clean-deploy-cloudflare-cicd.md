# Clean Deploy + Cloudflare Tunnel + CI/CD

## Context
개발 폴더(`/home/ubuntu/ops-platform`)가 지저분하므로, 새 폴더에 GitHub clone → Docker 배포 → Cloudflare Tunnel 노출 → GitHub Actions CI/CD 자동 배포까지 구축한다.

**Repo:** `https://github.com/YHK0427/ops-platform.git`
**현재 아키텍처:** Docker 4-tier (frontend:Nginx → backend:FastAPI + worker:ARQ → db:PG + redis)
**Frontend port:** 127.0.0.1:3000 (nginx:80)

---

## Step 1: 클린 클론 + 테스트

1. `/home/ubuntu/ops-deploy` 디렉토리 생성
2. `git clone https://github.com/YHK0427/ops-platform.git /home/ubuntu/ops-deploy`
3. `.env` 복사: `cp /home/ubuntu/ops-platform/.env /home/ubuntu/ops-deploy/.env`
4. `CORS_ORIGINS` 업데이트 — Cloudflare 도메인 추가 (나중에 터널 URL 확정 후)
5. 기존 Docker 스택 중지: `cd /home/ubuntu/ops-platform && docker compose down`
   - DB/Redis 데이터는 `pg_data/`, `redis_data/`에 남으므로 손실 없음
   - 단, 새 배포 폴더에서는 새 DB로 시작 (빈 상태)
6. `cd /home/ubuntu/ops-deploy && docker compose up -d --build`
7. healthcheck 확인: `curl http://localhost:3000`
8. Alembic 마이그레이션: `docker compose exec backend alembic upgrade head`
9. 브라우저에서 localhost:3000 접속 테스트

## Step 2: Cloudflare Tunnel 설치 + 설정

1. `cloudflared` 설치:
   ```bash
   curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb
   sudo dpkg -i /tmp/cloudflared.deb
   ```

2. Cloudflare 인증:
   ```bash
   cloudflared tunnel login
   ```
   → 브라우저에서 Cloudflare 계정 인증 (cert.pem 다운로드됨)

3. 터널 생성:
   ```bash
   cloudflared tunnel create ops-platform
   ```
   → Tunnel ID + credentials JSON 파일 생성

4. 설정 파일 작성 (`/home/ubuntu/ops-deploy/cloudflared-config.yml`):
   ```yaml
   tunnel: <TUNNEL_ID>
   credentials-file: /home/ubuntu/.cloudflared/<TUNNEL_ID>.json

   ingress:
     - hostname: ops.univpt.com    # 또는 사용자가 원하는 도메인
       service: http://localhost:3000
     - service: http_status:404
   ```

5. DNS 라우팅:
   ```bash
   cloudflared tunnel route dns ops-platform ops.univpt.com
   ```

6. `.env`의 `CORS_ORIGINS` 업데이트:
   ```
   CORS_ORIGINS=https://ops.univpt.com
   ```
   → backend 재시작: `docker compose restart backend worker`

7. 터널 실행 (테스트):
   ```bash
   cloudflared tunnel --config /home/ubuntu/ops-deploy/cloudflared-config.yml run
   ```

8. systemd 서비스로 등록 (자동 시작):
   ```bash
   sudo cloudflared service install
   ```
   또는 수동으로 systemd unit 파일 생성

## Step 3: GitHub Actions CI/CD

**`.github/workflows/deploy.yml`** (새 파일):

```yaml
name: Deploy to Server

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: ${{ secrets.DEPLOY_USER }}
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          script: |
            cd /home/ubuntu/ops-deploy
            git pull origin main
            docker compose build --no-cache
            docker compose up -d
            docker compose exec -T backend alembic upgrade head
```

**GitHub Secrets 설정 필요:**
- `DEPLOY_HOST`: 서버 IP 또는 호스트명
- `DEPLOY_USER`: `ubuntu`
- `DEPLOY_SSH_KEY`: 서버 SSH 개인키

## Step 4: 검증

1. localhost:3000 정상 동작 확인
2. https://ops.univpt.com (터널 도메인) 접속 확인
3. 로그인 → 대시보드 정상 표시
4. GitHub에 테스트 커밋 push → Actions 워크플로우 트리거 → 서버 자동 배포 확인

---

## 파일 변경 요약

| 파일 | 변경 |
|------|------|
| `.github/workflows/deploy.yml` | (신규) CI/CD 워크플로우 |
| `cloudflared-config.yml` | (신규, gitignore) 터널 설정 |
| `.env` | CORS_ORIGINS 업데이트 |
| `.gitignore` | `cloudflared-config.yml` 추가 |

## 주의사항
- cloudflared 인증은 브라우저 필요 (사용자가 직접 인증해야 함)
- 도메인이 Cloudflare DNS에 등록되어 있어야 함
- SSH 키는 사용자가 GitHub Secrets에 직접 등록
