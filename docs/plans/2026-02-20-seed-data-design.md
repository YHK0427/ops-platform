# Seed Data Design — UI 전체 플로우 테스트용

> 작성일: 2026-02-20
> 목적: 모든 UI 페이지·기능을 즉시 확인할 수 있는 DB 초기 상태 구성

---

## 1. 멤버 (10명)

| ID | 이름 | 역할 | 현재 deposit | 누적 minus | 비고 |
|----|------|------|-------------|-----------|------|
| 1  | 김민준 | 기본 | 20,000 | 0 | 클린 레코드 |
| 2  | 이서연 | 기본 | 18,000 | -1 | week1 지각 |
| 3  | 박지훈 | 기본 | 12,000 | -4 | week1 무단결석 |
| 4  | 최수아 | 기본 | 18,000 | -1 | week1 지각(사유서 PRE) |
| 5  | 정우진 | 기본 | 20,000 | 0 | week1 공결(EXCUSED) |
| 6  | 강예린 | 기본 | 19,000 | -1 | week1 과제 MISSING |
| 7  | 오도현 | 기본 | 4,000  | -14 | week1 무단결석 + 과제 MISSING + 마일스톤(-10) |
| 8  | 윤지아 | 기본 | 14,000 | -4 | week1 결석(사유서 POST) |
| 9  | 임준서 | 기본 | 20,000 | 0 | 클린 레코드 |
| 10 | 한소희 | 기본 | 16,000 | -1 | week1 지각(사유서 없음) |

> `total_plus_score`는 모두 0 (상점은 아직 없음)
> `net_score = total_plus_score + total_minus_score`

---

## 2. 세션 (4개)

### Week 1 — FINALIZED (TEAM)

- **팀 구성 (3팀)**
  - Team A: 김민준(leader), 이서연, 박지훈, 최수아
  - Team B: 정우진(leader), 강예린, 오도현, 윤지아
  - Team C: 임준서(leader), 한소희

- **출결 결과**

  | 멤버 | 상태 | 사유서 | 페널티 |
  |------|------|--------|--------|
  | 김민준 | PRESENT | - | 없음 |
  | 이서연 | LATE_UNDER10 | POST | -1점 -3,000원 |
  | 박지훈 | ABSENT | - | -4점 -8,000원 |
  | 최수아 | LATE_UNDER10 | PRE | -1점 -2,000원 |
  | 정우진 | EXCUSED | - | 없음 |
  | 강예린 | PRESENT | - | 없음 |
  | 오도현 | ABSENT | - | -4점 -8,000원 |
  | 윤지아 | ABSENT | POST | -4점 -6,000원 |
  | 임준서 | PRESENT | - | 없음 |
  | 한소희 | LATE_UNDER10 | - | -1점 -4,000원 |

- **과제 (REVIEW/FEEDBACK only, PPT는 team_id 기반)**

  | 멤버 | REVIEW | FEEDBACK | 추가 페널티 |
  |------|--------|----------|------------|
  | 강예린 | MISSING | PASS | -1점 -1,000원 |
  | 오도현 | MISSING | MISSING | -1점 -1,000원 (any_missing) |
  | 그 외 | PASS | PASS | 없음 |

- **PPT 과제 (team_id 기반, member_id=None)**
  - Team A: PASS / Team B: MISSING / Team C: PASS
  - *(BUG-04 미수정 상태이므로 페널티 계산 안 됨)*

- **마일스톤**: 오도현이 week1 ABSENT(-4점) + MISSING(-1점) 후 total_minus=-5에서 SETTLEMENT→FINALIZED 시점에 이미 -5. 아직 -10을 안 넘으므로, **초기 세팅에서 오도현의 사전 점수를 -9로 설정**해 week1 ABSENT+MISSING(-5)으로 -14 도달, 마일스톤 트리거.

  → 원장에 `MILESTONE_FINE -5,000원` 기록 포함.

- **TeamHistory**: Team A/B/C 멤버 간 nC2 조합 기록

---

### Week 2 — SETTLEMENT (TEAM)

- **팀 구성 (재편성, 3팀)**
  - Team D: 이서연(leader), 정우진, 오도현
  - Team E: 김민준(leader), 최수아, 한소희
  - Team F: 박지훈(leader), 강예린, 윤지아, 임준서

- **출결 결과** (모두 입력 완료 — PENDING 없음)

  | 멤버 | 상태 | 사유서 |
  |------|------|--------|
  | 김민준 | PRESENT | - |
  | 이서연 | LATE_UNDER10 | POST |
  | 박지훈 | PRESENT | - |
  | 최수아 | EXCUSED | - |
  | 정우진 | ABSENT | - |
  | 강예린 | PRESENT | - |
  | 오도현 | LATE_OVER10 | - |
  | 윤지아 | PRESENT | - |
  | 임준서 | ABSENT | POST |
  | 한소희 | PRESENT | - |

- **과제** (PENDING 없음, BUG-09 처리 후 상태)

  | 멤버 | REVIEW | FEEDBACK |
  |------|--------|----------|
  | 정우진 | MISSING | MISSING |
  | 오도현 | PASS | PASS |
  | 임준서 | MISSING | PASS |
  | 그 외 | PASS | PASS |

- **PPT 과제** (team_id 기반, member_id=None)
  - Team D: PASS / Team E: LATE / Team F: PASS

---

### Week 3 — OPS (INDIVIDUAL)

- 팀 없음 (INDIVIDUAL 세션)
- **출결**: 절반만 입력, 나머지 PENDING

  | 멤버 | 상태 |
  |------|------|
  | 김민준 | PRESENT |
  | 이서연 | PRESENT |
  | 박지훈 | ABSENT |
  | 최수아 | PENDING |
  | 정우진 | PENDING |
  | 강예린 | LATE_UNDER10 |
  | 오도현 | PENDING |
  | 윤지아 | PENDING |
  | 임준서 | PRESENT |
  | 한소희 | PENDING |

- **과제**: 전원 PENDING (크롤러 미실행)

---

### Week 4 — SETUP (INDIVIDUAL)

- 세션 레코드만 존재
- 팀, 출결, 과제 없음 (팀 편성 화면 테스트용)

---

## 3. 원장 (Week 1 FINALIZED 결과)

| 멤버 | type | amount | score_delta | 설명 |
|------|------|--------|-------------|------|
| 이서연 | FINE | -3,000 | -1 | LATE_UNDER10/POST |
| 박지훈 | FINE | -8,000 | -4 | ABSENT/사유서없음 |
| 최수아 | FINE | -2,000 | -1 | LATE_UNDER10/PRE |
| 강예린 | FINE | -1,000 | -1 | 미제출: REVIEW |
| 오도현 | FINE | -8,000 | -4 | ABSENT/사유서없음 |
| 오도현 | FINE | -1,000 | -1 | 미제출: REVIEW, FEEDBACK |
| 오도현 | MILESTONE_FINE | -5,000 | 0 | 누적벌점 -10점 도달 추가 벌금 |
| 윤지아 | FINE | -6,000 | -4 | ABSENT/POST |
| 한소희 | FINE | -4,000 | -1 | LATE_UNDER10/사유서없음 |

---

## 4. 구현 방식

- 기존 `backend/scripts/seed.py` **전면 교체**
- `TRUNCATE ... CASCADE` → 테이블 클린
- SQLAlchemy async 세션으로 ORM 삽입
- 실행: `docker compose exec backend python3 scripts/seed.py`
