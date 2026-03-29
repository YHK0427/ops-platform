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

    각 영역 편차 = 해당 영역 - 나머지 2개 평균
    max - min <= 0.5: 균형형
    가장 큰 |편차| 영역이 양수이고 음수 편차와 0.07 이상 차이: 강점 집중형
    그 외 (음수이거나 동률): 보완점 명확형 (애매하면 개선 피드백 우선)
    """
    values = [v for v in domain_scores.values() if v is not None]
    if len(values) < 3:
        return "데이터 부족"

    max_val = max(values)
    min_val = min(values)

    if max_val - min_val <= 0.5:
        return "균형형"

    # 각 영역의 편차(나머지 2개 평균 대비) 계산
    domains = list(domain_scores.keys())
    deviations = {}
    for d in domains:
        if domain_scores[d] is None:
            continue
        others_avg = sum(domain_scores[o] for o in domains if o != d and domain_scores[o] is not None) / 2
        deviations[d] = domain_scores[d] - others_avg

    outlier = max(deviations, key=lambda k: abs(deviations[k]))
    if deviations[outlier] > 0:
        min_dev = min(deviations.values())
        if abs(deviations[outlier]) - abs(min_dev) >= 0.07:
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
