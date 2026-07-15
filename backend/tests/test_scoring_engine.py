"""심사 집계 엔진 — 손계산과 대조하는 테스트.

핵심 불변식 두 가지:
- 심사위원(절대 채점): 팀 점수 = 평균 득점비율 × judge_weight. 팀 간 배분이 아니다.
- 참관위원 RANK(배분): 팀들이 observer_weight 를 나눠 갖는다 → 합계가 항상 observer_weight.
"""
from app.services.scoring_engine import (
    CriterionLite, ParticipantLite, RankLite, ScoreLite, compute_results,
)

# 기준 2개, 합계 만점 100점
CRITERIA = [CriterionLite(id=1, max_score=60), CriterionLite(id=2, max_score=40)]
TARGETS = [10, 20, 30]  # 팀 A/B/C

RANK_POINTS = [
    {"rank": 1, "points": 2},
    {"rank": 2, "points": 1.3},
    {"rank": 3, "points": 0.7},
]


def _judge(pid: int) -> ParticipantLite:
    return ParticipantLite(id=pid, role="JUDGE", name=f"심사{pid}")


def _obs(pid: int) -> ParticipantLite:
    return ParticipantLite(id=pid, role="OBSERVER", name=f"참관{pid}")


def _scores(pid: int, per_target: dict[int, tuple[float, float]]) -> list[ScoreLite]:
    out = []
    for tid, (c1, c2) in per_target.items():
        out.append(ScoreLite(participant_id=pid, target_id=tid, criterion_id=1, score=c1))
        out.append(ScoreLite(participant_id=pid, target_id=tid, criterion_id=2, score=c2))
    return out


def test_judge_score_is_absolute_not_distributed():
    """심사위원 2명이 모든 팀에 만점 → 모든 팀이 judge_weight 만점을 받는다(배분 아님)."""
    judges = [_judge(1), _judge(2)]
    scores = _scores(1, {t: (60, 40) for t in TARGETS}) + _scores(2, {t: (60, 40) for t in TARGETS})

    res = compute_results(
        judge_weight=80, observer_weight=20, observer_mode="RANK", rank_points=RANK_POINTS,
        criteria=CRITERIA, target_ids=TARGETS, participants=judges, scores=scores, ranks=[],
    )
    for r in res:
        assert r.judge_points == 80.0
        assert r.judge_count == 2


def test_judge_average_across_submitters():
    """심사위원 수가 몇이든 그룹 총점은 고정 — 평균 비율 × 80."""
    judges = [_judge(1), _judge(2)]
    # 팀10: 심사1이 100%, 심사2가 50% → 평균 75% → 60점
    scores = _scores(1, {10: (60, 40)}) + _scores(2, {10: (30, 20)})

    res = compute_results(
        judge_weight=80, observer_weight=20, observer_mode="RANK", rank_points=RANK_POINTS,
        criteria=CRITERIA, target_ids=[10], participants=judges, scores=scores, ranks=[],
    )
    assert res[0].judge_points == 60.0


def test_judge_skipping_a_team_excludes_only_that_judge():
    """자기팀 제외로 한 명이 건너뛰면, 그 팀 평균에서 그 사람만 빠진다(0점 취급 아님)."""
    judges = [_judge(1), _judge(2)]
    # 심사2는 팀10을 아예 채점하지 않음 → 팀10은 심사1의 50%만 반영 → 40점
    scores = _scores(1, {10: (30, 20)})

    res = compute_results(
        judge_weight=80, observer_weight=20, observer_mode="RANK", rank_points=RANK_POINTS,
        criteria=CRITERIA, target_ids=[10], participants=judges, scores=scores, ranks=[],
    )
    assert res[0].judge_points == 40.0  # 0점 처리였다면 20점이 됐을 것
    assert res[0].judge_count == 1


def test_observer_rank_group_total_is_fixed_regardless_of_headcount():
    """사용자 시나리오 — 참관위원 20점 비중. 5명이든 12명이든 그룹 합계는 정확히 20점."""
    for m in (5, 12, 1):
        observers = [_obs(i) for i in range(100, 100 + m)]
        # 전원이 팀10=1위, 팀20=2위, 팀30=3위로 동일 투표
        ranks = []
        for o in observers:
            ranks += [
                RankLite(participant_id=o.id, target_id=10, rank=1),
                RankLite(participant_id=o.id, target_id=20, rank=2),
                RankLite(participant_id=o.id, target_id=30, rank=3),
            ]

        res = compute_results(
            judge_weight=80, observer_weight=20, observer_mode="RANK", rank_points=RANK_POINTS,
            criteria=CRITERIA, target_ids=TARGETS, participants=observers, scores=[], ranks=ranks,
        )
        total = sum(r.observer_points for r in res)
        assert abs(total - 20.0) < 0.05, f"참관위원 {m}명일 때 합계 {total}"

        # 등수 비율대로 배분: 2 : 1.3 : 0.7 (합 4) → 10 : 6.5 : 3.5 점
        by_id = {r.target_id: r.observer_points for r in res}
        assert abs(by_id[10] - 10.0) < 0.05
        assert abs(by_id[20] - 6.5) < 0.05
        assert abs(by_id[30] - 3.5) < 0.05


def test_observer_rank_points_are_relative_only():
    """등수 배점을 통째로 2배(4/2.6/1.4)로 바꿔도 결과는 동일 — 상대 비율로만 작동."""
    observers = [_obs(101), _obs(102)]
    ranks = []
    for o in observers:
        ranks += [
            RankLite(participant_id=o.id, target_id=10, rank=1),
            RankLite(participant_id=o.id, target_id=20, rank=2),
            RankLite(participant_id=o.id, target_id=30, rank=3),
        ]

    doubled = [{"rank": 1, "points": 4}, {"rank": 2, "points": 2.6}, {"rank": 3, "points": 1.4}]
    a = compute_results(
        judge_weight=80, observer_weight=20, observer_mode="RANK", rank_points=RANK_POINTS,
        criteria=CRITERIA, target_ids=TARGETS, participants=observers, scores=[], ranks=ranks,
    )
    b = compute_results(
        judge_weight=80, observer_weight=20, observer_mode="RANK", rank_points=doubled,
        criteria=CRITERIA, target_ids=TARGETS, participants=observers, scores=[], ranks=ranks,
    )
    assert [r.observer_points for r in a] == [r.observer_points for r in b]


def test_observer_score_mode_is_absolute():
    """observer_mode=SCORE 는 심사위원과 같은 절대 채점 (배분 아님)."""
    observers = [_obs(101)]
    scores = _scores(101, {t: (60, 40) for t in TARGETS})  # 전 팀 만점

    res = compute_results(
        judge_weight=80, observer_weight=20, observer_mode="SCORE", rank_points=RANK_POINTS,
        criteria=CRITERIA, target_ids=TARGETS, participants=observers, scores=scores, ranks=[],
    )
    for r in res:
        assert r.observer_points == 20.0  # 전 팀이 20점 만점 — 나눠 갖지 않는다


def test_combined_total_and_ranking():
    judges = [_judge(1)]
    observers = [_obs(101)]
    # 심사: 팀10 100%, 팀20 50%, 팀30 0%
    scores = _scores(1, {10: (60, 40), 20: (30, 20), 30: (0, 0)})
    # 참관: 팀20을 1위로 밀어줌
    ranks = [
        RankLite(participant_id=101, target_id=20, rank=1),
        RankLite(participant_id=101, target_id=10, rank=2),
        RankLite(participant_id=101, target_id=30, rank=3),
    ]

    res = compute_results(
        judge_weight=80, observer_weight=20, observer_mode="RANK", rank_points=RANK_POINTS,
        criteria=CRITERIA, target_ids=TARGETS, participants=judges + observers,
        scores=scores, ranks=ranks,
    )
    by_id = {r.target_id: r for r in res}
    # 팀10: 심사 80 + 참관 (1.3/4)*20 = 6.5 → 86.5
    assert by_id[10].total == 86.5
    # 팀20: 심사 40 + 참관 (2/4)*20 = 10 → 50
    assert by_id[20].total == 50.0
    # 팀30: 심사 0 + 참관 (0.7/4)*20 = 3.5 → 3.5
    assert by_id[30].total == 3.5

    assert by_id[10].rank == 1
    assert by_id[20].rank == 2
    assert by_id[30].rank == 3
    assert res[0].target_id == 10  # total 내림차순 정렬


def test_no_submissions_is_zero_not_crash():
    res = compute_results(
        judge_weight=80, observer_weight=20, observer_mode="RANK", rank_points=RANK_POINTS,
        criteria=CRITERIA, target_ids=TARGETS, participants=[], scores=[], ranks=[],
    )
    assert all(r.total == 0.0 for r in res)
    assert len(res) == 3


def test_no_criteria_is_zero_not_divide_by_zero():
    res = compute_results(
        judge_weight=80, observer_weight=20, observer_mode="SCORE", rank_points=RANK_POINTS,
        criteria=[], target_ids=TARGETS, participants=[_judge(1)], scores=[], ranks=[],
    )
    assert all(r.total == 0.0 for r in res)


def test_tied_totals_share_rank():
    judges = [_judge(1)]
    scores = _scores(1, {10: (60, 40), 20: (60, 40), 30: (0, 0)})
    res = compute_results(
        judge_weight=80, observer_weight=20, observer_mode="RANK", rank_points=RANK_POINTS,
        criteria=CRITERIA, target_ids=TARGETS, participants=judges, scores=scores, ranks=[],
    )
    by_id = {r.target_id: r for r in res}
    assert by_id[10].rank == 1
    assert by_id[20].rank == 1  # 동점 → 공동 1위
    assert by_id[30].rank == 3


def test_criterion_average_for_radar_chart():
    judges = [_judge(1), _judge(2)]
    scores = _scores(1, {10: (60, 20)}) + _scores(2, {10: (40, 40)})
    res = compute_results(
        judge_weight=80, observer_weight=20, observer_mode="RANK", rank_points=RANK_POINTS,
        criteria=CRITERIA, target_ids=[10], participants=judges, scores=scores, ranks=[],
    )
    assert res[0].criterion_avg[1] == 50.0  # (60+40)/2
    assert res[0].criterion_avg[2] == 30.0  # (20+40)/2


# ── 계층형 기준 (영역 → 세부항목) ──────────────────────────────────────────────

from app.services.scoring_engine import AreaLite
from app.services.scoring_deductions import compute_deduction


def test_area_lump_equals_subitem_sum():
    """같은 팀에 심사위원 A는 세부항목별로, B는 영역 통째로 매겨도 동일 척도로 집계된다."""
    # 영역1(만점60) = 세부11(30) + 세부12(30), 영역2(만점40) = 세부21(40)
    areas = [AreaLite(id=1, max_score=60, criterion_ids=(11, 12)),
             AreaLite(id=2, max_score=40, criterion_ids=(21,))]
    criteria = [CriterionLite(id=11, max_score=30, area_id=1),
                CriterionLite(id=12, max_score=30, area_id=1),
                CriterionLite(id=21, max_score=40, area_id=2)]
    judges = [_judge(1), _judge(2)]
    # A: 세부항목별 (영역1: 30+18=48, 영역2: 32) → 팀 만점 대비 80/100
    scores = [
        ScoreLite(participant_id=1, target_id=10, criterion_id=11, score=30),
        ScoreLite(participant_id=1, target_id=10, criterion_id=12, score=18),
        ScoreLite(participant_id=1, target_id=10, criterion_id=21, score=32),
    ]
    # B: 영역 통째 (영역1=48, 영역2=32) → 동일한 80/100
    scores += [
        ScoreLite(participant_id=2, target_id=10, area_id=1, score=48),
        ScoreLite(participant_id=2, target_id=10, area_id=2, score=32),
    ]
    res = compute_results(
        judge_weight=80, observer_weight=20, observer_mode="RANK", rank_points=RANK_POINTS,
        criteria=criteria, areas=areas, target_ids=[10], participants=judges,
        scores=scores, ranks=[],
    )
    # 두 사람 모두 80% → 평균 80% × 80 = 64
    assert res[0].judge_points == 64.0
    assert res[0].area_avg[1] == 48.0   # 두 방식 모두 영역1 유효점수 48
    assert res[0].area_avg[2] == 32.0


def test_ungrouped_and_areas_mixed():
    """영역 + 미분류 기준이 섞여도 만점 합으로 정규화된다."""
    areas = [AreaLite(id=1, max_score=60, criterion_ids=(11,))]
    criteria = [CriterionLite(id=11, max_score=60, area_id=1),
                CriterionLite(id=99, max_score=40, area_id=None)]  # 미분류 40
    judges = [_judge(1)]
    scores = [
        ScoreLite(participant_id=1, target_id=10, area_id=1, score=60),   # 영역 통째 만점
        ScoreLite(participant_id=1, target_id=10, criterion_id=99, score=20),  # 미분류 절반
    ]
    res = compute_results(
        judge_weight=100, observer_weight=0, observer_mode="RANK", rank_points=RANK_POINTS,
        criteria=criteria, areas=areas, target_ids=[10], participants=judges,
        scores=scores, ranks=[],
    )
    # (60+20)/100 = 80% × 100 = 80
    assert res[0].judge_points == 80.0


def test_deduction_and_rank_reorder():
    """감점이 순위를 실제로 바꾼다."""
    judges = [_judge(1)]
    scores = _scores(1, {10: (60, 40), 20: (54, 36)})  # 10=100%, 20=90%
    res = compute_results(
        judge_weight=100, observer_weight=0, observer_mode="RANK", rank_points=RANK_POINTS,
        criteria=CRITERIA, target_ids=[10, 20], participants=judges, scores=scores, ranks=[],
        deductions={10: 15.0},  # 1위 팀에 -15
    )
    by = {r.target_id: r for r in res}
    assert by[10].pre_deduction == 100.0
    assert by[10].deduction == 15.0
    assert by[10].total == 85.0
    assert by[20].total == 90.0
    assert by[20].rank == 1   # 감점 후 역전
    assert by[10].rank == 2


def test_disqualified_excluded_from_ranking():
    judges = [_judge(1)]
    scores = _scores(1, {10: (60, 40), 20: (30, 20)})
    res = compute_results(
        judge_weight=100, observer_weight=0, observer_mode="RANK", rank_points=RANK_POINTS,
        criteria=CRITERIA, target_ids=[10, 20], participants=judges, scores=scores, ranks=[],
        disqualified={10},
    )
    by = {r.target_id: r for r in res}
    assert by[10].disqualified is True
    assert by[10].rank == 0          # 순위 없음
    assert by[20].rank == 1          # 살아남은 팀이 1위
    assert res[-1].target_id == 10   # 실격 팀은 맨 뒤


# ── 감점 계산 (compute_deduction) ─────────────────────────────────────────────

def test_deduction_time_steps():
    cfg = {
        "deadline": "2026-07-18T00:00:00",
        "mode": "STEPS",
        "steps": [
            {"after_minutes": 0, "points": 1.5},
            {"after_minutes": 120, "points": 3},
            {"after_minutes": 360, "points": 6},
        ],
        "disqualify_after_minutes": 600,  # 10시간
    }
    # 01:30 제출 → 90분 → 첫 구간(-1.5)
    assert compute_deduction("TIME", cfg, {"submitted_at": "2026-07-18T01:30:00"}) == (1.5, False)
    # 03:00 → 180분 → -3
    assert compute_deduction("TIME", cfg, {"submitted_at": "2026-07-18T03:00:00"}) == (3.0, False)
    # 07:00 → 420분 → -6
    assert compute_deduction("TIME", cfg, {"submitted_at": "2026-07-18T07:00:00"}) == (6.0, False)
    # 정시 이내
    assert compute_deduction("TIME", cfg, {"submitted_at": "2026-07-17T23:00:00"}) == (0.0, False)
    # 10:00 초과 → 실격
    assert compute_deduction("TIME", cfg, {"submitted_at": "2026-07-18T11:00:00"}) == (0.0, True)


def test_deduction_time_interval():
    cfg = {"deadline": "2026-07-18T00:00:00", "mode": "INTERVAL",
           "interval_minutes": 30, "interval_points": 1.5, "max_points": 6}
    # 45분 → ceil(45/30)=2 구간 → 3점
    assert compute_deduction("TIME", cfg, {"submitted_at": "2026-07-18T00:45:00"}) == (3.0, False)
    # 5시간(300분) → 10구간 × 1.5 = 15 → 상한 6
    assert compute_deduction("TIME", cfg, {"submitted_at": "2026-07-18T05:00:00"}) == (6.0, False)


def test_deduction_duration_and_flag():
    # 발표시간 기준 300초(5분), 허용오차 30초, 30초마다 -1.5
    cfg = {"target_seconds": 300, "tolerance_seconds": 30, "unit_seconds": 30, "unit_points": 1.5}
    # 정확히 5분 → 감점 없음
    assert compute_deduction("DURATION", cfg, {"actual_seconds": 300}) == (0.0, False)
    # 320초(20초 초과) → 허용오차 안 → 0
    assert compute_deduction("DURATION", cfg, {"actual_seconds": 320}) == (0.0, False)
    # 350초(50초 초과) → 허용 30 넘긴 20초 → 1구간 → -1.5
    assert compute_deduction("DURATION", cfg, {"actual_seconds": 350}) == (1.5, False)
    # 240초(60초 미달) → 허용 30 넘긴 30초 → 1구간 → -1.5 (미달도 감점)
    assert compute_deduction("DURATION", cfg, {"actual_seconds": 240}) == (1.5, False)
    # 400초(100초 초과) → 허용 넘긴 70초 → ceil(70/30)=3구간 → -4.5
    assert compute_deduction("DURATION", cfg, {"actual_seconds": 400}) == (4.5, False)
    # 상한
    cap = {**cfg, "max_points": 3}
    assert compute_deduction("DURATION", cap, {"actual_seconds": 400}) == (3.0, False)
    # 체크형
    assert compute_deduction("FLAG", {"points": 1}, {"checked": True}) == (1.0, False)
    assert compute_deduction("FLAG", {"points": 1}, {"checked": False}) == (0.0, False)


def test_deduction_empty_input_is_zero():
    assert compute_deduction("TIME", {"deadline": "2026-07-18T00:00:00"}, {}) == (0.0, False)
    assert compute_deduction("DURATION", {"target_seconds": 300, "unit_seconds": 30, "unit_points": 1.5}, {}) == (0.0, False)
    assert compute_deduction("FLAG", {"points": 1}, {}) == (0.0, False)
