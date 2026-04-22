import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// Service Worker 등록 — Background Fetch (영상 백그라운드 업로드) 용
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch((err) => {
            console.warn("Service Worker 등록 실패:", err);
        });
    });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
