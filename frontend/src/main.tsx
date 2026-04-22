import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

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
