import { useEffect, useState } from "react";
import memberApi from "@/lib/memberApi";
import { Trash2, Send } from "lucide-react";

interface Comment {
    id: number;
    member_id: number;
    name: string;
    content: string;
    created_at: string;
    is_mine: boolean;
}

function relTime(iso: string) {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "방금";
    if (s < 3600) return `${Math.floor(s / 60)}분 전`;
    if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
    return `${Math.floor(s / 86400)}일 전`;
}

/** 공지 댓글 — 멤버 열람/작성/본인삭제. */
export default function AnnouncementComments({ announcementId }: { announcementId: number }) {
    const [comments, setComments] = useState<Comment[]>([]);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        memberApi
            .get<Comment[]>(`/notifications/announcements/${announcementId}/comments`)
            .then(({ data }) => setComments(data))
            .catch(() => {});
    }, [announcementId]);

    const submit = async () => {
        const text = input.trim();
        if (!text || busy) return;
        setBusy(true);
        try {
            const { data } = await memberApi.post<Comment>(
                `/notifications/announcements/${announcementId}/comments`, { content: text },
            );
            setComments((c) => [...c, data]);
            setInput("");
        } catch {
            /* noop */
        } finally {
            setBusy(false);
        }
    };

    const del = async (id: number) => {
        if (!confirm("댓글을 삭제할까요?")) return;
        try {
            await memberApi.delete(`/notifications/announcements/${announcementId}/comments/${id}`);
            setComments((c) => c.filter((x) => x.id !== id));
        } catch {
            /* noop */
        }
    };

    return (
        <div>
            <p className="text-xs font-semibold text-gray-400 mb-2.5">댓글 {comments.length}</p>
            <div className="space-y-3">
                {comments.map((c) => (
                    <div key={c.id} className="flex items-start gap-2">
                        <div className="shrink-0 w-7 h-7 rounded-full bg-rose-100 text-rose-500 grid place-items-center text-[11px] font-bold">
                            {c.name.slice(0, 1)}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                                <span className="text-[13px] font-semibold text-gray-800">{c.name}</span>
                                <span className="text-[11px] text-gray-400">{relTime(c.created_at)}</span>
                            </div>
                            <p className="text-[14px] text-gray-700 mt-0.5 break-words whitespace-pre-wrap">{c.content}</p>
                        </div>
                        {c.is_mine && (
                            <button onClick={() => del(c.id)} className="text-gray-300 hover:text-rose-500 shrink-0 p-1">
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                ))}
                {comments.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-3">첫 댓글을 남겨보세요</p>
                )}
            </div>
            <div className="flex items-center gap-2 mt-3">
                <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                    placeholder="댓글 달기…"
                    maxLength={1000}
                    className="flex-1 px-3.5 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-400"
                />
                <button onClick={submit} disabled={busy || !input.trim()}
                    className="p-2.5 rounded-xl bg-rose-500 text-white disabled:opacity-40 active:scale-95">
                    <Send className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}
