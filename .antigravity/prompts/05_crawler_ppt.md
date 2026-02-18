# Phase 05: 크롤러 — 네이버 세션 + 카페 API + PPT 스캔
> 참조: `docs/spec_crawler.md`
> 모델: **claude-opus-4-5** ← 이 Phase만 Opus 사용 (크롤러 로직 복잡)
> 예상 소요: 3-4시간

---

## 작업 목표

네이버 세션 관리, 카페 API 연동, PPT 스캔 크롤러를 구현한다.
ARQ worker와 연동하여 비동기 태스크로 실행한다.

---

## 핵심 제약

### 네이버 세션 (DB 기반)
```python
# naver_sessions 테이블에 Playwright storage_state JSON 저장
# is_valid=true 레코드는 항상 최대 1개
# 새 세션 import 시: 기존 레코드 모두 is_valid=false → 새 레코드 INSERT
# expires_hint: NID_SES 쿠키의 expires 파싱값
```

### 카페 API (검증된 엔드포인트)
```python
# 게시글 목록
"https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/{CAFE_ID}/menus/{menu_id}/articles"

# 게시글 상세 (댓글 포함)
"https://article.cafe.naver.com/gw/v4/cafes/{CAFE_ID}/articles/{article_id}"
# params: useCafeId=true, requestFrom=A
# Referer 헤더 필수
```

### 제목 파싱 기반 멤버 매칭
```python
# 게시글 제목 컨벤션:
# 사유서:   "사유서20주차_김민준P"
# 리뷰:     "20주차리뷰_김민준"
# 과제:     "20주차과제_김민준"
# PPT 메일 제목: 주차+이름 포함

# 매칭 순서: member.name 완전일치 → name_initial 일치 → 부분일치
# 매칭 실패 → MISSING 처리 (Admin이 수동 PASS로 전환 가능)
```

### 401 처리
```python
# 401 응답 → NaverSessionExpiredError 발생
# task status = "failed", error = "네이버 세션 만료"
# Dashboard 경고 배너 트리거
```

---

## 수행 작업 목록

1. **`backend/app/services/naver_session.py`** (`docs/spec_crawler.md` 참조)
   - `get_valid_requests_session(db)` → requests.Session or None
   - `_build_requests_session(storage)` → User-Agent, X-Cafe-Product 헤더 설정
   - `import_session(storage_json, db)` → DB 저장

2. **`backend/app/services/crawler_cafe.py`** (`docs/spec_crawler.md` 참조)
   - `fetch_article_detail(session, article_id)`
   - `fetch_board_articles(session, menu_id, page, page_size)`
   - `extract_name_from_title(title, week, doc_type)` → str or None
   - `match_member_by_name(extracted_name, members)` → Member or None
   - `find_all_posts_for_week(session, menu_id, week, doc_type, members)` → dict
   - `find_feedback_comments_for_week(session, video_menu_id, week, members)` → dict
   - `NaverSessionExpiredError` 예외 클래스

3. **`backend/app/services/crawler_ppt.py`**
   - PPT 스캔 로직: 메일 또는 카페 게시판에서 제출 여부 확인
   - `scan_ppt(session_id, mode: 'regular'|'late', db)` → dict
   - regular: 금요일 21:59:59 기준 / late: 토요일 09:59:59 기준

4. **`backend/app/worker.py`** ARQ 설정
   ```python
   async def task_scan_ppt(ctx, session_id, mode): ...
   async def task_scan_homework(ctx, session_id): ...
   async def task_upload_videos(ctx, session_id): ...

   class WorkerSettings:
       functions = [task_scan_ppt, task_scan_homework, task_upload_videos]
       redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
   ```

5. **`backend/app/routers/crawler.py`**
   ```
   GET    /crawler/naver/session-status
   POST   /crawler/naver/import          { storage_json }
   POST   /crawler/scan-ppt              { session_id, mode } → { task_id }
   GET    /crawler/task/{task_id}        → { status, result?, error?, progress? }
   ```
   - task 결과는 Redis에 저장 (ARQ job result)

6. **`login_helper.py`** 프로젝트 루트에 생성 (서버 배포 제외)
   - `docs/spec_crawler.md` B-9 참조

---

## 완료 조건

```bash
# 네이버 세션 import (login_helper.py로 생성한 파일 사용)
curl -X POST http://localhost:3000/api/v1/crawler/naver/import \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @naver_session.json
# → {"status": "ok"}

# 세션 상태 확인
curl http://localhost:3000/api/v1/crawler/naver/session-status \
  -H "Authorization: Bearer $TOKEN"
# → {"is_valid": true, "expires_hint": "..."}

# PPT 스캔 태스크 시작
curl -X POST http://localhost:3000/api/v1/crawler/scan-ppt \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"session_id": 1, "mode": "regular"}'
# → {"task_id": "abc123"}

# 태스크 상태 폴링
curl http://localhost:3000/api/v1/crawler/task/abc123 \
  -H "Authorization: Bearer $TOKEN"
# → {"status": "pending"} or {"status": "done", "result": {...}}
```
