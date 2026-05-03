/**
 * 멤버 벌점 위험도 계산 — 진짜 임박한 사람만 표시.
 *
 * 시스템 룰: 누적벌점이 -10, -20, -30점 도달할 때마다 5,000원 추가 벌금 부과.
 *
 * 표시 규칙:
 * - net_score >= 0 → 잘하고 있는 멤버. 위험 표시 안 함.
 * - net_score < 0 + 다음 5천원 부과까지 3점 이하 → "danger" (벌금 임박)
 * - 그 외 → null (광범위한 '주의' 표기는 노이즈만 됨)
 */
export function penaltyRisk(
    minusScore: number,
    netScore: number,
): { level: "danger"; distance: number; nextThreshold: number } | null {
    if (minusScore >= 0) return null;
    if (netScore >= 0) return null;
    const abs = Math.abs(minusScore);
    const nextThreshold = -((Math.floor(abs / 10) + 1) * 10);
    const distance = minusScore - nextThreshold;
    if (distance <= 3) return { level: "danger", distance, nextThreshold };
    return null;
}
