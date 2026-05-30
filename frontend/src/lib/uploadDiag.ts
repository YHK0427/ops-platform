// 영상 업로드 진단 보고 — 브라우저→R2 직접 PUT 실패는 백엔드를 안 거치므로
// 각 단계 결과를 서버로 보고해 서버 로그/텔레그램에서 원인을 파악하기 위함.
// keepalive: 페이지를 닫거나 이동해도 전송되도록.

export interface UploadDiag {
    session_id: number;
    member_id: number;
    stage: "presign" | "r2_put" | "finalize" | "single" | "catch";
    ok: boolean;
    status?: number | null;
    message?: string | null;
    size_mb?: number | null;
    elapsed_ms?: number | null;     // 해당 단계 소요 시간
    presign_age_ms?: number | null; // presign 발급 후 경과 (만료 판단용)
    filename?: string | null;
}

export function reportUploadDiag(d: UploadDiag): void {
    try {
        const body = JSON.stringify({ ...d, ua: navigator.userAgent });
        fetch(
            `/api/v1/sessions/${d.session_id}/videos/${d.member_id}/upload-diag`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body,
                keepalive: true,
            },
        ).catch(() => { /* 진단 전송 실패는 무시 */ });
    } catch {
        /* noop */
    }
}
