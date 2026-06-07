import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getToken } from "@/lib/api";
import { getMemberToken } from "@/lib/memberApi";
import { lfKeys, type FeedbackBoardDetail, type FeedbackPost } from "./useLiveFeedback";

type Role = "admin" | "member";

interface WsEvent {
    type: string;
    data: any;
}

// 인증/거부 코드 — 재연결하지 않음
const NO_RETRY_CODES = [4401, 4403, 4404];

/**
 * 실시간 피드백 보드 WebSocket 구독 (운영진/멤버 공용).
 * 이벤트를 React Query 캐시(lfKeys.posts/board)에 반영. 재연결·하트비트 포함.
 */
export function useLiveFeedbackSocket(boardId: number | null, role: Role) {
    const qc = useQueryClient();
    const [connected, setConnected] = useState(false);

    const wsRef = useRef<WebSocket | null>(null);
    const retryRef = useRef(0);
    const stoppedRef = useRef(false);
    const hbRef = useRef<number | null>(null);
    const reconnectRef = useRef<number | null>(null);

    useEffect(() => {
        if (!boardId) return;
        stoppedRef.current = false;

        const applyEvent = (msg: WsEvent) => {
            const { type, data } = msg;
            const key = lfKeys.posts(boardId);
            if (type === "post.created") {
                qc.setQueryData<FeedbackPost[]>(key, (prev) => {
                    const list = prev ?? [];
                    if (list.some((p) => p.id === data.id)) return list; // id dedupe (옵티미스틱/에코)
                    return [...list, data as FeedbackPost];
                });
            } else if (type === "reaction.changed") {
                qc.setQueryData<FeedbackPost[]>(key, (prev) =>
                    (prev ?? []).map((p) =>
                        p.id === data.post_id ? { ...p, reactions: data.reactions } : p,
                    ),
                );
            } else if (type === "post.deleted") {
                qc.setQueryData<FeedbackPost[]>(key, (prev) =>
                    (prev ?? []).filter((p) => p.id !== data.post_id),
                );
            } else if (type === "post.hidden") {
                qc.setQueryData<FeedbackPost[]>(key, (prev) =>
                    (prev ?? []).map((p) =>
                        p.id === data.post_id ? { ...p, is_hidden: data.is_hidden } : p,
                    ),
                );
            } else if (type === "post.unhidden") {
                qc.invalidateQueries({ queryKey: key });
            } else if (type === "board.opened" || type === "board.closed") {
                qc.setQueryData<FeedbackBoardDetail>(lfKeys.board(boardId), (prev) =>
                    prev ? { ...prev, is_open: data.is_open } : prev,
                );
            }
        };

        const connect = () => {
            const token = role === "admin" ? getToken() : getMemberToken();
            if (!token) return;
            const scheme = window.location.protocol === "https:" ? "wss" : "ws";
            const url = `${scheme}://${window.location.host}/api/v1/live-feedback/ws/${boardId}?token=${encodeURIComponent(token)}`;
            const ws = new WebSocket(url);
            wsRef.current = ws;

            ws.onopen = () => {
                setConnected(true);
                retryRef.current = 0;
                // 재연결 시 누락분 재동기화 (REST가 진실원)
                qc.invalidateQueries({ queryKey: lfKeys.posts(boardId) });
                hbRef.current = window.setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) ws.send("ping");
                }, 30_000);
            };
            ws.onmessage = (ev) => {
                try {
                    applyEvent(JSON.parse(ev.data));
                } catch {
                    /* ignore */
                }
            };
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
    }, [boardId, role, qc]);

    return { connected };
}
