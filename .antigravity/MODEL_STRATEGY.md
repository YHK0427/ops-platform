# Antigravity 개발 전략 — 모델 선택 & 세션 시작 가이드

---

## 모델 선택 전략

| Phase | 모델 | 이유 |
|-------|------|------|
| 01 인프라 | **Sonnet** | 구조적 파일 생성, 판단 불필요 |
| 02 DB/Auth | **Sonnet** | 스키마는 설계서 그대로 구현 |
| 03 CRUD | **Sonnet** | 반복적 패턴 |
| 04 출결/팀빌딩 | **Sonnet** | 가드 로직은 단순 조건 |
| 05 크롤러 | **Opus** | 네이버 API 특성, 예외처리 복잡 |
| 06 영상 업로드 | **Opus** | Playwright 2단계 + 드라이브 연동 |
| 07 Penalty/Finalize | **Opus** | 순서 로직 치명적, 절대 틀리면 안 됨 |
| 08 Ledger/상점 | **Sonnet** | 단순 CRUD + 쿼리 |
| 09 FE 기반 | **Sonnet** | CSS 변수, 컴포넌트 조립 |
| 10 Dashboard/Members | **Sonnet** | UI 패턴 반복 |
| 11 Session/Prep/Ops | **Sonnet** | UI 패턴 반복 |
| 12 Post/Settlement/Ledger | **Sonnet** | UI 패턴 반복 |
| 13 배포 검증 | **Sonnet** | 명령어 실행 위주 |

> **요약:** Opus는 05, 06, 07 세 Phase만. 나머지는 Sonnet으로 충분.
> Opus를 남용하면 속도가 느리고 비용이 높아짐.

---

## 세션 시작 방법 (매번 동일)

### Step 1: 초기 컨텍스트 주입 (새 세션 시작 시 항상)

```
@.antigravity/rules.md 를 읽고 프로젝트 규칙을 숙지해.
지금 작업할 Phase는 XX야.
@.antigravity/prompts/XX_파일명.md 를 읽고 작업을 시작해.
```

### Step 2: Phase 파일 실행

```
@.antigravity/prompts/01_infra.md 의 작업을 수행해줘.
```

### Step 3: 완료 조건 검증 요청 (각 Phase 끝)

```
작업이 끝났으면 01_infra.md 의 "완료 조건" 섹션의 명령어를 직접 실행해서 결과를 보여줘.
```

### Step 4: 다음 Phase로 이동

```
완료 확인됐어. 이제 @.antigravity/prompts/02_db_auth.md 작업 시작해줘.
```

---

## 세션 간 컨텍스트 유지 팁

Antigravity는 세션 간 메모리가 없다. 새 세션 시작 시 항상 rules.md를 먼저 읽게 할 것.

**다음 세션 시작 템플릿:**
```
@.antigravity/rules.md 읽어줘.
이전 세션에서 Phase 0N까지 완료했어.
지금부터 Phase 0N+1을 시작할 거야.
@.antigravity/prompts/0N+1_파일명.md 읽고 작업해줘.
```

---

## 문제 발생 시 대응

### AI가 설계서와 다르게 구현했을 때
```
이 구현은 설계서와 다르게 되어있어.
@docs/spec_XXX.md 의 해당 섹션을 다시 읽고 수정해줘.
구체적으로 [어떤 부분]이 [어떻게] 달라야 해.
```

### 특정 로직을 모르는 척할 때 (환각 방지)
```
구현 전에 @docs/spec_business_logic.md 의 B-6 섹션을
그대로 코드로 옮겨줘. 창의적 해석 금지.
```

### DB 마이그레이션이 꼬였을 때
```bash
bash scripts/reset_db.sh
```

### 의존성 충돌
```
pip install 실패하면 --break-system-packages 추가했는지 확인해줘.
```

---

## .gitignore 필수 항목 (Phase 01에서 생성)

```gitignore
.env
pg_data/
redis_data/
files/
naver_session.json
*service_account*.json
__pycache__/
*.pyc
.venv/
node_modules/
dist/
login_helper.py
```
