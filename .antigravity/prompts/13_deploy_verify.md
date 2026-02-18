# Phase 13: 최종 통합 + 배포 검증
> 참조: `docs/spec_infra.md`
> 모델: **claude-sonnet-4-5**
> 예상 소요: 2시간

---

## 작업 목표

전체 서비스를 Docker로 올리고, 엔드투엔드 흐름을 검증한다.
Cloudflare Tunnel 연동을 확인한다.

---

## 수행 작업 목록

1. **`frontend` 빌드 테스트**
   ```bash
   cd frontend && npm run build
   # → dist/ 폴더 생성 확인 (에러 없음)
   ```

2. **전체 Docker Compose 기동**
   ```bash
   docker compose up -d
   docker compose ps
   # → 5개 서비스 모두 healthy/running
   ```

3. **네트워크 격리 최종 확인**
   ```bash
   # frontend 컨테이너가 db에 직접 접근 불가 확인
   docker compose exec frontend wget -q --spider http://db:5432 2>&1
   # → 실패해야 정상

   # backend는 db 접근 가능 확인
   docker compose exec backend python -c \
     "import asyncio; from app.database import engine; print('OK')"
   ```

4. **보안 체크리스트** (`docs/spec_infra.md` B-13 참조)
   - [ ] `.env` git에 올라가지 않음 확인 (`git status`)
   - [ ] `pg_data/`, `redis_data/` `.gitignore` 확인
   - [ ] Redis `requirepass` 설정 확인
   - [ ] CORS_ORIGINS에 localhost 미포함 (프로덕션 도메인만)

5. **엔드투엔드 시나리오 검증**
   ```
   ① 로그인
   ② 멤버 3명 등록 (1명에 "leader" 태그)
   ③ TEAM 세션 생성 → 팀빌딩 → 확정
   ④ Prep 탭: 출결 업데이트
   ⑤ PPT 스캔 (mock 또는 실제)
   ⑥ Settlement Preview 확인
   ⑦ Finalize → Ledger 확인
   ```

6. **`scripts/deploy.sh`** 실행 테스트
   ```bash
   bash scripts/deploy.sh
   # → "Deploy Complete" 메시지
   ```

7. **Cloudflare Tunnel 설정** (`docs/spec_infra.md` 참조)
   ```bash
   cloudflared tunnel create univpt-ops
   cloudflared tunnel route dns univpt-ops ops.your-domain.com
   sudo cloudflared service install
   sudo systemctl enable --now cloudflared
   ```

---

## 완료 조건

```bash
# 외부에서 접근 확인 (Cloudflare Tunnel 도메인)
curl https://ops.your-domain.com/api/health
# → {"status": "ok"}

# 브라우저로 https://ops.your-domain.com 접속
# → 로그인 페이지 표시
# → 로그인 후 Dashboard 표시
```

---

## 이후 유지보수 명령어

```bash
# 로그 확인
docker compose logs backend --tail=50 -f
docker compose logs worker --tail=20

# DB 백업
docker compose exec db pg_dump -U $POSTGRES_USER $POSTGRES_DB > backup_$(date +%Y%m%d).sql

# 서비스 재시작 (DB는 건드리지 않음)
docker compose up -d --no-deps backend worker frontend

# 마이그레이션 추가
docker compose run --rm backend alembic revision --autogenerate -m "설명"
docker compose run --rm backend alembic upgrade head
```
