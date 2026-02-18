#!/usr/bin/env bash
# 운영 배포 스크립트
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
