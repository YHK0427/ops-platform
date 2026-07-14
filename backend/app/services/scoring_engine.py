"""심사 점수 집계 엔진.

핵심 원칙 — **그룹 총점 고정**. 공개 링크라 제출 인원이 몇 명일지 알 수 없으므로,
심사위원 그룹과 참관위원 그룹의 기여도를 인원수와 무관하게 고정한다.

두 그룹의 점수 성격이 다르다는 점에 주의:

- **심사위원 (그리고 observer_mode='SCORE'인 참관위원)** — *절대* 채점.
  팀 t의 점수 = mean(t를 채점한 사람들의 득점 비율) × 그룹 총점.
  모든 팀이 만점을 받으면 모든 팀이 그룹 총점을 다 받는다(팀 간 배분이 아님).
  제출자가 N명이면 각자 (그룹총점/N)만큼 기여 → 평균과 수학적으로 동일.

- **참관위원 observer_mode='RANK'** — *배분*. 팀들이 그룹 총점을 나눠 갖는다.
  "참관위원 20점, 5명이면 각자 4점씩 1·2·3위에 차등 배분" 이라는 요구가 그대로 이것.
  실제 배부된 점수 총합으로 나누므로, 참관위원이 몇 명이든 그룹 합계는 정확히 20점.
  등수별 배점(rank_points)은 절대값이 아니라 **상대 비율로만** 작동한다.

자기팀 제외로 어떤 심사위원이 특정 팀을 건너뛰면, 그 팀의 평균에서 해당 심사위원만
빠진다(분모가 자동으로 조정됨).
"""
from __future__ import annotations

from dataclasses import dataclass, field

# 소수점 둘째 자리까지 — 표시/비교용. 내부 계산은 float 그대로.
ROUND_TO = 2


@dataclass(frozen=True)
class CriterionLite:
    id: int
    max_score: float


@dataclass(frozen=True)
class ParticipantLite:
    id: int
    role: str  # JUDGE | OBSERVER
    name: str


@dataclass(frozen=True)
class ScoreLite:
    participant_id: int
    target_id: int
    criterion_id: int
    score: float


@dataclass(frozen=True)
class RankLite:
    participant_id: int
    target_id: int
    rank: int


@dataclass
class TargetResult:
    target_id: int
    judge_points: float = 0.0
    observer_points: float = 0.0
    total: float = 0.0
    rank: int = 0
    judge_count: int = 0        # 이 팀을 채점한 심사위원 수
    observer_count: int = 0     # 이 팀을 채점/투표한 참관위원 수
    # 기준별 평균 원점수 {criterion_id: avg} — 결과 테이블·레이더 차트용
    criterion_avg: dict[int, float] = field(default_factory=dict)
    # RANK 모드: 등수별 득표수 {rank: count}
    rank_votes: dict[int, int] = field(default_factory=dict)


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def compute_results(
    *,
    judge_weight: float,
    observer_weight: float,
    observer_mode: str,
    rank_points: list[dict],
    criteria: list[CriterionLite],
    target_ids: list[int],
    participants: list[ParticipantLite],
    scores: list[ScoreLite],
    ranks: list[RankLite],
) -> list[TargetResult]:
    """제출 완료된 participants만 넘길 것 (submitted_at IS NOT NULL 필터는 호출부 책임).

    반환: target_ids 순서와 무관하게 total 내림차순 정렬된 결과. rank는 1부터, 동점은 공동 순위.
    """
    max_total = sum(c.max_score for c in criteria)

    judges = [p for p in participants if p.role == "JUDGE"]
    observers = [p for p in participants if p.role == "OBSERVER"]

    # (participant_id, target_id) → {criterion_id: score}
    score_map: dict[tuple[int, int], dict[int, float]] = {}
    for s in scores:
        score_map.setdefault((s.participant_id, s.target_id), {})[s.criterion_id] = s.score

    def ratio(pid: int, tid: int) -> float | None:
        """이 사람이 이 팀에 준 득점 비율. 채점하지 않았으면 None."""
        row = score_map.get((pid, tid))
        if not row or max_total <= 0:
            return None
        return sum(row.values()) / max_total

    results: dict[int, TargetResult] = {tid: TargetResult(target_id=tid) for tid in target_ids}

    # ── 심사위원: 절대 채점 → 평균 비율 × 그룹 총점 ──
    for tid in target_ids:
        r = results[tid]
        ratios = [x for j in judges if (x := ratio(j.id, tid)) is not None]
        r.judge_count = len(ratios)
        r.judge_points = _mean(ratios) * judge_weight

    # ── 참관위원 ──
    if observer_mode == "SCORE":
        # 심사위원과 동일한 절대 채점, 그룹 총점만 다름
        for tid in target_ids:
            r = results[tid]
            ratios = [x for o in observers if (x := ratio(o.id, tid)) is not None]
            r.observer_count = len(ratios)
            r.observer_points = _mean(ratios) * observer_weight
    else:
        # RANK — 팀들이 그룹 총점을 나눠 갖는다.
        pts_by_rank = {int(rp["rank"]): float(rp["points"]) for rp in rank_points}
        observer_ids = {o.id for o in observers}

        raw: dict[int, float] = {tid: 0.0 for tid in target_ids}
        awarded_total = 0.0  # 실제로 배부된 점수 총합 = 정규화 분모
        for rk in ranks:
            if rk.participant_id not in observer_ids or rk.target_id not in raw:
                continue
            pts = pts_by_rank.get(rk.rank, 0.0)
            raw[rk.target_id] += pts
            awarded_total += pts
            r = results[rk.target_id]
            r.rank_votes[rk.rank] = r.rank_votes.get(rk.rank, 0) + 1
            r.observer_count += 1

        for tid in target_ids:
            # 분모가 실제 배부 총합이므로, 참관위원이 몇 명이든 합계는 정확히 observer_weight
            results[tid].observer_points = (
                raw[tid] / awarded_total * observer_weight if awarded_total > 0 else 0.0
            )

    # ── 기준별 평균 원점수 (심사위원 + SCORE 모드 참관위원 = 실제로 채점한 사람 전원) ──
    scorers = judges + (observers if observer_mode == "SCORE" else [])
    scorer_ids = {p.id for p in scorers}
    for tid in target_ids:
        for c in criteria:
            vals = [
                row[c.id]
                for (pid, t), row in score_map.items()
                if t == tid and pid in scorer_ids and c.id in row
            ]
            results[tid].criterion_avg[c.id] = round(_mean(vals), ROUND_TO)

    # ── 총점 + 순위 (동점 공동 순위) ──
    for r in results.values():
        r.judge_points = round(r.judge_points, ROUND_TO)
        r.observer_points = round(r.observer_points, ROUND_TO)
        r.total = round(r.judge_points + r.observer_points, ROUND_TO)

    ordered = sorted(results.values(), key=lambda r: -r.total)
    for i, r in enumerate(ordered):
        if i > 0 and r.total == ordered[i - 1].total:
            r.rank = ordered[i - 1].rank  # 동점 → 공동 순위
        else:
            r.rank = i + 1
    return ordered
