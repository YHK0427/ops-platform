// Self-unregistering SW — 이전에 Background Fetch 용으로 등록된 SW 정리.
// 브라우저에 캐시되어 있던 구버전 SW 를 모두 해지하고 캐시 삭제 후 스스로 제거.

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        try {
            // 이 오리진의 모든 SW 등록 해지
            const regs = await self.registration.unregister();
            // 모든 캐시 삭제
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
            // 컨트롤 중인 페이지에 강제 리로드 메시지 (선택)
            const clients = await self.clients.matchAll();
            for (const c of clients) c.postMessage({ type: "sw-unregistered" });
        } catch (err) {
            console.warn("[SW] cleanup failed", err);
        }
    })());
});
