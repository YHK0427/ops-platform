"""감점 계산 — 규정(config) + 팀 입력(input) → 감점 점수·실격 여부.

순수 함수. 라우터가 팀별 감점을 저장할 때 서버에서 계산해 캐시한다(신뢰 경계: 클라이언트가
보낸 points를 믿지 않는다). 3종:

- TIME (발표자료 지각): 마감시각 대비 제출 지연분으로 자동 판정
    config {deadline, mode:"INTERVAL"|"STEPS", interval_minutes, interval_points, max_points?,
            steps:[{at, points, disqualify?} | {after_minutes, points, disqualify?}],
            disqualify_at?, disqualify_after_minutes?}
    input  {submitted_at}

    STEPS 구간은 두 가지 방식을 섞어 쓸 수 있다:
    - at (절대 시각) — 신규. "몇 시 몇 분 몇 초 이후 제출"을 직접 지정한다.
    - after_minutes (마감 기준 상대분) — 구버전 호환용. 예전에 만든 규정은 이 형태 그대로 계산된다.
    구간마다 실제 판정 시각(threshold)을 구해 큰 순서로 훑으면서 제출시각이 넘긴 첫 구간을 적용한다.
    disqualify_at/disqualify_after_minutes도 같은 관계 — 있으면 at을, 없으면 after_minutes를 쓴다.
- DURATION (발표시간 초과·미달): 기준 시간과의 차이가 허용오차를 넘으면 단위마다 감점
    config {target_seconds, tolerance_seconds, unit_seconds, unit_points, max_points?}
    input  {actual_seconds}
- FLAG (형식 미준수 등): 체크 시 고정 감점
    config {points}                     input {checked: bool}
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta


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


def _naive(dt: datetime | None) -> datetime | None:
    """tz 혼용 방지 — naive 로 통일(같은 벽시계 기준으로 다룬다)."""
    if dt is not None and dt.tzinfo is not None:
        return dt.replace(tzinfo=None)
    return dt


def _time(config: dict, inp: dict) -> tuple[float, bool]:
    submitted = _naive(_parse_dt(inp.get("submitted_at")))
    if submitted is None:
        return 0.0, False
    deadline = _naive(_parse_dt(config.get("deadline")))

    mode = config.get("mode", "STEPS")
    if mode == "INTERVAL":
        if deadline is None:
            return 0.0, False
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

        interval = float(config.get("interval_minutes") or 0)
        unit_pts = float(config.get("interval_points") or 0)
        if interval <= 0 or unit_pts <= 0:
            return 0.0, False
        units = math.ceil(late_min / interval)
        return _cap(units * unit_pts, config), False

    # STEPS — 구간마다 판정 시각(threshold)을 구해서 큰 시각부터 훑는다.
    # 구간은 at(절대 시각, 신규) 또는 after_minutes(마감 기준 상대분, 구버전 호환) 중 하나를 쓴다.
    def threshold(entry: dict) -> datetime | None:
        at = _naive(_parse_dt(entry.get("at")))
        if at is not None:
            return at
        if deadline is not None and entry.get("after_minutes") is not None:
            try:
                return deadline + timedelta(minutes=float(entry["after_minutes"]))
            except (ValueError, TypeError):
                return None
        return None

    dq_at = _naive(_parse_dt(config.get("disqualify_at")))
    if dq_at is not None:
        if submitted > dq_at:
            return 0.0, True
    elif deadline is not None:
        dq_after = config.get("disqualify_after_minutes")
        if dq_after is not None:
            try:
                if (submitted - deadline).total_seconds() / 60.0 > float(dq_after):
                    return 0.0, True
            except (ValueError, TypeError):
                pass

    steps = [(threshold(st), st) for st in (config.get("steps") or [])]
    steps = [(th, st) for th, st in steps if th is not None]
    steps.sort(key=lambda pair: pair[0], reverse=True)
    for th, st in steps:
        if submitted > th:
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
