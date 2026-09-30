import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api, { getActiveCohort, getToken } from "@/lib/api";
import memberApi, { getMemberToken } from "@/lib/memberApi";
import { sessionsKeys } from "./useSessions";

// 오프·오피 투표 — 백엔드 app/routers/session_votes.py
export type VoteCategory = "OFF" | "OPI";
export const VOTE_LABEL: Record<VoteCategory, string> = { OFF: "오프", OPI: "오피" };
export const VOTE_DESC: Record<VoteCategory, string> = { OFF: "오늘의 프레젠터", OPI: "오늘의 PPT" };

export interface Person { id: number; name: string }
export interface CategoryResult {
    winners: number[];
    votes: number;
    tie: boolean;
    resolved: "auto" | "all" | "runoff" | "none" | null;
}
export interface SessionVote {
    id: number;
    group_num: number | null;
    round: number;
    parent_id: number | null;
    is_open: boolean;
    result: Partial<Record<VoteCategory, CategoryResult>> | null;
    opened_at: string | null;
    closed_at: string | null;
    candidates: Partial<Record<VoteCategory, Person[]>>;
    tally: Partial<Record<VoteCategory, Record<string, number>>>;
    voters: (Person & { picks: Partial<Record<VoteCategory, number>> })[];
}
export interface SessionVotesData {
    session_status: string;
    groups: (number | null)[];
    eligible: Record<string, Person[]>;
    votes: SessionVote[];
}
export interface MemberVote {
    id: number;
    round: number;
    group_num: number | null;
    session_title: string;
    session_week_num: number;
    candidates: Partial<Record<VoteCategory, Person[]>>;
    my: Partial<Record<VoteCategory, number>>;
}

export const voteKeys = {
    session: (sid: number) => ["session-votes", sid] as const,
    memberOpen: () => ["session-votes", "member-open"] as const,
};

// ── 운영진 ──────────────────────────────────────────────────────────────

export function useSessionVotes(sessionId: number) {
    return useQuery({
        queryKey: voteKeys.session(sessionId),
        queryFn: async () => (await api.get<SessionVotesData>(`/sessions/${sessionId}/votes`)).data,
        refetchInterval: 30_000, // 실시간 신호를 놓쳐도 30초 안에는 맞춰진다
    });
}

function useVoteMutation<T>(sessionId: number, fn: (arg: T) => Promise<unknown>) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: fn,
        onSettled: () => {
            qc.invalidateQueries({ queryKey: voteKeys.session(sessionId) });
            // 정산 대기 상점 목록이 바뀐다
            qc.invalidateQueries({ queryKey: [...sessionsKeys.detail(sessionId), "settlement"] });
        },
    });
}

export const useOpenVote = (sid: number) =>
    useVoteMutation(sid, (b: { group_num: number | null; candidates: number[] }) => api.post(`/sessions/${sid}/votes`, b));
export const useUpdateCandidates = (sid: number) =>
    useVoteMutation(sid, (b: { id: number; candidates: number[] }) => api.put(`/session-votes/${b.id}/candidates`, { candidates: b.candidates }));
export const useCloseVote = (sid: number) =>
    useVoteMutation(sid, (id: number) => api.post(`/session-votes/${id}/close`));
export const useResolveVote = (sid: number) =>
    useVoteMutation(sid, (b: { id: number } & Partial<Record<VoteCategory, "runoff" | "all">>) => {
        const { id, ...choice } = b;
        return api.post(`/session-votes/${id}/resolve`, choice);
    });
export const useReopenVote = (sid: number) =>
    useVoteMutation(sid, (id: number) => api.post(`/session-votes/${id}/reopen`));
export const useDeleteVote = (sid: number) =>
    useVoteMutation(sid, (id: number) => api.delete(`/session-votes/${id}`));

// ── 기수원 ──────────────────────────────────────────────────────────────

export const memberOpenVotesQuery = {
    queryKey: voteKeys.memberOpen(),
    queryFn: async () => (await memberApi.get<MemberVote[]>("/session-votes/member/open")).data,
};

export function useMemberOpenVotes() {
    return useQuery({ ...memberOpenVotesQuery, refetchInterval: 60_000 });
}

export function useCastBallot() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (b: { id: number } & Partial<Record<VoteCategory, number | null>>) => {
            const { id, ...picks } = b;
            return memberApi.put(`/session-votes/member/${id}/ballot`, picks);
        },
        // 누르자마자 선택이 보이게(저장 실패하면 onSettled 가 서버 값으로 되돌린다)
        onMutate: ({ id, ...picks }) => {
            qc.setQueryData<MemberVote[]>(voteKeys.memberOpen(), (prev) => prev?.map((v) => {
                if (v.id !== id) return v;
                const my = { ...v.my };
                for (const [c, p] of Object.entries(picks) as [VoteCategory, number | null][]) {
                    if (p == null) delete my[c]; else my[c] = p;
                }
                return { ...v, my };
            }));
        },
        onSettled: () => qc.invalidateQueries({ queryKey: voteKeys.memberOpen() }),
    });
}

// ── 실시간 신호 ──────────────────────────────────────────────────────────
// 서버는 "다시 조회하라"는 신호만 보낸다(vote.changed / vote.ballot). 내용은 각자 권한에 맞는 API 로 받는다.

export function useVoteSignals(role: "admin" | "member", onSignal: () => void) {
    useEffect(() => {
        let ws: WebSocket | null = null;
        let stopped = false;
        let retry = 0;
        let hb: number | undefined;
        let again: number | undefined;
        let batch: number | undefined;
        const connect = () => {
            const token = role === "admin" ? getToken() : getMemberToken();
            if (!token) return;
            const scheme = window.location.protocol === "https:" ? "wss" : "ws";
            const cohort = role === "admin" ? getActiveCohort() : null;
            ws = new WebSocket(`${scheme}://${window.location.host}/api/v1/session-votes/ws?token=${encodeURIComponent(token)}${cohort != null ? `&cohort=${cohort}` : ""}`);
            ws.onopen = () => {
                retry = 0;
                onSignal(); // 끊겨 있던 사이 바뀐 것 맞추기
                hb = window.setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), 30_000);
            };
            ws.onmessage = () => {
                // 여러 명이 연달아 투표하면 신호가 몰린다 — 0.3초 모아서 한 번만
                window.clearTimeout(batch);
                batch = window.setTimeout(onSignal, 300);
            };
            ws.onclose = (ev) => {
                window.clearInterval(hb);
                if (stopped || [4401, 4403].includes(ev.code)) return;
                again = window.setTimeout(connect, Math.min(15000, 1000 * 2 ** retry++));
            };
            ws.onerror = () => ws?.close();
        };
        connect();
        return () => {
            stopped = true;
            window.clearInterval(hb);
            window.clearTimeout(again);
            window.clearTimeout(batch);
            ws?.close();
        };
        // onSignal 은 호출하는 쪽에서 안정적인 함수로 넘긴다
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [role]);
}
