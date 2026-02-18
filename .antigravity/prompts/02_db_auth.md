# Phase 02: DB 스키마 + Auth
> 참조: `docs/spec_schema.md`, `docs/spec_api.md` (Auth 섹션)
> 모델: **claude-sonnet-4-5**
> 예상 소요: 2-3시간

---

## 작업 목표

전체 DB 스키마를 SQLAlchemy 모델로 구현하고, Alembic 마이그레이션을 적용한다.
JWT 기반 단일 어드민 인증을 구현한다.

---

## 핵심 제약

```
net_score:
- total_plus_score + total_minus_score 를 자동 계산하는 DB 트리거 존재
- SQLAlchemy 모델에서 net_score를 직접 업데이트하지 않는다
- Alembic 마이그레이션에 트리거 DDL 포함 필수

점수 저장 방식:
- total_plus_score:  항상 ≥ 0 (상점)
- total_minus_score: 항상 ≤ 0 (벌점, 음수로 저장)
- net_score:         트리거가 자동 계산

attendance.excuse_type:
- CHECK 제약: ('PRE', 'POST') or NULL
- 마감 로직은 API 레이어에서 처리 (모델 레벨 아님)
```

---

## 수행 작업 목록

1. **`backend/app/config.py`**
   - `pydantic_settings.BaseSettings`로 `.env` 로드
   - DATABASE_URL, REDIS_URL, JWT_SECRET_KEY 등 전체 변수 포함

2. **`backend/app/database.py`**
   - `create_async_engine`, `AsyncSession`, `Base` 설정

3. **`backend/app/models.py`** — `docs/spec_schema.md` B-1 전체 구현
   - `Member`: tags는 `ARRAY(String)` 타입
   - `Session`: title 컬럼 포함 (VARCHAR 100, NOT NULL)
   - `Team`, `TeamMember`, `TeamHistory`
   - `Assignment`: UNIQUE (session_id, member_id, type)
   - `Attendance`: excuse_type CheckConstraint 포함
   - `Ledger`: type CheckConstraint 7개 값 전체 포함
   - `NaverSession`

4. **`backend/alembic/`** 초기화 및 첫 마이그레이션
   - `alembic init alembic`
   - `env.py`에 async 엔진 + 모델 임포트 설정
   - `alembic revision --autogenerate -m "초기 스키마"`
   - 마이그레이션 파일에 `sync_net_score` 트리거 DDL 수동 추가:
     ```python
     # upgrade() 안에 추가
     op.execute("""
     CREATE OR REPLACE FUNCTION sync_net_score() RETURNS TRIGGER AS $$
     BEGIN
         NEW.net_score := NEW.total_plus_score + NEW.total_minus_score;
         RETURN NEW;
     END;
     $$ LANGUAGE plpgsql;

     CREATE TRIGGER trg_sync_net_score
         BEFORE INSERT OR UPDATE OF total_plus_score, total_minus_score
         ON members FOR EACH ROW EXECUTE FUNCTION sync_net_score();
     """)
     # downgrade() 안에 추가
     op.execute("DROP TRIGGER IF EXISTS trg_sync_net_score ON members;")
     op.execute("DROP FUNCTION IF EXISTS sync_net_score;")
     ```

5. **`backend/app/routers/auth.py`**
   - `POST /auth/login` → bcrypt 검증 → JWT 반환
   - `POST /auth/refresh`
   - `DELETE /auth/logout`

6. **`backend/app/deps.py`**
   - `get_db()`: AsyncSession 의존성
   - `get_current_user()`: JWT 검증 의존성

7. **`backend/app/main.py`**
   - FastAPI 앱 생성, CORS 설정 (`CORS_ORIGINS` 환경변수)
   - `GET /health` → `{"status": "ok"}` (Docker healthcheck용)
   - auth 라우터 등록

---

## 완료 조건

```bash
# 마이그레이션 적용
docker compose run --rm backend alembic upgrade head

# 트리거 확인
docker compose exec db psql -U $POSTGRES_USER -d $POSTGRES_DB \
  -c "\df sync_net_score"
# → 함수 존재 확인

# 헬스 엔드포인트
docker compose up -d backend
curl http://localhost:3000/api/health
# → {"status": "ok"}

# 로그인 테스트
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"yourpassword"}'
# → {"access_token": "...", "token_type": "bearer"}
```
