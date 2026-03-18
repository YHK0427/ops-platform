"""발표 성장 리포트 — 분석 헬퍼 함수"""

from app.constants.eval_questions import QUESTIONS_BY_DOMAIN, QUESTION_BY_KEY


def compute_domain_scores(responses: list) -> dict:
    """응답 리스트로부터 도메인별 평균 점수 산출.

    Args:
        responses: list of (question_key, score) tuples or objects with those attrs

    Returns:
        {"PLANNING": 3.5, "DESIGN": 4.0, "SPEECH": 3.0}
    """
    domain_sums: dict[str, float] = {}
    domain_counts: dict[str, int] = {}

    for resp in responses:
        if isinstance(resp, tuple):
            key, score = resp
        else:
            key, score = resp.question_key, resp.score

        q = QUESTION_BY_KEY.get(key)
        if q is None:
            continue

        domain = q["domain"]
        domain_sums[domain] = domain_sums.get(domain, 0.0) + score
        domain_counts[domain] = domain_counts.get(domain, 0) + 1

    result = {}
    for domain in ("PLANNING", "DESIGN", "SPEECH"):
        count = domain_counts.get(domain, 0)
        if count > 0:
            result[domain] = round(domain_sums[domain] / count, 2)
        else:
            result[domain] = None
    return result


def compute_question_scores(responses: list) -> dict:
    """응답 리스트로부터 문항별 점수 dict 반환.

    Returns:
        {"planning_consistency": 4, "planning_delivery": 3, ...}
    """
    return {
        (r[0] if isinstance(r, tuple) else r.question_key): (
            r[1] if isinstance(r, tuple) else r.score
        )
        for r in responses
    }


def compute_avg_question_scores(all_responses: list[list]) -> dict:
    """복수 평가자의 응답으로부터 문항별 평균 점수 산출.

    Args:
        all_responses: list of [responses_per_evaluator]

    Returns:
        {"planning_consistency": 3.67, ...}
    """
    sums: dict[str, float] = {}
    counts: dict[str, int] = {}

    for responses in all_responses:
        for resp in responses:
            key = resp[0] if isinstance(resp, tuple) else resp.question_key
            score = resp[1] if isinstance(resp, tuple) else resp.score
            sums[key] = sums.get(key, 0.0) + score
            counts[key] = counts.get(key, 0) + 1

    return {k: round(sums[k] / counts[k], 2) for k in sums}


def determine_stage(score: float) -> str:
    """종합 점수로 발표 단계 판별.

    1.0~1.5: 구조 형성
    1.6~3.0: 안정화
    3.1~4.5: 정교화
    4.6~5.0: 전달 최적화
    """
    if score <= 1.5:
        return "구조 형성"
    elif score <= 3.0:
        return "안정화"
    elif score <= 4.5:
        return "정교화"
    else:
        return "전달 최적화"


def determine_type(domain_scores: dict) -> str:
    """도메인별 점수로 발표 유형 판별.

    max - min <= 0.8: 균형형
    max - avg(other two) >= 1.0: 강점 집중형
    else: 성장 가능성형
    """
    values = [v for v in domain_scores.values() if v is not None]
    if len(values) < 3:
        return "데이터 부족"

    max_val = max(values)
    min_val = min(values)

    if max_val - min_val <= 0.8:
        return "균형형"

    # 최고 영역 제외한 나머지 2개 평균
    sorted_vals = sorted(values, reverse=True)
    avg_others = (sorted_vals[1] + sorted_vals[2]) / 2
    if max_val - avg_others >= 1.0:
        return "강점 집중형"

    return "보완점 명확형"


def compute_combined_domain_scores(
    self_domain: dict, audience_domain: dict
) -> dict:
    """자기평가와 청중평가를 1:1 비율로 결합.

    Returns:
        {"PLANNING": 3.75, "DESIGN": 4.0, "SPEECH": 3.5}
    """
    combined = {}
    for domain in ("PLANNING", "DESIGN", "SPEECH"):
        s = self_domain.get(domain)
        a = audience_domain.get(domain)
        if s is not None and a is not None:
            combined[domain] = round((s + a) / 2, 2)
        elif s is not None:
            combined[domain] = s
        elif a is not None:
            combined[domain] = a
        else:
            combined[domain] = None
    return combined
