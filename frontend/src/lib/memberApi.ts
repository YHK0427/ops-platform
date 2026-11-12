import axios from "axios";
import { isMemberPortalPath } from "@/lib/utils";

const MEMBER_TOKEN_KEY = "member_access_token";
/** 운영진 '기수 화면 보기' 토큰 — 그 탭(sessionStorage)에만 두고 진짜 기수 로그인 토큰보다 먼저 쓴다 */
export const MEMBER_PREVIEW_KEY = "member_preview_token";

function readPreview(): string | null {
    try { return sessionStorage.getItem(MEMBER_PREVIEW_KEY); } catch { return null; }
}

// 미리보기 탭인지는 페이지를 열 때 한 번만 정한다 — 중간에 키를 지워도(만료) 이 탭은 끝까지 미리보기로 취급해
// 진짜 기수 로그인 토큰(localStorage, 다른 탭과 공유)을 지우거나 /login 으로 보내지 않게.
const PREVIEW_TOKEN: string | null = readPreview();

// 자동 로그인 ON → localStorage(앱 재실행해도 유지), OFF → sessionStorage(앱 종료 시 만료)
let _accessToken: string | null =
    PREVIEW_TOKEN || localStorage.getItem(MEMBER_TOKEN_KEY) || sessionStorage.getItem(MEMBER_TOKEN_KEY);

/** 미리보기 중이면 {보는 운영진, 만료 시각} — 아니면 null */
export function memberPreviewInfo(): { by: string; exp: number } | null {
    const t = PREVIEW_TOKEN;
    if (!t) return null;
    try {
        const bin = atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"));
        const p = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))); // 운영진 아이디가 한글일 수 있다
        return p.preview_by ? { by: p.preview_by, exp: p.exp * 1000 } : null;
    } catch { return null; }
}
export const isMemberPreview = () => PREVIEW_TOKEN !== null;

/** 미리보기가 끝났다(만료·닫기) — 키를 지우고 탭을 닫는다. 못 닫으면 운영진 화면으로. 여러 번 불려도 한 번만. */
let _ending = false;
export function endMemberPreview() {
    if (_ending) return;
    _ending = true;
    sessionStorage.removeItem(MEMBER_PREVIEW_KEY);
    window.close();
    window.location.href = "/members";
}

export const setMemberToken = (token: string | null, remember = true) => {
    if (isMemberPreview()) return; // 미리보기 탭에서는 진짜 기수 로그인 토큰을 건드리지 않는다
    _accessToken = token;
    localStorage.removeItem(MEMBER_TOKEN_KEY);
    sessionStorage.removeItem(MEMBER_TOKEN_KEY);
    if (token) {
        (remember ? localStorage : sessionStorage).setItem(MEMBER_TOKEN_KEY, token);
    }
};

export const getMemberToken = () => _accessToken;

const memberApi = axios.create({
    baseURL: "/api/v1",
    headers: { "Content-Type": "application/json" },
    timeout: 15000,
});

// Attach bearer token on every request
memberApi.interceptors.request.use((config) => {
    if (_accessToken) {
        config.headers.Authorization = `Bearer ${_accessToken}`;
    }
    return config;
});

// Handle 401 -> redirect to member login (skip if already on login page)
memberApi.interceptors.response.use(
    (res) => res,
    (error) => {
        if (isMemberPreview()) {
            // 미리보기 30분이 지났다 — 탭을 닫는다. 진짜 기수 로그인은 건드리지 않는다(아래 분기로 안 감)
            if (error.response?.status === 401) endMemberPreview();
        } else if (error.response?.status === 401) {
            setMemberToken(null);
            if (isMemberPortalPath(window.location.pathname)) {
                window.location.href = "/login";
            }
        }
        return Promise.reject(error);
    },
);

export default memberApi;
