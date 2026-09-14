/** 발표 성장 리포트 표지 멘트 — PDF 표지와 화면 결과보기 인트로에서 공유 */

/** 슬로건 기본값 — 기수에 슬로건이 설정 안 돼 있으면(cohort.slogan=null) 이 값으로 대체.
 * 이모지도 슬로건 문구 자체에 포함된다(별도 프리픽스로 붙이지 않음). */
export const DEFAULT_SLOGAN = "🌸 당신의 가능성을 꽃피우기 위해";

export interface CoverParagraph {
    text: string;
    /** 강조 문단(굵게) 여부 */
    emphasis?: boolean;
}

export const COVER_PARAGRAPHS: CoverParagraph[] = [
    { text: "발표성장리포트는 유니브피티에서의 성장을 기록하기 위한 하나의 과정입니다." },
    { text: "발표 성장은 단기간에 완성되지 않습니다. 발표하고, 피드백을 받고, 다시 도전하는 경험 속에서 조금씩 쌓여갑니다." },
    { text: "처음 자기소개를 하던 때와 비교했을 때 지금의 여러분은 어떤가요?", emphasis: true },
    { text: "분명 많은 성장이 있었을 것입니다. 하지만 개인 발표의 마무리는 성장의 끝이 아닌 또 다른 시작입니다.", emphasis: true },
    { text: "앞으로 남은 Business PT와 피날래를 통해 여러분은 또 다른 성장의 순간들을 만들어 나갈 것입니다. 아직 꽃피우지 못한 가능성도, 보여주지 못한 강점도 많이 남아 있습니다." },
    { text: "앞으로의 발표와 도전 속에서 여러분만의 강점과 가능성을 계속해서 꽃피워 나가길 바랍니다.", emphasis: true },
];

/** 슬로건을 앞에 붙인 맺음말 — 기수별 slogan을 그대로 넘기면 된다 */
export function coverClosing(slogan: string): string {
    return `${slogan}, 발표성장리포트 TF팀은 여러분의 성장을 늘 응원하겠습니다. 🌸`;
}

export const COVER_SIGNATURE = "발표성장리포트 TF 일동 (장영진, 이현아, 김태형, 김영헌)";
