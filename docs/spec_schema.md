# UnivPT Ops — DB 스키마 + 페널티 매트릭스 (B-1, B-2)

# 섹션 B: 기술 명세

## B-1. Database Schema

### `members`

```sql
CREATE TABLE members (
    id               SERIAL PRIMARY KEY,
    name             VARCHAR(50)  NOT NULL,     -- 실명 (크롤러 제목 파싱 기준)
    name_initial     VARCHAR(10),               -- 이니셜/약칭 (예: '민준') 선택 입력
    email            VARCHAR(200),              -- PPT 제출 메일 주소
    -- ── 태그: 역할(leader 등) + 스킬 모두 여기서 관리 ─
    tags             TEXT[]       DEFAULT '{}',
    -- 예약 태그 (팀빌딩 로직 사용): 'leader'
    -- 자유 태그 예시: 'frontend', 'design', '기획', '대학원'
    -- ──────────────────────────────────────────────────
    current_deposit  INTEGER      DEFAULT 20000,
    -- ── 점수 3분리 ───────────────────────────
    total_plus_score  INTEGER DEFAULT 0,   -- 누적 상점 (항상 ≥ 0)
    total_minus_score INTEGER DEFAULT 0,   -- 누적 벌점 (항상 ≤ 0, 음수 저장)
    net_score         INTEGER DEFAULT 0,   -- 자동 갱신 (트리거)
    -- ─────────────────────────────────────────
    is_active        BOOLEAN      DEFAULT true,
    created_at       TIMESTAMPTZ  DEFAULT now(),
    deactivated_at   TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION sync_net_score() RETURNS TRIGGER AS $$
BEGIN
    NEW.net_score := NEW.total_plus_score + NEW.total_minus_score;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_net_score
    BEFORE INSERT OR UPDATE OF total_plus_score, total_minus_score
    ON members FOR EACH ROW EXECUTE FUNCTION sync_net_score();
```

### `naver_sessions`

```sql
CREATE TABLE naver_sessions (
    id           SERIAL PRIMARY KEY,
    storage_json JSONB       NOT NULL,  -- Playwright storage_state 전체
    is_valid     BOOLEAN     DEFAULT true,
    created_at   TIMESTAMPTZ DEFAULT now(),
    validated_at TIMESTAMPTZ DEFAULT now(),
    expires_hint TIMESTAMPTZ            -- NID_SES expires 파싱값
    -- 항상 is_valid=true인 레코드 최대 1개
);
```

### `sessions` (주차)

```sql
CREATE TABLE sessions (
    id           SERIAL PRIMARY KEY,
    week_num     INTEGER NOT NULL UNIQUE,
    title        VARCHAR(100) NOT NULL,  -- 세션명 예) "개인 발표 세션", "Listen UP"
                                         -- 영상 게시글 제목: {week}주차_{title}_{발표자명}
    date         DATE    NOT NULL,       -- 토요일 날짜
    type         VARCHAR(20) NOT NULL CHECK (type IN ('INDIVIDUAL','TEAM')),
    config       JSONB   DEFAULT '{"has_ppt":true,"has_review":true,"has_feedback":true,"is_holiday":false}',
    status       VARCHAR(20) DEFAULT 'SETUP'
                 CHECK (status IN ('SETUP','PREP','OPS','POST','SETTLEMENT','FINALIZED')),
    finalized_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ DEFAULT now()
);
```

> **영상 게시글 제목 생성 규칙**
> - INDIVIDUAL: `{week_num}주차_{title}_{발표자 name}` → `20주차_개인발표세션_김민준`
> - TEAM: `{week_num}주차_{title}_{팀명}` → `20주차_ListenUP_TeamA`
> - 드라이브 파일명 `김민준(8번째).mp4` → 정규식 `^(.+?)\s*\(` 로 `김민준` 파싱

### `teams`

```sql
CREATE TABLE teams (
    id         SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
    name       VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

### `team_members`

```sql
CREATE TABLE team_members (
    id        SERIAL PRIMARY KEY,
    team_id   INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    member_id INTEGER REFERENCES members(id),
    is_leader BOOLEAN DEFAULT false,
    UNIQUE (team_id, member_id)
);
```

### `team_history`

```sql
CREATE TABLE team_history (
    id          SERIAL PRIMARY KEY,
    session_id  INTEGER REFERENCES sessions(id),
    member_a_id INTEGER REFERENCES members(id),
    member_b_id INTEGER REFERENCES members(id),
    CHECK (member_a_id < member_b_id),
    UNIQUE (session_id, member_a_id, member_b_id)
);
```

### `assignments`

```sql
CREATE TABLE assignments (
    id            SERIAL PRIMARY KEY,
    session_id    INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
    member_id     INTEGER REFERENCES members(id),
    team_id       INTEGER REFERENCES teams(id),  -- TEAM 세션 PPT용, 나머지는 NULL
    type          VARCHAR(20) NOT NULL
                  CHECK (type IN ('PPT','REVIEW','FEEDBACK','HOMEWORK')),
    target_count  INTEGER DEFAULT 1,
    current_count INTEGER DEFAULT 0,
    status        VARCHAR(20) DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','PASS','LATE','MISSING')),
    scanned_at    TIMESTAMPTZ,
    raw_data      JSONB DEFAULT '{}',
    UNIQUE (session_id, member_id, type)
);
```

### `attendance`

```sql
CREATE TABLE attendance (
    id          SERIAL PRIMARY KEY,
    session_id  INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
    member_id   INTEGER REFERENCES members(id),
    status      VARCHAR(20) DEFAULT 'PENDING'
                CHECK (status IN ('PENDING','PRESENT','LATE_UNDER10','LATE_OVER10',
                                  'EARLY_LEAVE','ABSENT','EXCUSED')),
    excuse_type VARCHAR(10) CHECK (excuse_type IN ('PRE','POST') OR excuse_type IS NULL),
    excuse_text TEXT,
    updated_at  TIMESTAMPTZ DEFAULT now(),
    -- excuse_type 수정 마감: session.date(토) + 1일 21:59:59 (일요일)
    -- 마감 이후 수정은 원칙적으로 차단 (API 가드)
    -- FINALIZED 후 Admin 비상 수정 시 → ledger에 ADJUSTMENT 자동 기록
    UNIQUE (session_id, member_id)
);
```

### `ledger`

```sql
CREATE TABLE ledger (
    id           SERIAL PRIMARY KEY,
    session_id   INTEGER REFERENCES sessions(id),  -- NULL = 세션 외 수동 처리
    member_id    INTEGER REFERENCES members(id),
    type         VARCHAR(30) NOT NULL
                 CHECK (type IN (
                     'FINE',             -- 규칙 위반 디파짓 차감 (벌점 연동)
                     'MILESTONE_FINE',   -- 누적벌점 10단위 도달 추가 벌금 (점수 무관)
                     'DEPOSIT_RECHARGE', -- 디파짓 수동 재충전
                     'DEPOSIT_ADJUST',   -- 기타 수동 디파짓 조정
                     'DEPOSIT_REFUND',   -- 중간 이탈자 잔여 디파짓 환불
                     'MERIT',            -- 상점 부여 (KRW 변동 없음, score_delta > 0)
                     'ADJUSTMENT'        -- FINALIZED 후 Admin 비상 수동 수정 (audit용)
                 )),
    amount_krw    INTEGER DEFAULT 0,    -- 양수=입금, 음수=차감
    score_delta   INTEGER DEFAULT 0,    -- 양수=상점, 음수=벌점
    description   TEXT    NOT NULL,
    created_by    VARCHAR(20) DEFAULT 'system',
    created_at    TIMESTAMPTZ DEFAULT now(),
    deposit_after INTEGER NOT NULL      -- 처리 후 디파짓 잔액 스냅샷
);
```

---

## B-2. 페널티 & 상점 매트릭스

> **기본 디파짓:** 20,000 KRW | **퇴출:** `net_score < -12`

### 출결 × 사유서 조합

| 상황 | 사유서 | 벌점 | 디파짓 | 추가 과제 |
|------|--------|:----:|:------:|:--------:|
| 지각 < 10분 | PRE | -1 | -2,000 | - |
| 지각 < 10분 | POST | -1 | -3,000 | - |
| 지각 < 10분 | NULL | -1 | -4,000 | - |
| 지각 ≥ 10분 | PRE | -2 | -2,000 | - |
| 지각 ≥ 10분 | POST | -2 | -3,000 | - |
| 지각 ≥ 10분 | NULL | -2 | -4,000 | - |
| 조퇴 | PRE | -2 | -2,000 | - |
| 조퇴 | POST | -2 | -3,000 | - |
| 조퇴 | NULL | -2 | -4,000 | - |
| 결석 단순 | PRE | -4 | -4,000 | 피드백 2개 |
| 결석 단순 | POST | -4 | -6,000 | 피드백 2개 |
| 결석 단순 | NULL | -4 | -8,000 | 피드백 2개 |
| 결석 인정 | - | 0 | 0 | 피드백 2개 |

### PPT

| 상황 | 벌점 | 디파짓 | 추가 과제 |
|------|:----:|:------:|:--------:|
| 정규 제출 (금 21:59:59 이전) | 0 | 0 | - |
| 지각 제출 (토 09:59:59 이전) | -1 | -1,000 | - |
| 미제출 | -2 | -3,000 | 피드백 2개 |
| 인정결석 미제출 | 0 | 0 | - |

### 과제/리뷰/영상피드백

| 상황 | 벌점 | 디파짓 |
|------|:----:|:------:|
| 셋 중 하나라도 미제출 | -1 | -1,000 |

> 셋 모두 미제출이어도 동일하게 -1점, -1,000원 (누적 아님)

### 피드백 필요 개수 계산 (중복 명확화)

```
출석자:                  피드백 1개 필수
결석자 (단순/인정):       피드백 2개 필수
PPT 미제출자 (출석):      피드백 2개 필수
결석 + PPT 미제출:        피드백 2개 (OR, 최대 2개)
```

### 누적벌점 마일스톤 벌금

```
total_minus_score 이전값 > -10 ≥ 이후값 → 디파짓 -5,000 (MILESTONE_FINE)
total_minus_score 이전값 > -20 ≥ 이후값 → 디파짓 -5,000
total_minus_score 이전값 > -30 ≥ 이후값 → 디파짓 -5,000
```

> 디파짓 재충전(`current_deposit ≤ 10,000` 시 UI 경고)과 **완전 별개** 이벤트

### 상점 체계

| 구분 | 종류 | 점수 | 시점 |
|------|------|:----:|------|
| 개인상 | 오늘의 피피티 | +1 | 매주 |
| 개인상 | 오늘의 프레젠터 | +1 | 매주 |
| 개인상 | 발전왕 | +4 | 11, 20주차 |
| 개인상 | 베스트협력상 | +1 | Listen UP, 비즈니스 PT |
| 팀플상 | 친해지길 바라 | +1 | 팀 세션 |
| 팀플상 | Listen UP | +4 | 해당 세션 |
| 팀플상 | 비즈니스 PT | +4 | 해당 세션 |
| 팀플상 | 피날래 본선 진출 | +3 | 피날래 |
| 기타 | 번개 주최 완료 | +1 | 수시 |
| 기타 | 번개 2회 참석 | +1 | 수시 |
| 기타 | 추억상자 글 작성 | +1 | 수시 |
| 기타 | 4회 연속 출석 | +2 | **자동 감지** |

---

