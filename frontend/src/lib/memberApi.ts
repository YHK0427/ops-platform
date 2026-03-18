import axios from "axios";

const MEMBER_TOKEN_KEY = "member_access_token";

let _accessToken: string | null = localStorage.getItem(MEMBER_TOKEN_KEY);

export const setMemberToken = (token: string | null) => {
    _accessToken = token;
    if (token) {
        localStorage.setItem(MEMBER_TOKEN_KEY, token);
    } else {
        localStorage.removeItem(MEMBER_TOKEN_KEY);
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
            if (!window.location.pathname.startsWith("/member/login")) {
                window.location.href = "/member/login";
            }
        }
        return Promise.reject(error);
    },
);

export default memberApi;
