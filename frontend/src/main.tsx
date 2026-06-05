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

// 이전에 Background Fetch 용으로 등록된 Service Worker 가 있으면 해지.
// (신규 등록 안 함 — sw.js 자체도 자가-해지 버전으로 배포됨)
if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) reg.unregister().catch(() => {});
    }).catch(() => {});
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
