// 웹 푸시 구독 헬퍼 (표준 VAPID).
// 멤버 포털과 운영진 모두 사용 — axios 인스턴스를 주입받아 동작한다.
import type { AxiosInstance } from "axios";

export interface PushEndpoints {
    vapidPath?: string; // 기본 /notifications/vapid-public-key
    subscribePath: string; // 멤버 /notifications/subscribe · 운영진 /notifications/ops/subscribe
}

const DEFAULT_VAPID_PATH = "/notifications/vapid-public-key";

/** 이 브라우저가 웹 푸시를 지원하는가 */
export function isPushSupported(): boolean {
    return (
        typeof navigator !== "undefined" &&
        "serviceWorker" in navigator &&
        typeof window !== "undefined" &&
        "PushManager" in window &&
        "Notification" in window
    );
}

/** iOS/iPadOS 여부 (PWA 설치해야 푸시 가능) */
export function isIOS(): boolean {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent;
    const iOSDevice = /iPad|iPhone|iPod/.test(ua);
    // iPadOS 13+ 는 Mac으로 위장 → 터치 + Mac 으로 추정
    const iPadOS = navigator.platform === "MacIntel" && (navigator as unknown as { maxTouchPoints: number }).maxTouchPoints > 1;
    return iOSDevice || iPadOS;
}

/** 홈화면에 설치된(standalone) 상태로 실행 중인가 */
export function isStandalone(): boolean {
    if (typeof window === "undefined") return false;
    return (
        window.matchMedia?.("(display-mode: standalone)").matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true
    );
}

export function getPermission(): NotificationPermission | "unsupported" {
    if (!isPushSupported()) return "unsupported";
    return Notification.permission;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = window.atob(base64);
    const buf = new ArrayBuffer(raw.length);
    const arr = new Uint8Array(buf);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
}

/** 현재 브라우저의 기존 푸시 구독 (없으면 null) */
export async function getExistingSubscription(): Promise<PushSubscription | null> {
    if (!isPushSupported()) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
}

/**
 * 푸시 구독 + 서버 등록. 성공 시 true.
 * - 권한 요청(사용자 제스처 안에서 호출해야 함)
 * - SW ready → pushManager.subscribe → 서버 POST
 */
export async function subscribePush(http: AxiosInstance, ep: PushEndpoints): Promise<boolean> {
    if (!isPushSupported()) throw new Error("이 브라우저는 푸시 알림을 지원하지 않습니다");

    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("알림 권한이 거부되었습니다");

    const reg = await navigator.serviceWorker.ready;

    // VAPID 공개키
    const { data } = await http.get<{ public_key: string }>(ep.vapidPath || DEFAULT_VAPID_PATH);
    if (!data.public_key) throw new Error("서버에 VAPID 키가 설정되지 않았습니다");

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
        sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(data.public_key),
        });
    }

    const json = sub.toJSON();
    await http.post(ep.subscribePath, {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
        ua: navigator.userAgent.slice(0, 300),
    });
    return true;
}

/**
 * 푸시 구독 해제 + 서버에서 삭제. 로그아웃/토글 OFF 시 호출.
 * subscribePath 와 같은 경로로 DELETE(endpoint) 한다.
 */
export async function unsubscribePush(http: AxiosInstance, ep: PushEndpoints): Promise<void> {
    if (!isPushSupported()) return;
    try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!sub) return;
        const endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => {});
        await http.delete(ep.subscribePath, { data: { endpoint } }).catch(() => {});
    } catch {
        /* 조용히 무시 — 로그아웃 흐름을 막지 않는다 */
    }
}
