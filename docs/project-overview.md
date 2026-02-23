# UnivPT Ops Platform — 프로젝트 개요

> 작성일: 2026-02-20
> 작성자: Claude Code (분석 기준 커밋: `841a6e7`)

---

## 1. 프로젝트 목적

대학 PT(Personal Training) 동아리의 **운영 전체를 자동화하는 내부 관리 도구**다.
한 명의 관리자(운영진)가 사용하며, 다음을 다룬다:

- 회원 등록 / 비활성화 / 점수 관리
- 주간 세션(PT 수업) 생성 → 팀 편성 → 출결 관리 → 과제 스캔 → 정산 마감
- 네이버 카페 크롤링 (PPT 제출, 과제, 피드백 자동 수집)
- Google Drive 영상 업로드
- 금전 원장(디파짓, 벌금, 상점, 환불) 관리

---

## 2. 기술 스택

| 레이어 | 기술 |
|---|---|
| Backend | FastAPI + SQLAlchemy (async) + PostgreSQL 16 |
| Job Queue | ARQ (asyncio Redis Queue) |
| Crawler | Playwright (네이버 자동화) |
| Frontend | React 19 + TypeScript + Vite + TailwindCSS v4 + ShadcnUI |
| Infra | Docker Compose (4-tier), Cloudflare Tunnel, Tailscale |
| Auth | 단일 Admin 계정 + JWT (python-jose) |

---

## 3. 아키텍처

```
[외부 접근]
  Cloudflare Tunnel
       │
  ┌────▼────────────────────────────────┐  frontend-net
  │  frontend (Nginx :3000)             │
  │  - /api/* → backend proxy           │
  └────┬────────────────────────────────┘
       │
  ┌────▼────────────────────────────────┐  frontend-net + backend-net
  │  backend (FastAPI :8000)            │
  │  worker (ARQ)                       │
  └────┬────────────────────────────────┘
       │
  ┌────▼────────────────────────────────┐  backend-net (외부 미노출)
  │  db (PostgreSQL)                    │
  │  redis (Redis 7)                    │
  └─────────────────────────────────────┘
```

**개발 시** Vite dev server(:5173)를 Tailscale로 접근.

---

## 4. 데이터 모델 요약

```
Member ─────────────── Attendance ──── Session ──── Team ──── TeamMember
  │                                       │            │
  │── Assignment ─────────────────────────┘            │── Assignment (PPT)
  │── LedgerEntry
  │── TeamMember                    TeamHistory (멤버 간 조합 이력)
  NaverSession (쿠키 저장)
```

**9개 테이블:** members, sessions, teams, team_members, team_history, assignments, attendance, ledger, naver_sessions

---

## 5. 세션 라이프사이클

```
SETUP → PREP → OPS → POST → SETTLEMENT → FINALIZED
```

| 상태 | 주요 작업 |
|---|---|
| SETUP | 세션 생성, 팀 편성(Snake Draft), 출결 레코드 자동 생성 |
| PREP | 크롤러 스캔 대기 |
| OPS | 실시간 출결 입력 |
| POST | 과제/피드백/리뷰 스캔 |
| SETTLEMENT | 정산 프리뷰, 최종 확인 |
| FINALIZED | 페널티 확정, 원장 기록, 팀 이력 저장 |

---

## 6. 페널티 시스템

### 출결 매트릭스

| 상태 | 사유서 | 점수 | 금액 |
|---|---|---|---|
| LATE_UNDER10 | PRE | -1 | -2,000 |
| LATE_UNDER10 | POST | -1 | -3,000 |
| LATE_UNDER10 | 없음 | -1 | -4,000 |
| LATE_OVER10 | PRE | -2 | -2,000 |
| ABSENT | 없음 | -4 | -8,000 |
| EXCUSED/PRESENT | - | 0 | 0 |

### 과제

- PPT LATE: -1점 / -1,000원
- PPT MISSING: -2점 / -3,000원
- REVIEW/HOMEWORK/FEEDBACK 중 하나라도 MISSING: -1점 / -1,000원

### 마일스톤

누적 벌점이 -10, -20, -30, ... 경계를 돌파할 때 마다 **추가 -5,000원** (MILESTONE_FINE)

---

## 7. 라우터 & 주요 엔드포인트

| 라우터 | prefix | 주요 역할 |
|---|---|---|
| auth | `/api/v1/auth` | JWT 로그인/로그아웃/갱신 |
| members | `/api/v1/members` | 회원 CRUD, 원장 조회, 스트릭 |
| sessions | `/api/v1/sessions` | 세션 CRUD, 출결, 팀빌딩, 정산 |
| assignments | `/api/v1/assignments` | 과제 상태 수동 수정 |
| ledger | `/api/v1/ledger` | 전체 원장, 상점 지급, 수동 거래 |
| crawler | `/api/v1/crawler` | ARQ 태스크 실행, 네이버 세션 관리 |

---

## 8. 프론트엔드

**React Router v7** 기반 SPA. 주요 페이지:

- `/dashboard` — 요약 통계
- `/members`, `/members/:id` — 회원 관리
- `/sessions`, `/sessions/new`, `/sessions/:id/[prep|ops|post|settlement]` — 세션 운영
- `/ledger` — 원장

디자인: "Neo-Industrial Command" 테마 (pure black + Rose-500 accent, 글래스모피즘 카드, Framer Motion 애니메이션)

---

---

# 백엔드 불안정 이슈 목록 (담당 범위)

> 아래는 현재 코드에서 발견된 **운영 리스크** 및 **데이터 정합성 위협** 이슈들이다.
> 우선순위 기준: 🔴 Critical (데이터 손실/오염) → 🟠 High (운영 오동작) → 🟡 Medium (잠재 버그)

---

## [BUG-01] 🔴 net_score 비동기화

**위치:** `models.py:23`, `finalize.py:75-78`

`net_score` 컬럼은 "DB 트리거 자동 갱신"이라고 주석에 명시되어 있으나, **실제 트리거가 없다.**
`finalize.py`는 `total_plus_score`, `total_minus_score`만 업데이트하고 `net_score`는 건드리지 않는다.

```python
# finalize.py:75-78 - net_score 갱신 없음
if p.score_delta < 0:
    p.member.total_minus_score += p.score_delta
elif p.score_delta > 0:
    p.member.total_plus_score += p.score_delta
# net_score는 여기서 영원히 0(default) 그대로
```

**영향:** 프론트엔드가 `net_score`를 직접 사용한다면 모든 멤버가 0점으로 보임.

---

## [BUG-02] 🔴 finalize_session의 datetime timezone 불일치

**위치:** `finalize.py:61`, `finalize.py:138`

```python
now = datetime.now()  # naive datetime (timezone 없음)
session.finalized_at = now
```

나머지 코드는 모두 `datetime.now(timezone.utc)` 또는 `server_default=func.now()` (UTC)를 사용.
PostgreSQL의 `TIMESTAMP(timezone=True)` 컬럼에 naive datetime을 넣으면 **DB가 로컬 시간으로 오해**하거나 예외 발생 가능.

---

## [BUG-03] 🔴 SETTLEMENT→FINALIZED 상태 전환 우회 가능

**위치:** `sessions.py:175-203` (`update_session_status`)

`PATCH /sessions/{id}/status` 엔드포인트로 `SETTLEMENT→FINALIZED`를 직접 전환하면, `finalize_session()`을 거치지 않고 상태만 바뀐다.
즉 **페널티 계산, 원장 기록, 팀 이력 기록이 모두 생략**된 채 세션이 FINALIZED 처리된다.

```python
# 상태 전환 시 finalize_session() 호출 없음
session.status = target
if target == "FINALIZED":
    session.finalized_at = datetime.now(timezone.utc)
```

실제 정산은 `POST /sessions/{id}/finalize`가 담당하지만, 두 경로가 동일한 상태로 전환 가능하다.

---

## [BUG-04] 🔴 PPT 과제의 페널티 엔진 미작동

**위치:** `sessions.py:513-522`, `penalty_engine.py:91-96`

팀 확정 시 PPT 과제는 `member_id=None`으로 생성된다:

```python
ppt = Assignment(
    session_id=session_id,
    team_id=team.id,
    member_id=None,  # 팀 과제
    type="PPT",
)
```

그런데 PenaltyEngine은 개인 member_id로 과제를 조회한다:

```python
assign_stmt = select(Assignment).where(
    Assignment.session_id == self.session.id,
    Assignment.member_id == member.id  # None인 레코드는 절대 매칭 안됨
)
```

따라서 **PPT 페널티는 절대 계산되지 않는다.** PPT LATE/MISSING이어도 아무 벌점도 없음.

---

## [BUG-05] 🟠 production 코드에 debug auto-delete 잔존

**위치:** `sessions.py:79-86`

```python
# 세션 생성 시 week_num 충돌 처리
stuck = stuck_session.scalar_one_or_none()
if stuck:
    logger.warning(f"Deleting stuck session {stuck.id} for week {body.week_num}")
    await db.delete(stuck)  # SETUP 상태면 조용히 삭제
```

`SETUP` 상태인 기존 세션을 **경고 로그만 남기고 자동 삭제**한다.
의도치 않은 데이터 손실 가능. 운영 중 프론트엔드 버그로 두 번 생성 요청이 오면 첫 세션이 사라진다.

---

## [BUG-06] 🟠 in-memory 토큰 블랙리스트 (재시작 시 무효화)

**위치:** `deps.py:15`

```python
BLACKLISTED_TOKENS: set[str] = set()
```

백엔드 프로세스 재시작 시 로그아웃된 토큰이 **다시 유효**해진다.
Docker container 재배포, crash 복구 시마다 발생. `worker` 컨테이너와도 공유 불가.

---

## [BUG-07] 🟠 confirm_teams의 팀 삭제 로직 오작동

**위치:** `sessions.py:467-481`

```python
# 실제로 아무것도 삭제하지 않는 코드
await db.execute(
    select(Team).where(Team.session_id == session_id)
)
# 바로 그 아래에서 DELETE 실행
await db.execute(delete(Assignment).where(Assignment.session_id == session_id))
await db.execute(delete(Team).where(Team.session_id == session_id))
```

`select(Team)` 결과를 변수에 담지 않아 쓸모없다. 실제 삭제는 `delete()`로 별도 수행.
로직 자체는 작동하지만, `Team` 삭제 시 `cascade="all, delete-orphan"`이 SQLAlchemy ORM 레벨에서 발동하지 않는다 (raw DELETE라서). `team_members`는 FK `ondelete="CASCADE"` 덕분에 DB에서 삭제되지만, ORM identity map이 stale해질 수 있다.

---

## [BUG-08] 🟠 attendance PENDING을 출석률에서 출석으로 계산

**위치:** `sessions.py:224-228`

```python
non_present_count = att_counts.get("ABSENT", 0) + att_counts.get("PENDING", 0)
att_present = att_total - non_present_count
attendance_rate = (att_present / att_total * 100.0) if att_total > 0 else 0.0
```

주석에 "PENDING, ABSENT 제외한 모든 상태"라고 나와 있지만, PENDING을 결석에 포함시키는 로직이다.
OPS 단계 초반에 아무도 출석 입력을 안 했다면 출석률 0%로 잘못 표시된다.
반대로, POST 단계에서 일부 미입력(PENDING)이 있으면 출석률이 낮게 산정된다.
**정확한 출석률은 입력 완료 후에만 유효**하다는 점이 명확히 드러나지 않음.

---

## [BUG-09] 🟠 미제출 과제 자동 MISSING 처리 없음

**위치:** `penalty_engine.py:160-171` (주석에도 명시)

Crawler는 "제출된 것"만 PASS/LATE로 저장한다.
미제출자는 Assignment 레코드 자체가 없거나, 있어도 PENDING 상태다.
PenaltyEngine은 **`a.status == "MISSING"`인 레코드만 페널티 적용**하므로,
Crawler 스캔 후 수동으로 MISSING 처리하거나 "미제출자에게 MISSING Assignment를 생성하는 로직"이 없으면 과제 페널티가 작동하지 않는다.

---

## [BUG-10] 🟡 중복 import

**위치:** `sessions.py:29-33`

```python
from app.schemas.session import (
    ...
    SessionStatsResponse,   # ← 중복
    SessionStatusUpdate,    # ← 중복
    SessionStatsResponse,
    SessionStatusUpdate,
)
```

실행에는 영향 없지만 코드 품질 문제.

---

## [BUG-11] 🟡 get_me 엔드포인트의 하드코딩

**위치:** `members.py:35-47`

```python
stmt = select(Member).where(Member.name == "Admin")
```

단일 어드민 시스템이지만, "Admin"이라는 이름의 멤버가 없으면 fallback으로 첫 번째 active 멤버를 반환한다. 잘못된 데이터가 노출될 수 있다.

---

## [BUG-12] 🟡 assignment UniqueConstraint와 member_id=None 충돌 가능

**위치:** `models.py:151`, `sessions.py:513-522`

```sql
UniqueConstraint("session_id", "member_id", "type")
```

`member_id=NULL`이면 PostgreSQL에서는 NULL != NULL이므로 동일한 (session_id, NULL, "PPT") 조합을 여러 번 insert할 수 있다. `confirm_teams`를 재실행하면 기존 PPT Assignment를 삭제하고 새로 만드므로 현재는 문제없지만, 로직이 바뀌면 중복 삽입 가능.

---

## [INFO-01] 설계 의도 불명확 (추후 확인 필요)

- **`total_minus_score`의 부호:** 주석에 "항상 ≤ 0 (음수 저장)"이라고 나와 있으나, `finalize.py`에서 `p.member.total_minus_score += p.score_delta` (음수 delta)로 갱신. 결과적으로 음수+음수=더 큰 음수 → 의도 맞음. 단, `check_milestone_after_update(before_minus, after_minus)`의 `before > threshold >= after` 조건에서 `before`와 `after`가 모두 음수이고 `threshold`도 음수이므로 논리적으로는 맞다. 하지만 변수명이 혼란스러움.
- **HOMEWORK Assignment 생성 미구현:** `confirm_teams`에서 REVIEW, FEEDBACK만 생성하고 HOMEWORK는 생성하지 않는다 (주석에도 명시). HOMEWORK 타입이 Assignment ENUM에는 있지만 사용되지 않음.
- **`target_count` / `current_count`:** Assignment에 있지만 어디서도 업데이트되지 않음.

---

## 우선순위 정리

| 번호 | 이슈 | 심각도 | 수정 복잡도 |
|---|---|---|---|
| BUG-01 | net_score 비동기화 | 🔴 Critical | 낮음 |
| BUG-04 | PPT 페널티 미작동 | 🔴 Critical | 중간 |
| BUG-03 | FINALIZED 우회 | 🔴 Critical | 낮음 |
| BUG-02 | timezone 불일치 | 🔴 Critical | 낮음 |
| BUG-09 | 미제출 MISSING 처리 없음 | 🟠 High | 높음 |
| BUG-05 | debug auto-delete | 🟠 High | 낮음 |
| BUG-06 | 토큰 블랙리스트 | 🟠 High | 중간 |
| BUG-07 | confirm_teams 삭제 로직 | 🟠 High | 낮음 |
| BUG-08 | 출석률 계산 | 🟠 High | 낮음 |
| BUG-10 | 중복 import | 🟡 Medium | 낮음 |
| BUG-11 | get_me 하드코딩 | 🟡 Medium | 낮음 |
| BUG-12 | NULL UniqueConstraint | 🟡 Medium | 낮음 |
