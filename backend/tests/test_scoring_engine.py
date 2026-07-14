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
