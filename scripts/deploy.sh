#!/usr/bin/env bash
# 무중단 배포 — GitHub Actions(deploy.yml)가 서버에서 실행한다. 손으로 돌려도 같다.
#
# 예전엔 `docker compose down && up` 이라 배포마다 DB·Redis 까지 내려가 30초~1분 사이트가 멈췄다.
# 지금 경로: cloudflared → caddy → frontend(nginx) → backend / backend-b
#  - backend 두 개를 하나씩 교체한다. nginx 가 요청마다 살아 있는 쪽으로 보낸다.
#  - frontend 를 다시 띄우는 1~2초는 caddy 가 요청을 붙잡았다가 넘긴다.
#  - db/redis 는 설정이 바뀌지 않았으면 건드리지 않는다.
# 코드(./backend)는 볼륨으로 붙어 있어 이미지가 같아도 재시작해야 새 코드가 돈다 → --force-recreate.
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1   # (윈도우 Git Bash 에서 시험할 때) 컨테이너 안 경로를 바꾸지 않게

PULL="${PULL:-1}"   # 로컬 시험 때는 PULL=0

if [ "$PULL" = "1" ]; then
  git pull origin main
fi

# 1. 빌드 (실패하면 여기서 멈춘다 — 돌고 있는 서비스는 그대로)
docker compose build
# 받아올 이미지는 미리 — 처음 caddy 로 넘어갈 때 포트가 빈 사이에 다운로드하지 않게
docker compose pull --quiet caddy

# 2. 바탕 서비스 — 이미 떠 있고 바뀐 게 없으면 그대로 둔다
docker compose up -d --no-deps db redis dockerproxy

# 3. 마이그레이션은 백엔드를 바꾸기 전에, 떠 있는 백엔드 안에서 (코드는 볼륨이라 새 마이그레이션 파일이 보인다)
#    `compose run` 은 안 된다 — 일회용 컨테이너도 'backend' 이름을 달고 붙어서 nginx 가 그쪽으로 요청을 보낸다.
#    처음 배포처럼 백엔드가 없으면 그때만 run.  마이그레이션은 기존 코드와 공존 가능하게(컬럼 추가 위주).
if [ -n "$(docker compose ps -q --status running backend)" ]; then
  docker compose exec -T backend alembic upgrade head
else
  docker compose run --rm --no-deps backend alembic upgrade head
fi

wait_backend() {
  local svc="$1"
  for _ in $(seq 1 60); do
    if docker compose exec -T "$svc" curl -sf http://localhost:8000/health >/dev/null 2>&1; then
      echo "  ✓ $svc 응답"
      return 0
    fi
    sleep 2
  done
  echo "  ✗ $svc 가 2분 안에 안 떴다 — 배포 중단 (다른 백엔드는 계속 응답 중)" >&2
  docker compose logs --tail 50 "$svc" >&2 || true
  return 1
}

# 4. 백엔드 하나씩 교체 — 하나가 뜬 걸 확인하고 다음 것
#    (처음 한 번: backend-b 가 아직 없으면 먼저 띄워서, backend 를 바꾸는 동안 받게 한다)
if [ -z "$(docker compose ps -q --status running backend-b)" ]; then
  echo "→ backend-b 처음 띄움"
  docker compose up -d --no-deps backend-b
  wait_backend backend-b
fi
for svc in backend backend-b; do
  echo "→ $svc 교체"
  docker compose up -d --no-deps --force-recreate "$svc"
  wait_backend "$svc"
done

# 5. 프론트 — caddy 가 재시작 동안 요청을 붙잡는다
echo "→ frontend 교체"
docker compose up -d --no-deps --force-recreate frontend

# 6. caddy — 없으면 만들고(처음 한 번), 있으면 설정만 다시 읽는다(끊김 없음)
if [ -z "$(docker compose ps -q caddy)" ]; then
  docker compose up -d --no-deps caddy
else
  docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile
fi

# 7. 워커 (돌던 작업은 끊긴다 — 영상 업로드 중이면 다시 눌러야 함)
echo "→ worker 교체"
docker compose up -d --no-deps --force-recreate worker

# 8. 확인
for _ in $(seq 1 15); do
  curl -sf http://127.0.0.1:3000/ >/dev/null && curl -sf http://127.0.0.1:3000/api/v1/notifications/vapid-public-key >/dev/null && { echo "✓ 배포 완료"; break; }
  sleep 2
done

# 9. 이전 빌드 잔여물 정리
docker image prune -f >/dev/null
docker builder prune -f --keep-storage=2GB >/dev/null
