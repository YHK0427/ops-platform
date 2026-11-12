import { useEffect, useState } from "react";
import { Eye, X } from "lucide-react";
import { MEMBER_PREVIEW_KEY, endMemberPreview, memberPreviewInfo } from "@/lib/memberApi";
import { PREVIEW_READY, PREVIEW_TOKEN } from "@/lib/memberPreview";

/**
 * /member-preview — 운영진이 '기수 화면 보기'로 연 새 탭의 첫 화면.
 * 연 창(opener)에 준비됐다고 알리고, 토큰을 받으면 이 탭에만 저장한 뒤 기수 포털로 간다.
 */
export function MemberPreviewBoot() {
    const [failed, setFailed] = useState(() => !window.opener);
    useEffect(() => {
        const opener = window.opener as Window | null;
        if (!opener) return;
        const onMsg = (e: MessageEvent) => {
            if (e.origin !== window.location.origin || e.source !== opener) return;
            if (e.data?.type !== PREVIEW_TOKEN || typeof e.data.token !== "string") return;
            sessionStorage.setItem(MEMBER_PREVIEW_KEY, e.data.token);
            window.location.replace("/member");
        };
        window.addEventListener("message", onMsg);
        opener.postMessage(PREVIEW_READY, window.location.origin);
        const t = setTimeout(() => setFailed(true), 15_000);
        return () => { window.removeEventListener("message", onMsg); clearTimeout(t); };
    }, []);
    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 text-sm text-gray-500 text-center break-keep">
            {failed ? "운영진 화면의 멤버 상세에서 '기수 화면 보기'를 다시 눌러주세요." : "기수 화면을 여는 중…"}
        </div>
    );
}

/** 미리보기 탭 맨 위 띠 — 누가 보고 있는지, 읽기 전용, 남은 시간 */
export function MemberPreviewBar() {
    const info = memberPreviewInfo();
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!info) return;
        const id = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(id);
    }, [info?.exp]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (info && now >= info.exp) endMemberPreview(); // 30분이 지나면 가만히 있어도 닫는다
    }, [info, now]);
    if (!info) return null;
    const left = Math.max(0, Math.ceil((info.exp - now) / 60_000));
    return (
        <div className="relative z-30 flex items-center gap-2 px-4 py-2 bg-amber-100 border-b border-amber-300 text-xs text-amber-900">
            <Eye className="w-3.5 h-3.5 shrink-0" />
            <p className="flex-1 min-w-0 break-keep">
                <b className="font-semibold">기수 화면 미리보기</b> · 읽기 전용이라 눌러도 저장되지 않아요 · {left}분 남음
            </p>
            <button type="button" onClick={endMemberPreview}
                className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-amber-200 font-medium">
                <X className="w-3.5 h-3.5" />닫기
            </button>
        </div>
    );
}
