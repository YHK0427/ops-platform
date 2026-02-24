import axios from "axios";

const TOKEN_KEY = "ops_access_token";
let _accessToken: string | null = localStorage.getItem(TOKEN_KEY);

export const setToken = (token: string | null) => {
    _accessToken = token;
    if (token) {
        localStorage.setItem(TOKEN_KEY, token);
    } else {
        localStorage.removeItem(TOKEN_KEY);
    }
};

export const getToken = () => _accessToken;

const api = axios.create({
    baseURL: "/api/v1",
    headers: { "Content-Type": "application/json" },
    timeout: 15000,
});

// Attach bearer token on every request
api.interceptors.request.use((config) => {
    if (_accessToken) {
        config.headers.Authorization = `Bearer ${_accessToken}`;
    }
    return config;
});

// Redirect to login on 401
api.interceptors.response.use(
    (res) => res,
    (error) => {
        if (error.response?.status === 401) {
            setToken(null);
            window.location.href = "/login";
        }
        return Promise.reject(error);
    }
);

export default api;
