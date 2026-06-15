// UnivPT 푸시 전용 서비스워커.
// ⚠️ fetch/캐싱 핸들러 없음 — 과거 캐싱 SW가 앱을 깨뜨린 적이 있어 절대 추가하지 않는다.
// 역할: (1) 즉시 활성화, (2) push 수신 → 알림 표시, (3) 알림 클릭 → 해당 화면 포커스/열기.

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        data = { title: "UnivPT", body: event.data ? event.data.text() : "" };
    }
    const title = data.title || "UnivPT";
    const options = {
        body: data.body || "",
        icon: data.icon || "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: data.tag || undefined,
        data: { url: data.url || "/" },
        renotify: !!data.tag,
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const targetUrl = (event.notification.data && event.notification.data.url) || "/";
    event.waitUntil((async () => {
        const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        // 이미 열린 탭이 있으면 포커스 + 해당 경로로 이동
        for (const client of all) {
            if ("focus" in client) {
                try { await client.focus(); } catch (e) { /* noop */ }
                if ("navigate" in client && targetUrl) {
                    try { await client.navigate(targetUrl); } catch (e) { /* noop */ }
                }
                return;
            }
        }
        // 없으면 새 창
        if (self.clients.openWindow) {
            await self.clients.openWindow(targetUrl);
        }
    })());
});
