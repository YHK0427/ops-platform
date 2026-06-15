import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
