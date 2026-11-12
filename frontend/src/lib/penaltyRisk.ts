import type { PenaltyRules } from "@/lib/penaltyRules";

/**
 * 멤버 벌점 위험도 계산 — 진짜 임박한 사람만 표시.
 *
 * 기수 규칙: 누적벌점이 N점(milestone_every) 단위에 도달할 때마다 추가 벌금(milestone_fine).
 *
 * 표시 규칙:
 * - net_score >= 0 → 잘하고 있는 멤버. 위험 표시 안 함.
 * - net_score < 0 + 다음 5천원 부과까지 3점 이하 → "danger" (벌금 임박)
 * - 그 외 → null (광범위한 '주의' 표기는 노이즈만 됨)
 */
/** 벌금 임박 범위 — 기본(10점 단위)이면 3점 이내, 단위가 작으면 좁혀서 음수인 사람이 전부 걸리지 않게 */
export const riskWindow = (every: number) => Math.min(3, Math.floor(every / 3));

export function penaltyRisk(
    minusScore: number,
    netScore: number,
    rules: PenaltyRules | undefined,
): { level: "danger"; distance: number; nextThreshold: number } | null {
    if (!rules || rules.milestone_fine <= 0) return null;
    const every = rules.milestone_every;
    if (minusScore >= 0) return null;
    if (netScore >= 0) return null;
    const abs = Math.abs(minusScore);
    const nextThreshold = -((Math.floor(abs / every) + 1) * every);
    const distance = minusScore - nextThreshold;
    if (distance <= riskWindow(every)) return { level: "danger", distance, nextThreshold };
    return null;
}
