# Phase 06: 크롤러 — 영상 업로드 (구글 드라이브 → 네이버 카페)
> 참조: `docs/spec_crawler.md`
> 모델: **claude-opus-4-5** (Playwright 2단계 등록 로직 복잡)
> 예상 소요: 2-3시간

---

## 작업 목표

구글 드라이브에서 영상을 순서대로 다운로드하여 네이버 카페에 업로드한다.

---

## 핵심 제약

### 드라이브 파일 컨벤션
```
파일명: 김민준(8번째).mp4
파싱: 정규식 r'^(.+?)\s*\(' → "김민준"
정렬: (N번째) 숫자 기준 오름차순
```

### 게시글 제목 생성
```python
# INDIVIDUAL: f"{session.week_num}주차_{session.title}_{presenter}"
# 예: "20주차_개인발표세션_김민준"
# TEAM: f"{session.week_num}주차_{session.title}_{team_name}"
```

### Playwright 업로드 (검증된 2단계 등록 로직)
```python
# 1단계: m.cafe.naver.com 모바일 에디터 사용 (PC보다 안정적)
url = f"https://m.cafe.naver.com/ca-fe/web/cafes/{CAFE_ID}/menus/{MENU_VIDEO}/articles/write?boardType=L"

# 2단계: 영상 파일 선택 → 업로드 완료 대기 → 등록
# "업로드 완료!" 텍스트 대기: timeout=180_000 (3분)
# 업로드 간 sleep(10) 필수 (rate limit 방지)

# webdriver 속성 숨김 필수:
await ctx.add_init_script(
    "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})"
)
```

### 임시 파일 관리
```python
# 다운로드: /app/files/video/{원본파일명}
# 업로드 완료 or 실패 후 즉시 os.remove(tmp_path)
# 다음 파일 업로드 전 sleep(10)
```

---

## 수행 작업 목록

1. **`backend/app/services/crawler_video.py`** (`docs/spec_crawler.md` 전체 참조)
   - `get_drive_service()` — 서비스 어카운트 JSON으로 인증
   - `list_drive_videos(week_num)` — (N번째) 정렬
   - `parse_presenter_name(filename)` — 정규식 파싱
   - `download_drive_file(file_id, dest_path)`
   - `upload_all_videos(session_id, db)` — 전체 흐름 오케스트레이션
   - `_upload_single(page, video_path, cafe_title)` — Playwright 2단계

2. **`backend/app/worker.py`** 업데이트
   - `task_upload_videos` 함수가 `crawler_video.upload_all_videos` 호출

3. **`backend/app/routers/crawler.py`** 업데이트
   ```
   POST /crawler/upload-videos   { session_id } → { task_id }
   ```

4. **`backend/pyproject.toml`** 의존성 추가
   - `google-api-python-client>=2.120.0`
   - `google-auth>=2.29.0`

---

## 완료 조건

```bash
# 의존성 설치 확인
docker compose run --rm backend pip show google-api-python-client

# 드라이브 파일 목록 확인 (실제 드라이브 폴더 설정 필요)
# 단위 테스트로 파싱 로직만 먼저 확인:
# parse_presenter_name("김민준(8번째).mp4") == "김민준"
# parse_presenter_name("TeamA(1번째).mp4") == "TeamA"

# 업로드 태스크 시작
curl -X POST http://localhost:3000/api/v1/crawler/upload-videos \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"session_id": 1}'
# → {"task_id": "xyz789"}

# 진행상황 폴링
curl http://localhost:3000/api/v1/crawler/task/xyz789 \
  -H "Authorization: Bearer $TOKEN"
# → {"status":"pending","progress":"1/5 업로드 중: 이지은(2번째).mp4"}
```
