"""감점 계산 — 규정(config) + 팀 입력(input) → 감점 점수·실격 여부.

순수 함수. 라우터가 팀별 감점을 저장할 때 서버에서 계산해 캐시한다(신뢰 경계: 클라이언트가
보낸 points를 믿지 않는다). 3종:

- TIME (발표자료 지각): 마감시각 대비 제출 지연분으로 자동 판정
    config {deadline, mode:"INTERVAL"|"STEPS", interval_minutes, interval_points, max_points?,
            steps:[{after_minutes, points, disqualify?}], disqualify_after_minutes?}
    input  {submitted_at}
- DURATION (발표시간 초과·미달): 기준 시간과의 차이가 허용오차를 넘으면 단위마다 감점
    config {target_seconds, tolerance_seconds, unit_seconds, unit_points, max_points?}
    input  {actual_seconds}
- FLAG (형식 미준수 등): 체크 시 고정 감점
    config {points}                     input {checked: bool}
"""
from __future__ import annotations

import math
from datetime import datetime


def _parse_dt(v) -> datetime | None:
    if not v:
        return None
    if isinstance(v, datetime):
        return v
    try:
        # ISO8601 ('Z' 포함) 허용
        return datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def compute_deduction(kind: str, config: dict, inp: dict) -> tuple[float, bool]:
    """반환: (감점 점수 ≥ 0, 실격 여부). 입력이 비었으면 (0, False)."""
    config = config or {}
    inp = inp or {}

    if kind == "TIME":
        return _time(config, inp)
    if kind == "DURATION":
        return _duration(config, inp)
    if kind == "FLAG":
        return _flag(config, inp)
    return 0.0, False


def _cap(points: float, config: dict) -> float:
    mx = config.get("max_points")
    if mx is not None:
        try:
            return min(points, float(mx))
        except (ValueError, TypeError):
            pass
    return points


def _time(config: dict, inp: dict) -> tuple[float, bool]:
    deadline = _parse_dt(config.get("deadline"))
    submitted = _parse_dt(inp.get("submitted_at"))
    if deadline is None or submitted is None:
        return 0.0, False

    # tz 혼용 방지 — 둘 다 naive 로 비교(같은 벽시계 기준으로 다룬다)
    if deadline.tzinfo is not None:
        deadline = deadline.replace(tzinfo=None)
    if submitted.tzinfo is not None:
        submitted = submitted.replace(tzinfo=None)

    late_min = (submitted - deadline).total_seconds() / 60.0
    if late_min <= 0:
        return 0.0, False  # 정시 이내

    dq_after = config.get("disqualify_after_minutes")
    if dq_after is not None:
        try:
            if late_min > float(dq_after):
                return 0.0, True  # 실격 — 점수 무의미
        except (ValueError, TypeError):
            pass

    mode = config.get("mode", "STEPS")
    if mode == "INTERVAL":
        interval = float(config.get("interval_minutes") or 0)
        unit_pts = float(config.get("interval_points") or 0)
        if interval <= 0 or unit_pts <= 0:
            return 0.0, False
        units = math.ceil(late_min / interval)
        return _cap(units * unit_pts, config), False

    # STEPS — 경과분이 큰 구간부터 매칭(가장 강한 구간 적용)
    steps = sorted(
        (config.get("steps") or []),
        key=lambda s: float(s.get("after_minutes") or 0),
        reverse=True,
    )
    for st in steps:
        after = float(st.get("after_minutes") or 0)
        if late_min > after:
            if st.get("disqualify"):
                return 0.0, True
            return float(st.get("points") or 0), False
    return 0.0, False


def _duration(config: dict, inp: dict) -> tuple[float, bool]:
    """발표시간 초과·미달. 기준 시간과의 차이가 허용오차를 넘으면 단위마다 감점."""
    actual = inp.get("actual_seconds")
    if actual in (None, ""):
        return 0.0, False
    try:
        actual = float(actual)
    except (ValueError, TypeError):
        return 0.0, False

    target = float(config.get("target_seconds") or 0)
    tolerance = float(config.get("tolerance_seconds") or 0)
    unit = float(config.get("unit_seconds") or 0)
    unit_pts = float(config.get("unit_points") or 0)
    if target <= 0 or unit <= 0 or unit_pts <= 0:
        return 0.0, False

    diff = abs(actual - target)          # 초과·미달 모두 절대차로
    over = max(0.0, diff - tolerance)    # 허용오차 안이면 감점 없음
    if over <= 0:
        return 0.0, False
    units = math.ceil(over / unit)
    return _cap(units * unit_pts, config), False


def _flag(config: dict, inp: dict) -> tuple[float, bool]:
    checked = bool(inp.get("checked"))
    if not checked:
        return 0.0, False
    return float(config.get("points") or 0), False
