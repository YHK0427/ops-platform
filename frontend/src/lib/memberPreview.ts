import { toast } from "sonner";
import api from "@/lib/api";

/** 운영진 화면 → 새 탭 사이에 주고받는 메시지. 토큰은 주소(URL)에 싣지 않는다(기록·히스토리에 남지 않게). */
export const PREVIEW_READY = "member-preview-ready";
export const PREVIEW_TOKEN = "member-preview-token";

/**
 * 운영진 화면에서 호출 — 새 탭을 먼저 열고(팝업 차단 피하려고 클릭 직후), 서버에서 받은 30분짜리
 * 읽기 전용 토큰을 새 탭이 준비됐다고 알려오면 postMessage 로 넘긴다.
 */
export function openMemberPreview(memberId: number) {
    const w = window.open("/member-preview", "_blank");
    if (!w) { toast.error("팝업이 막혔어요. 브라우저에서 이 사이트 팝업을 허용해 주세요."); return; }
    let token: string | null = null;
    let ready = false;
    const done = () => window.removeEventListener("message", onMsg);
    const send = () => {
        if (!token || !ready) return;
        w.postMessage({ type: PREVIEW_TOKEN, token }, window.location.origin);
        done();
    };
    const onMsg = (e: MessageEvent) => {
        if (e.origin !== window.location.origin || e.source !== w || e.data !== PREVIEW_READY) return;
        ready = true;
        send();
    };
    window.addEventListener("message", onMsg);
    setTimeout(done, 60_000);
    api.post<{ token: string }>(`/members/${memberId}/preview-token`)
        .then(({ data }) => { token = data.token; send(); })
        .catch((e) => {
            w.close();
            done();
            const d = e?.response?.data?.detail;
            toast.error(typeof d === "string" ? d : "기수 화면을 열지 못했어요");
        });
}
