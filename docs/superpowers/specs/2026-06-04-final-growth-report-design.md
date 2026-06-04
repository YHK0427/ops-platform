# 후기 발표 성장 리포트 (초기↔후기 비교) — 설계

작성일: 2026-06-04
브랜치: `feature/final-growth-report`

## 1. 목표

후기(FINAL) 발표 성장 리포트를 "처음의 나 vs 지금의 나" **초기↔후기 비교 리포트**로 만든다.
현재 초기·후기 리포트는 인트로 문구와 성장 회고 입력만 다를 뿐 결과지가 사실상 동일하며,
결과지 상단에 "초기 분석지" 라벨이 하드코딩되어 후기 결과를 봐도 초기처럼 보인다.

대상: 운영진 결과 카드(`EvalResultCard`)와 **기수(멤버) 결과 페이지(`MemberResult.tsx`)** 모두.

## 2. 현재 상태 (코드 기준)

- 문항: 9개(기획·디자인·스피치 × 3). `backend/app/constants/eval_questions.py` + `frontend/src/constants/evalQuestions.ts`에 **중복 정의**. 초기·후기 동일.
- 점수: SELF + AUDIENCE → 도메인 평균 → 1:1 결합(`compute_combined_domain_scores`) → `determine_stage`/`determine_type`.
- 라운드 모델 `EvalRound`: `round_type ∈ INITIAL/FINAL/COMBINED`, `is_open`, `results_open`, `session_id`(nullable). **초기↔후기를 잇는 필드 없음.**
- FINAL 고유 동작은 (1) 인트로 문구 (2) 성장 회고 필수(`growth_reflection`) (3) 운영진 성장회고 모아보기 뿐.
- 결과 리포트 `GrowthReportContent.tsx`는 `round_type`을 모르고 "초기 분석지" 하드코딩(L344). PDF(`MemberResult.tsx` L215)도 동일.

### Deploy 실데이터 (2026-06-04 백업 완료)
- 백업: `/home/ubuntu/db-backups/ops-deploy-univpt_ops-20260604-213926.dump` (pg_dump -Fc, 복원검증 OK)
- 컨테이너: `ops-deploy-*` (prod, 이 머신), `ops-platform-*` (dev/local, vite 핫리로드)
- 라운드: INITIAL **id=6** "33기 초기 발표 평가"(session 5, 결과공개, 마감) / FINAL **id=7** "33기 후기 발표 평가"(session 14, **열림**, 결과비공개)
- 응답 2,376건 / 멤버 31 / 운영진 17. alembic head `e7c1a9f2b3d4` (deploy=local 동일, 단일 head).

## 3. 데이터 무손실 원칙 (push → CI/CD 자동반영)

1. 마이그레이션은 **`eval_rounds.compare_to_round_id` nullable 컬럼 추가만**. 기존 row/응답 무변경. 롤백=컬럼 drop.
2. 신규 코드 **graceful fallback**: 후기 라운드라도 `initial` 데이터 없으면 기존 단일 리포트로 렌더 → push 직후 compare 미설정 상태에서도 안 깨짐.
3. **시드/비번통일 스크립트는 마이그레이션·startup 등 자동 실행 경로에 절대 미포함.** 로컬에서 수동 실행만.
4. Deploy 롤아웃(사용자 승인 후): push → CI 마이그레이션+코드 → 관리자 UI에서 후기(id7) `비교할 초기=id6` 지정(1 row UPDATE) → 검수 후 `results_open` ON.
5. 문제 시 복원: `docker exec -i ops-deploy-db-1 pg_restore -U univpt -d univpt_ops --clean --if-exists < <dump>`.

## 4. 아키텍처

### 4.1 백엔드 (A1 — initial 임베드)

- **마이그레이션** `xxxx_add_compare_to_round_id.py` (down_revision `e7c1a9f2b3d4`):
  `eval_rounds`에 `compare_to_round_id INTEGER NULL`, FK→`eval_rounds.id` `ON DELETE SET NULL`.
- **모델** `EvalRound.compare_to_round_id = Column(Integer, ForeignKey("eval_rounds.id", ondelete="SET NULL"), nullable=True)`.
- **스키마** `evaluation.py`:
  - `RoundCreateRequest`/`RoundUpdateRequest`/`RoundResponse`에 `compare_to_round_id: int | None`.
  - `MemberResultDetail`에 `round_type: str | None`, `initial: MemberResultDetail | None`(self-참조, 1단계).
- **로직** `_build_member_result(db, round_id, member_id, member_name, include_comparison=True)`:
  - 라운드 조회해 `round_type` 채움.
  - `round_type == "FINAL"` 이고 `compare_to_round_id` 있으면, 그 라운드로 `_build_member_result(..., include_comparison=False)` 재귀 호출(성장회고 제외) → `initial`에 첨부.
  - 비교 라운드에 해당 멤버 데이터 없으면 `initial=None`.
- **엔드포인트**: `get_member_result`(운영진), `member_self_result`(기수) 둘 다 위 함수가 비교 포함 반환. 기존 시그니처 유지.

### 4.2 프론트엔드 (B1 — FinalGrowthReport 신규)

- **`frontend/src/components/eval/FinalGrowthReport.tsx`** 신규. 헬퍼·상수·`RadarChart`·`TriangleIcon`은 `GrowthReportContent`/`evalQuestions`에서 재사용(export 추가).
- 진입 분기: 결과 데이터에 `initial`이 있으면(=후기+비교가능) `FinalGrowthReport`, 아니면 기존 `GrowthReportContent`.
- **`RadarChart`**: optional prop `compareScores?: DomainScores` 추가 → 초기(점선/반투명) + 후기(실선) 두 삼각형 오버레이.

### 4.3 인식 전환 매트릭스 상수 (`evalQuestions.ts`)

`getPerceptionType`가 반환하는 id: `underestimate`(A·자기<청중), `objective`(B·자기=청중), `overestimate`(C·자기>청중). (임계값 ±0.5 동일 재사용.)
`PERCEPTION_TRANSITIONS: Record<"A→A"|...|"C→C", { name, oneLiner, body }>` — 키는 `${initial}_${final}` (A/B/C). 문구는 아래 4.4.

## 4.4 후기 리포트 6개 섹션 스펙

1. **발표 역량 방사형 그래프**
   - 초기·후기 삼각형 **오버레이**(후기 강조). 범례에 초기/후기 구분.
   - 하단 표: **후기** 자기/청중/종합 (소수 둘째자리 반올림, `roundDisplay`).
2. **영역별 단계 해석 (초기 vs 후기 변화)**
   - 도메인별 0~5 막대에 초기·후기 종합점수를 **점**으로 찍고 **화살표**로 변화량 표시. 예: `정교화(3.8) → 전달 최적화(4.8)`.
   - 초기 단계 설명 + 후기 단계 설명 **둘 다**(`DOMAIN_STAGE_DESCRIPTIONS`).
   - 세 도메인 중 `final.combined − initial.combined` **최대 도메인에 👑**(동률이면 첫 도메인).
3. **발표 유형 해석 (변화)**
   - `초기유형 → 후기유형` (예: 균형형 → 강점 집중형). 설명/액션은 **후기 기준**(`TYPE_DESCRIPTIONS[finalType]`).
4. **자기 vs 청중 인식 비교**
   - 후기 기준 A/B/C 설명(`getPerceptionType(후기)`).
   - **초기→후기 전환 매트릭스**(아래 9유형) — 한 줄 요약 + 리포트 문구.
5. **성장 PLAN** — **'1:N 운영진 멘토링' 블록 삭제**(후기 리포트에서 `DOMAIN_COMMON_FEEDBACK.mentoring` 미렌더). 문항별 피드백·꿀팁(tips)은 유지.
6. **내가 발견한 성장 (맨 끝)** — 아래 인트로 카피 + 멤버 `growth_reflection` 인용.

상단 라벨: 후기 모드 = **"후기 분석지"**, 소개 문구도 후기용으로. (`GrowthReportContent`/`MemberResult` PDF의 "초기 분석지" 하드코딩을 라운드 인식으로 교체.)

### 인식 전환 9유형 (full copy — source of truth)

| 키 | 유형명 | 한 줄 요약 |
|----|--------|-----------|
| A→A | 발전형 | 스스로에게 높은 기준을 유지하며 꾸준히 성장하는 발전형 |
| A→B | 성장형 | 자신감을 얻으며 객관성을 갖춘 성장형 |
| A→C | 도약형 | 잠재된 자신감을 발견하며 표현력을 확장한 도약형 |
| B→A | 탐구형 | 높아진 기준으로 스스로를 돌아보는 탐구형 |
| B→B | 안정형 | 균형 잡힌 자기 인식을 유지한 안정형 |
| B→C | 확장형 | 성장과 함께 자신감이 더욱 강화된 확장형 |
| C→A | 전환형 | 자신을 바라보는 시각이 크게 변화한 전환형 |
| C→B | 성찰형 | 피드백을 통해 객관성을 획득한 성찰형 |
| C→C | 추진형 | 높은 자신감을 바탕으로 강점을 유지한 추진형 |

리포트 문구(각 유형):

- **A→A 발전형**: 활동 초기와 후기 모두 청중 평가보다 자기평가가 낮게 나타났습니다. 이는 자신의 발표를 실제보다 엄격하게 바라보는 경향이 있음을 의미합니다. 발표 경험이 쌓이며 역량은 성장했지만, 스스로는 여전히 부족한 부분에 더 집중하고 있을 수 있습니다. 높은 기준은 지속적인 성장을 이끄는 원동력이 되지만, 때로는 이미 갖춘 강점을 충분히 인정하는 것도 중요합니다. 앞으로는 개선점뿐 아니라 자신의 강점에도 주목하며 균형 있게 성장해 나가길 바랍니다.
- **A→B 성장형**: 활동 초기에는 자신의 발표 역량을 실제보다 낮게 평가하는 경향이 있었지만, 후기에는 청중 평가와 유사한 수준으로 변화했습니다. 이는 다양한 발표 경험과 피드백을 통해 자신의 강점과 성장 수준을 보다 객관적으로 인식하게 되었음을 의미합니다. 발표 실력의 향상뿐 아니라 건강한 자신감까지 함께 성장한 매우 긍정적인 변화라고 볼 수 있습니다.
- **A→C 도약형**: 초기에는 자신의 발표를 실제보다 낮게 평가했지만, 후기에는 오히려 자신을 더 높게 평가하는 모습으로 변화했습니다. 이는 활동을 통해 발표에 대한 자신감이 크게 향상되었음을 보여줍니다. 발표 상황에서 보다 적극적으로 의견을 표현하고 자신만의 강점을 드러내기 시작했을 가능성이 높습니다. 다만 앞으로는 자신감과 함께 청중의 시선도 함께 고려하며 균형 있는 성장을 이어간다면 더욱 설득력 있는 발표자가 될 수 있습니다.
- **B→A 탐구형**: 초기에는 자기평가와 청중평가가 유사했지만, 후기에는 자신을 더욱 엄격하게 평가하는 모습으로 변화했습니다. 이는 발표에 대한 이해와 안목이 높아지면서 스스로에게 적용하는 기준 역시 높아졌기 때문일 수 있습니다. 성장 과정에서 자주 나타나는 긍정적인 변화이며, 실제 청중은 여전히 당신의 발표를 긍정적으로 평가하고 있다는 점도 함께 기억해 보세요.
- **B→B 안정형**: 초기와 후기 모두 자기평가와 청중평가가 비슷한 수준으로 나타났습니다. 이는 자신의 강점과 개선점을 비교적 객관적으로 파악하고 있음을 의미합니다. 자기 객관화 능력은 발표 성장 과정에서 매우 중요한 역량입니다. 현재의 강점을 유지하면서 피드백을 꾸준히 반영한다면 더욱 안정적인 성장을 이어갈 수 있을 것입니다.
- **B→C 확장형**: 초기에는 자기평가와 청중평가가 유사했지만, 후기에는 스스로를 더 높게 평가하는 모습으로 변화했습니다. 이는 발표 경험을 통해 자신의 역량에 대한 확신과 자신감이 크게 향상되었음을 의미합니다. 발표 상황에서 더욱 적극적으로 의견을 제시하고 주도적으로 소통할 수 있는 강점이 생겼지만, 앞으로도 청중의 관점에서 스스로를 점검하는 태도를 함께 유지해 보세요.
- **C→A 전환형**: 초기에는 자신의 발표를 실제보다 높게 평가했지만, 후기에는 오히려 더 엄격하게 바라보는 모습으로 변화했습니다. 이는 발표 경험과 피드백을 통해 자신의 강점뿐 아니라 개선점까지 폭넓게 인식하게 되었음을 의미합니다. 발표에 대한 이해가 깊어졌다는 점에서 매우 의미 있는 변화이지만, 지나친 자기비판보다는 성장 가능성에도 함께 주목하는 균형 잡힌 시각이 중요합니다.
- **C→B 성찰형**: 초기에는 자신의 발표를 실제보다 높게 평가하는 경향이 있었지만, 후기에는 청중 평가와 유사한 수준으로 변화했습니다. 이는 다양한 발표 경험과 피드백을 통해 자신의 강점과 개선점을 보다 객관적으로 바라보게 되었음을 의미합니다. 자신을 정확하게 이해하는 능력은 앞으로의 성장을 더욱 빠르게 만드는 중요한 자산이 될 것입니다.
- **C→C 추진형**: 초기와 후기 모두 자기평가가 청중평가보다 높게 나타났습니다. 이는 자신의 발표에 대한 높은 자신감과 적극적인 태도를 갖고 있음을 의미합니다. 자신감은 발표에서 큰 강점이 될 수 있습니다. 앞으로는 청중이 실제로 어떻게 받아들이고 있는지도 함께 살펴본다면 더욱 설득력 있고 영향력 있는 발표자로 성장할 수 있을 것입니다.

### "내가 발견한 성장" 인트로 카피

> 앞선 결과가 발표 역량의 변화를 보여주는 보다 객관적인 성장 기록이라면, 아래 내용은 여러분이 직접 체감한 주관적인 성장 기록입니다.
> 유니브피티에서의 발표 경험, 피드백, 팀 활동, 그리고 수많은 연습 과정 속에서 여러분은 각자의 방식으로 성장해 왔습니다. 성장은 언제나 점수로만 설명되는 것은 아닙니다.
> 발표를 준비하며 고민했던 시간, 팀원들과 의견을 나누었던 순간, 용기를 내어 사람들 앞에 섰던 경험 하나하나가 여러분만의 성장으로 쌓여 왔습니다.
> 객관적인 성장과 주관적인 성장이 만나는 지점에서 진짜 변화가 시작됩니다. 유니브피티를 통해 스스로 발견한 가장 큰 성장의 순간을 확인해 보세요.

(이어서 멤버가 작성한 `growth_reflection` 인용 표시)

## 5. 데모 시드 + 비번 통일 (로컬 전용)

- `backend/scripts/seed_demo_final_report.py` (idempotent, **로컬 DB만**):
  - 가상 멤버: **김유피** + 운영진 이름(**장영진·이현아·김태형·김영헌**).
  - 초기 라운드 + 후기 라운드 생성(후기.`compare_to_round_id`=초기). 두 라운드 `results_open=true`.
  - 각 멤버에 SELF/AUDIENCE 응답을 **서로 다른 전환·유형이 보이게** 구성:
    - 예: 성장형(A→B), 균형형→강점집중형(+👑), 성찰형(C→B), 발전형(A→A), 추진형(C→C) 등 분산.
  - 후기 SELF에 `growth_reflection` 샘플 텍스트.
  - **로컬 DB의 모든 멤버+운영진 비밀번호 → `univpt33`**(bcrypt). 멤버 인증/운영진 인증 해시 컬럼 확인 후 적용.
- deploy/운영 서버는 건드리지 않음. push 금지.

## 6. 검증 (dev 서버 실시간 확인 항목)

- M1: 로컬 alembic upgrade 후 `eval_rounds.compare_to_round_id` 존재, 기존 데이터 무손실.
- M2: 시드 실행 후 멤버 로그인(univpt33)으로 후기 분석지 진입 → 오버레이 레이더/단계 화살표/👑/유형 전환/9유형 인식/멘토링 삭제/맨끝 회고 표시.
- M3: 운영진 결과 카드에서도 동일 후기 리포트.
- M4: `compare_to_round_id` 미설정 후기 라운드 → 기존 단일 리포트로 안 깨지고 렌더(fallback).
- M5: PDF 다운로드 시 "후기 분석지" 라벨/오버레이 정상.

## 7. 비범위 (YAGNI)
- 문항 자체 변경/추가 없음(초기·후기 동일 9문항 유지).
- COMBINED 라운드 타입 동작 변경 없음.
- 자동 round 페어링/세션 기반 추론 없음(명시 지정만).
