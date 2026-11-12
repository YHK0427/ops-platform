/** 기수별 벌점·상점 규칙 — 서버 services/penalty_rules.py 와 같은 모양. 숫자는 모두 양수(쓰는 쪽에서 차감). */
export interface RulePair { score: number; deposit: number }
export interface AttendanceRuleRow { PRE: RulePair; POST: RulePair; NONE: RulePair }

export const ATTENDANCE_RULE_KEYS = ["LATE_UNDER10", "LATE_OVER10", "EARLY_LEAVE", "ABSENT"] as const;
export type AttendanceRuleKey = typeof ATTENDANCE_RULE_KEYS[number];
export const EXCUSE_KEYS = ["PRE", "POST", "NONE"] as const;
export type ExcuseKey = typeof EXCUSE_KEYS[number];

export interface PenaltyRules extends Record<AttendanceRuleKey, AttendanceRuleRow> {
    ppt_email_late: RulePair;
    ppt_email_missing: RulePair;
    homework_missing: RulePair;
    milestone_every: number;
    milestone_fine: number;
    streak_count: number;
    streak_score: number;
    eviction_limit: number;
    warn_from: number;
    low_deposit: number;
}

/** 화면 이름 / 장부 설명 앞부분(penalty_engine.ATT_STATUS_LABEL 과 같아야 엑셀·정산 문구가 맞는다) */
export const ATTENDANCE_RULE_LABEL: Record<AttendanceRuleKey, { short: string; desc: string }> = {
    LATE_UNDER10: { short: "10분미만 지각", desc: "지각(10분 미만)" },
    LATE_OVER10: { short: "10분이상 지각", desc: "지각(10분 이상)" },
    EARLY_LEAVE: { short: "조퇴", desc: "조퇴" },
    ABSENT: { short: "결석", desc: "결석" },
};
export const EXCUSE_LABEL: Record<ExcuseKey, { short: string; desc: string }> = {
    PRE: { short: "사전", desc: "사전" },
    POST: { short: "사후", desc: "사후" },
    NONE: { short: "사유서X", desc: "사유서없음" },
};

export interface PenaltyPreset { label: string; score: number; deposit: number; desc: string }

/** 벌점 주기 창 프리셋 — 정산과 같은 금액이 되도록 규칙에서 만든다. */
export function buildPenaltyPresets(rules: PenaltyRules): PenaltyPreset[] {
    const out: PenaltyPreset[] = [];
    for (const k of ATTENDANCE_RULE_KEYS) {
        for (const e of EXCUSE_KEYS) {
            const p = rules[k][e];
            out.push({
                label: `${ATTENDANCE_RULE_LABEL[k].short} (${EXCUSE_LABEL[e].short})`,
                score: p.score, deposit: p.deposit,
                desc: `${ATTENDANCE_RULE_LABEL[k].desc} (${EXCUSE_LABEL[e].desc})`,
            });
        }
    }
    out.push(
        { label: "PPT이메일 지연제출", ...rules.ppt_email_late, desc: "PPT이메일 지연제출" },
        { label: "PPT이메일 미제출", ...rules.ppt_email_missing, desc: "PPT이메일 미제출" },
        { label: "과제 미제출", ...rules.homework_missing, desc: "미제출: 과제" },
        { label: "무임승차 (주요세션)", score: 5, deposit: 0, desc: "주요세션 무임승차" },
    );
    return out;
}

/**
 * 지금 run회 연속 중이고 그 연속에서 상점을 granted번 받은 사람이 다음 세션에 출석하면 받는 상점 개수.
 * 서버(streak_checker)와 같은 계산: floor((run+1)/count) - 이미 받은 개수. 상점 점수가 0이면 안 준다.
 */
export function streakGrantsOnNextAttend(run: number, granted: number, count: number, score: number): number {
    if (score <= 0) return 0;
    return Math.max(0, Math.floor((run + 1) / count) - granted);
}

/** 순점수 기준 퇴출 상태 — 순점수가 -eviction_limit 아래면 퇴출 대상, -warn_from 이하면 경고 */
export function evictionLevel(netScore: number, rules?: PenaltyRules): "evict" | "warn" | null {
    if (!rules) return null;
    if (netScore < -rules.eviction_limit) return "evict";
    if (netScore <= -rules.warn_from) return "warn";
    return null;
}
