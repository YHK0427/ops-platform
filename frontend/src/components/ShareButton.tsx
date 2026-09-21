import { useState } from "react";
import { Share2, Check, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * 공유 버튼.
 *
 * 폰에서는 OS 공유 시트(카카오톡·인스타 등)를 띄우고, 데스크톱처럼 그게 없는 환경에서는
 * 주소를 복사한다. navigator.share 는 HTTPS(또는 localhost)에서만 있고 사용자의
 * 직접 클릭에서만 열리므로, 클릭 핸들러 안에서 바로 호출한다.
 *
 * 주소는 서버가 준 share_path 를 쓴다. 여기에 붙은 서명이 있어야 카카오톡 미리보기에
 * 제목이 뜬다 — 서명 없는 주소는 일부러 일반 문구만 보이게 해뒀다.
 */
// 데스크톱 크롬 등에는 navigator.share 자체가 없다. 타입 정의상으로는 항상 있는 것으로
// 되어 있어 런타임에서 직접 확인한다.
const canShare = typeof navigator !== "undefined" && "share" in navigator;

export default function ShareButton({
    path, title, className, compact,
}: { path: string; title: string; className?: string; compact?: boolean }) {
    const [copied, setCopied] = useState(false);
    const url = typeof window !== "undefined" ? new URL(path, window.location.origin).toString() : path;

    const copy = async () => {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(url);
            } else {
                // 구형 사파리·http 환경 폴백
                const ta = document.createElement("textarea");
                ta.value = url;
                ta.style.position = "fixed";
                ta.style.opacity = "0";
                document.body.appendChild(ta);
                ta.select();
                document.execCommand("copy");
                document.body.removeChild(ta);
            }
            setCopied(true);
            toast.success("링크를 복사했어요");
            setTimeout(() => setCopied(false), 2000);
        } catch {
            toast.error("복사하지 못했어요. 주소창의 링크를 직접 복사해주세요.");
        }
    };

    const share = async () => {
        if (canShare) {
            try {
                await navigator.share({ title, url });
                return;
            } catch (e) {
                // 사용자가 공유 시트를 닫은 것뿐이면 아무 일도 하지 않는다
                if ((e as Error)?.name === "AbortError") return;
            }
        }
        await copy();
    };

    return (
        <button
            type="button"
            onClick={share}
            title="공유하기"
            className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border border-gray-300 text-gray-600",
                "hover:bg-gray-50 active:scale-95 transition",
                compact ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm font-medium",
                className,
            )}
        >
            {copied ? <Check className="w-4 h-4 text-emerald-600" />
                : canShare ? <Share2 className="w-4 h-4" />
                : <LinkIcon className="w-4 h-4" />}
            {!compact && (copied ? "복사됨" : "공유")}
        </button>
    );
}
