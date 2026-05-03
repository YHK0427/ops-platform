# 팀세션 피드백 감지 강화 + Drive 코드 정리 + 업로드 진행 디테일

## 배경

UnivPT Ops Platform의 영상 업로드 플로우는 원래 Google Drive를 경유했으나(Drive에 파일명 레이블링 → 플랫폼이 다운로드 → 네이버 카페 업로드), 영상 직접 업로드 기능이 추가되어 Drive 의존을 끊을 수 있게 되었다.

추가로 7주차 deploy 운영에서 다음 두 가지 이슈가 드러났다:

1. **팀세션 피드백 감지가 동작하지 않음.** `crawler_homework.py:scan_feedback_comments`의 영상 작성자 매칭이 첫 번째 매칭된 멤버에서 break하기 때문에, 한 영상에 여러 발표자가 있는 팀세션에서는 두 번째 이후 멤버가 영상 owner로 등록되지 않는다. 결과적으로 그 멤버를 피드백 대상으로 지정한 사람들이 자동 PASS 처리된다.
2. **Naver 업로드 중단 버튼이 일부 시나리오에서 안 보임.** 중단 버튼이 "영상 업로드 (드라이브)" 패널 안쪽에 묶여 있고, 직접 업로드 패널에서 업로드를 시작하면 (`uploadedFromDirect=true`) 중단 버튼이 렌더링되지 않는다. Drive 패널이 삭제되면 호출 지점도 함께 사라진다.

또 운영자 피드백으로 자동 생성되는 영상 제목이 팀세션에서 적절치 않다는 점(현재 `[세션제목]-{팀명}(N번째)`인데 자동 형식이 `${prefix}${team.name}(N번째)`이라서 세션제목과 팀명이 같으면 팀명이 두 번 들어감), 그리고 업로드 진행 상황이 단일 뱃지로만 표시되어 추가 정보가 필요하다는 점이 제기되었다.

## 범위

이번 사이클은 영상/피드백/Drive 정리에 한정한다. PPT 카페 게시판 분리 구현은 별도 사이클로 미룬다(이메일 PPT는 운영상 미사용 상태로 그대로 둔다).

---

## 1. Drive 코드 전체 삭제

### 백엔드
- `backend/app/services/crawler_video.py`
  - 삭제: `get_drive_service`, `create_drive_folder`, `list_drive_videos`, `list_drive_videos_by_folder`, `download_drive_file`, `download_drive_file_bytes`, `copy_drive_file`, `upload_file_to_drive`
  - 삭제: 전역 import (`google.oauth2`, `googleapiclient.*`)
  - 삭제: `upload_all_videos` 내부의 prefetch 로직, `is_local`/`local_path` 분기. 모든 영상은 항상 `local_path`로 들어옴 → tmp 디렉토리 생성/정리 단순화
- `backend/app/routers/crawler.py`
  - 삭제: `GET /crawler/drive-videos` 엔드포인트, `_parse_order`, `_parse_group` 헬퍼
  - 삭제: `from app.services.crawler_video import list_drive_videos*` import
- `backend/app/schemas/crawler.py`
  - 삭제: `DriveVideoListResponse`, `DriveVideoItem`
- `backend/app/services/crawler_ppt.py`
  - Drive 의존이 있다면 사용 여부 점검 후 결정. 이메일 PPT IMAP 스캔 자체는 유지 가능. (Drive 업로드/조회만 호출하는 함수가 있으면 함수만 제거)
- `backend/app/config.py`
  - `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_DRIVE_FOLDER_ID` 설정 제거. 단 `crawler_ppt.py`가 여전히 사용한다면 유지

### 프론트
- `frontend/src/pages/session/OpsTab.tsx`
  - 삭제: "영상 업로드 (드라이브)" 패널 (현재 라인 390~572 영역)
  - 삭제: `useDriveVideos`, `driveVideos`, `applyTemplate`, `updateVideoTitle`, `updateVideoOrder`, `titlePrefix`(이 패널 전용) 등 Drive UI 관련 상태/함수
  - 삭제: `useUploadVideos`의 Drive 모드 호출 (`handleCafeUpload(false)`) — 직접 업로드만 사용
- `frontend/src/hooks/useCrawler.ts`
  - 삭제: `useDriveVideos` 훅, `crawlerKeys.driveVideos`, `DriveVideoItem` 타입

### Config / 데이터
- `session.config.drive_folder_id`, `drive_video_folder_id` 키는 더 이상 읽지 않음. 기존 데이터는 무시 (DB에 남아있어도 OK).

### videos[] payload
- 항상 `local_path`로 영상 파일을 가리킴. `id`, `name`, `presenter`, `order`, `group`, `cafe_title`, `local_path` 만 사용.

---

## 2. 팀세션 영상 제목 자동 생성

### 자동 형식
- 기본: `연합UP 33기 N주차 발표-[세션제목]-{팀명}({N}번째)`
  - prefix(`연합UP 33기 N주차 발표-[세션제목]-`)는 그대로 유지
  - 가변 부분이 현재 `${team.name}(N번째)`인데, 운영자가 매번 손대기 좋은 형태(팀세션 컨벤션과 일치)

### "이름 붙이기" 토글 버튼
- 각 팀 슬롯 옆에 작은 토글 버튼 (예: "👤 이름")
- OFF: `{팀명}({N}번째)`
- ON: `{팀명}(이름P, 이름P, ...)({N}번째)` — 팀 멤버 이름을 순서대로 이름 뒤에 P 접미사 + 콤마로 join
- 인라인 편집은 그대로 유지. 토글 ON/OFF는 상태이므로 바뀔 때 cafe_title이 재생성됨 (인라인 수정한 값이 있다면 덮어쓰기)
- 토글 상태는 `useState<Set<number>>` — `presenters[].member_id` (팀 슬롯의 첫 번째 멤버 id가 anchor로 사용됨, 인라인 편집 키와 동일) 단위. 컴포넌트 로컬 상태이며 페이지 새로고침 시 OFF로 리셋되어도 무방

### 변경 위치
- `frontend/src/components/VideoUploadPanel.tsx`의 `buildTitle` 로직 + UI 토글 버튼 추가
- `presenters` prop의 팀 케이스에 `member_names: string[]` 같은 필드를 OpsTab에서 추가로 넘겨줌 (현재는 `sub_label: "김다은, 도민희"` 콤마 join 문자열만 있음 — 정확한 join 제어 위해 배열로 넘김)

---

## 3. 팀세션 피드백 감지 강화

### 매칭 정책 (Q1 C안)
영상 게시글의 owner를 다음 두 방법 모두 적용한 union으로 등록:

**3.1 팀명 매칭**
- 제목 prefix(`-[세션제목]-`) 이후의 가변 부분에서 팀명을 찾음
- DB `Team`(session_id == 현재 세션) 의 `name` 목록과 매칭. 단순 substring 검색 (현재 멤버 매칭과 동일 방식, 단 첫 매치에서 break하지 않고 모든 매치 수집)
- 매칭된 모든 팀의 모든 멤버를 영상 owner로 등록

**3.2 멤버 이름 다중 매칭**
- 제목에서 멤버 이름이 등장하는지 검사 — 모든 매칭 멤버를 owner로 등록 (현재의 break 제거)
- 단순화: 제목 전체를 대상으로 substring 검사 후 매치되는 모든 멤버 수집. `(이름P, 이름P)` 패턴 명시 파싱은 하지 않음 — 어떤 형식으로 작성하든 멤버 이름이 들어있으면 매치

### prefix 매칭 제외
- prefix 안의 `[세션제목]`은 매칭 대상에서 제외해야 함. 세션제목이 팀명/멤버명과 겹치면 오매칭 위험.
- 구현: 제목 문자열에서 첫 `]-` 인덱스를 찾아 그 이후 부분만 매칭 대상(variable_part)으로 사용. `]-`이 없으면 제목 전체를 그대로 사용 (방어 fallback).

### 효과
- 7주차 짝짜꿍 세션의 `연합UP 33기 7주차 발표-[짝짜꿍]-주제01 신념(김다은P, 도민희P)` 제목에서:
  - prefix 제거 후 가변 부분: `주제01 신념(김다은P, 도민희P)`
  - 팀명 매칭: `신념` 팀 발견 → 신념 팀의 모든 멤버를 owner로 등록
  - 이름 매칭: `김다은`, `도민희` 모두 owner로 등록 (break 제거 효과)
  - union → 신념 팀 멤버 + 김다은 + 도민희 (대부분 중복이지만 set이므로 자동 처리)
- 향후 1조/2조 컨벤션에서도 `[세션제목]-1조(1번째)` 같은 자동 제목으로 1조 팀 멤버 전원 owner 등록됨

### 변경 위치
- `backend/app/services/crawler_homework.py:scan_feedback_comments` 영상 article 순회 부분 (현재 라인 230~245)

---

## 4. 중단 버튼 재배치

### 새 위치
- "업로드 진행 상태" 박스를 OpsTab 내 별도 섹션으로 분리. VideoUploadPanel 바로 아래 (또는 위) 한 곳에 표시.
- Drive 패널 삭제로 기존 `renderTaskStatus()` 호출 지점이 사라지므로 자연스럽게 이동.

### `uploadedFromDirect` 분기 제거
- `uploadedFromDirect` state와 관련 분기 모두 삭제 (`!uploadedFromDirect && renderTaskStatus()`, `naverResult={uploadedFromDirect && ...}` 등)
- 어떤 경로(직접 업로드 패널, 다른 사용자가 시작한 active task 자동 감지)로 task가 시작되었든 동일한 박스에 표시

### 변경 위치
- `frontend/src/pages/session/OpsTab.tsx`

---

## 5. 영상 업로드 진행 디테일 (옵션 B)

### 백엔드 `crawler_video.py`
- `progress_list[i]`에 다음 필드 추가:
  - `started_at`: 단계 전환 시각 (ISO 8601). `pending → uploading` 시 갱신
  - (선택) `phase`: 세부 단계 — `preparing`(페이지 진입/제목 입력), `uploading`(파일 업로드), `finalizing`(등록 버튼 클릭). 현재 status 위에 얹는 보조 정보. 구현 부담이 있으면 생략하고 status만 사용.
- Redis progress 업데이트 시 함께 저장

### 프론트
- 진행 중(`status === "uploading"`) 영상에 다음 표시:
  - elapsed time: `Date.now() - new Date(started_at)` → "1분 23초 경과"
  - `size_mb` 정보가 있으면 ETA 추정 (옵션): 평균 업로드 속도 가정값 또는 직전 영상 속도로 단순 추정. 정확도 욕심 안 냄.
- `setInterval` 1초로 elapsed time 갱신. active 영상이 없으면 interval 해제

### 변경 위치
- `backend/app/services/crawler_video.py`
- `frontend/src/pages/session/OpsTab.tsx` (또는 별도 컴포넌트로 분리)

---

## 6. PPT 카페 — 이번 사이클 제외

- 이메일 PPT (`PPT_EMAIL`) 기능은 그대로 둠. 운영상 미사용 상태이지만 코드 자체는 건드리지 않음.
- 카페 PPT 분리 구현(`PPT` assignment 타입의 카페 게시판 스캔)은 별도 사이클.

---

## 관련 파일

| 파일 | 변경 |
|------|------|
| `backend/app/services/crawler_video.py` | Drive 함수 삭제, prefetch 분기 제거, started_at 추가 |
| `backend/app/routers/crawler.py` | `/drive-videos` 엔드포인트 삭제, helpers 삭제 |
| `backend/app/schemas/crawler.py` | DriveVideoListResponse/Item 삭제 |
| `backend/app/services/crawler_homework.py` | `scan_feedback_comments` 매칭 강화 (팀명 + 다중 이름) |
| `backend/app/config.py` | GOOGLE_* 설정 제거 (PPT 의존 점검 후) |
| `frontend/src/pages/session/OpsTab.tsx` | Drive 패널 삭제, 중단 버튼 재배치, presenters 멤버명 배열 전달 |
| `frontend/src/components/VideoUploadPanel.tsx` | buildTitle 변경, "이름 붙이기" 토글 버튼 추가, 진행 디테일 표시 |
| `frontend/src/hooks/useCrawler.ts` | useDriveVideos 훅 + 관련 타입 삭제 |
