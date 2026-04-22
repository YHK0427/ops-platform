// Service Worker — Background Fetch API 영상 업로드용
// 주 역할:
//  1. Multipart 업로드 성공 시 모든 part 응답에서 ETag 수집 → 서버 /multipart/complete 호출
//  2. (레거시) 단일 PUT 성공 시 /r2/finalize 호출
//  3. 완료 알림 + 클라이언트에 상태 전파

// ───────── IndexedDB helpers (업로드 메타 저장) ─────────

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

// URL 쿼리스트링에서 partNumber 추출 (S3 multipart presigned URL: ?partNumber=N&uploadId=...)
function extractPartNumber(url) {
    try {
        const u = new URL(url);
        const pn = u.searchParams.get("partNumber");
        return pn ? parseInt(pn, 10) : null;
    } catch {
        return null;
    }
}

async function notifyClients(payload) {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    for (const c of clients) c.postMessage(payload);
}

// ───────── 이벤트 핸들러 ─────────

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// Background Fetch 성공 — 모든 part 요청이 응답받음
self.addEventListener("backgroundfetchsuccess", (event) => {
    const id = event.registration.id;
    event.waitUntil((async () => {
        try {
            const meta = await getUploadMeta(id);
            if (!meta) {
                console.warn("[SW] bgfetch success but no meta found", id);
                return;
            }

            const isMultipart = meta.kind === "multipart";
            let ok = false;
            let finalizeStatus = 0;
            let finalizeText = "";

            if (isMultipart) {
                // 각 part 응답에서 ETag 수집
                const records = await event.registration.matchAll();
                const parts = [];
                for (const record of records) {
                    const response = await record.responseReady;
                    if (!response.ok) {
                        throw new Error(`part 응답 실패 (${response.status}) ${record.request.url.slice(0, 80)}`);
                    }
                    const etag = response.headers.get("ETag") || response.headers.get("etag");
                    if (!etag) {
                        throw new Error("part 응답에 ETag 헤더 없음 — R2 CORS ExposeHeaders 확인");
                    }
                    const partNumber = extractPartNumber(record.request.url);
                    if (!partNumber) {
                        throw new Error("URL 에서 partNumber 추출 실패");
                    }
                    parts.push({ PartNumber: partNumber, ETag: etag });
                }
                parts.sort((a, b) => a.PartNumber - b.PartNumber);

                const res = await fetch(meta.finalizeUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${meta.token}`,
                    },
                    body: JSON.stringify({
                        key: meta.key,
                        uploadId: meta.uploadId,
                        filename: meta.filename,
                        parts,
                    }),
                });
                ok = res.ok;
                finalizeStatus = res.status;
                if (!ok) finalizeText = await res.text().catch(() => "");
            } else {
                // 레거시 단일 PUT 경로
                const res = await fetch(meta.finalizeUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${meta.token}`,
                    },
                    body: JSON.stringify({ key: meta.key, filename: meta.filename }),
                });
                ok = res.ok;
                finalizeStatus = res.status;
                if (!ok) finalizeText = await res.text().catch(() => "");
            }

            if (ok) {
                event.updateUI({ title: `✅ ${meta.displayName} 업로드 완료` });
            } else {
                event.updateUI({ title: `⚠ ${meta.displayName} finalize 실패 (${finalizeStatus}) ${finalizeText.slice(0, 80)}` });
            }

            await notifyClients({ type: "upload-complete", memberId: meta.memberId, success: ok });
            await deleteUploadMeta(id);
        } catch (err) {
            console.error("[SW] finalize error", err);
            event.updateUI({ title: `⚠ 업로드 처리 중 오류 — ${err.message}` });
            // abort R2 multipart (best-effort) — meta 읽기 한 번 더
            try {
                const meta = await getUploadMeta(id);
                if (meta && meta.kind === "multipart" && meta.abortUrl) {
                    await fetch(meta.abortUrl, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${meta.token}`,
                        },
                        body: JSON.stringify({ key: meta.key, uploadId: meta.uploadId }),
                    }).catch(() => {});
                }
                if (meta) await notifyClients({ type: "upload-failed", memberId: meta.memberId });
            } catch {}
            await deleteUploadMeta(id).catch(() => {});
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
        // multipart 면 R2 측 cleanup
        if (meta && meta.kind === "multipart" && meta.abortUrl) {
            await fetch(meta.abortUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${meta.token}`,
                },
                body: JSON.stringify({ key: meta.key, uploadId: meta.uploadId }),
            }).catch(() => {});
        }
        await notifyClients({ type: "upload-failed", memberId: meta?.memberId });
        if (id) await deleteUploadMeta(id).catch(() => {});
    })());
});

// Background Fetch 중단 (사용자가 알림에서 취소)
self.addEventListener("backgroundfetchabort", (event) => {
    const id = event.registration.id;
    event.waitUntil((async () => {
        const meta = await getUploadMeta(id).catch(() => null);
        if (meta && meta.kind === "multipart" && meta.abortUrl) {
            await fetch(meta.abortUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${meta.token}`,
                },
                body: JSON.stringify({ key: meta.key, uploadId: meta.uploadId }),
            }).catch(() => {});
        }
        await notifyClients({ type: "upload-aborted", memberId: meta?.memberId });
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
