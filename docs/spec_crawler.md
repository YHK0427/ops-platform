# UnivPT Ops — 크롤러 서비스 구현 (B-4, B-9)
> 네이버 세션 관리, 카페 API, 제목 파싱, 영상 업로드, 로그인 헬퍼

## B-4. 크롤러 서비스 구현

### 네이버 세션 관리 (DB 기반)

```python
# services/naver_session.py

async def get_valid_requests_session(db) -> requests.Session | None:
    row = await db.execute(
        "SELECT * FROM naver_sessions WHERE is_valid=true ORDER BY created_at DESC LIMIT 1"
    ).fetchone()
    if not row:
        return None
    if row.expires_hint and row.expires_hint < datetime.now(timezone.utc):
        await db.execute("UPDATE naver_sessions SET is_valid=false WHERE id=:id", {"id": row.id})
        await db.commit()
        return None
    return _build_requests_session(row.storage_json)

def _build_requests_session(storage: dict) -> requests.Session:
    session = requests.Session()
    for cookie in storage.get("cookies", []):
        session.cookies.set(cookie["name"], cookie["value"], domain=".naver.com")
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "X-Cafe-Product": "pc"
    })
    return session

async def import_session(storage_json: dict, db) -> None:
    """로컬 PC에서 생성한 storage_state를 API로 받아 DB에 저장"""
    expires_hint = None
    for cookie in storage_json.get("cookies", []):
        if cookie.get("name") == "NID_SES":
            exp = cookie.get("expires", -1)
            if exp > 0:
                expires_hint = datetime.fromtimestamp(exp, tz=timezone.utc)
            break
    await db.execute("UPDATE naver_sessions SET is_valid=false")
    db.add(NaverSession(storage_json=storage_json, is_valid=True, expires_hint=expires_hint))
    await db.commit()
```

### 카페 API (requests 기반, 검증된 엔드포인트)

```python
# services/crawler_cafe.py

CAFE_ID = settings.NAVER_CAFE_ID

def fetch_article_detail(session: requests.Session, article_id) -> dict | None:
    url = f"https://article.cafe.naver.com/gw/v4/cafes/{CAFE_ID}/articles/{article_id}"
    session.headers.update({
        "Referer": f"https://cafe.naver.com/ca-fe/cafes/{CAFE_ID}/articles/{article_id}"
    })
    res = session.get(url, params={"useCafeId": "true", "requestFrom": "A"}, timeout=10)
    if res.status_code == 401:
        raise NaverSessionExpiredError()
    return res.json() if res.status_code == 200 else None

def fetch_board_articles(session, menu_id, page=1, page_size=50) -> list[dict]:
    url = (f"https://apis.naver.com/cafe-web/cafe-boardlist-api/v1"
           f"/cafes/{CAFE_ID}/menus/{menu_id}/articles")
    res = session.get(url, params={"page": page, "pageSize": page_size}, timeout=10)
    if res.status_code == 401:
        raise NaverSessionExpiredError()
    return [i.get("item", {}) for i in res.json().get("result", {}).get("articleList", [])]

# ─── 제목 파싱 기반 멤버 매칭 ───────────────────────────────────────
# 카페 게시글 제목 컨벤션:
#   사유서:   "사유서{주차}주차_{이름}P"     예: 사유서20주차_김민준P
#   리뷰:     "{주차}주차리뷰_{이름}"         예: 20주차리뷰_김민준
#   과제:     "{주차}주차과제_{이름}"         예: 20주차과제_김민준
# → 모든 매칭은 naver 계정 ID가 아닌 게시글 제목에서 이름 추출로 처리

def extract_name_from_title(title: str, week: int, doc_type: str) -> str | None:
    """
    제목에서 이름 추출.
    doc_type: 'excuse' | 'review' | 'homework'
    반환: 추출된 이름 문자열 or None
    """
    import re
    patterns = {
        "excuse":   rf"사유서\s*{week}\s*주차[_\s](.+?)P?\s*$",
        "review":   rf"{week}\s*주차\s*리뷰[_\s](.+?)\s*$",
        "homework": rf"{week}\s*주차\s*과제[_\s](.+?)\s*$",
    }
    m = re.search(patterns[doc_type], title, re.I)
    return m.group(1).strip() if m else None

def match_member_by_name(extracted_name: str, members: list) -> "Member | None":
    """
    추출된 이름을 멤버 DB와 매칭.
    1순위: member.name 완전 일치
    2순위: member.name_initial 일치
    3순위: member.name에 extracted_name 포함 (부분 일치)
    """
    # 1순위: 완전 일치
    for m in members:
        if m.name == extracted_name:
            return m
    # 2순위: 이니셜/약칭 일치
    for m in members:
        if m.name_initial and m.name_initial == extracted_name:
            return m
    # 3순위: 부분 일치 (이름이 긴 경우 대비)
    for m in members:
        if extracted_name in m.name or m.name in extracted_name:
            return m
    return None

def find_posts_by_member_name(session, menu_id, member_name: str, week: int,
                               doc_type: str, generation: int = 33) -> list[dict]:
    """
    게시판에서 특정 멤버 이름이 포함된 제목의 글 찾기.
    doc_type: 'review' | 'homework'
    """
    import re
    articles = fetch_board_articles(session, menu_id, page_size=100)
    result = []
    for a in articles:
        name = extract_name_from_title(a.get("subject", ""), week, doc_type)
        if name and match_member_by_name(name, [type("M", (), {"name": member_name, "name_initial": None})()] ):
            result.append(a)
    return result

def find_all_posts_for_week(session, menu_id: str, week: int,
                             doc_type: str, members: list) -> dict:
    """
    게시판의 해당 주차 글 전체를 한 번에 수집하고, 이름 파싱으로 멤버별 매핑.
    → 멤버별로 개별 API 호출하는 것보다 훨씬 효율적.
    반환: { member_id: [article, ...] }
    """
    articles = fetch_board_articles(session, menu_id, page_size=100)
    result = {m.id: [] for m in members}
    for a in articles:
        name = extract_name_from_title(a.get("subject", ""), week, doc_type)
        if not name:
            continue
        matched = match_member_by_name(name, members)
        if matched:
            result[matched.id].append(a)
    return result

def find_feedback_comments_for_week(session, video_menu_id: str, week: int,
                                     members: list) -> dict:
    """
    영상 게시판의 해당 주차 영상들 댓글을 수집, 댓글 작성자 이름으로 멤버 매핑.
    반환: { member_id: [comment, ...] }
    """
    import re, time
    # 영상 제목 패턴 (week 포함 여부로 필터)
    week_pattern = re.compile(rf"{week}주차", re.I)
    result = {m.id: [] for m in members}

    for article in fetch_board_articles(session, video_menu_id, page_size=50):
        if not week_pattern.search(article.get("subject", "")):
            continue
        detail = fetch_article_detail(session, article["articleId"])
        if not detail:
            continue
        for c in detail.get("result", {}).get("comments", {}).get("items", []):
            # 댓글 작성자 닉네임으로 매칭
            commenter_nick = c.get("writer", {}).get("nick", "")
            matched = match_member_by_name(commenter_nick, members)
            if matched:
                result[matched.id].append(c)
        time.sleep(0.5)
    return result

class NaverSessionExpiredError(Exception):
    pass
```

### 영상 업로드 — 구글 드라이브 → 네이버 카페

```
흐름:
1. Admin이 구글 드라이브 폴더에 영상을 순서대로 정리
   파일명 컨벤션: 김민준(8번째).mp4 / TeamA(1번째).mp4
2. [Upload Videos] 버튼 클릭
3. 백엔드가 드라이브 폴더에서 파일 순서대로 다운로드
4. 파일명에서 발표자명 파싱: r'^(.+?)\s*\(' → "김민준"
5. 카페 게시글 제목 생성: f"{week_num}주차_{session.title}_{발표자명}"
   예) "20주차_개인발표세션_김민준"
6. Playwright로 카페에 순서대로 업로드 (2단계 등록)
7. 업로드 완료 후 /app/files/video/ 임시 파일 삭제
```

```python
# services/crawler_video.py

import re
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
import io, os, asyncio

DRIVE_FOLDER_ID = settings.GOOGLE_DRIVE_FOLDER_ID

def get_drive_service():
    """서비스 어카운트 JSON으로 Drive API 클라이언트 생성"""
    import json
    from google.oauth2 import service_account
    creds_info = json.loads(settings.GOOGLE_SERVICE_ACCOUNT_JSON)
    creds = service_account.Credentials.from_service_account_info(
        creds_info, scopes=["https://www.googleapis.com/auth/drive.readonly"]
    )
    return build("drive", "v3", credentials=creds)

def list_drive_videos(week_num: int) -> list[dict]:
    """
    드라이브 폴더에서 해당 주차 영상 목록을 순서대로 가져옴.
    파일명에 (N번째) 포함 → 번호 기준 오름차순 정렬.
    """
    service = get_drive_service()
    results = service.files().list(
        q=f"'{DRIVE_FOLDER_ID}' in parents and mimeType contains 'video/'",
        fields="files(id, name)",
        orderBy="name"
    ).execute()
    files = results.get("files", [])
    # (N번째) 숫자 기준 정렬
    def sort_key(f):
        m = re.search(r'\((\d+)번째\)', f["name"])
        return int(m.group(1)) if m else 9999
    return sorted(files, key=sort_key)

def parse_presenter_name(filename: str) -> str:
    """
    '김민준(8번째).mp4' → '김민준'
    파싱 실패 시 확장자 제거한 전체 이름 반환
    """
    m = re.match(r'^(.+?)\s*\(', filename)
    if m:
        return m.group(1).strip()
    return os.path.splitext(filename)[0].strip()

def download_drive_file(file_id: str, dest_path: str) -> None:
    service = get_drive_service()
    request = service.files().get_media(fileId=file_id)
    with open(dest_path, "wb") as f:
        downloader = MediaIoBaseDownload(f, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()

async def upload_all_videos(week_session_id: int, db) -> list[dict]:
    week_session = await get_week_session(week_session_id, db)
    storage = await get_naver_storage_state(db)

    drive_files = list_drive_videos(week_session.week_num)
    if not drive_files:
        raise RuntimeError("드라이브에 영상 파일이 없습니다.")

    results = []
    tmp_dir = "/app/files/video"
    os.makedirs(tmp_dir, exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(storage_state=storage)
        await ctx.add_init_script(
            "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})"
        )
        page = await ctx.new_page()

        for drive_file in drive_files:
            raw_name   = drive_file["name"]
            presenter  = parse_presenter_name(raw_name)
            # 게시글 제목: 20주차_개인발표세션_김민준
            cafe_title = f"{week_session.week_num}주차_{week_session.title}_{presenter}"
            tmp_path   = os.path.join(tmp_dir, raw_name)

            try:
                # 드라이브에서 다운로드
                download_drive_file(drive_file["id"], tmp_path)
                # 카페 업로드
                ok = await _upload_single(page, tmp_path, cafe_title)
                results.append({"file": raw_name, "title": cafe_title, "success": ok})
                if ok:
                    await asyncio.sleep(10)
            except Exception as e:
                results.append({"file": raw_name, "title": cafe_title,
                                "success": False, "error": str(e)})
            finally:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)  # 업로드 후 임시 파일 삭제

        await browser.close()
    return results

async def upload_all_videos(session_id: int, db) -> list[dict]:
    storage = await get_naver_storage_state(db)
    video_files = [
        os.path.join("/app/files/video", f)
        for f in os.listdir("/app/files/video") if f.endswith(".mp4")
    ]
    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(storage_state=storage)
        await ctx.add_init_script(
            "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})"
        )
        page = await ctx.new_page()
        for video in video_files:
            ok = await _upload_single(page, video)
            results.append({"file": os.path.basename(video), "success": ok})
            if ok:
                await asyncio.sleep(10)
        await browser.close()
    return results

async def _upload_single(page, video_path: str, cafe_title: str) -> bool:
    url = (f"https://m.cafe.naver.com/ca-fe/web/cafes/{settings.NAVER_CAFE_ID}"
           f"/menus/{settings.NAVER_CAFE_MENU_VIDEO}/articles/write?boardType=L")
    await page.goto(url)
    if "nid.naver.com" in page.url:
        raise NaverSessionExpiredError("로그인 페이지 리다이렉트")
    await page.wait_for_load_state("networkidle")
    await page.locator("textarea[placeholder='제목'],.textarea_input").first.fill(cafe_title)
    try:
        async with page.expect_file_chooser() as fc:
            await page.locator("button[aria-label*='동영상'],button:has-text('동영상')").first.click()
        await fc.value.set_files(video_path)
        await page.get_by_text("업로드 완료!", exact=False).wait_for(state="visible", timeout=180_000)
        await page.locator("button:has-text('등록'),button:has-text('완료'),.btn_done").first.click()
        await asyncio.sleep(3)
    except Exception as e:
        return False
    await asyncio.sleep(2)
    try:
        await page.locator("button:has-text('등록'),.GnbBntRight__green,.btn_register").first.click()
        await page.wait_for_url(lambda u: "/articles/write" not in u, timeout=30_000)
        return True
    except:
        return False
```

---


---

## B-9. 로그인 헬퍼 스크립트 (로컬 PC 실행용)

```python
# login_helper.py  ← 로컬 PC에서만 실행, 서버에 올리지 않음

"""
사용법:
  python login_helper.py
  → 브라우저 열림 → 로그인 완료 → naver_session.json 생성
  → curl -X POST https://your-domain.com/api/v1/crawler/naver/import \
         -H "Authorization: Bearer {token}" \
         -d @naver_session.json
"""
from playwright.sync_api import sync_playwright
import json, time

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False)
    ctx = browser.new_context()
    page = ctx.new_page()
    page.goto("https://nid.naver.com/nidlogin.login")
    print("로그인 완료 후 네이버 메인 화면을 기다리세요...")
    page.wait_for_url("https://www.naver.com/**", timeout=300_000)
    time.sleep(2)
    storage = ctx.storage_state()
    with open("naver_session.json", "w") as f:
        json.dump(storage, f)
    print("naver_session.json 생성 완료")
    browser.close()
```

---

