import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { getToken } from "@/lib/api";
import { getMemberToken } from "@/lib/memberApi";

// 배포로 청크 해시가 바뀌면 열려있던 옛 탭이 옛 청크를 못 받아 404가 난다.
// 동적 import(코드분할) 로드 실패 시 한 번만 새로고침해 최신 번들을 받는다.
function reloadOnceForStaleChunk() {
    const KEY = "chunk_reload_at";
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 10000) return; // 10초 내 중복 새로고침 방지(무한루프 차단)
    sessionStorage.setItem(KEY, String(Date.now()));
    window.location.reload();
}
window.addEventListener("vite:preloadError", (e) => {
    e.preventDefault();
    reloadOnceForStaleChunk();
});
window.addEventListener("unhandledrejection", (e) => {
    const msg = String((e.reason && e.reason.message) || e.reason || "");
    if (/dynamically imported module|Importing a module script failed|Failed to fetch dynamically/.test(msg)) {
        reloadOnceForStaleChunk();
    }
});

// 푸시 전용 서비스워커 등록 (캐싱 없음 — public/sw.js 참고).
// 웹 푸시 알림 수신/표시를 위해 필요. 등록만 하고 실제 구독은 사용자가 "알림 받기"로 명시 동의.
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker
            .register("/sw.js", { scope: "/" })
            .catch((err) => console.warn("[SW] register failed", err));
    });
}

// PWA 홈화면 설치 감지 — appinstalled는 브라우저(주로 크로미움 계열)당 한 번만 발생.
// iOS는 표준상 이 이벤트가 없어 집계에서 빠진다(알려진 한계, 집계는 하한값으로 취급).
window.addEventListener("appinstalled", () => {
    if (localStorage.getItem("pwa_install_logged")) return;
    localStorage.setItem("pwa_install_logged", "1");
    const memberToken = getMemberToken();
    const staffToken = getToken();
    const [path, token] = memberToken
        ? ["/api/v1/notifications/pwa-installed", memberToken]
        : staffToken
            ? ["/api/v1/notifications/ops/pwa-installed", staffToken]
            : [null, null];
    if (path && token) {
        fetch(path, { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    }
});

// 폰트 로딩 완료 전에 첫 페인트가 일어나면 컴포넌트마다 마운트 시점이 달라
// 어떤 글자는 폴백 폰트로 고정되고 어떤 글자는 나중에 Paperlogy로 그려져
// "폰트가 바뀌는" 게 눈에 띈다. 마운트 자체를 폰트 준비(또는 짧은 타임아웃)
// 까지 살짝 늦춰서 첫 페인트부터 최종 폰트로 통일되게 한다.
async function waitForCriticalFonts(timeoutMs = 400): Promise<void> {
    if (!("fonts" in document)) return;
    try {
        await Promise.race([
            Promise.all([
                document.fonts.load('400 1em "Paperlogy"'),
                document.fonts.load('700 1em "Paperlogy"'),
            ]),
            new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
        ]);
    } catch {
        // 폰트 로드 실패해도 렌더는 진행 — 폴백 폰트로 표시됨
    }
}

waitForCriticalFonts().then(() => {
    createRoot(document.getElementById("root")!).render(
        <StrictMode>
            <App />
        </StrictMode>
    );
});
