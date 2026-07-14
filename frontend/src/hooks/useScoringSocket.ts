import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getToken } from "@/lib/api";
import { scoringKeys } from "./useScoring";

// 인증/거부 코드 — 재연결하지 않음
const NO_RETRY_CODES = [4401, 4403, 4404];

/**
 * 심사 결과 실시간 갱신 WebSocket (운영진 전용).
 *
 * 이벤트 payload는 {type}만 담고 데이터는 싣지 않는다 — 집계는 서버에서 하는 게 진실원이라,
 * 이벤트를 받으면 결과 쿼리를 무효화해 다시 받아온다(REST가 진실원).
 */
export function useScoringSocket(roundId: number | null) {
    const qc = useQueryClient();
    const [connected, setConnected] = useState(false);

    const wsRef = useRef<WebSocket | null>(null);
    const retryRef = useRef(0);
    const stoppedRef = useRef(false);
    const hbRef = useRef<number | null>(null);
    const reconnectRef = useRef<number | null>(null);

    useEffect(() => {
        if (!roundId) return;
        stoppedRef.current = false;

        const resync = () => {
            qc.invalidateQueries({ queryKey: scoringKeys.results(roundId) });
            qc.invalidateQueries({ queryKey: scoringKeys.participants(roundId) });
            qc.invalidateQueries({ queryKey: scoringKeys.round(roundId) });
        };

        const connect = () => {
            const token = getToken();
            if (!token) return;
            const scheme = window.location.protocol === "https:" ? "wss" : "ws";
            const url = `${scheme}://${window.location.host}/api/v1/scoring/ws/${roundId}?token=${encodeURIComponent(token)}`;
            const ws = new WebSocket(url);
            wsRef.current = ws;

            ws.onopen = () => {
                setConnected(true);
                retryRef.current = 0;
                resync(); // 재연결 시 누락분 재동기화
                hbRef.current = window.setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) ws.send("ping");
                }, 30_000);
            };
            ws.onmessage = () => resync();
            ws.onclose = (ev) => {
                setConnected(false);
                if (hbRef.current) {
                    clearInterval(hbRef.current);
                    hbRef.current = null;
                }
                if (stoppedRef.current || NO_RETRY_CODES.includes(ev.code)) return;
                const delay = Math.min(15000, 1000 * 2 ** retryRef.current);
                retryRef.current += 1;
                reconnectRef.current = window.setTimeout(() => {
                    if (!stoppedRef.current) connect();
                }, delay);
            };
            ws.onerror = () => ws.close();
        };

        connect();

        return () => {
            stoppedRef.current = true;
            if (hbRef.current) clearInterval(hbRef.current);
            if (reconnectRef.current) clearTimeout(reconnectRef.current);
            wsRef.current?.close();
        };
    }, [roundId, qc]);

    return { connected };
}
