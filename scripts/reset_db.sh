#!/usr/bin/env bash
# DB 스키마 초기화 (개발용)
set -euo pipefail

docker compose run --rm backend alembic downgrade base
docker compose run --rm backend alembic upgrade head
