// Service Worker — Background Fetch API 영상 업로드용
// 주 역할:
//  1. Background Fetch 성공 시 서버에 /r2/finalize 호출
//  2. 완료 알림 + 클라이언트에 상태 전파

const FINALIZE_PREFIX = "bgfetch-upload:";  // IndexedDB key prefix

// ───────── IndexedDB helpers (인증 토큰 + finalize 메타 저장) ─────────

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open("univpt-upload", 1);
        req.onupgradeneeded = () => {
            req.result.createObjectStore("uploads", { keyPath: "id" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function getUploadMeta(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("uploads", "readonly");
        const req = tx.objectStore("uploads").get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function deleteUploadMeta(id) {
    const db = await openDB();
    return new Promise((resolve) => {
        const tx = db.transaction("uploads", "readwrite");
        tx.objectStore("uploads").delete(id);
        tx.oncomplete = () => resolve();
    });
}

// ───────── 이벤트 핸들러 ─────────

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// Background Fetch 성공 — 모든 청크/요청이 200 OK 로 응답됨
self.addEventListener("backgroundfetchsuccess", (event) => {
    const id = event.registration.id;
    event.waitUntil((async () => {
        try {
            const meta = await getUploadMeta(id);
            if (!meta) {
                console.warn("[SW] bgfetch success but no meta found", id);
                return;
            }

            // 서버에 finalize 호출 — ARQ 가 R2 에서 로컬로 pull 시작
            const res = await fetch(meta.finalizeUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${meta.token}`,
                },
                body: JSON.stringify({ key: meta.key, filename: meta.filename }),
            });

            if (res.ok) {
                // 성공 알림 업데이트 (선택)
                event.updateUI({ title: `✅ ${meta.displayName} 업로드 완료` });
            } else {
                const txt = await res.text().catch(() => "");
                event.updateUI({ title: `⚠ ${meta.displayName} finalize 실패 (${res.status}) ${txt.slice(0, 80)}` });
            }

            // 클라이언트(탭)에 알림 — 열려있으면 상태 갱신
            const clients = await self.clients.matchAll({ includeUncontrolled: true });
            for (const client of clients) {
                client.postMessage({ type: "upload-complete", memberId: meta.memberId, success: res.ok });
            }

            await deleteUploadMeta(id);
        } catch (err) {
            console.error("[SW] finalize error", err);
            event.updateUI({ title: `⚠ 업로드 처리 중 오류` });
        }
    })());
});

// Background Fetch 실패 (네트워크 오류 등)
self.addEventListener("backgroundfetchfailure", (event) => {
    const id = event.registration.id;
    event.waitUntil((async () => {
        const meta = await getUploadMeta(id).catch(() => null);
        const name = meta?.displayName ?? "영상";
        event.updateUI({ title: `❌ ${name} 업로드 실패` });
        const clients = await self.clients.matchAll({ includeUncontrolled: true });
        for (const client of clients) {
            client.postMessage({
                type: "upload-failed",
                memberId: meta?.memberId,
            });
        }
        if (id) await deleteUploadMeta(id).catch(() => {});
    })());
});

// Background Fetch 중단 (사용자가 알림에서 취소)
self.addEventListener("backgroundfetchabort", (event) => {
    const id = event.registration.id;
    event.waitUntil((async () => {
        const meta = await getUploadMeta(id).catch(() => null);
        const clients = await self.clients.matchAll({ includeUncontrolled: true });
        for (const client of clients) {
            client.postMessage({
                type: "upload-aborted",
                memberId: meta?.memberId,
            });
        }
        if (id) await deleteUploadMeta(id).catch(() => {});
    })());
});

// 알림 클릭 시 탭 포커스
self.addEventListener("backgroundfetchclick", (event) => {
    event.waitUntil((async () => {
        const clients = await self.clients.matchAll({ type: "window" });
        if (clients.length > 0) {
            await clients[0].focus();
        } else {
            await self.clients.openWindow("/");
        }
    })());
});
