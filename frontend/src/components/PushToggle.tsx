import { useEffect, useState } from "react";
import type { AxiosInstance } from "axios";
import { Bell, BellOff, Share, X } from "lucide-react";
import { toast } from "sonner";
import {
    getExistingSubscription,
    getPermission,
    isIOS,
    isPushSupported,
    isStandalone,
    subscribePush,
    unsubscribePush,
    type PushEndpoints,
} from "@/lib/push";

interface Props {
    http: AxiosInstance;
    endpoints: PushEndpoints;
    /** 색 톤 — 멤버(rose) / 운영진(accent) */
    tone?: "rose" | "accent";
    className?: string;
}

/** "🔔 알림 받기" 토글 — 미지원/거부/iOS미설치 분기 포함. */
export default function PushToggle({ http, endpoints, tone = "rose", className }: Props) {
    const [supported] = useState(isPushSupported());
    const [subscribed, setSubscribed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [showIOSGuide, setShowIOSGuide] = useState(false);

    useEffect(() => {
        if (!supported) return;
        getExistingSubscription()
            .then((sub) => setSubscribed(!!sub && getPermission() === "granted"))
            .catch(() => {});
    }, [supported]);

    const accent =
        tone === "rose"
            ? "bg-rose-500 hover:bg-rose-600"
            : "bg-[var(--color-accent)] hover:opacity-90";

    async function handleToggle() {
        if (busy) return;
        // iOS인데 홈화면 미설치면 구독 불가 → 설치 안내
        if (isIOS() && !isStandalone()) {
            setShowIOSGuide(true);
            return;
        }
        setBusy(true);
        try {
            if (subscribed) {
                await unsubscribePush(http, endpoints);
                setSubscribed(false);
                toast.success("알림을 껐습니다");
            } else {
                await subscribePush(http, endpoints);
                setSubscribed(true);
                toast.success("알림을 켰습니다 🔔");
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : "알림 설정에 실패했습니다";
            toast.error(msg);
        } finally {
            setBusy(false);
        }
    }

    if (!supported) {
        return (
            <div className={`text-xs text-gray-400 ${className ?? ""}`}>
                이 브라우저는 푸시 알림을 지원하지 않아요
            </div>
        );
    }

    const denied = getPermission() === "denied";

    return (
        <>
            <button
                onClick={handleToggle}
                disabled={busy || denied}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50 ${subscribed ? "bg-gray-400 hover:bg-gray-500" : accent} ${className ?? ""}`}
            >
                {subscribed ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                {busy ? "처리 중…" : subscribed ? "알림 끄기" : "알림 받기"}
            </button>
            {denied && (
                <p className="mt-1.5 text-[11px] text-amber-600">
                    브라우저에서 알림이 차단돼 있어요. 사이트 설정에서 알림을 허용해 주세요.
                </p>
            )}

            {showIOSGuide && <IOSInstallGuide onClose={() => setShowIOSGuide(false)} />}
        </>
    );
}

function IOSInstallGuide({ onClose }: { onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={onClose}>
            <div
                className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-bold text-gray-900">아이폰 알림 설정</h3>
                    <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <p className="text-sm text-gray-600 mb-4 leading-relaxed">
                    아이폰은 <b>홈 화면에 앱을 추가</b>해야 알림을 받을 수 있어요. 아래 순서로 설치한 뒤,
                    설치된 앱에서 다시 <b>알림 받기</b>를 눌러주세요.
                </p>
                <ol className="space-y-3 text-sm text-gray-700">
                    <li className="flex items-start gap-3">
                        <span className="shrink-0 w-6 h-6 rounded-full bg-rose-100 text-rose-600 text-xs font-bold grid place-items-center">1</span>
                        <span>사파리 하단의 <Share className="inline w-4 h-4 -mt-0.5" /> <b>공유</b> 버튼을 누르세요</span>
                    </li>
                    <li className="flex items-start gap-3">
                        <span className="shrink-0 w-6 h-6 rounded-full bg-rose-100 text-rose-600 text-xs font-bold grid place-items-center">2</span>
                        <span><b>홈 화면에 추가</b>를 선택하세요</span>
                    </li>
                    <li className="flex items-start gap-3">
                        <span className="shrink-0 w-6 h-6 rounded-full bg-rose-100 text-rose-600 text-xs font-bold grid place-items-center">3</span>
                        <span>홈 화면에 생긴 <b>UnivPT</b> 앱을 열고 로그인 후 알림을 켜세요</span>
                    </li>
                </ol>
                <button
                    onClick={onClose}
                    className="mt-5 w-full py-2.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold"
                >
                    알겠어요
                </button>
            </div>
        </div>
    );
}
