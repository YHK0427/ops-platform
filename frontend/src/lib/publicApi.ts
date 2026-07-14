import axios from "axios";

/**
 * 공개(무로그인) API 클라이언트 — 심사 채점 폼 전용.
 *
 * lib/api.ts 와 의도적으로 분리한 이유:
 *  - Authorization / X-Cohort-Id 헤더를 붙이면 안 된다 (로그인하지 않은 외부 심사위원용).
 *  - 401 → /login 리다이렉트가 걸리면 안 된다 (공개 폼에서 로그인 화면으로 튕기면 안 됨).
 */
const publicApi = axios.create({
    baseURL: "/api/v1/public",
    headers: { "Content-Type": "application/json" },
    timeout: 15000,
});

export default publicApi;

// 참가자 토큰 — 같은 기기로 재접속하면 이름 입력 없이 본인 제출분을 복원하는 데 쓴다.
const PARTICIPANT_KEY = (token: string) => `scoring_participant:${token}`;

export const getParticipantToken = (publicToken: string): string | null =>
    localStorage.getItem(PARTICIPANT_KEY(publicToken));

export const setParticipantToken = (publicToken: string, participantToken: string) =>
    localStorage.setItem(PARTICIPANT_KEY(publicToken), participantToken);

export const clearParticipantToken = (publicToken: string) =>
    localStorage.removeItem(PARTICIPANT_KEY(publicToken));
