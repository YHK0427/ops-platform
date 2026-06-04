# 후기 발표 성장 리포트 (초기↔후기 비교) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 후기(FINAL) 발표 성장 리포트를 초기↔후기 비교 리포트로 구현하고, 로컬 데모 시드로 검증한다.

**Architecture:** `eval_rounds.compare_to_round_id`(nullable) 추가 → 후기 결과 응답에 초기 결과를 `initial`로 임베드(A1) → 프론트는 `initial` 있으면 신규 `FinalGrowthReport`(B1) 렌더, 없으면 기존 단일 리포트. 마이그레이션은 additive-only, 시드/비번은 로컬 수동 실행.

**Tech Stack:** FastAPI · SQLAlchemy async · Alembic · React19/TS · recharts · framer-motion · pytest.

**데이터 안전:** push 금지(사용자 지시 시만). deploy DB 백업 완료(`/home/ubuntu/db-backups/ops-deploy-univpt_ops-20260604-213926.dump`). 마이그레이션 컬럼 추가만.

---

### Task 1: 마이그레이션 + 모델 — `compare_to_round_id`

**Files:**
- Create: `backend/alembic/versions/f1a2_add_compare_to_round_id.py`
- Modify: `backend/app/models.py` (`EvalRound`, ~L297-315)

- [ ] **Step 1: 모델 컬럼 추가**

`models.py` `EvalRound`에 `results_open` 줄 아래 추가:
```python
    compare_to_round_id = Column(
        Integer, ForeignKey("eval_rounds.id", ondelete="SET NULL"), nullable=True
    )
```

- [ ] **Step 2: 마이그레이션 작성**

```python
"""add compare_to_round_id to eval_rounds

Revision ID: f1a2c3d4e5f6
Revises: e7c1a9f2b3d4
"""
from alembic import op
import sqlalchemy as sa

revision = "f1a2c3d4e5f6"
down_revision = "e7c1a9f2b3d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("eval_rounds", sa.Column("compare_to_round_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_eval_rounds_compare_to", "eval_rounds", "eval_rounds",
        ["compare_to_round_id"], ["id"], ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_eval_rounds_compare_to", "eval_rounds", type_="foreignkey")
    op.drop_column("eval_rounds", "compare_to_round_id")
```

- [ ] **Step 3: 로컬 적용 + 무손실 확인**

Run:
```bash
docker exec ops-platform-db-1 psql -U univpt -d univpt_ops -c "SELECT count(*) FROM eval_responses;"   # before
docker exec ops-platform-backend-1 alembic upgrade head
docker exec ops-platform-db-1 psql -U univpt -d univpt_ops -c "\d eval_rounds" | grep compare_to_round_id
docker exec ops-platform-db-1 psql -U univpt -d univpt_ops -c "SELECT count(*) FROM eval_responses;"   # after, unchanged
```
Expected: 컬럼 존재, 응답 카운트 동일.

- [ ] **Step 4: Commit** — `git commit -m "feat(eval): eval_rounds.compare_to_round_id 컬럼 추가"`

---

### Task 2: 백엔드 스키마 — compare_to_round_id 노출/설정

**Files:**
- Modify: `backend/app/routers/evaluation.py` (RoundCreate/Update/Response L47-69, create_round L329, update_round L400)

- [ ] **Step 1: 스키마 필드 추가**

`RoundCreateRequest`, `RoundUpdateRequest`, `RoundResponse`에 각각:
```python
    compare_to_round_id: int | None = None
```
(`RoundUpdateRequest`는 기본 None 그대로 — 부분 업데이트.)

- [ ] **Step 2: create/update 반영**

`create_round`의 `EvalRound(...)` 생성에 `compare_to_round_id=body.compare_to_round_id` 추가.
`update_round`에 추가:
```python
    if body.compare_to_round_id is not None:
        round_.compare_to_round_id = body.compare_to_round_id
```

- [ ] **Step 3: 확인** — `docker exec ops-platform-backend-1 python -c "import app.routers.evaluation"` 임포트 에러 없음.

- [ ] **Step 4: Commit** — `git commit -m "feat(eval): 라운드 API에 compare_to_round_id 노출"`

---

### Task 3: 백엔드 비교 데이터 임베드 (`_build_member_result`)

**Files:**
- Modify: `backend/app/routers/evaluation.py` (`MemberResultDetail` L142-153, `_build_member_result` L218-295)
- Test: `backend/tests/test_eval_comparison.py`

- [ ] **Step 1: 실패 테스트 작성**

```python
# backend/tests/test_eval_comparison.py
import pytest
from app.routers.evaluation import MemberResultDetail


def test_member_result_detail_has_comparison_fields():
    d = MemberResultDetail(
        member_id=1, member_name="x",
        self_scores_by_question={}, self_scores_by_domain={},
        audience_scores_by_question={}, audience_scores_by_domain={},
        combined_scores_by_domain={},
    )
    assert d.round_type is None
    assert d.initial is None
```

- [ ] **Step 2: 실패 확인** — `docker exec ops-platform-backend-1 pytest tests/test_eval_comparison.py -q` → FAIL (필드 없음).

- [ ] **Step 3: 스키마 + 로직 구현**

`MemberResultDetail`에 추가:
```python
    round_type: str | None = None
    initial: "MemberResultDetail | None" = None
```
파일 끝 또는 클래스 정의 후 `MemberResultDetail.model_rebuild()` 호출(self-참조 forward ref 해소).

`_build_member_result` 시그니처에 `include_comparison: bool = True` 추가. 함수 시작에서 라운드 조회:
```python
    round_ = await db.get(EvalRound, round_id)
    round_type = round_.round_type if round_ else None
```
return 직전 비교 빌드:
```python
    initial = None
    if include_comparison and round_ and round_.round_type == "FINAL" and round_.compare_to_round_id:
        init_member = await db.get(Member, member_id)
        if init_member:
            initial = await _build_member_result(
                db, round_.compare_to_round_id, member_id, member_name,
                include_comparison=False,
            )
            if initial and all(v is None for v in initial.combined_scores_by_domain.values()):
                initial = None  # 비교 라운드에 데이터 없음
```
`return MemberResultDetail(... , round_type=round_type, initial=initial)`.

- [ ] **Step 4: 통과 확인** — `pytest tests/test_eval_comparison.py -q` → PASS.

- [ ] **Step 5: 실데이터 스모크(로컬)**

Run: `docker exec ops-platform-db-1 psql -U univpt -d univpt_ops -c "UPDATE eval_rounds SET compare_to_round_id=1 WHERE id=7;"`
그 후 운영진 토큰으로 `GET /api/v1/evaluations/rounds/7/results/<member_id>` 호출 시 `round_type=FINAL`, `initial` 객체 포함 확인(curl 또는 dev UI 네트워크 탭).

- [ ] **Step 6: Commit** — `git commit -m "feat(eval): 후기 결과에 초기 결과 비교 임베드"`

---

### Task 4: 프론트 공유 export + RadarChart 오버레이

**Files:**
- Modify: `frontend/src/components/eval/RadarChart.tsx`
- Modify: `frontend/src/components/eval/GrowthReportContent.tsx` (헬퍼 export 확인)

- [ ] **Step 1: RadarChart 오버레이 prop**

`RadarChart` props에 `compareScores?: { PLANNING:number; DESIGN:number; SPEECH:number }` 추가. compareScores 있으면 동일 좌표계에 **두 번째 폴리곤**(반투명/점선, 회색~초기색)을 메인(후기) 폴리곤 아래에 그린다. 범례 텍스트 "초기"/"후기" 추가(compareScores 있을 때만).

- [ ] **Step 2: 헬퍼 export 확인**

`GrowthReportContent.tsx`에서 `getPerceptionType`, `getDomainStage`, `roundDisplay`, `avg`, `getStrongestDomain`, `getWeakestDomain`, `TriangleIcon`, `Section`, `STAGES`, `DOMAIN_*`, `TYPE_DESCRIPTIONS`, `DOMAIN_STAGE_DESCRIPTIONS`가 export 되어 있는지 확인(대부분 이미 export됨). 누락 시 export 추가.

- [ ] **Step 3: 확인(dev)** — vite 빌드 에러 없음(터미널 watch). RadarChart 단독 변화는 다음 Task에서 시각 확인.

- [ ] **Step 4: Commit** — `git commit -m "feat(eval): RadarChart 초기·후기 오버레이 지원"`

---

### Task 5: 인식 전환 매트릭스 상수

**Files:**
- Modify: `frontend/src/constants/evalQuestions.ts` (끝에 추가)

- [ ] **Step 1: 상수 + 헬퍼 추가**

```typescript
// ── 자기 vs 청중 인식: 초기→후기 전환 9유형 ──
export type PerceptionCode = "A" | "B" | "C";  // A 자기<청중, B 자기=청중, C 자기>청중

export function perceptionCode(selfAvg: number, audienceAvg: number): PerceptionCode {
    const diff = selfAvg - audienceAvg;
    if (diff < -0.5) return "A";
    if (diff > 0.5) return "C";
    return "B";
}

export interface PerceptionTransition { name: string; oneLiner: string; body: string; }

export const PERCEPTION_TRANSITIONS: Record<string, PerceptionTransition> = {
    "A_A": { name: "발전형", oneLiner: "스스로에게 높은 기준을 유지하며 꾸준히 성장하는 발전형", body: "활동 초기와 후기 모두 청중 평가보다 자기평가가 낮게 나타났습니다. 이는 자신의 발표를 실제보다 엄격하게 바라보는 경향이 있음을 의미합니다. 발표 경험이 쌓이며 역량은 성장했지만, 스스로는 여전히 부족한 부분에 더 집중하고 있을 수 있습니다. 높은 기준은 지속적인 성장을 이끄는 원동력이 되지만, 때로는 이미 갖춘 강점을 충분히 인정하는 것도 중요합니다. 앞으로는 개선점뿐 아니라 자신의 강점에도 주목하며 균형 있게 성장해 나가길 바랍니다." },
    "A_B": { name: "성장형", oneLiner: "자신감을 얻으며 객관성을 갖춘 성장형", body: "활동 초기에는 자신의 발표 역량을 실제보다 낮게 평가하는 경향이 있었지만, 후기에는 청중 평가와 유사한 수준으로 변화했습니다. 이는 다양한 발표 경험과 피드백을 통해 자신의 강점과 성장 수준을 보다 객관적으로 인식하게 되었음을 의미합니다. 발표 실력의 향상뿐 아니라 건강한 자신감까지 함께 성장한 매우 긍정적인 변화라고 볼 수 있습니다." },
    "A_C": { name: "도약형", oneLiner: "잠재된 자신감을 발견하며 표현력을 확장한 도약형", body: "초기에는 자신의 발표를 실제보다 낮게 평가했지만, 후기에는 오히려 자신을 더 높게 평가하는 모습으로 변화했습니다. 이는 활동을 통해 발표에 대한 자신감이 크게 향상되었음을 보여줍니다. 발표 상황에서 보다 적극적으로 의견을 표현하고 자신만의 강점을 드러내기 시작했을 가능성이 높습니다. 다만 앞으로는 자신감과 함께 청중의 시선도 함께 고려하며 균형 있는 성장을 이어간다면 더욱 설득력 있는 발표자가 될 수 있습니다." },
    "B_A": { name: "탐구형", oneLiner: "높아진 기준으로 스스로를 돌아보는 탐구형", body: "초기에는 자기평가와 청중평가가 유사했지만, 후기에는 자신을 더욱 엄격하게 평가하는 모습으로 변화했습니다. 이는 발표에 대한 이해와 안목이 높아지면서 스스로에게 적용하는 기준 역시 높아졌기 때문일 수 있습니다. 성장 과정에서 자주 나타나는 긍정적인 변화이며, 실제 청중은 여전히 당신의 발표를 긍정적으로 평가하고 있다는 점도 함께 기억해 보세요." },
    "B_B": { name: "안정형", oneLiner: "균형 잡힌 자기 인식을 유지한 안정형", body: "초기와 후기 모두 자기평가와 청중평가가 비슷한 수준으로 나타났습니다. 이는 자신의 강점과 개선점을 비교적 객관적으로 파악하고 있음을 의미합니다. 자기 객관화 능력은 발표 성장 과정에서 매우 중요한 역량입니다. 현재의 강점을 유지하면서 피드백을 꾸준히 반영한다면 더욱 안정적인 성장을 이어갈 수 있을 것입니다." },
    "B_C": { name: "확장형", oneLiner: "성장과 함께 자신감이 더욱 강화된 확장형", body: "초기에는 자기평가와 청중평가가 유사했지만, 후기에는 스스로를 더 높게 평가하는 모습으로 변화했습니다. 이는 발표 경험을 통해 자신의 역량에 대한 확신과 자신감이 크게 향상되었음을 의미합니다. 발표 상황에서 더욱 적극적으로 의견을 제시하고 주도적으로 소통할 수 있는 강점이 생겼지만, 앞으로도 청중의 관점에서 스스로를 점검하는 태도를 함께 유지해 보세요." },
    "C_A": { name: "전환형", oneLiner: "자신을 바라보는 시각이 크게 변화한 전환형", body: "초기에는 자신의 발표를 실제보다 높게 평가했지만, 후기에는 오히려 더 엄격하게 바라보는 모습으로 변화했습니다. 이는 발표 경험과 피드백을 통해 자신의 강점뿐 아니라 개선점까지 폭넓게 인식하게 되었음을 의미합니다. 발표에 대한 이해가 깊어졌다는 점에서 매우 의미 있는 변화이지만, 지나친 자기비판보다는 성장 가능성에도 함께 주목하는 균형 잡힌 시각이 중요합니다." },
    "C_B": { name: "성찰형", oneLiner: "피드백을 통해 객관성을 획득한 성찰형", body: "초기에는 자신의 발표를 실제보다 높게 평가하는 경향이 있었지만, 후기에는 청중 평가와 유사한 수준으로 변화했습니다. 이는 다양한 발표 경험과 피드백을 통해 자신의 강점과 개선점을 보다 객관적으로 바라보게 되었음을 의미합니다. 자신을 정확하게 이해하는 능력은 앞으로의 성장을 더욱 빠르게 만드는 중요한 자산이 될 것입니다." },
    "C_C": { name: "추진형", oneLiner: "높은 자신감을 바탕으로 강점을 유지한 추진형", body: "초기와 후기 모두 자기평가가 청중평가보다 높게 나타났습니다. 이는 자신의 발표에 대한 높은 자신감과 적극적인 태도를 갖고 있음을 의미합니다. 자신감은 발표에서 큰 강점이 될 수 있습니다. 앞으로는 청중이 실제로 어떻게 받아들이고 있는지도 함께 살펴본다면 더욱 설득력 있고 영향력 있는 발표자로 성장할 수 있을 것입니다." },
};

export function getPerceptionTransition(initialCode: PerceptionCode, finalCode: PerceptionCode): PerceptionTransition {
    return PERCEPTION_TRANSITIONS[`${initialCode}_${finalCode}`];
}
```

- [ ] **Step 2: 빌드 확인(dev)** — vite 에러 없음.

- [ ] **Step 3: Commit** — `git commit -m "feat(eval): 초기→후기 인식 전환 9유형 상수"`

---

### Task 6: `FinalGrowthReport.tsx` 컴포넌트 (6개 섹션)

**Files:**
- Create: `frontend/src/components/eval/FinalGrowthReport.tsx`

- [ ] **Step 1: Props/타입 + 데이터 가공**

```typescript
interface RoundScores {
    self_scores_by_domain: Record<string, number | null>;
    audience_scores_by_domain: Record<string, number | null>;
    combined_scores_by_domain: Record<string, number | null>;
    self_scores_by_question: Record<string, number | null>;
    audience_scores_by_question: Record<string, number | null>;
    stage: string | null;
    type: string | null;
}
export interface FinalGrowthReportProps {
    memberName: string;
    final: RoundScores;
    initial: RoundScores;
    growthReflection?: string | null;
    showTitle?: boolean;
}
```
`import { DOMAINS, DOMAIN_LABELS, DOMAIN_COLORS, DOMAIN_STAGE_DESCRIPTIONS, TYPE_DESCRIPTIONS, STAGES, getDomainStage, roundDisplay, avg, getStrongestDomain, getWeakestDomain, getPerceptionType, TriangleIcon, Section } from "./GrowthReportContent";`
`import { perceptionCode, getPerceptionTransition, QUESTION_BY_KEY, QUESTION_SUBTITLES, QUESTION_GROWTH_FEEDBACK, DOMAIN_COMMON_FEEDBACK, getLowestQuestionInDomain } from "@/constants/evalQuestions";`

- [ ] **Step 2: 섹션 1 — 오버레이 레이더 + 후기 표**

타이틀 카드 라벨 "**후기 분석지**". `RadarChart` 에 `selfScores={후기 combined}` `compareScores={초기 combined}`. 하단 표는 후기 자기/청중/종합(`roundDisplay`).

- [ ] **Step 3: 섹션 2 — 영역별 단계 해석(초기→후기 + 👑)**

```tsx
const growthByDomain = DOMAINS.map(d => ({
    d,
    init: initial.combined_scores_by_domain[d] ?? 0,
    fin: final.combined_scores_by_domain[d] ?? 0,
    delta: (final.combined_scores_by_domain[d] ?? 0) - (initial.combined_scores_by_domain[d] ?? 0),
}));
const crownDomain = growthByDomain.reduce((a, b) => (b.delta > a.delta ? b : a)).d;
```
도메인별: 0~5 트랙에 init·fin 위치를 점으로, 그 사이 화살표. `getDomainStage(init)` → `getDomainStage(fin)` 텍스트(예: 정교화 3.8 → 전달 최적화 4.8). `DOMAIN_STAGE_DESCRIPTIONS[d][초기단계]`와 `[후기단계]` 둘 다 표시. `d===crownDomain`이면 도메인명 옆 👑.

- [ ] **Step 4: 섹션 3 — 발표 유형 변화**

`{initial.type} → {final.type}` 헤더, 본문은 `TYPE_DESCRIPTIONS[final.type ?? "균형형"].detail` + `.action` (후기 기준). 강점/보완 도메인은 `getStrongestDomain/getWeakestDomain(final.combined_scores_by_domain)`.

- [ ] **Step 5: 섹션 4 — 자기 vs 청중(후기 기준 + 전환)**

```tsx
const finPerc = getPerceptionType(avg(final.self_scores_by_domain), avg(final.audience_scores_by_domain));
const initCode = perceptionCode(avg(initial.self_scores_by_domain), avg(initial.audience_scores_by_domain));
const finCode = perceptionCode(avg(final.self_scores_by_domain), avg(final.audience_scores_by_domain));
const transition = getPerceptionTransition(initCode, finCode);
```
후기 기준 `finPerc.label`/`.description`/`.feedback` 표시. 이어서 전환 카드: `transition.name`(예: 성장형) + `transition.oneLiner` + `transition.body`. (초기→후기 A/B/C 뱃지 표기.)

- [ ] **Step 6: 섹션 5 — 성장 PLAN (멘토링 삭제)**

`GrowthReportContent`의 성장 PLAN 구조 재사용하되 `DOMAIN_COMMON_FEEDBACK[domain].mentoring` 블록은 **렌더하지 않음**. `getLowestQuestionInDomain(domain, final.self_scores_by_question, final.audience_scores_by_question)`로 후기 기준 최저 문항 피드백 + `tips`만.

- [ ] **Step 7: 섹션 6 — 내가 발견한 성장**

스펙 4.4의 "내가 발견한 성장" 인트로 4문단 + `growthReflection`(있으면 인용 박스, whitespace-pre-wrap). 없으면 섹션 생략.

- [ ] **Step 8: 빌드 확인(dev)** — vite 에러 없음. (시각 확인은 Task 9 시드 후.)

- [ ] **Step 9: Commit** — `git commit -m "feat(eval): FinalGrowthReport 후기 비교 리포트 컴포넌트"`

---

### Task 7: 프론트 타입/훅 + 결과 페이지 연결

**Files:**
- Modify: `frontend/src/hooks/useMemberEvaluation.ts` (`MemberResultDetail` L31-42)
- Modify: `frontend/src/hooks/useEvaluation.ts` (해당 결과 타입)
- Modify: `frontend/src/pages/member/MemberResult.tsx`
- Modify: `frontend/src/components/eval/EvalResultCard.tsx`

- [ ] **Step 1: 타입에 비교 필드 추가**

`useMemberEvaluation.ts`의 `MemberResultDetail`(및 `useEvaluation.ts` 대응 타입)에:
```typescript
    round_type?: "INITIAL" | "FINAL" | "COMBINED" | null;
    initial?: MemberResultDetail | null;
```

- [ ] **Step 2: MemberResult.tsx 분기**

`data.initial`가 있으면 `<FinalGrowthReport memberName={data.member_name} final={data} initial={data.initial} growthReflection={data.growth_reflection} showTitle />`, 아니면 기존 `<GrowthReportContent data={data} showTitle />`. PDF 오버레이의 "초기 분석지"(L215)·소개문구도 `data.round_type==="FINAL"`이면 "후기 분석지"로.

- [ ] **Step 3: EvalResultCard.tsx 분기**

`detail?.initial` 있으면 확장 영역에서 `FinalGrowthReport`(final=detail, initial=detail.initial, showTitle=false) 렌더, 아니면 기존 `GrowthReportContent`. 상단 성장회고 박스는 유지(중복 시 FinalGrowthReport의 섹션6는 showTitle=false에서 생략하도록 prop으로 제어 — `showReflection` prop 추가하여 카드에선 false).

- [ ] **Step 4: 빌드 확인(dev)** — vite 에러 없음, 타입 통과.

- [ ] **Step 5: Commit** — `git commit -m "feat(eval): 기수/운영진 결과 페이지에 후기 비교 리포트 연결"`

---

### Task 8: GrowthReportContent 라운드 인식 라벨 (fallback 정합)

**Files:**
- Modify: `frontend/src/components/eval/GrowthReportContent.tsx` (L341-346 라벨)

- [ ] **Step 1: 라벨 prop화**

`GrowthReportContentProps`에 `roundLabel?: string`(기본 "초기 분석지") 추가, 하드코딩 라벨을 prop으로. (FinalGrowthReport는 자체 라벨 사용하므로 영향 없음. 단일 후기 fallback 시 호출부에서 "후기 분석지" 전달 가능.)

- [ ] **Step 2: 빌드 확인 + Commit** — `git commit -m "fix(eval): 성장 리포트 라벨 라운드 인식"`

---

### Task 9: 데모 시드 + 비번 통일 (로컬 전용)

**Files:**
- Create: `backend/scripts/seed_demo_final_report.py`

- [ ] **Step 1: 시드 스크립트 작성**

idempotent. 동작:
1. 데모 멤버 upsert: `김유피, 장영진, 이현아, 김태형, 김영헌` (`members`).
2. 각 멤버에 `generation_accounts` upsert (username 예: `demo_kimupi` 등, password_hash=bcrypt("univpt33")).
3. 초기 라운드 `[데모] 초기 평가`, 후기 라운드 `[데모] 후기 평가`(compare_to=초기.id) upsert, 둘 다 `results_open=true, is_open=false`.
4. 각 멤버 SELF + 더미 AUDIENCE 응답 생성하여 전환 유형 분산:
   - 김유피: 성장형(A→B) + 균형→강점집중(👑 SPEECH)
   - 장영진: 발전형(A→A)
   - 이현아: 성찰형(C→B)
   - 김태형: 추진형(C→C)
   - 김영헌: 안정형(B→B), 큰 폭 성장(단계 상승 보이게)
   점수는 9문항 1~5 정수로 직접 지정(도메인 평균이 의도한 단계/코드 나오게).
5. 후기 SELF에 `growth_reflection` 샘플 텍스트.
6. **로컬 DB 전체 비번 통일**: `UPDATE users SET password_hash=:h; UPDATE generation_accounts SET password_hash=:h;` (h=bcrypt("univpt33")). **이 스크립트는 로컬에서만 실행** — 주석으로 경고 명시, deploy 호스트/DB 감지 시 abort 가드(예: DB명/호스트 확인).

스크립트 상단 가드:
```python
import os
assert os.getenv("ALLOW_DEMO_SEED") == "1", "로컬 전용. ALLOW_DEMO_SEED=1 로 실행하세요. deploy 금지."
```

- [ ] **Step 2: 실행(로컬)**

Run:
```bash
docker exec -e ALLOW_DEMO_SEED=1 ops-platform-backend-1 python scripts/seed_demo_final_report.py
```
Expected: 멤버/계정/라운드/응답 생성 로그, "passwords unified" 로그.

- [ ] **Step 3: 확인** — `docker exec ops-platform-db-1 psql -U univpt -d univpt_ops -c "SELECT r.id,r.round_type,r.compare_to_round_id FROM eval_rounds r WHERE r.title LIKE '[데모]%';"` 후기에 compare_to 채워짐.

- [ ] **Step 4: Commit** — `git commit -m "chore(eval): 후기 분석지 데모 시드 스크립트(로컬 전용)"`

---

### Task 10: 로컬 통합 검증 (dev 서버 실시간)

- [ ] **M1** alembic 적용 후 기존 응답 카운트 무변동(Task 1 Step 3).
- [ ] **M2** 멤버 로그인(데모 계정 / univpt33) → 후기 분석지: ① 오버레이 레이더(초기·후기) ② 단계 화살표 + 초기/후기 설명 ③ 가장 성장한 영역 👑 ④ 유형 전환(예: 균형형→강점집중형) ⑤ 9유형 인식 전환 문구 ⑥ 멘토링 블록 없음 ⑦ 맨 끝 "내가 발견한 성장" + 회고.
- [ ] **M3** 운영진 결과 카드 확장 → 동일 후기 리포트.
- [ ] **M4** `compare_to_round_id` 비운 후기 라운드 → 기존 단일 리포트로 안 깨짐(fallback). (`UPDATE eval_rounds SET compare_to_round_id=NULL WHERE id=7;` 로 임시 확인 후 원복.)
- [ ] **M5** PDF 다운로드 → "후기 분석지" 라벨/레이아웃 정상.

**push는 사용자 승인 후에만.** M1~M5 통과 + 사용자 확인 시 push → CI/CD → deploy에서 후기(id7) compare_to=6 지정 → results_open ON.

---

## Self-Review 메모
- 스펙 6개 섹션 ↔ Task 6 Step 2-7 1:1 매핑 확인.
- 데이터 안전(컬럼 추가/시드 로컬가드/fallback) ↔ Task 1·3·9.
- 기수 페이지(MemberResult) + 운영진(EvalResultCard) 양쪽 ↔ Task 7.
- 타입명 일관: `RoundScores`, `FinalGrowthReportProps`, `getPerceptionTransition`, `perceptionCode`.
