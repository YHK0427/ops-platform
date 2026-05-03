# 팀세션 피드백 감지 + Drive 영상 코드 정리 + 업로드 진행 디테일 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 7주차 운영 중 발견된 팀세션 피드백 감지 누락 버그를 고치고, Drive 영상 다운로드 경로를 모두 제거하고, 영상 업로드 진행 상황을 더 자세히 보여준다.

**Architecture:**
- 백엔드: `crawler_homework.py` 매칭 로직 강화(break 제거 + 팀명 매칭 추가), `crawler_video.py`에서 Drive video 함수만 제거(PPT_EMAIL용 함수는 보존), Redis progress에 `started_at` 추가
- 프론트: OpsTab의 Drive 영상 패널 통째 제거, 업로드 task 상태 박스를 별도 섹션으로 분리, VideoUploadPanel `buildTitle` 로직 변경 + "이름 붙이기" 토글 추가, elapsed time 1초 갱신

**Tech Stack:** FastAPI(async), SQLAlchemy 2.0(async), Redis/ARQ, Playwright, React 19 + TypeScript, TanStack Query

**관련 spec:** `docs/superpowers/specs/2026-05-03-team-feedback-and-drive-cleanup-design.md`

---

## File Structure

| 파일 | 역할 / 변경 |
|------|------|
| `backend/app/services/crawler_homework.py` | `scan_feedback_comments`의 영상 owner 매칭 로직 강화 |
| `backend/app/services/crawler_video.py` | Drive video 함수만 제거(`list_drive_videos*`, `download_drive_file`, `parse_presenter_name`), PPT_EMAIL용 함수 보존(`get_drive_service`, `create_drive_folder`, `upload_file_to_drive`, `copy_drive_file`, `download_drive_file_bytes`). prefetch + local/remote 분기 제거. `started_at` 추가 |
| `backend/app/routers/crawler.py` | `/drive-videos` 엔드포인트, `_parse_order`/`_parse_group` helper 삭제 |
| `backend/app/schemas/crawler.py` | `DriveVideoListResponse`, `DriveVideoItem` 삭제 |
| `frontend/src/pages/session/OpsTab.tsx` | Drive 영상 패널(390~572줄) 삭제. task 상태 박스를 별도 섹션으로 분리. `uploadedFromDirect` 분기 제거. `team_member_names` 배열을 VideoUploadPanel에 전달 |
| `frontend/src/components/VideoUploadPanel.tsx` | `buildTitle` 변경, "이름 붙이기" 토글 버튼 추가, elapsed time 표시 |
| `frontend/src/hooks/useCrawler.ts` | `useDriveVideos` 훅, `DriveVideoItem` / `DriveVideoListResponse` 타입, `crawlerKeys.driveVideos` 삭제 |

**보존(이메일 PPT 의존):**
- `crawler_video.py`의 `get_drive_service`, `create_drive_folder`, `upload_file_to_drive`, `copy_drive_file`, `download_drive_file_bytes`
- `routers/sessions.py`의 PPT 업로드/다운로드 엔드포인트(라인 1310, 1373)
- `routers/sessions.py`의 세션 생성 시 Drive ppt 폴더 생성 (videos 폴더 생성도 그대로 둠 — 안 쓰지만 코드 단순화 위해 일단 유지)
- `config.py`의 `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_DRIVE_FOLDER_ID`
- `crawler_ppt.py` 그대로

---

## Task 1: 팀세션 피드백 영상 owner 매칭 강화

**Files:**
- Modify: `backend/app/services/crawler_homework.py:230-245` (영상 article 순회 부분)

`crawler_homework.py:scan_feedback_comments` 의 영상 owner 매칭 부분 변경:
- 제목 prefix(`...]-`) 이후의 가변 부분만 매칭 대상으로 사용
- 멤버 이름 매칭에서 `break` 제거 → 매치되는 모든 멤버를 owner로 등록
- 팀명 매칭 추가 → 매치되는 모든 팀의 모든 멤버를 owner로 등록 (Team + TeamMember 조회 필요)

- [ ] **Step 1: 함수 시작 부분에 팀 멤버 매핑 로드**

`scan_feedback_comments` 함수 안, `if not video_articles: ...` 이후 (현재 라인 220 근처)에 팀 정보 로드 추가:

```python
    # 팀세션 피드백 매칭용 — 팀 이름 → 그 팀의 멤버 ID 리스트
    teams_stmt = select(Team).where(Team.session_id == session_id)
    teams_result = await db.execute(teams_stmt)
    session_teams = teams_result.scalars().all()
    team_to_member_ids: dict[str, list[int]] = {}
    if session_teams:
        for team in session_teams:
            tm_stmt = select(TeamMember.member_id).where(TeamMember.team_id == team.id)
            tm_result = await db.execute(tm_stmt)
            team_to_member_ids[team.name] = [row[0] for row in tm_result.all()]
```

(파일 상단의 import에 `Team`, `TeamMember`가 이미 있는지 확인. 없으면 추가)

- [ ] **Step 2: 매칭 로직 교체 (break 제거 + 팀명 매칭 + prefix 분리)**

현재 코드 (라인 236~245):

```python
        # 영상 저자 매칭: 제목에 멤버 이름이 포함되어 있는지로 판단
        # 예: "연합UP 32기 11주차 발표-[시초윺]-김민지P(1분반 1번째)"
        title = article.get("subject", "")
        owner = None
        for m in members:
            if m.name in title:
                owner = m
                break
        if owner:
            member_to_articles.setdefault(owner.id, set()).add(article_id)
```

다음으로 교체:

```python
        # 영상 저자 매칭: 제목에서 prefix(`...]-`) 이후의 가변 부분만 검사
        # 예: "연합UP 32기 11주차 발표-[시초윺]-김민지P(1분반 1번째)"
        #     → variable_part = "김민지P(1분반 1번째)"
        # 팀명 매칭 + 멤버 이름 다중 매칭을 union으로 owner 등록.
        title = article.get("subject", "")
        sep_idx = title.find("]-")
        variable_part = title[sep_idx + 2:] if sep_idx >= 0 else title

        owner_member_ids: set[int] = set()

        # 팀명 매칭 — 팀세션이면 팀명 substring 매치되는 모든 팀의 멤버 등록
        for team_name, mids in team_to_member_ids.items():
            if team_name and team_name in variable_part:
                owner_member_ids.update(mids)

        # 멤버 이름 다중 매칭 — break 없이 모든 매치 수집
        for m in members:
            if m.name in variable_part:
                owner_member_ids.add(m.id)

        for mid in owner_member_ids:
            member_to_articles.setdefault(mid, set()).add(article_id)
```

- [ ] **Step 3: 단순 단위 테스트 작성 — 매칭 로직 검증**

`backend/test_feedback_matching.py` 새 파일:

```python
"""scan_feedback_comments의 owner 매칭 로직만 분리 테스트"""

def _match_owners(title: str, members_by_name: dict, team_to_member_ids: dict):
    """프로덕션 코드와 동일한 매칭 알고리즘"""
    sep_idx = title.find("]-")
    variable_part = title[sep_idx + 2:] if sep_idx >= 0 else title

    owner_ids = set()
    for team_name, mids in team_to_member_ids.items():
        if team_name and team_name in variable_part:
            owner_ids.update(mids)
    for name, mid in members_by_name.items():
        if name in variable_part:
            owner_ids.add(mid)
    return owner_ids


def test_team_session_multi_presenter():
    """7주차 짝짜꿍 케이스 — 신념 팀 매칭 + 두 발표자 모두 등록"""
    title = "연합UP 33기 7주차 발표-[짝짜꿍]-주제01 신념(김다은P, 도민희P)"
    members = {"김다은": 11, "도민희": 22, "이슬아": 33}
    teams = {"신념": [11, 22], "짝짜꿍": [99]}  # 짝짜꿍은 세션제목인데 팀명으로도 등록되어 있음 가정
    owners = _match_owners(title, members, teams)
    # prefix 안의 [짝짜꿍]은 매칭 안 되어야 함 → 99 없음
    # 신념 팀의 멤버 11, 22 + 이름 매칭 11, 22 = {11, 22}
    assert owners == {11, 22}


def test_individual_session_single_presenter():
    """개인 세션 — 한 명만 매칭"""
    title = "연합UP 33기 6주차 발표-[너의선택은]-김민지P(1분반 1번째)"
    members = {"김민지": 5, "김민지수": 6}
    teams = {}
    owners = _match_owners(title, members, teams)
    # 김민지수도 substring 매치되므로 둘 다 등록 — 알려진 한계
    assert owners == {5, 6}


def test_session_title_in_prefix_not_matched():
    """[세션제목]은 prefix이므로 매칭 대상 아님"""
    title = "연합UP 33기 7주차 발표-[짝짜꿍]-신념(김다은P)"
    members = {"김다은": 11}
    teams = {"짝짜꿍": [99], "신념": [11, 22]}
    owners = _match_owners(title, members, teams)
    # 짝짜꿍은 prefix 안에 있어서 매칭 안 됨, 신념 팀 + 김다은
    assert owners == {11, 22}


def test_no_separator_falls_back_to_full_title():
    """']-'가 없으면 제목 전체로 매칭"""
    title = "수동입력영상-김민지"
    members = {"김민지": 5}
    teams = {}
    owners = _match_owners(title, members, teams)
    assert owners == {5}


if __name__ == "__main__":
    test_team_session_multi_presenter()
    test_individual_session_single_presenter()
    test_session_title_in_prefix_not_matched()
    test_no_separator_falls_back_to_full_title()
    print("OK — all matching tests passed")
```

- [ ] **Step 4: 테스트 실행**

```bash
docker exec ops-platform-backend-1 python /app/../test_feedback_matching.py 2>&1
# 또는 호스트에서
python3 /home/ubuntu/ops-platform/backend/test_feedback_matching.py
```
Expected: `OK — all matching tests passed`

- [ ] **Step 5: 커밋**

```bash
cd /home/ubuntu/ops-platform
git add backend/app/services/crawler_homework.py backend/test_feedback_matching.py
git commit -m "$(cat <<'EOF'
fix(feedback): 팀세션 영상 owner 매칭 — 팀명 + 다중 이름 union

7주차 짝짜꿍 운영에서 한 영상에 여러 발표자(김다은P, 도민희P)인데
첫 매치에서 break 해서 두 번째 발표자가 owner 등록 안 되던 버그.
prefix(']-' 이전)는 매칭에서 제외해 [세션제목] 오매칭도 차단.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Drive 영상 함수 + helper 삭제 (PPT_EMAIL용 함수 보존)

**Files:**
- Modify: `backend/app/services/crawler_video.py` (`list_drive_videos`, `list_drive_videos_by_folder`, `download_drive_file`, `parse_presenter_name` 삭제)
- Modify: `backend/app/routers/crawler.py` (`/drive-videos` 엔드포인트, `_parse_order`, `_parse_group` 삭제)
- Modify: `backend/app/schemas/crawler.py` (`DriveVideoListResponse`, `DriveVideoItem` 삭제)

- [ ] **Step 1: `crawler_video.py`에서 Drive video 함수 삭제**

다음 함수들을 통째로 삭제:
- `list_drive_videos_by_folder` (라인 54~69)
- `list_drive_videos` (라인 72~109)
- `parse_presenter_name` (라인 112~129)
- `download_drive_file` (라인 194~201)

남기는 함수: `get_drive_service`, `create_drive_folder`, `upload_file_to_drive`, `copy_drive_file`, `download_drive_file_bytes` (모두 PPT_EMAIL 의존)

- [ ] **Step 2: `crawler.py`에서 Drive video 엔드포인트/헬퍼 삭제**

다음을 모두 삭제:
- 상단 import 라인 27: `from app.services.crawler_video import list_drive_videos, list_drive_videos_by_folder, parse_presenter_name`
- 상단 import 라인 22: `DriveVideoListResponse`, `DriveVideoItem` 임포트
- 함수 `_parse_order` (35~43)
- 함수 `_parse_group` (46~49)
- 엔드포인트 `@router.get("/drive-videos", ...)` `list_drive_videos_api` 함수 전체 (311~352)

- [ ] **Step 3: `schemas/crawler.py`에서 타입 삭제**

```bash
grep -n "DriveVideo" /home/ubuntu/ops-platform/backend/app/schemas/crawler.py
```

`DriveVideoListResponse`, `DriveVideoItem` 클래스 정의 삭제.

- [ ] **Step 4: backend syntax check**

```bash
docker exec ops-platform-backend-1 python -c "from app.routers.crawler import router; from app.services.crawler_video import upload_file_to_drive, download_drive_file_bytes, get_drive_service; print('imports OK')"
```
Expected: `imports OK` (PPT_EMAIL용 함수는 정상 import)

- [ ] **Step 5: 커밋**

```bash
cd /home/ubuntu/ops-platform
git add backend/app/services/crawler_video.py backend/app/routers/crawler.py backend/app/schemas/crawler.py
git commit -m "$(cat <<'EOF'
refactor: Drive 영상 다운로드 코드 제거 — 직접 업로드만 사용

list_drive_videos*, download_drive_file, parse_presenter_name,
/drive-videos 엔드포인트 전체 제거. PPT_EMAIL용 Drive 함수
(get_drive_service, upload/copy/download_bytes)는 보존.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `upload_all_videos`에서 Drive 분기 + prefetch 제거 + `started_at` 추가

**Files:**
- Modify: `backend/app/services/crawler_video.py` (`upload_all_videos` 함수)

이 함수가 영상 업로드 코어 로직. 변경:
- `videos` 인자가 항상 들어온다고 가정 (None일 때 Drive 폴더 fetch 분기 삭제)
- `prefetch_task`, `prefetch_download` 헬퍼 삭제
- `local_path` / Drive 분기 삭제 → 항상 `local_path` 사용
- progress_list 항목에 `started_at` 추가, status 전환 시 갱신

- [ ] **Step 1: `videos` 필수화 + Drive fetch 블록 삭제**

현재 라인 290~302:

```python
    if videos:
        drive_files = sorted(videos, key=lambda v: (v.get("group") or 0, v.get("order", 9999)))
    else:
        cfg = session.config or {}
        drive_folder_id = cfg.get("drive_video_folder_id") or cfg.get("drive_folder_id")
        if drive_folder_id:
            drive_files = list_drive_videos_by_folder(drive_folder_id)
        else:
            drive_files = list_drive_videos(session.week_num)

    if not drive_files:
        logger.warning(f"No videos found in Drive for week {session.week_num}")
        return []
```

다음으로 교체:

```python
    if not videos:
        logger.warning(f"No videos provided for session {session_id}")
        return []
    drive_files = sorted(videos, key=lambda v: (v.get("group") or 0, v.get("order", 9999)))
```

(변수명 `drive_files`은 그대로 유지하거나 `video_items`로 rename해도 됨. 일단 유지하되 메인 흐름만 정리)

- [ ] **Step 2: progress_list 초기화에 `started_at` 추가**

현재 라인 308~318:

```python
    progress_list = []
    for f in drive_files:
        name = f.get("name", f.get("id", "unknown"))
        progress_list.append({
            "file": name,
            "presenter": f.get("presenter", parse_presenter_name(name)),
            "order": f.get("order", 9999),
            "status": "pending",
            "error": None,
        })
    await _set_progress(redis, job_id, progress_list)
```

`parse_presenter_name`을 삭제했으니 fallback 제거 + `started_at` 필드 추가:

```python
    progress_list = []
    for f in drive_files:
        name = f.get("name", f.get("id", "unknown"))
        progress_list.append({
            "file": name,
            "presenter": f.get("presenter", name),
            "order": f.get("order", 9999),
            "status": "pending",
            "error": None,
            "started_at": None,
        })
    await _set_progress(redis, job_id, progress_list)
```

- [ ] **Step 3: prefetch 로직 + Drive 다운로드 분기 삭제**

라인 354~437 근처. file_metas 만들기는 유지하되 `file_id`/`tmp_path` 부분은 단순화. prefetch_task / prefetch_download 함수 + 호출 모두 삭제. `is_local`/`local_path` 분기 → 항상 local_path 사용.

현재 코드:

```python
    # 파일별 메타 미리 계산 + 크기 정보
    file_metas = []
    for i, drive_file in enumerate(drive_files):
        raw_name = drive_file.get("name", drive_file.get("id", "unknown"))
        file_id = drive_file.get("id", drive_file.get("file_id"))
        tmp_path = os.path.join(tmp_dir, raw_name)
        size_mb = round(int(drive_file.get("size", 0)) / (1024 * 1024), 1) if drive_file.get("size") else None
        file_metas.append({"raw_name": raw_name, "file_id": file_id, "tmp_path": tmp_path, "size_mb": size_mb})
        progress_list[i]["size_mb"] = size_mb

    # 다음 영상 1개만 미리 다운로드하는 헬퍼
    prefetch_task: Optional[asyncio.Task] = None

    async def prefetch_download(idx: int):
        meta = file_metas[idx]
        try:
            progress_list[idx]["status"] = "downloading"
            await _set_progress(redis, job_id, progress_list)
            await asyncio.to_thread(download_drive_file, meta["file_id"], meta["tmp_path"])
        except Exception as e:
            logger.error(f"[{idx+1}/{total}] {meta['raw_name']} 다운로드 실패: {e}")
```

다음으로 교체:

```python
    # 파일별 메타 미리 계산 + 크기 정보
    file_metas = []
    for i, drive_file in enumerate(drive_files):
        raw_name = drive_file.get("name", drive_file.get("id", "unknown"))
        local_path = drive_file.get("local_path")
        size_mb = None
        if local_path and os.path.exists(local_path):
            try:
                size_mb = round(os.path.getsize(local_path) / (1024 * 1024), 1)
            except OSError:
                size_mb = None
        file_metas.append({"raw_name": raw_name, "local_path": local_path, "size_mb": size_mb})
        progress_list[i]["size_mb"] = size_mb
```

(prefetch_task, prefetch_download 함수 삭제)

- [ ] **Step 4: 메인 루프에서 Drive 분기 + prefetch 호출 제거**

현재 라인 386~437 근처 (메인 for loop 안):

```python
        for idx, drive_file in enumerate(drive_files):
            raw_name = file_metas[idx]["raw_name"]
            file_id = file_metas[idx]["file_id"]
            tmp_path = file_metas[idx]["tmp_path"]
            ...
            try:
                # 로컬 파일 여부 확인 (직접 업로드된 영상)
                local_path = drive_file.get("local_path")
                is_local = bool(local_path and os.path.exists(local_path))

                if is_local:
                    # 로컬 파일 — Drive 다운로드 스킵, 경로만 지정
                    tmp_path = local_path
                else:
                    # 1. Drive 다운로드 (prefetch로 이미 받았으면 대기, 아니면 직접)
                    if prefetch_task and not os.path.exists(tmp_path):
                        await prefetch_task
                        prefetch_task = None

                    if not os.path.exists(tmp_path):
                        progress_list[idx]["status"] = "downloading"
                        await _set_progress(redis, job_id, progress_list)
                        await asyncio.to_thread(download_drive_file, file_id, tmp_path)

                # 2. 업로드 시작 → 다음 영상 미리 다운로드
                progress_list[idx]["status"] = "uploading"
                await _set_progress(redis, job_id, progress_list)

                # 다음 영상 prefetch (Drive 파일만 — 로컬 파일은 이미 존재)
                next_file = drive_files[idx + 1] if idx + 1 < total else None
                next_is_local = bool(next_file and next_file.get("local_path"))
                if idx + 1 < total and not abort_event.is_set() and not next_is_local:
                    prefetch_task = asyncio.create_task(prefetch_download(idx + 1))

                ok = False
                ...
```

다음으로 교체 (drive 다운로드 분기 + prefetch 모두 제거, started_at 갱신):

```python
        for idx, drive_file in enumerate(drive_files):
            raw_name = file_metas[idx]["raw_name"]
            local_path = file_metas[idx]["local_path"]
            ...
            try:
                if not local_path or not os.path.exists(local_path):
                    raise FileNotFoundError(f"local_path 없음 또는 파일 없음: {local_path}")

                # 업로드 시작
                progress_list[idx]["status"] = "uploading"
                progress_list[idx]["started_at"] = datetime.now(timezone.utc).isoformat()
                await _set_progress(redis, job_id, progress_list)

                ok = False
                ...
                    ok = await _upload_single(page, local_path, cafe_title)
                ...
```

(`tmp_path` 변수가 _upload_single에 전달되었으니 `local_path`로 변경. retry 로직, `for attempt in ...` 그대로 유지)

상단 import에 `from datetime import datetime, timezone` 없으면 추가.

- [ ] **Step 5: finally 블록에서 로컬 파일 정리 분기 단순화**

현재 (라인 485~491):

```python
            finally:
                # 로컬 파일은 삭제하지 않음 (직접 업로드된 파일은 사용자가 관리)
                if not is_local and os.path.exists(tmp_path):
                    try:
                        os.remove(tmp_path)
                    except Exception:
                        pass
```

→ 모두 local_path이므로 삭제 안 함:

```python
            # local_path 영상은 사용자가 관리하므로 finally 정리 불필요 (삭제하지 않음)
```

(finally 블록 자체를 제거하거나 빈 블록으로 두기. 그냥 통째로 삭제)

- [ ] **Step 6: 함수 끝 cleanup에서 prefetch 캔슬 / tmp_dir / file_metas 정리 단순화**

라인 498~518 근처:

```python
    # 정리
    if prefetch_task:
        prefetch_task.cancel()
    cancel_poller.cancel()

    ...

    # 임시 디렉토리 전체 삭제 (job별 격리)
    import shutil
    shutil.rmtree(tmp_dir, ignore_errors=True)

    # (하위 호환) 개별 파일 정리도 시도
    for meta in file_metas:
        if os.path.exists(meta["tmp_path"]):
            try:
                os.remove(meta["tmp_path"])
            except Exception:
                pass
```

→ Drive 다운로드를 안 하므로 `tmp_dir`은 더 이상 필요 없음 (앞에서 `tmp_dir`, `os.makedirs` 호출 자체를 제거):

```python
    # 정리
    cancel_poller.cancel()
```

상단의 `tmp_dir = ...`, `os.makedirs(tmp_dir, ...)` 도 제거 (라인 322~324).

- [ ] **Step 7: 백엔드 import + 컨테이너 syntax check**

```bash
docker exec ops-platform-backend-1 python -c "from app.services.crawler_video import upload_all_videos; print('OK')"
```
Expected: `OK`

- [ ] **Step 8: 커밋**

```bash
cd /home/ubuntu/ops-platform
git add backend/app/services/crawler_video.py
git commit -m "$(cat <<'EOF'
refactor(upload): Drive prefetch 제거 + started_at 추가

upload_all_videos에서 videos 인자 필수화, Drive 다운로드/prefetch 분기
및 tmp_dir 로직 모두 제거. progress_list 항목에 started_at(ISO) 추가
— 프론트에서 elapsed time 표시용.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 프론트 — Drive 패널 + useDriveVideos 훅 삭제

**Files:**
- Modify: `frontend/src/pages/session/OpsTab.tsx` (Drive 패널 영역 삭제)
- Modify: `frontend/src/hooks/useCrawler.ts` (useDriveVideos 훅 + 타입 삭제)

- [ ] **Step 1: `useCrawler.ts`에서 Drive 관련 export 삭제**

다음 항목 모두 삭제:
- `useDriveVideos` 훅 함수
- `DriveVideoItem` 인터페이스
- `DriveVideoListResponse` 인터페이스 (있다면)
- `crawlerKeys.driveVideos` 키 함수

- [ ] **Step 2: `OpsTab.tsx`에서 Drive 패널 통째 삭제**

라인 390~572 근처의 `{/* Video Upload Panel */}` 주석으로 시작하는 div 통째 삭제:

```tsx
{/* Video Upload Panel */}
<div className="bg-[var(--color-surface)] p-4 md:p-6 rounded-xl border border-[var(--color-border)]">
    ... (Drive 패널 전체) ...
</div>
```

같이 삭제할 import / state / 함수:
- `useDriveVideos` import
- `crawlerKeys` import (다른 데서 안 쓰면) — 사용처 확인 후 결정
- `DriveVideoItem` import
- `fetchDriveVideos`, `isLoadingDrive`, `driveVideos` 분해 변수
- `defaultPrefix`, `titlePrefix`, `setTitlePrefix` (Drive 패널 전용)
- `buildTitle`, `applyTemplate`, `updateVideoTitle`, `updateVideoOrder` 함수
- `handleCafeUpload(false)` 호출 (Drive 모드만 false 전달했음 — 다른 호출 없으면 함수도 삭제)

- [ ] **Step 3: `uploadedFromDirect` state + 분기 삭제**

OpsTab 안:
- `const [uploadedFromDirect, setUploadedFromDirect] = useState(false);` 삭제
- `setUploadedFromDirect(false)`, `setUploadedFromDirect(true)` 호출 모두 삭제
- `{!uploadedFromDirect && renderTaskStatus()}` → 그냥 `renderTaskStatus()` (단, 별도 섹션으로 옮긴 후, Task 5 참조)
- `naverResult={uploadedFromDirect && Array.isArray(taskStatus?.result) ? taskStatus.result : null}` → `naverResult={Array.isArray(taskStatus?.result) ? taskStatus.result : null}`

- [ ] **Step 4: 프론트 빌드 확인**

```bash
docker exec ops-platform-frontend-dev-1 sh -c "cd /app && npx tsc --noEmit 2>&1 | head -40"
```
Expected: 에러 없거나 본 변경과 무관한 기존 에러만

- [ ] **Step 5: 커밋**

```bash
cd /home/ubuntu/ops-platform
git add frontend/src/pages/session/OpsTab.tsx frontend/src/hooks/useCrawler.ts
git commit -m "$(cat <<'EOF'
refactor(ui): OpsTab Drive 영상 패널 + useDriveVideos 훅 제거

uploadedFromDirect 분기도 제거. 영상 업로드는 직접 업로드 패널만 남김.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 업로드 진행 박스 별도 섹션 분리 + 중단 버튼 노출 보장

**Files:**
- Modify: `frontend/src/pages/session/OpsTab.tsx`

`renderTaskStatus()` 호출을 VideoUploadPanel 바로 아래(또는 위)에 별도 섹션으로 배치. Drive 패널이 사라졌으므로 자연스럽게 위치 이동.

- [ ] **Step 1: 별도 섹션 div로 감싸기**

OpsTab return 안에서, VideoUploadPanel을 감싼 div 다음 라인에 추가:

```tsx
{uploadTaskId && (
    <div className="bg-[var(--color-surface)] p-4 md:p-6 rounded-xl border border-[var(--color-border)]">
        <h3 className="font-bold text-base md:text-lg mb-3 flex items-center gap-2">
            <UploadCloud className="w-4 h-4 text-[var(--color-accent)]" />
            네이버 카페 업로드 진행 상태
        </h3>
        {renderTaskStatus()}
    </div>
)}
```

(uploadTaskId가 없을 땐 박스 자체 미노출 — 기존 "업로드 상태가 여기에 표시됩니다" 플레이스홀더는 제거)

- [ ] **Step 2: `renderTaskStatus()` 의 placeholder 분기 제거**

함수 시작부 (라인 261~265):

```tsx
if (!uploadTaskId || !taskStatus) return (
    <div className="bg-[var(--color-base)] rounded-lg p-4 ...">
        업로드 상태가 여기에 표시됩니다.
    </div>
);
```

→ `if (!uploadTaskId || !taskStatus) return null;` (감싸는 박스가 이미 조건부이므로 placeholder 불필요)

- [ ] **Step 3: 빌드 확인**

```bash
docker exec ops-platform-frontend-dev-1 sh -c "cd /app && npx tsc --noEmit 2>&1 | grep -E 'error TS' | head -10"
```
Expected: 본 변경과 무관한 에러만 (또는 0)

- [ ] **Step 4: 커밋**

```bash
cd /home/ubuntu/ops-platform
git add frontend/src/pages/session/OpsTab.tsx
git commit -m "$(cat <<'EOF'
fix(ui): 업로드 진행 박스를 별도 섹션으로 분리 — 중단 버튼 항상 노출

기존엔 Drive 패널 안에 묶여있어 직접 업로드로 시작하면 중단 버튼이
안 보이던 케이스가 있었음. 별도 섹션으로 분리하고 uploadTaskId 있을
때만 표시하도록 단순화.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 자동 영상 제목 형식 변경 + "이름 붙이기" 토글

**Files:**
- Modify: `frontend/src/components/VideoUploadPanel.tsx` (PresenterSlot 타입, buildTitle, UI 토글 버튼)
- Modify: `frontend/src/pages/session/OpsTab.tsx` (teamPresenters에 `member_names` 배열 전달)

- [ ] **Step 1: `PresenterSlot` 타입에 `member_names?: string[]` 추가**

`VideoUploadPanel.tsx` 상단 인터페이스 정의:

```tsx
interface PresenterSlot {
    member_id: number;
    member_name: string;
    sub_label?: string | null;
    group_num: number | null;
    presenter_order: number | null;
    member_names?: string[];  // 팀세션일 때 팀 멤버 이름 배열 (이름 붙이기 토글용)
}
```

- [ ] **Step 2: OpsTab에서 `member_names` 전달**

`teamPresenters` 매핑(현재 라인 580~595):

```tsx
const teamPresenters = isTeamSession
    ? [...(session.teams ?? [])]
        .filter(t => (t.members?.length ?? 0) > 0)
        .sort((a, b) => ((a as any).presenter_order ?? 999) - ((b as any).presenter_order ?? 999))
        .map((t, idx) => {
            const firstMember = t.members![0];
            const memberNames = t.members!.map(m => m.name);
            return {
                member_id: firstMember.id,
                member_name: t.name,
                sub_label: memberNames.join(", "),
                group_num: null,
                presenter_order: (t as any).presenter_order ?? idx + 1,
                member_names: memberNames,  // ← 추가
            };
        })
    : [];
```

- [ ] **Step 3: VideoUploadPanel에 토글 state + 변경된 `buildTitle` 추가**

`VideoUploadPanel.tsx`에 토글 state 추가 (`titleOverrides` 근처):

```tsx
// "이름 붙이기" 토글: member_id (슬롯 anchor) 단위
const [nameToggle, setNameToggle] = useState<Set<number>>(new Set());

const toggleName = (memberId: number) => {
    setNameToggle(prev => {
        const next = new Set(prev);
        next.has(memberId) ? next.delete(memberId) : next.add(memberId);
        return next;
    });
};
```

`buildTitle` 변경 (현재 라인 386~391):

```tsx
const buildTitle = (p: PresenterSlot) => {
    const orderPart = hasGroups && p.group_num
        ? `${p.group_num}분반 ${p.presenter_order ?? ""}번째`
        : p.presenter_order ? `${p.presenter_order}번째` : "";
    const orderSuffix = orderPart ? `(${orderPart})` : "";

    // 팀세션 + 토글 ON → "팀명(이름P, 이름P)(N번째)"
    if (p.member_names && p.member_names.length > 0 && nameToggle.has(p.member_id)) {
        const namesPart = p.member_names.map(n => `${n}P`).join(", ");
        return `${titlePrefix}${p.member_name}(${namesPart})${orderSuffix}`;
    }

    return `${titlePrefix}${p.member_name}${orderSuffix}`;
};
```

- [ ] **Step 4: 토글 버튼 UI 추가 (각 팀 슬롯)**

각 슬롯 렌더링 부분(라인 575 근처)에서 팀세션(`member_names` 있음)일 때 작은 토글 버튼 추가. 슬롯 헤더(이름 옆) 또는 카페 제목 input 옆 한 곳에. 예시:

```tsx
{p.member_names && p.member_names.length > 0 && (
    <Button
        variant={nameToggle.has(p.member_id) ? "default" : "outline"}
        size="sm"
        className="h-6 px-2 text-[10px]"
        onClick={() => toggleName(p.member_id)}
        title="제목에 멤버 이름 포함"
    >
        이름
    </Button>
)}
```

위치는 카페 제목 input 옆 (라인 685~695의 video && 블록) 또는 헤더 영역 중 적절한 곳. 인라인 편집과 충돌 안 나도록 주의 — 토글 변경 시 `titleOverrides[member_id]`가 있다면 그게 우선이므로 토글이 안 보일 수 있음. 토글은 **자동 생성된 제목에만 영향**, 인라인 편집한 제목은 그대로.

UX 단순화: 토글 클릭 시 `titleOverrides[p.member_id]`도 함께 삭제(자동 형식으로 복귀):

```tsx
const toggleName = (memberId: number) => {
    setNameToggle(prev => {
        const next = new Set(prev);
        next.has(memberId) ? next.delete(memberId) : next.add(memberId);
        return next;
    });
    // 토글 시 인라인 override 제거 → 자동 형식으로 즉시 반영
    setTitleOverrides(prev => {
        const next = { ...prev };
        delete next[memberId];
        return next;
    });
};
```

- [ ] **Step 5: 빌드 확인**

```bash
docker exec ops-platform-frontend-dev-1 sh -c "cd /app && npx tsc --noEmit 2>&1 | grep -E 'error TS' | head -10"
```
Expected: 본 변경과 무관한 에러만

- [ ] **Step 6: 커밋**

```bash
cd /home/ubuntu/ops-platform
git add frontend/src/components/VideoUploadPanel.tsx frontend/src/pages/session/OpsTab.tsx
git commit -m "$(cat <<'EOF'
feat(ui): 팀세션 영상 제목에 '이름 붙이기' 토글 추가

기본 자동 형식: [세션제목]-팀명(N번째)
토글 ON: [세션제목]-팀명(이름P, 이름P)(N번째)
인라인 편집은 그대로 유지. 토글 변경 시 override 초기화.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 업로드 elapsed time 표시 (옵션 B — 시간 정보)

**Files:**
- Modify: `frontend/src/pages/session/OpsTab.tsx` (renderTaskStatus 안 progress 행)
- Modify: `frontend/src/components/VideoUploadPanel.tsx` (인라인 뱃지 옆에 elapsed)

- [ ] **Step 1: 시간 포맷터 helper 함수 추가**

`OpsTab.tsx` 상단 또는 별도 utility (`frontend/src/lib/format.ts`가 있으면 거기). 없으면 OpsTab 안에:

```tsx
function formatElapsed(startedAt: string | null | undefined): string {
    if (!startedAt) return "";
    const ms = Date.now() - new Date(startedAt).getTime();
    if (ms < 0) return "";
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}분 ${s}초` : `${s}초`;
}
```

- [ ] **Step 2: 1초 setInterval로 강제 리렌더 — `now` state**

OpsTab 안:

```tsx
const [, setNowTick] = useState(0);
useEffect(() => {
    const hasActive = taskStatus?.progress?.some(
        (p: any) => p.status === "uploading" && p.started_at
    );
    if (!hasActive) return;
    const id = setInterval(() => setNowTick(t => t + 1), 1000);
    return () => clearInterval(id);
}, [taskStatus?.progress]);
```

- [ ] **Step 3: progress 행에 elapsed 표시**

`renderTaskStatus()` 안의 progress 테이블 (현재 라인 305~331). 상태 셀 옆에 elapsed time 표시:

```tsx
<td className="px-4 py-1.5">
    <VideoStatusBadge status={item.status} error={item.error} />
    {item.status === "uploading" && item.started_at && (
        <span className="ml-2 text-[10px] text-[var(--color-text-muted)] tabular-nums">
            {formatElapsed(item.started_at)} 경과
        </span>
    )}
</td>
```

- [ ] **Step 4: VideoUploadPanel 슬롯 뱃지 옆에도 동일하게 표시 (옵션)**

VideoUploadPanel에서 naverProgress 매핑되는 부분(현재 라인 563 근처). naverProgress 항목에 `started_at` 도 함께 받게 타입 보강:

```tsx
naverProgress?: { file: string; presenter: string; status: string; error?: string | null; started_at?: string | null }[] | null;
```

뱃지 옆에:

```tsx
{naverProgress?.find(np => np.presenter === p.member_name)?.started_at && naverStatus === "uploading" && (
    <span className="ml-1 text-[10px] text-[var(--color-text-muted)] tabular-nums">
        {formatElapsed(naverProgress.find(np => np.presenter === p.member_name)!.started_at)}
    </span>
)}
```

(VideoUploadPanel에도 1초 tick state 또는 OpsTab의 tick을 prop으로 전달. 단순화 위해 VideoUploadPanel 안에서도 자체 setInterval — naverStatus가 uploading인 영상이 있을 때만)

- [ ] **Step 5: 빌드 확인 + 동작 확인**

```bash
docker exec ops-platform-frontend-dev-1 sh -c "cd /app && npx tsc --noEmit 2>&1 | grep -E 'error TS' | head -10"
```
Expected: 본 변경과 무관한 에러만

- [ ] **Step 6: 커밋**

```bash
cd /home/ubuntu/ops-platform
git add frontend/src/pages/session/OpsTab.tsx frontend/src/components/VideoUploadPanel.tsx
git commit -m "$(cat <<'EOF'
feat(ui): 영상 업로드 진행 elapsed time 표시

uploading 상태인 영상 옆에 'M분 S초 경과' 표시. 백엔드의 started_at
필드 사용. active 영상 있을 때만 1초 setInterval 가동.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec 커버리지:**
- ✅ Drive 코드 삭제 (Task 2, 3, 4) — PPT_EMAIL 의존 함수만 보존
- ✅ 자동 영상 제목 형식 변경 + 이름 붙이기 토글 (Task 6)
- ✅ 팀세션 피드백 감지 강화 (Task 1) — 팀명 + 다중 이름 union, prefix 분리
- ✅ 중단 버튼 재배치 (Task 5)
- ✅ 업로드 진행 디테일 (Task 3 백엔드 + Task 7 프론트)
- ✅ PPT 카페 — 이번 사이클 제외 (Task 없음)

**검증 섹션 제외 (사용자 요청).**

**Type/이름 일관성:**
- `started_at` 필드명 — 백엔드 progress_list, 프론트 naverProgress, formatElapsed 모두 동일
- `member_names` (배열) — VideoUploadPanel PresenterSlot, OpsTab teamPresenters 동일
- `nameToggle` Set 키 — `member_id` 사용 (titleOverrides와 동일)

**잠재 이슈:**
- crawler_ppt.py가 Drive video 함수를 동적 import 한다는 가정 — 실제로 `upload_file_to_drive`, `copy_drive_file`만 쓰고 이건 보존하므로 영향 없음. Task 2 Step 4의 syntax check로 검증.
- session.config의 `drive_video_folder_id` 키는 sessions.py가 생성하지만 더 이상 읽는 코드는 없음 (frontend 패널 삭제 + crawler_video.py에서 분기 제거). DB에 남아있어도 무해.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-03-team-feedback-and-drive-cleanup.md`.

두 가지 실행 옵션이 있습니다:

**1. Subagent-Driven (recommended)** — 각 Task마다 fresh subagent에 위임하고 task 사이에 리뷰. 빠른 반복, 컨텍스트 분리

**2. Inline Execution** — 이 세션에서 직접 실행, 체크포인트마다 사용자 검토 받음

Which approach? (또는 그냥 진행해도 OK)
