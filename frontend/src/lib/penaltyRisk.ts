/**
 * 멤버 벌점 위험도 계산.
 *
 * 시스템 룰: 누적벌점이 -10, -20, -30점 도달할 때마다 5,000원 추가 벌금 부과.
 *
 * 표시 규칙:
 * - net_score >= 0 → 잘하고 있는 멤버. 위험 표시 안 함 (사용자 직관).
 * - net_score < 0 + 다음 5천원 부과까지 3점 이하 → "danger" (벌금 임박)
 * - net_score < 0 + 4~10점 이하 → "warning" (벌점 주의)
 */
export function penaltyRisk(
    minusScore: number,
    netScore: number,
): { level: "danger" | "warning"; distance: number; nextThreshold: number } | null {
    if (minusScore >= 0) return null;
    if (netScore >= 0) return null;
    const abs = Math.abs(minusScore);
    const nextThreshold = -((Math.floor(abs / 10) + 1) * 10);
    const distance = minusScore - nextThreshold; // minus - more_minus = positive
    if (distance <= 3) return { level: "danger", distance, nextThreshold };
    if (distance <= 10) return { level: "warning", distance, nextThreshold };
    return null;
}
