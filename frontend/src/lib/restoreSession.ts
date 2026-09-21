import { getToken, setToken } from "@/lib/api";
import { getMemberToken, setMemberToken } from "@/lib/memberApi";

/**
 * 로그인 복구.
 *
 * 토큰은 localStorage 에 두는데, 사파리·크롬(WebKit/ITP)은 사이트를 7일간 쓰지 않으면
 * **스크립트가 쓴 저장소**를 통째로 지운다. 2주에 한 번 들어오는 기수원은 그래서
 * 매번 다시 로그인하게 된다. 카카오톡 인앱 브라우저는 저장소가 따로라 더 자주 겪는다.
 *
 * 로그인할 때 서버가 HttpOnly 쿠키를 같이 심어둔다. 쿠키는 스크립트가 쓴 저장소가
 * 아니라서 그 삭제 대상이 아니다. 토큰이 없으면 그 쿠키로 한 번 되살린다.
 *
 * 실패해도 아무 일도 하지 않는다 — 평소처럼 로그인 화면으로 가면 된다.
 */
export async function restoreSession(): Promise<void> {
    if (getToken() || getMemberToken()) return;   // 이미 있으면 건드리지 않는다
    try {
        const r = await fetch("/api/v1/auth/session", {
            credentials: "same-origin",
            headers: { Accept: "application/json" },
        });
        if (!r.ok) return;
        const d = (await r.json()) as { access_token?: string | null; kind?: string | null };
        if (!d.access_token) return;
        if (d.kind === "member") setMemberToken(d.access_token);
        else if (d.kind === "staff") setToken(d.access_token, true);
    } catch {
        // 네트워크가 없으면 그냥 넘어간다
    }
}
