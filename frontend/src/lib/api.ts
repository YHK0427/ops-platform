import axios from "axios";

const TOKEN_KEY = "ops_access_token";
const REMEMBER_KEY = "ops_remember";
const LAST_ACTIVE_KEY = "ops_last_active";
const INACTIVITY_LIMIT_MS = 3 * 24 * 60 * 60 * 1000; // 3일

function _loadToken(): string | null {
    const remember = localStorage.getItem(REMEMBER_KEY) === "1";

    // 로그인 유지를 켜지 않은 경우에만 미접속 만료(3일) 적용 — 켰으면 무제한 유지
    if (!remember) {
        const lastActive = localStorage.getItem(LAST_ACTIVE_KEY);
        if (lastActive && Date.now() - Number(lastActive) > INACTIVITY_LIMIT_MS) {
            localStorage.removeItem(TOKEN_KEY);
            sessionStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(LAST_ACTIVE_KEY);
            localStorage.removeItem(REMEMBER_KEY);
            return null;
        }
    }

    return remember
        ? localStorage.getItem(TOKEN_KEY)
        : sessionStorage.getItem(TOKEN_KEY);
}

let _accessToken: string | null = _loadToken();

export const setToken = (token: string | null, remember?: boolean) => {
    _accessToken = token;
    if (token) {
        if (remember !== undefined) {
            localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
        }
        const useLocal = localStorage.getItem(REMEMBER_KEY) === "1";
        if (useLocal) {
            localStorage.setItem(TOKEN_KEY, token);
            sessionStorage.removeItem(TOKEN_KEY);
        } else {
            sessionStorage.setItem(TOKEN_KEY, token);
            localStorage.removeItem(TOKEN_KEY);
        }
        localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
    } else {
        localStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(LAST_ACTIVE_KEY);
        localStorage.removeItem(REMEMBER_KEY);
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

// Update last active on every successful response
api.interceptors.response.use(
    (res) => {
        if (_accessToken) {
            localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
        }
        return res;
    },
    (error) => {
        if (error.response?.status === 401) {
            // /member 경로에서는 리다이렉트 방지 (멤버 포털은 토큰 미사용)
            const isMemberPath = window.location.pathname.startsWith("/member");
            if (!isMemberPath) {
                setToken(null);
                window.location.href = "/login";
            }
        }
        if (error.response?.status === 403) {
            showForbiddenOverlay();
        }
        return Promise.reject(error);
    }
);

function showForbiddenOverlay() {
    if (document.getElementById("forbidden-overlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "forbidden-overlay";
    Object.assign(overlay.style, {
        position: "fixed",
        inset: "0",
        zIndex: "99999",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(255,255,255,0.95)",
        backdropFilter: "blur(6px)",
        animation: "forbid-in 0.25s ease-out",
    });

    overlay.innerHTML = `
        <div style="
            background: #ffffff;
            border: 2px solid #f43f5e;
            border-radius: 16px;
            padding: 40px 48px;
            text-align: center;
            box-shadow: 0 4px 24px rgba(0,0,0,0.12), 0 8px 16px rgba(0,0,0,0.08);
            max-width: 400px;
            animation: forbid-pop 0.3s cubic-bezier(0.34,1.56,0.64,1);
        ">
            <div style="font-size: 48px; margin-bottom: 16px;">🔒</div>
            <div style="
                font-size: 22px;
                font-weight: 800;
                color: #e11d48;
                margin-bottom: 12px;
                letter-spacing: -0.5px;
            ">총무부 아니면 못하지이롱</div>
            <div style="
                font-size: 14px;
                color: #64748b;
                line-height: 1.5;
            ">이 기능은 운영진(회장단/총무부) 권한이 필요합니다.</div>
        </div>
    `;

    // inject keyframes once
    if (!document.getElementById("forbid-style")) {
        const style = document.createElement("style");
        style.id = "forbid-style";
        style.textContent = `
            @keyframes forbid-in { from { opacity: 0 } to { opacity: 1 } }
            @keyframes forbid-pop { from { opacity: 0; transform: scale(0.8) } to { opacity: 1; transform: scale(1) } }
            @keyframes forbid-out { from { opacity: 1 } to { opacity: 0 } }
        `;
        document.head.appendChild(style);
    }

    const dismiss = () => {
        overlay.style.animation = "forbid-out 0.2s ease-in forwards";
        setTimeout(() => overlay.remove(), 200);
    };

    overlay.addEventListener("click", dismiss);
    setTimeout(dismiss, 3000);
    document.body.appendChild(overlay);
}

export default api;
