// UnivPT 푸시 + PWA 설치용 서비스워커.
// ⚠️ 캐싱은 절대 안 함 — 과거 캐싱 SW가 앱을 깨뜨린 적이 있음.
// 역할: (1) 즉시 활성화, (2) push 알림, (3) 알림 클릭 이동, (4) Chrome 설치조건용 빈 fetch 핸들러.

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

// Chrome 등은 '설치 가능한 PWA' 판정에 fetch 핸들러 존재를 요구한다.
// respondWith 를 호출하지 않으면 브라우저 기본 동작(네트워크) 그대로라 가로채기/캐싱 없음.
// → 이 빈 핸들러만으로 "앱 설치"가 뜨고, Chrome WebAPK(구글 서명)라 Play 프로텍트 경고도 없음.
self.addEventListener("fetch", () => { /* pass-through, no caching */ });

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
        icon: data.icon || "/icons/notif-icon.png",
        badge: "/icons/notif-badge.png",
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
