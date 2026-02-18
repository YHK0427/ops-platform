#!/usr/bin/env bash
# scripts/test_backend.sh — 백엔드 핵심 API 연결 테스트
set -euo pipefail

BASE="http://localhost:3000/api/v1"
PW="${ADMIN_PASSWORD:-yourpassword}"

echo "=== UnivPT Ops Backend 테스트 ==="

# 1. 헬스체크
echo -n "[1] Health check... "
curl -sf "$BASE/../health" > /dev/null && echo "✓" || { echo "✗ FAIL"; exit 1; }

# 2. 로그인
echo -n "[2] Login... "
TOKEN=$(curl -sf -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"$PW\"}" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
[[ -n "$TOKEN" ]] && echo "✓" || { echo "✗ FAIL"; exit 1; }

AUTH="-H \"Authorization: Bearer $TOKEN\""

# 3. 멤버 목록
echo -n "[3] GET /members... "
curl -sf "$BASE/members" -H "Authorization: Bearer $TOKEN" > /dev/null && echo "✓" || echo "✗ FAIL"

# 4. 세션 목록
echo -n "[4] GET /sessions... "
curl -sf "$BASE/sessions" -H "Authorization: Bearer $TOKEN" > /dev/null && echo "✓" || echo "✗ FAIL"

# 5. Ledger 목록
echo -n "[5] GET /ledger... "
curl -sf "$BASE/ledger" -H "Authorization: Bearer $TOKEN" > /dev/null && echo "✓" || echo "✗ FAIL"

# 6. 네이버 세션 상태
echo -n "[6] Naver session status... "
curl -sf "$BASE/crawler/naver/session-status" -H "Authorization: Bearer $TOKEN" > /dev/null && echo "✓" || echo "✗ FAIL"

echo "=== 테스트 완료 ==="
