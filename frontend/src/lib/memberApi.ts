import axios from "axios";

const MEMBER_TOKEN_KEY = "member_access_token";

// 자동 로그인 ON → localStorage(앱 재실행해도 유지), OFF → sessionStorage(앱 종료 시 만료)
let _accessToken: string | null =
    localStorage.getItem(MEMBER_TOKEN_KEY) || sessionStorage.getItem(MEMBER_TOKEN_KEY);

export const setMemberToken = (token: string | null, remember = true) => {
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
        if (error.response?.status === 401) {
            setMemberToken(null);
            if (window.location.pathname.startsWith("/member")) {
                window.location.href = "/login";
            }
        }
        return Promise.reject(error);
    },
);

export default memberApi;
