#!/usr/bin/env bash
# PostgreSQL 일일 백업.
#
# cron 예시 (매일 새벽 4시):
#   0 4 * * * /home/ubuntu/ops-platform/scripts/backup_db.sh >> /home/ubuntu/backup.log 2>&1
#
# BACKUP_HC_URL 을 .env 에 넣어두면 healthchecks.io 같은 데 결과를 찍는다.
# 이게 있어야 '실패했다'뿐 아니라 '아예 안 돌았다'까지 잡힌다 — 후자가 더 위험하다.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
# .env 에 JSON 한 줄(서비스 계정 키 등)이 섞여 있어 통째로 source 하면 깨진다.
# 단순 KEY=VALUE 줄만 골라 읽는다.
if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1090
    . <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env | grep -v '[{}]')
    set +a
fi

BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
HC="${BACKUP_HC_URL:-}"
OUT="$BACKUP_DIR/db-$(date +%F_%H%M).dump"

ping_hc() { [ -n "$HC" ] && curl -fsS -m 10 --retry 3 "${HC%/}/$1" -o /dev/null || true; }

mkdir -p "$BACKUP_DIR"
ping_hc "start"

if ! docker compose exec -T db pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB" > "$OUT"; then
    echo "pg_dump 실패"
    rm -f "$OUT"
    ping_hc "fail"
    exit 1
fi

# 인증 실패한 pg_dump 가 헤더만 쓰고 exit 0 으로 끝나는 경우가 있다.
# 크기를 확인하지 않으면 몇 달 내내 '초록불 + 빈 백업'이 된다.
SIZE=$(stat -c%s "$OUT" 2>/dev/null || echo 0)
if [ "$SIZE" -lt 100000 ]; then
    echo "백업 파일이 너무 작음 (${SIZE} bytes) — 실패로 처리"
    ping_hc "fail"
    exit 1
fi

find "$BACKUP_DIR" -name 'db-*.dump' -mtime "+$KEEP_DAYS" -delete
echo "백업 완료: $OUT ($((SIZE / 1024 / 1024))MB)"
ping_hc "0"
