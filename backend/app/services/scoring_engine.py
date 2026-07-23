"""심사 점수 집계 엔진.

핵심 원칙 — **그룹 총점 고정**. 공개 링크라 제출 인원이 몇 명일지 알 수 없으므로,
심사위원 그룹과 청중 그룹의 기여도를 인원수와 무관하게 고정한다.

두 그룹의 점수 성격이 다르다는 점에 주의:

- **심사위원 (그리고 observer_mode='SCORE'인 청중)** — *절대* 채점.
  팀 t의 점수 = mean(t를 채점한 사람들의 득점 비율) × 그룹 총점.

- **청중 observer_mode='RANK'** — *배분*. 팀들이 그룹 총점을 나눠 갖는다.

계층형 기준: 영역(area) 아래 세부항목(criterion)이 있고, 심사위원은 영역마다
"세부항목별로 점수" 또는 "영역 통째로 한 점수" 중 골라 매길 수 있다. 어느 방식이든
영역의 유효 점수는 하나로 환산되어(통째면 그 값, 세부면 세부 합) 동일 척도로 집계된다.

감점: 최종점수 = (심사 + 청중) − 감점. 실격 팀은 순위에서 제외된다.
(감점은 운영자가 팀별로 입력한 값의 합이며, 이 엔진은 이미 계산된 감점·실격만 받는다.)
"""
from __future__ import annotations

from dataclasses import dataclass, field

# 소수점 둘째 자리까지 — 표시/비교용. 내부 계산은 float 그대로.
ROUND_TO = 2


@dataclass(frozen=True)
class AreaLite:
    id: int
    max_score: float
    criterion_ids: tuple[int, ...] = ()  # 세부항목 id들 (빈 튜플 = 영역 통째 전용)


@dataclass(frozen=True)
class CriterionLite:
    id: int
    max_score: float
    area_id: int | None = None  # None = 미분류(평면) 기준


@dataclass(frozen=True)
class ParticipantLite:
    id: int
    role: str  # JUDGE | OBSERVER
    name: str
    group_label: str | None = None  # 다동아리 모드에서 이 사람의 소그룹(동아리/외부) 식별용


@dataclass(frozen=True)
class ScoreLite:
    participant_id: int
    target_id: int
    score: float
    criterion_id: int | None = None  # 세부항목/미분류 점수
    area_id: int | None = None        # 영역 통째 점수(criterion_id 없음)


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
    pre_deduction: float = 0.0   # 감점 전 합계 (심사 + 청중)
    deduction: float = 0.0       # 감점 총합
    total: float = 0.0           # 감점 후 최종
    disqualified: bool = False
    rank: int = 0                # 실격 팀은 0
    judge_count: int = 0
    observer_count: int = 0
    # 세부항목/미분류 기준별 평균 원점수 {criterion_id: avg}
    criterion_avg: dict[int, float] = field(default_factory=dict)
    # 영역별 평균 유효 점수 {area_id: avg} — 레이더·요약용(통째/세부 무관)
    area_avg: dict[int, float] = field(default_factory=dict)
    # RANK 모드: 등수별 득표수 {rank: count}
    rank_votes: dict[int, int] = field(default_factory=dict)
    # ── 다동아리 모드 전용 (multi_club=False면 전부 None) ──
    internal_audience_ratio: float | None = None  # 내부 청중 동아리별 정규화 평균 (0~1)
    external_audience_ratio: float | None = None  # 외부 청중(풀 병합) 비율 (0~1)
    audience_award_score: float | None = None      # 청중상 점수(감점 전) = internal*w1 + external*w2
    audience_award_total: float | None = None      # 감점 반영 후
    audience_award_rank: int = 0                   # 청중상 전용 순위 (실격 팀은 0)


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def compute_results(
    *,
    judge_weight: float,
    observer_weight: float,
    observer_mode: str,
    rank_points: list[dict],
    criteria: list[CriterionLite],
    areas: list[AreaLite] | None = None,
    target_ids: list[int],
    participants: list[ParticipantLite],
    scores: list[ScoreLite],
    ranks: list[RankLite],
    deductions: dict[int, float] | None = None,
    disqualified: set[int] | None = None,
    multi_club: bool = False,
    group_blocked_targets: dict[str, list[int]] | None = None,
    external_group_labels: list[str] | None = None,
    internal_audience_weight: float = 50.0,
    external_audience_weight: float = 50.0,
) -> list[TargetResult]:
    """제출 완료된 participants만 넘길 것.

    반환: total 내림차순 정렬. 실격 팀은 맨 뒤·rank=0. 동점은 공동 순위.

    multi_club=True (observer_mode='RANK' 전제) — 다동아리 연합 이벤트 전용.
    팀의 "동아리" 소속은 별도 필드가 아니라 group_blocked_targets로 역으로 표현된다
    (그 소그룹이 투표 못 하는 팀 = 그 소그룹 소속 팀). 청중 인원이 동아리마다 다르면
    그냥 합산 시 인원 많은 동아리 팀이 유리해지므로, "그 동아리가 낼 수 있는 최고점
    대비 비율"로 바꾼 뒤 (자기 동아리 제외) 동아리 수로 평균낸다 — 투표 인원수가 아니라
    그 동아리에서 얼마나 높게 평가받았는지를 본다. 이 내부청중 정규화 평균을
    (1) 종합순위(대상/최우수/우수상)의 observer_points에 그대로 대입하고
    (2) 청중상(내부+외부 재조합) 계산에도 재사용한다. 외부로 지정된 라벨들은
    여러 개여도 전부 합쳐 단일 풀로 취급한다(외부는 동아리별 분리가 필요 없음).
    """
    areas = areas or []
    deductions = deductions or {}
    disqualified = disqualified or set()

    ungrouped = [c for c in criteria if c.area_id is None]
    # 만점 합계 = 영역 만점 합 + 미분류 기준 만점 합 (세부항목은 영역 만점에 이미 포함)
    max_total = sum(a.max_score for a in areas) + sum(c.max_score for c in ungrouped)

    judges = [p for p in participants if p.role == "JUDGE"]
    observers = [p for p in participants if p.role == "OBSERVER"]

    # (participant_id, target_id) → {"crit": {cid: score}, "area": {aid: score}}
    smap: dict[tuple[int, int], dict[str, dict[int, float]]] = {}
    for s in scores:
        cell = smap.setdefault((s.participant_id, s.target_id), {"crit": {}, "area": {}})
        if s.criterion_id is not None:
            cell["crit"][s.criterion_id] = s.score
        elif s.area_id is not None:
            cell["area"][s.area_id] = s.score

    def area_effective(cell: dict[str, dict[int, float]], a: AreaLite) -> float:
        """영역 유효 점수 — 통째 점수 있으면 그 값, 없으면 세부항목 합."""
        if a.id in cell["area"]:
            return cell["area"][a.id]
        return sum(cell["crit"].get(cid, 0.0) for cid in a.criterion_ids)

    def ratio(pid: int, tid: int) -> float | None:
        """이 사람이 이 팀에 준 득점 비율. 채점하지 않았으면 None."""
        cell = smap.get((pid, tid))
        if not cell or (not cell["crit"] and not cell["area"]) or max_total <= 0:
            return None
        raw = sum(area_effective(cell, a) for a in areas)
        raw += sum(cell["crit"].get(c.id, 0.0) for c in ungrouped)
        return raw / max_total

    results: dict[int, TargetResult] = {tid: TargetResult(target_id=tid) for tid in target_ids}

    # ── 심사위원: 절대 채점 → 평균 비율 × 그룹 총점 ──
    for tid in target_ids:
        r = results[tid]
        ratios = [x for j in judges if (x := ratio(j.id, tid)) is not None]
        r.judge_count = len(ratios)
        r.judge_points = _mean(ratios) * judge_weight

    # ── 청중 ──
    if observer_mode == "SCORE":
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
        awarded_total = 0.0
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
            results[tid].observer_points = (
                raw[tid] / awarded_total * observer_weight if awarded_total > 0 else 0.0
            )

        # ── 다동아리 모드: 동아리별 정규화 청중 점수 (종합순위 재정의 + 청중상 별도 계산) ──
        if multi_club:
            group_blocked_targets = group_blocked_targets or {}
            ext_labels = set(external_group_labels or [])
            pts_by_rank_vals = list(pts_by_rank.values())
            max_pts_per_voter = max(pts_by_rank_vals) if pts_by_rank_vals else 0.0
            pid_group = {o.id: o.group_label for o in observers}

            # 그룹별(내부/외부 구분 없이 일단) raw 점수·투표자 집계
            club_points: dict[str, dict[int, float]] = {}
            club_voters: dict[str, set[int]] = {}
            for rk in ranks:
                if rk.participant_id not in observer_ids or rk.target_id not in raw:
                    continue
                grp = pid_group.get(rk.participant_id)
                if not grp:
                    continue
                pts = pts_by_rank.get(rk.rank, 0.0)
                club_points.setdefault(grp, {}).setdefault(rk.target_id, 0.0)
                club_points[grp][rk.target_id] += pts
                club_voters.setdefault(grp, set()).add(rk.participant_id)

            def club_ratio(club: str, tid: int) -> float | None:
                voters = club_voters.get(club)
                if not voters or max_pts_per_voter <= 0:
                    return None
                denom = len(voters) * max_pts_per_voter
                if denom <= 0:
                    return None
                return club_points.get(club, {}).get(tid, 0.0) / denom

            # 외부로 지정된 라벨들은 전부 합쳐 단일 풀로
            ext_voters: set[int] = set()
            for grp, voters in club_voters.items():
                if grp in ext_labels:
                    ext_voters |= voters
            ext_denom = len(ext_voters) * max_pts_per_voter

            def external_ratio(tid: int) -> float | None:
                if not ext_voters or ext_denom <= 0:
                    return None
                pts = sum(
                    club_points.get(grp, {}).get(tid, 0.0)
                    for grp in club_points if grp in ext_labels
                )
                return pts / ext_denom

            internal_groups = [g for g in club_voters if g not in ext_labels]

            for tid in target_ids:
                blockers = {g for g in internal_groups if tid in group_blocked_targets.get(g, [])}
                other_groups = [g for g in internal_groups if g not in blockers]
                club_ratios = [x for g in other_groups if (x := club_ratio(g, tid)) is not None]
                internal_avg = _mean(club_ratios) if club_ratios else 0.0
                ext_ratio = external_ratio(tid)
                external_avg = ext_ratio if ext_ratio is not None else 0.0

                r = results[tid]
                # 0~1 스케일 비율이라 ROUND_TO(=2, 점수 표시용)를 그대로 쓰면 퍼센트 소수점이
                # 뭉개진다(80.35% → 80%) — 표시용 정밀도를 위해 소수 4자리까지 남긴다.
                r.internal_audience_ratio = round(internal_avg, 4)
                r.external_audience_ratio = round(external_avg, 4)
                # 종합순위(대상/최우수/우수상)용 청중 점수 — 전체 배분 방식 대신 동아리별 정규화로 교체
                r.observer_points = internal_avg * observer_weight
                # 청중상(심사위원 미포함, 내부+외부 재조합)은 별도 점수/순위
                r.audience_award_score = round(
                    internal_avg * internal_audience_weight + external_avg * external_audience_weight,
                    ROUND_TO,
                )

    # ── 채점자 = 심사위원 + SCORE 모드 청중 ──
    scorers = judges + (observers if observer_mode == "SCORE" else [])
    scorer_ids = {p.id for p in scorers}

    # 세부항목/미분류 기준별 평균 (실제 세부 점수를 낸 사람만)
    for tid in target_ids:
        for c in criteria:
            vals = [
                cell["crit"][c.id]
                for (pid, t), cell in smap.items()
                if t == tid and pid in scorer_ids and c.id in cell["crit"]
            ]
            results[tid].criterion_avg[c.id] = round(_mean(vals), ROUND_TO)

    # 영역별 평균 유효 점수 (그 팀을 채점한 사람 전원 — 통째/세부 무관)
    for tid in target_ids:
        for a in areas:
            vals = []
            for (pid, t), cell in smap.items():
                if t != tid or pid not in scorer_ids:
                    continue
                if not cell["crit"] and not cell["area"]:
                    continue
                if a.id not in cell["area"] and not any(cid in cell["crit"] for cid in a.criterion_ids):
                    continue  # 이 영역을 아예 안 건드림
                vals.append(area_effective(cell, a))
            results[tid].area_avg[a.id] = round(_mean(vals), ROUND_TO)

    # ── 감점·실격 반영 + 순위 ──
    for r in results.values():
        r.judge_points = round(r.judge_points, ROUND_TO)
        r.observer_points = round(r.observer_points, ROUND_TO)
        r.pre_deduction = round(r.judge_points + r.observer_points, ROUND_TO)
        r.deduction = round(deductions.get(r.target_id, 0.0), ROUND_TO)
        r.disqualified = r.target_id in disqualified
        r.total = round(r.pre_deduction - r.deduction, ROUND_TO)
        if r.audience_award_score is not None:
            r.audience_award_total = round(r.audience_award_score - r.deduction, ROUND_TO)

    live = [r for r in results.values() if not r.disqualified]
    dq = [r for r in results.values() if r.disqualified]

    live.sort(key=lambda r: -r.total)
    for i, r in enumerate(live):
        if i > 0 and r.total == live[i - 1].total:
            r.rank = live[i - 1].rank  # 동점 → 공동 순위
        else:
            r.rank = i + 1
    for r in dq:
        r.rank = 0  # 실격 — 순위 없음

    # 청중상 전용 순위 — 종합 순위(위)와 독립적으로 audience_award_total 기준 재정렬
    if multi_club:
        live_aw = sorted(
            (r for r in live if r.audience_award_total is not None),
            key=lambda r: -r.audience_award_total,
        )
        for i, r in enumerate(live_aw):
            if i > 0 and r.audience_award_total == live_aw[i - 1].audience_award_total:
                r.audience_award_rank = live_aw[i - 1].audience_award_rank
            else:
                r.audience_award_rank = i + 1

    return live + dq
