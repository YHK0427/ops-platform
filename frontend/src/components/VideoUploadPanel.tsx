import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Upload, CheckCircle2, Trash2, Film, UploadCloud, XCircle, AlertTriangle, UserMinus } from "lucide-react";
import { useSessionVideos, useDeleteSessionVideo, useUploadVideos } from "@/hooks";
import type { SessionVideo } from "@/hooks";
import { getToken } from "@/lib/api";
import { toast } from "sonner";

interface PresenterSlot {
    member_id: number;
    member_name: string;
    sub_label?: string | null;
    group_num: number | null;
    presenter_order: number | null;
}

interface AbsentMember {
    member_id: number;
    member_name: string;
    status: "ABSENT" | "EXCUSED";
}

interface NaverResultItem {
    success: boolean;
    file?: string;
    presenter?: string;
    error?: string | null;
}

interface VideoUploadPanelProps {
    sessionId: number;
    sessionTitle: string;
    weekNum: number;
    presenters: PresenterSlot[];
    absentMembers?: AbsentMember[];
    hasGroups: boolean;
    onNaverUploadStarted?: (taskId: string) => void;
    naverProgress?: { file: string; presenter: string; status: string; error?: string | null }[] | null;
    naverStatus?: "queued" | "in_progress" | "complete" | "failed" | "unknown" | null;
    naverResult?: NaverResultItem[] | null;
}

interface UploadState {
    progress: number;
    uploading: boolean;
    queued?: boolean;
    error?: string;
}

// 동시 업로드 개수 제한 — R2는 Cloudflare 엣지로 분산되지만 클라 대역폭은 여전히 공유
const MAX_CONCURRENT_UPLOADS = 3;
// 이 크기 이하면 서버 직접 업로드 (Cloudflare 100MB 제한 안 걸림)
// 초과면 R2 direct upload. Android + BG Fetch 지원 + 이 임계값 초과면 multipart BG Fetch 경로.
const R2_THRESHOLD = 50 * 1024 * 1024;
// Multipart BG Fetch 청크 크기 — S3 multipart 최소 5MB. BG Fetch 저장소 부담 완화를 위해 20MB.
const MULTIPART_CHUNK_SIZE = 20 * 1024 * 1024;
// 이 크기 초과부터 multipart 고려 (청크 5개 이상 → 오버헤드 정당화)
const MULTIPART_THRESHOLD = 100 * 1024 * 1024;

export function VideoUploadPanel({ sessionId, sessionTitle, weekNum, presenters, absentMembers, hasGroups, onNaverUploadStarted, naverProgress, naverStatus, naverResult }: VideoUploadPanelProps) {
    const { data: uploadedVideos, refetch } = useSessionVideos(sessionId);
    const { mutate: deleteVideo, isPending: isDeleting } = useDeleteSessionVideo();
    const { mutate: startNaverUpload, isPending: isStartingNaver } = useUploadVideos();
    const [uploads, setUploads] = useState<Record<number, UploadState>>({});
    const xhrRefs = useRef<Record<number, XMLHttpRequest>>({});
    // 큐에서 대기 중인 업로드 (memberId → File)
    const uploadQueueRef = useRef<Array<{ memberId: number; file: File }>>([]);
    const activeUploadsRef = useRef<number>(0);
    // R2 업로드는 끝났지만 서버 pull 이 아직 안 된 멤버들 (= 서버 처리 중)
    const [pendingPull, setPendingPull] = useState<Set<number>>(new Set());
    // Wake Lock — 업로드 중 화면 자동 꺼짐 방지 (iOS/Android 공통)
    const wakeLockRef = useRef<WakeLockSentinel | null>(null);
    const iosWarnShownRef = useRef<boolean>(false);

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/i.test(navigator.userAgent);

    const acquireWakeLock = useCallback(async () => {
        if (wakeLockRef.current) return;
        try {
            // @ts-ignore — Wake Lock API
            if (navigator.wakeLock) {
                // @ts-ignore
                wakeLockRef.current = await navigator.wakeLock.request("screen");
            }
        } catch { /* 권한 거부 or 미지원 — 무시 */ }
    }, []);

    const releaseWakeLockIfIdle = useCallback(async () => {
        // 진행 중인 업로드가 하나도 없고 대기 중도 없으면 해제
        if (activeUploadsRef.current > 0 || uploadQueueRef.current.length > 0) return;
        const lock = wakeLockRef.current;
        if (lock) {
            try { await lock.release(); } catch { /* noop */ }
            wakeLockRef.current = null;
        }
    }, []);

    // SW / Background Fetch 상태 진단 (UI 표시용)
    const [swStatus, setSwStatus] = useState<"checking" | "ready" | "no-sw" | "no-bgfetch">("checking");
    useEffect(() => {
        (async () => {
            if (!("serviceWorker" in navigator)) { setSwStatus("no-sw"); return; }
            try {
                const reg = await Promise.race([
                    navigator.serviceWorker.ready,
                    new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
                ]);
                if (!reg) { setSwStatus("no-sw"); return; }
                // @ts-ignore
                if (!reg.backgroundFetch) { setSwStatus("no-bgfetch"); return; }
                setSwStatus("ready");
            } catch { setSwStatus("no-sw"); }
        })();
    }, []);

    // 네이버 업로드 대상 체크
    const [selectedForNaver, setSelectedForNaver] = useState<Set<number>>(new Set());

    // 카페 제목 접두어
    const defaultPrefix = `연합UP 33기 ${weekNum}주차 발표-[${sessionTitle}]-`;
    const [titlePrefix, setTitlePrefix] = useState(defaultPrefix);

    // member_id → uploaded video
    const videoMap = new Map<number, SessionVideo>();
    (uploadedVideos ?? []).forEach(v => videoMap.set(v.member_id, v));

    // 영상 업로드된 발표자 auto-select
    useEffect(() => {
        const uploaded = new Set<number>();
        presenters.forEach(p => { if (videoMap.has(p.member_id)) uploaded.add(p.member_id); });
        setSelectedForNaver(uploaded);
    }, [uploadedVideos]);

    // videos 리스트에 파일이 나타나면 pendingPull 에서 제거 (= 서버 처리 완료)
    useEffect(() => {
        if (pendingPull.size === 0) return;
        let changed = false;
        const next = new Set(pendingPull);
        for (const id of Array.from(next)) {
            if (videoMap.has(id)) { next.delete(id); changed = true; }
        }
        if (changed) setPendingPull(next);
    }, [uploadedVideos]);

    // 탭 다시 보이면 업로드 진행 중일 경우 Wake Lock 재획득
    // (visibilitychange 시 브라우저가 Wake Lock을 자동 해제함)
    useEffect(() => {
        const onVis = () => {
            if (document.visibilityState === "visible" && activeUploadsRef.current > 0) {
                acquireWakeLock();
            }
        };
        document.addEventListener("visibilitychange", onVis);
        return () => document.removeEventListener("visibilitychange", onVis);
    }, [acquireWakeLock]);

    // 컴포넌트 unmount 시 Wake Lock 정리
    useEffect(() => {
        return () => {
            const lock = wakeLockRef.current;
            if (lock) { lock.release().catch(() => {}); wakeLockRef.current = null; }
        };
    }, []);

    // pendingPull 있거나 압축 중인 영상 있으면 주기적으로 refetch
    const anyCompressing = (uploadedVideos ?? []).some(v => v.is_compressing);
    useEffect(() => {
        if (pendingPull.size === 0 && !anyCompressing) return;
        const interval = setInterval(() => refetch(), 3000);
        return () => clearInterval(interval);
    }, [pendingPull.size, anyCompressing, refetch]);

    // 개별 카페 제목 오버라이드
    const [titleOverrides, setTitleOverrides] = useState<Record<number, string>>({});

    const getTitle = (p: PresenterSlot) => titleOverrides[p.member_id] ?? buildTitle(p);

    const toggleNaver = (memberId: number) => {
        setSelectedForNaver(prev => {
            const next = new Set(prev);
            next.has(memberId) ? next.delete(memberId) : next.add(memberId);
            return next;
        });
    };

    // 작은 파일 단일 업로드
    const singleUpload = (memberId: number, file: File, onDone: () => void) => {
        const formData = new FormData();
        formData.append("file", file);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/v1/sessions/${sessionId}/videos/${memberId}`);

        const token = getToken();
        if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const pct = Math.round((e.loaded / e.total) * 100);
                setUploads(prev => ({ ...prev, [memberId]: { progress: pct, uploading: true } }));
            }
        };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                setUploads(prev => ({ ...prev, [memberId]: { progress: 100, uploading: false } }));
                toast.success("영상 업로드 완료");
                refetch();
            } else {
                setUploads(prev => ({ ...prev, [memberId]: { progress: 0, uploading: false, error: `실패 (${xhr.status})` } }));
                toast.error(`업로드 실패 (${xhr.status})`);
            }
            onDone();
        };
        xhr.onerror = () => {
            setUploads(prev => ({ ...prev, [memberId]: { progress: 0, uploading: false, error: "네트워크 오류 — 다시 시도해주세요" } }));
            toast.error("네트워크 오류");
            onDone();
        };
        xhr.onabort = () => {
            setUploads(prev => ({ ...prev, [memberId]: { progress: 0, uploading: false } }));
            toast.info("업로드가 중지되었습니다.");
            onDone();
        };

        xhrRefs.current[memberId] = xhr;
        xhr.send(formData);
    };

    // IndexedDB 에 업로드 메타 저장 (SW 가 finalize 시 참조)
    const saveUploadMeta = async (uploadId: string, meta: any) => {
        return new Promise<void>((resolve, reject) => {
            const req = indexedDB.open("univpt-upload", 1);
            req.onupgradeneeded = () => {
                req.result.createObjectStore("uploads", { keyPath: "id" });
            };
            req.onsuccess = () => {
                const db = req.result;
                const tx = db.transaction("uploads", "readwrite");
                tx.objectStore("uploads").put({ id: uploadId, ...meta });
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            };
            req.onerror = () => reject(req.error);
        });
    };

    // SW → main thread 메시지 수신 (업로드 완료/실패 알림)
    useEffect(() => {
        if (!("serviceWorker" in navigator)) return;
        const handler = (event: MessageEvent) => {
            const { type, memberId, success } = event.data ?? {};
            if (type === "upload-complete" && typeof memberId === "number") {
                setUploads(prev => ({ ...prev, [memberId]: { progress: 100, uploading: false } }));
                if (success !== false) {
                    setPendingPull(prev => new Set(prev).add(memberId));
                    toast.success("백그라운드 업로드 완료 — 서버에서 처리 중");
                    refetch();
                }
            } else if (type === "upload-failed" || type === "upload-aborted") {
                if (typeof memberId === "number") {
                    setUploads(prev => ({
                        ...prev,
                        [memberId]: { progress: 0, uploading: false, error: type === "upload-aborted" ? "취소됨" : "백그라운드 업로드 실패" },
                    }));
                }
                toast.error(type === "upload-aborted" ? "업로드가 취소되었습니다" : "백그라운드 업로드 실패");
            }
        };
        navigator.serviceWorker.addEventListener("message", handler);
        return () => navigator.serviceWorker.removeEventListener("message", handler);
    }, [refetch]);

    // Multipart R2 + Background Fetch — Android 에서 대용량(>100MB) 파일을 진짜 백그라운드로 업로드.
    // 파일을 20MB 청크로 쪼개 각 청크별 presigned PUT URL 받아 단일 BG Fetch 에 Request[] 배열로 전달.
    // SW 가 성공 시 모든 part 응답에서 ETag 수집 → /multipart/complete 호출.
    const r2MultipartUploadBackground = async (memberId: number, file: File, displayName: string, onDone: () => void) => {
        const token = getToken();
        const authHeader: Record<string, string> = token ? { "Authorization": `Bearer ${token}` } : {};

        try {
            // 1. Multipart init → 모든 part presigned URL 일괄 수신
            const initRes = await fetch(`/api/v1/sessions/${sessionId}/videos/${memberId}/r2/multipart/init`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeader },
                body: JSON.stringify({
                    filename: file.name,
                    content_type: file.type || "application/octet-stream",
                    size: file.size,
                    chunk_size: MULTIPART_CHUNK_SIZE,
                }),
            });
            if (!initRes.ok) throw new Error(`multipart init 실패 (${initRes.status})`);
            const { key, uploadId, chunkSize, numParts, partUrls, contentType } = await initRes.json();

            // 2. 각 청크를 file.slice() 로 자른 Request 배열 생성
            const requests: Request[] = partUrls.map((p: { partNumber: number; url: string }) => {
                const idx = p.partNumber - 1;
                const start = idx * chunkSize;
                const end = Math.min(start + chunkSize, file.size);
                return new Request(p.url, {
                    method: "PUT",
                    headers: { "Content-Type": contentType || "application/octet-stream" },
                    body: file.slice(start, end),
                });
            });

            // 3. SW 에 완료 처리용 메타 저장
            const bgId = `upload-${sessionId}-${memberId}-${Date.now()}`;
            await saveUploadMeta(bgId, {
                kind: "multipart",
                key,
                uploadId,
                filename: file.name,
                memberId,
                displayName,
                token: token ?? "",
                numParts,
                finalizeUrl: `/api/v1/sessions/${sessionId}/videos/${memberId}/r2/multipart/complete`,
                abortUrl: `/api/v1/sessions/${sessionId}/videos/${memberId}/r2/multipart/abort`,
            });

            // 4. Background Fetch 실행 — 단일 알림, 여러 Request
            const reg = await navigator.serviceWorker.ready;
            // @ts-ignore — BackgroundFetchManager 미지원 타입
            const bgFetch = await reg.backgroundFetch.fetch(bgId, requests, {
                title: `${displayName} 영상 업로드 중 (${numParts}청크)`,
                icons: [{ src: "/favicon.ico", sizes: "64x64", type: "image/x-icon" }],
                downloadTotal: file.size,
            });

            setUploads(prev => ({ ...prev, [memberId]: { progress: 1, uploading: true } }));
            toast.success("백그라운드 업로드 시작 — 화면 닫고 앱 나가도 됩니다");

            bgFetch.addEventListener("progress", () => {
                const total = file.size;
                const uploaded = bgFetch.uploaded || 0;
                if (total > 0) {
                    const pct = Math.max(1, Math.min(99, Math.round((uploaded / total) * 100)));
                    setUploads(prev => ({ ...prev, [memberId]: { progress: pct, uploading: true } }));
                }
            });
        } catch (err: any) {
            const errMsg = err?.message ?? "알 수 없음";
            setUploads(prev => ({ ...prev, [memberId]: { progress: 0, uploading: false, error: `백그라운드 시작 실패: ${errMsg}` } }));
            toast.error(`백그라운드 실패 — foreground 로 전환: ${errMsg}`);
            await r2Upload(memberId, file, onDone);
            return;
        }
        onDone();
    };

    // R2 직접 업로드: Cloudflare Tunnel 안 거침 → 빠름
    // 서버 presign → 클라 PUT to R2 → 서버 finalize(ARQ pull 트리거)
    const r2Upload = async (memberId: number, file: File, onDone: () => void) => {
        const token = getToken();
        const authHeader: Record<string, string> = token ? { "Authorization": `Bearer ${token}` } : {};

        let aborted = false;
        xhrRefs.current[memberId] = {
            abort: () => { aborted = true; },
        } as any;

        const bail = (err: string) => {
            setUploads(prev => ({ ...prev, [memberId]: { progress: 0, uploading: false, error: err } }));
            toast.error(err);
            onDone();
        };

        try {
            // 1. presign
            const presignRes = await fetch(`/api/v1/sessions/${sessionId}/videos/${memberId}/r2/presign`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeader },
                body: JSON.stringify({
                    filename: file.name,
                    content_type: file.type || "application/octet-stream",
                    size: file.size,
                }),
            });
            if (presignRes.status === 501) {
                // R2 미설정 → fallback으로 서버 직접 업로드 (chunked 구버전) 시도
                toast.info("R2 미설정 — 서버 직접 업로드로 전환");
                return singleUpload(memberId, file, onDone);
            }
            if (!presignRes.ok) throw new Error(`presign 실패 (${presignRes.status})`);
            const { upload_url, key, content_type } = await presignRes.json();

            // 2. R2 PUT (XHR로 progress 추적)
            await new Promise<void>((resolve, reject) => {
                if (aborted) { reject(new Error("aborted")); return; }
                const xhr = new XMLHttpRequest();
                xhr.open("PUT", upload_url);
                xhr.setRequestHeader("Content-Type", content_type || "application/octet-stream");

                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) {
                        // 0-95%: R2 전송. 96-99%: 서버 pull 대기
                        const pct = Math.min(95, Math.round((e.loaded / e.total) * 95));
                        setUploads(prev => ({ ...prev, [memberId]: { progress: pct, uploading: true } }));
                    }
                };
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) resolve();
                    else reject(new Error(`R2 PUT 실패 (${xhr.status})`));
                };
                xhr.onerror = () => reject(new Error("R2 네트워크 오류"));
                xhr.onabort = () => reject(new Error("aborted"));
                xhrRefs.current[memberId] = xhr as any;
                xhr.send(file);
            });

            if (aborted) throw new Error("aborted");

            // 3. 서버 finalize → ARQ pull 태스크 큐잉
            const finalizeRes = await fetch(`/api/v1/sessions/${sessionId}/videos/${memberId}/r2/finalize`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeader },
                body: JSON.stringify({ key, filename: file.name }),
            });
            if (!finalizeRes.ok) {
                const errTxt = await finalizeRes.text().catch(() => "");
                throw new Error(`finalize 실패 (${finalizeRes.status}) ${errTxt}`);
            }

            // R2 업로드 끝! 사용자는 이 시점에 사이트 나가도 됨.
            // 서버 pull 은 백그라운드에서 진행 → pendingPull 에 기록해두고
            // useSessionVideos 폴링으로 완료 감지되면 자동 제거됨
            setUploads(prev => ({ ...prev, [memberId]: { progress: 100, uploading: false } }));
            setPendingPull(prev => new Set(prev).add(memberId));
            toast.success("R2 업로드 완료 — 서버에서 처리 중");
            refetch();
        } catch (err: any) {
            if (aborted || err?.message === "aborted") {
                setUploads(prev => ({ ...prev, [memberId]: { progress: 0, uploading: false } }));
                toast.info("업로드가 중지되었습니다.");
            } else {
                bail(`업로드 실패: ${err?.message ?? "알 수 없음"}`);
            }
        }
        onDone();
    };

    const startActualUpload = useCallback(async (memberId: number, file: File) => {
        activeUploadsRef.current += 1;
        setUploads(prev => ({ ...prev, [memberId]: { progress: 0, uploading: true } }));

        const finishAndDrain = () => {
            activeUploadsRef.current = Math.max(0, activeUploadsRef.current - 1);
            delete xhrRefs.current[memberId];
            const next = uploadQueueRef.current.shift();
            if (next) {
                startActualUpload(next.memberId, next.file);
            } else {
                // 더 이상 진행/대기 업로드가 없을 때만 Wake Lock 해제
                releaseWakeLockIfIdle();
            }
        };

        // 업로드 경로 분기:
        // - Android + BG Fetch 지원 + >100MB → R2 Multipart + Background Fetch (진짜 백그라운드)
        // - >50MB → R2 직접 업로드 (foreground, Wake Lock)
        // - ≤50MB → 서버 직접 업로드 (Cloudflare 100MB 제한 미만)
        const presenter = presenters.find(p => p.member_id === memberId);
        const displayName = presenter?.member_name ?? "영상";

        if (isAndroid && swStatus === "ready" && file.size > MULTIPART_THRESHOLD) {
            r2MultipartUploadBackground(memberId, file, displayName, finishAndDrain);
        } else if (file.size > R2_THRESHOLD) {
            r2Upload(memberId, file, finishAndDrain);
        } else {
            singleUpload(memberId, file, finishAndDrain);
        }
    }, [sessionId, refetch, releaseWakeLockIfIdle, isAndroid, swStatus, presenters]);

    const handleFileSelect = useCallback((memberId: number, file: File) => {
        // Wake Lock 확보 (화면 자동 꺼짐 방지) — 이미 잡혀있으면 no-op
        acquireWakeLock();

        // iOS 안내 — 업로드 시작 시 1회만
        if (isIOS && !iosWarnShownRef.current) {
            iosWarnShownRef.current = true;
            toast.warning(
                "iOS는 Apple 정책상 백그라운드 업로드 안 됩니다. 화면 나가지 말아주세요 (꼬우면 안드로이드 쓰던강ㅋ)",
                { duration: 10_000 }
            );
        }

        // 이미 진행 중인 같은 멤버 업로드가 있으면 중단
        const existing = xhrRefs.current[memberId];
        if (existing) {
            try { existing.abort(); } catch { /* noop */ }
        }
        // 큐에서도 같은 멤버 기존 항목 제거
        uploadQueueRef.current = uploadQueueRef.current.filter(q => q.memberId !== memberId);

        if (activeUploadsRef.current < MAX_CONCURRENT_UPLOADS) {
            startActualUpload(memberId, file);
        } else {
            uploadQueueRef.current.push({ memberId, file });
            setUploads(prev => ({ ...prev, [memberId]: { progress: 0, uploading: false, queued: true } }));
            toast.info(`업로드 대기 중 (앞 ${uploadQueueRef.current.length}개)`);
        }
    }, [startActualUpload, acquireWakeLock, isIOS]);

    const cancelUpload = useCallback((memberId: number) => {
        // 큐 대기 중이면 큐에서 제거
        const inQueue = uploadQueueRef.current.some(q => q.memberId === memberId);
        if (inQueue) {
            uploadQueueRef.current = uploadQueueRef.current.filter(q => q.memberId !== memberId);
            setUploads(prev => ({ ...prev, [memberId]: { progress: 0, uploading: false } }));
            toast.info("대기 중 업로드를 취소했습니다.");
            releaseWakeLockIfIdle();
            return;
        }
        const xhr = xhrRefs.current[memberId];
        if (xhr) {
            xhr.abort();
            delete xhrRefs.current[memberId];
        }
        // xhr.abort() 는 onabort 핸들러로 흘러가 finishAndDrain 호출 → 거기서 releaseWakeLockIfIdle
    }, [releaseWakeLockIfIdle]);

    // 분반별 그룹화 (분반 번호 오름차순 고정)
    const groups: Record<string, PresenterSlot[]> = {};
    if (hasGroups) {
        const sortedPresenters = [...presenters].sort((a, b) =>
            (a.group_num ?? 999) - (b.group_num ?? 999)
        );
        for (const p of sortedPresenters) {
            const key = p.group_num ? `${p.group_num}분반` : "미배정";
            (groups[key] ??= []).push(p);
        }
    } else {
        groups["전체"] = presenters;
    }

    // 카페 제목 생성
    const buildTitle = (p: PresenterSlot) => {
        const orderPart = hasGroups && p.group_num
            ? `${p.group_num}분반 ${p.presenter_order ?? ""}번째`
            : p.presenter_order ? `${p.presenter_order}번째` : "";
        return `${titlePrefix}${p.member_name}${orderPart ? `(${orderPart})` : ""}`;
    };

    // 네이버 업로드 시작
    const handleNaverUpload = () => {
        const selected = presenters.filter(p => selectedForNaver.has(p.member_id) && videoMap.has(p.member_id));
        if (selected.length === 0) {
            toast.error("네이버에 업로드할 영상을 선택해주세요.");
            return;
        }

        const videos = selected.map(p => {
            const video = videoMap.get(p.member_id)!;
            return {
                id: `local_${p.member_id}`,
                name: video.filename,
                presenter: p.member_name,
                order: p.presenter_order ?? 9999,
                group: p.group_num ?? undefined,
                cafe_title: getTitle(p),
                local_path: `/app/files/video/session_${sessionId}/${p.member_id}_${video.filename}`,
            };
        });

        startNaverUpload({ sessionId, videos: videos as any }, {
            onSuccess: (data) => {
                toast.success("네이버 카페 업로드가 시작되었습니다.");
                onNaverUploadStarted?.(data.task_id);
            },
            onError: (err: any) => {
                if (err?.response?.status === 409) {
                    toast.error(err.response.data?.detail ?? "이미 업로드가 진행 중입니다.");
                } else {
                    toast.error("요청 실패");
                }
            },
        });
    };

    const totalPresenters = presenters.length;
    const uploadedCount = presenters.filter(p => videoMap.has(p.member_id)).length;
    const selectedCount = selectedForNaver.size;
    const uploadingCount = Object.values(uploads).filter(u => u.uploading).length;
    // 압축 진행 중 멤버 집합
    const compressingMembers = new Set<number>(
        (uploadedVideos ?? []).filter(v => v.is_compressing).map(v => v.member_id)
    );
    // 선택됐지만 아직 서버에 파일 없는(pendingPull) 또는 압축 중인 멤버들 — 네이버 업로드 차단
    const selectedPendingPull = Array.from(selectedForNaver).filter(id => !videoMap.has(id) && pendingPull.has(id));
    const selectedCompressing = Array.from(selectedForNaver).filter(id => compressingMembers.has(id));
    const selectedBlocked = selectedPendingPull.length + selectedCompressing.length;
    const naverDisabled = selectedCount === 0 || isStartingNaver || selectedBlocked > 0;

    return (
        <div className="space-y-4">
            {/* 헤더 */}
            <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                    <Film className="w-4 h-4 text-[var(--color-accent)]" />
                    <span className="text-sm font-medium">영상 직접 업로드</span>
                    <span className="text-xs text-[var(--color-text-muted)]">
                        {uploadedCount}/{totalPresenters}개 완료
                        {uploadingCount > 0 && ` · ${uploadingCount}개 업로드 중`}
                    </span>
                    {/* SW / Background Fetch 진단 배지 — Android 에서만 표시 */}
                    {isAndroid && (
                        <span
                            className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                                swStatus === "ready" ? "bg-green-500/10 text-green-600 border-green-500/20" :
                                swStatus === "checking" ? "bg-gray-100 text-gray-500 border-gray-200" :
                                "bg-rose-500/10 text-rose-500 border-rose-500/20"
                            }`}
                            title={
                                swStatus === "ready" ? "100MB 초과 영상은 백그라운드로 전송됩니다 (Multipart + Background Fetch)" :
                                swStatus === "checking" ? "Service Worker 준비 중..." :
                                swStatus === "no-sw" ? "Service Worker 등록 실패 — 페이지 완전 새로고침(Ctrl+Shift+R 또는 캐시 삭제) 후 재시도" :
                                "이 브라우저는 Background Fetch 미지원 — foreground 업로드로 전환"
                            }
                        >
                            {swStatus === "ready" ? "✓ 백그라운드 업로드 가능" :
                             swStatus === "checking" ? "SW 확인 중..." :
                             swStatus === "no-sw" ? "⚠ SW 없음" :
                             "⚠ BG 미지원"}
                        </span>
                    )}
                </div>
                <Button
                    onClick={handleNaverUpload}
                    disabled={naverDisabled}
                    className="bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]"
                    size="sm"
                    title={selectedBlocked > 0 ? "서버 처리/압축 중인 영상이 있습니다. 잠시 기다려주세요." : undefined}
                >
                    <UploadCloud className="w-4 h-4 mr-1" />
                    {isStartingNaver
                        ? "시작 중..."
                        : selectedPendingPull.length > 0
                            ? `서버 처리 중 (${selectedPendingPull.length}개)`
                            : selectedCompressing.length > 0
                                ? `압축 중 (${selectedCompressing.length}개)`
                                : `네이버 업로드 (${selectedCount}개)`}
                </Button>
            </div>

            {/* 안내 */}
            <p className="text-xs text-[var(--color-text-muted)]">
                체크된 영상만 네이버 카페에 업로드됩니다. 1분반 → 2분반 순서로 발표 순서대로 진행됩니다.
            </p>

            {/* 네이버 업로드 결과 배너 */}
            {(naverStatus === "complete" || naverStatus === "failed") && Array.isArray(naverResult) && naverResult.length > 0 && (() => {
                const successCount = naverResult.filter(r => r.success).length;
                const failures = naverResult.filter(r => !r.success);
                const allOk = failures.length === 0;
                return (
                    <div className={`rounded-lg border p-3 ${
                        allOk
                            ? "bg-green-500/5 border-green-500/30"
                            : "bg-red-500/5 border-red-500/30"
                    }`}>
                        <div className="flex items-center gap-2 mb-1">
                            {allOk
                                ? <CheckCircle2 className="w-4 h-4 text-green-600" />
                                : <XCircle className="w-4 h-4 text-red-500" />}
                            <span className={`text-sm font-bold ${allOk ? "text-green-700" : "text-red-600"}`}>
                                {allOk ? "네이버 업로드 완료" : "네이버 업로드 일부 실패"}
                            </span>
                            <span className="ml-auto text-xs tabular-nums text-[var(--color-text-muted)]">
                                {successCount}/{naverResult.length} 성공
                            </span>
                        </div>
                        {failures.length > 0 && (
                            <ul className="mt-2 space-y-1 text-xs">
                                {failures.map((f, i) => (
                                    <li key={i} className="flex items-start gap-1.5 text-red-600">
                                        <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                        <span className="font-medium">{f.presenter ?? f.file ?? "알 수 없음"}</span>
                                        <span className="text-red-500/80">— {f.error ?? "원인 미상"}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                );
            })()}

            {/* 카페 제목 접두어 */}
            <div className="flex items-center gap-2 text-xs">
                <span className="text-[var(--color-text-muted)] whitespace-nowrap">카페 제목 접두어</span>
                <Input
                    value={titlePrefix}
                    onChange={(e) => setTitlePrefix(e.target.value)}
                    className="h-7 text-xs flex-1"
                />
            </div>

            {/* 분반별 슬롯 */}
            <div className={hasGroups ? "grid grid-cols-1 md:grid-cols-2 gap-4" : ""}>
                {Object.entries(groups).map(([groupName, members]) => {
                    const groupMemberIds = members.filter(p => videoMap.has(p.member_id)).map(p => p.member_id);
                    const allChecked = groupMemberIds.length > 0 && groupMemberIds.every(id => selectedForNaver.has(id));
                    const toggleAll = () => {
                        setSelectedForNaver(prev => {
                            const next = new Set(prev);
                            if (allChecked) {
                                groupMemberIds.forEach(id => next.delete(id));
                            } else {
                                groupMemberIds.forEach(id => next.add(id));
                            }
                            return next;
                        });
                    };

                    return (
                    <div key={groupName} className="rounded-lg border border-[var(--color-border)] overflow-hidden">
                        <div className="px-4 py-2 bg-gray-50 border-b border-[var(--color-border)] flex items-center gap-3">
                            {groupMemberIds.length > 0 && (
                                <Checkbox
                                    checked={allChecked}
                                    onCheckedChange={toggleAll}
                                />
                            )}
                            <span className="text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
                                {groupName}
                            </span>
                        </div>
                        <div className="divide-y divide-[var(--color-border)]">
                            {members
                                .sort((a, b) => (a.presenter_order ?? 999) - (b.presenter_order ?? 999))
                                .map((p, idx) => {
                                    const video = videoMap.get(p.member_id);
                                    const uploadState = uploads[p.member_id];
                                    const isUploading = uploadState?.uploading;
                                    const isChecked = selectedForNaver.has(p.member_id);
                                    const naverStatus = naverProgress?.find(np => np.presenter === p.member_name)?.status;
                                    const isPendingPull = pendingPull.has(p.member_id) && !video;
                                    const isCompressing = video?.is_compressing === true;

                                    return (
                                        <div key={p.member_id} className="px-3 md:px-4 py-2.5 md:py-3 space-y-1.5">
                                            <div className="flex flex-wrap items-center gap-x-2 md:gap-x-3 gap-y-1.5">
                                                {/* 체크박스 — 서버 처리 중이어도 선택은 가능 (네이버 버튼에서 대기) */}
                                                <Checkbox
                                                    checked={isChecked}
                                                    onCheckedChange={() => toggleNaver(p.member_id)}
                                                    disabled={!video && !isPendingPull}
                                                    className="flex-shrink-0"
                                                />

                                                {/* 순서 + 이름 */}
                                                <span className="text-xs text-[var(--color-text-muted)] w-5 text-right tabular-nums">
                                                    {p.presenter_order ?? idx + 1}.
                                                </span>
                                                <div className="flex flex-col min-w-0 flex-1 md:flex-initial">
                                                    <span className="text-sm font-medium leading-tight truncate">
                                                        {p.member_name}
                                                    </span>
                                                    {p.sub_label && (
                                                        <span className="text-[10px] text-[var(--color-text-muted)] leading-tight truncate">
                                                            {p.sub_label}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* 서버 처리 중 배지 (R2 업로드 끝, 서버 pull 대기) */}
                                                {isPendingPull && (
                                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold border bg-amber-500/10 text-amber-600 border-amber-500/20 animate-pulse flex-shrink-0">
                                                        서버 처리 중
                                                    </span>
                                                )}
                                                {/* 압축 중 배지 */}
                                                {isCompressing && (
                                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold border bg-indigo-500/10 text-indigo-600 border-indigo-500/20 animate-pulse flex-shrink-0">
                                                        압축 중
                                                    </span>
                                                )}

                                                {/* 카페 업로드 상태 배지 */}
                                                {naverStatus && (
                                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border flex-shrink-0 ${
                                                        naverStatus === "done" ? "bg-green-500/10 text-green-600 border-green-500/20" :
                                                        naverStatus === "uploading" ? "bg-yellow-500/10 text-yellow-600 border-yellow-500/20 animate-pulse" :
                                                        naverStatus === "downloading" ? "bg-blue-500/10 text-blue-600 border-blue-500/20 animate-pulse" :
                                                        naverStatus === "failed" ? "bg-red-500/10 text-red-500 border-red-500/20" :
                                                        naverStatus === "cancelled" ? "bg-orange-500/10 text-orange-500 border-orange-500/20" :
                                                        "bg-gray-100 text-gray-500 border-gray-200"
                                                    }`}>
                                                        {naverStatus === "done" ? "완료" :
                                                         naverStatus === "uploading" ? "업로드중" :
                                                         naverStatus === "downloading" ? "다운중" :
                                                         naverStatus === "failed" ? "실패" :
                                                         naverStatus === "cancelled" ? "취소" :
                                                         "대기"}
                                                    </span>
                                                )}

                                                {/* 상태 — 모바일은 전체 폭 아래 줄, 데스크톱은 인라인 */}
                                                {uploadState?.queued ? (
                                                    <div className="w-full md:w-auto md:flex-1 flex items-center gap-2 order-last md:order-none">
                                                        <span className="text-xs text-amber-600 font-medium">업로드 대기 중...</span>
                                                        <Button
                                                            variant="ghost" size="sm"
                                                            className="h-6 px-2 text-[10px] text-rose-500 hover:bg-rose-50 ml-auto"
                                                            onClick={() => cancelUpload(p.member_id)}
                                                        >
                                                            취소
                                                        </Button>
                                                    </div>
                                                ) : video && !isUploading ? (
                                                    <div className="flex items-center gap-2 w-full md:w-auto md:flex-1 min-w-0 order-last md:order-none">
                                                        <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                                                        <span className="text-xs text-green-600 truncate flex-1">
                                                            {video.filename} ({video.size_mb} MB)
                                                        </span>
                                                        <div className="flex gap-1 flex-shrink-0">
                                                            <FileInputButton memberId={p.member_id} onSelect={handleFileSelect} label="교체" small />
                                                            <Button
                                                                variant="ghost" size="sm"
                                                                className="h-6 w-6 p-0 text-rose-500 hover:bg-rose-50"
                                                                onClick={() => deleteVideo({ sessionId, memberId: p.member_id })}
                                                                disabled={isDeleting}
                                                            >
                                                                <Trash2 className="w-3 h-3" />
                                                            </Button>
                                                        </div>
                                                    </div>
                                                ) : isUploading ? (
                                                    <div className="w-full md:w-auto md:flex-1 min-w-0 order-last md:order-none">
                                                        <div className="flex items-center gap-2">
                                                            <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                                                                <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${uploadState.progress}%` }} />
                                                            </div>
                                                            <span className="text-xs text-blue-600 tabular-nums w-10 text-right">{uploadState.progress}%</span>
                                                            <Button
                                                                variant="ghost" size="sm"
                                                                className="h-6 px-2 text-[10px] text-rose-500 hover:bg-rose-50"
                                                                onClick={() => cancelUpload(p.member_id)}
                                                            >
                                                                중지
                                                            </Button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="w-full md:w-auto md:flex-1 flex items-center gap-2 order-last md:order-none">
                                                        {uploadState?.error && <span className="text-xs text-rose-500">{uploadState.error}</span>}
                                                        <div className="ml-auto">
                                                            <FileInputButton memberId={p.member_id} onSelect={handleFileSelect} label="영상 선택" />
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            {/* 카페 제목 인라인 편집 */}
                                            {video && (
                                                <div className="ml-0 md:ml-14">
                                                    <input
                                                        type="text"
                                                        className="hangul-fallback w-full h-6 text-[11px] px-2 border border-[var(--color-border)] rounded bg-white text-[var(--color-text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                                                        value={getTitle(p)}
                                                        onChange={(e) => setTitleOverrides(prev => ({ ...prev, [p.member_id]: e.target.value }))}
                                                        placeholder="카페 게시글 제목"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                        </div>
                    </div>
                    );
                })}
            </div>

            {/* 결석/공결 제외 안내 */}
            {absentMembers && absentMembers.length > 0 && (
                <div className="rounded-lg border border-[var(--color-border)] bg-gray-50/50 px-4 py-2.5">
                    <div className="flex items-center gap-2 mb-1.5">
                        <UserMinus className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                        <span className="text-xs font-medium text-[var(--color-text-muted)]">
                            업로드 대상에서 제외 ({absentMembers.length}명)
                        </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {absentMembers.map(m => (
                            <span
                                key={m.member_id}
                                className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border ${
                                    m.status === "ABSENT"
                                        ? "bg-rose-500/10 text-rose-500 border-rose-500/20"
                                        : "bg-blue-500/10 text-blue-600 border-blue-500/20"
                                }`}
                            >
                                {m.member_name}
                                <span className="text-[9px] opacity-80">
                                    {m.status === "ABSENT" ? "결석" : "공결"}
                                </span>
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function FileInputButton({ memberId, onSelect, label = "영상 선택", small = false }: {
    memberId: number; onSelect: (id: number, file: File) => void; label?: string; small?: boolean;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    return (
        <>
            <input ref={inputRef} type="file" accept="video/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) { onSelect(memberId, f); e.target.value = ""; } }} />
            <Button variant="outline" size="sm" className={small ? "h-6 px-2 text-[10px]" : "h-7 px-3 text-xs"}
                onClick={() => inputRef.current?.click()}>
                <Upload className={small ? "w-2.5 h-2.5 mr-1" : "w-3 h-3 mr-1"} />{label}
            </Button>
        </>
    );
}
