import { useState } from "react";
import { SmilePlus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import memberApi from "@/lib/memberApi";

export const REACTION_EMOJIS = ["👍", "❤️", "🔥", "👏", "🎉", "🥹", "👀"];

/** 공지 이모지 반응 — 활성 반응만 칩으로 노출 + ＋😊 팝업으로 추가(실시간 피드백 톤).
 * - 멤버(interactive): 탭 토글, 서버 반영.
 * - readOnly(운영진/목록): 칩만 표시. */
export default function AnnouncementReactions({
    announcementId, reactions, myReactions = [], readOnly = false, className,
}: {
    announcementId: number;
    reactions: Record<string, number>;
    myReactions?: string[];
    readOnly?: boolean;
    className?: string;
}) {
    const [counts, setCounts] = useState<Record<string, number>>(reactions || {});
    const [mine, setMine] = useState<Set<string>>(new Set(myReactions));
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState(false);

    const toggle = async (emoji: string) => {
        if (busy) return;
        setBusy(true);
        try {
            const { data } = await memberApi.post<{ reactions: Record<string, number>; my_reactions: string[] }>(
                `/notifications/announcements/${announcementId}/reactions`, { emoji },
            );
            setCounts(data.reactions || {});
            setMine(new Set(data.my_reactions || []));
        } catch {
            /* noop */
        } finally {
            setBusy(false);
        }
    };

    const active = REACTION_EMOJIS.filter((e) => (counts[e] || 0) > 0);
    if (readOnly && active.length === 0) return null;

    return (
        <div className={`flex flex-wrap items-center gap-1.5 ${className ?? ""}`}>
            {active.map((e) => {
                const isMine = mine.has(e);
                return (
                    <button
                        key={e}
                        disabled={readOnly || busy}
                        onClick={() => !readOnly && toggle(e)}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium transition-colors disabled:cursor-default ${isMine ? "bg-rose-50 border-rose-300 text-rose-600" : "bg-gray-50 border-gray-200 text-gray-600"} ${!readOnly ? "hover:border-gray-300 active:scale-95" : ""}`}
                    >
                        <span className="text-sm leading-none">{e}</span>
                        <span className="tabular-nums leading-none">{counts[e]}</span>
                    </button>
                );
            })}
            {!readOnly && (
                <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                        <button aria-label="반응 추가"
                            className="inline-flex items-center justify-center h-6 w-6 rounded-full border border-dashed border-gray-300 text-gray-400 hover:text-rose-500 hover:border-rose-300 transition-colors">
                            <SmilePlus className="w-3.5 h-3.5" />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-auto p-1.5">
                        <div className="flex gap-1">
                            {REACTION_EMOJIS.map((e) => (
                                <button
                                    key={e}
                                    onClick={() => { void toggle(e); setOpen(false); }}
                                    className={`h-9 w-9 rounded-lg text-xl flex items-center justify-center transition-colors ${mine.has(e) ? "bg-rose-50 ring-1 ring-rose-200" : "hover:bg-gray-100"}`}
                                >
                                    {e}
                                </button>
                            ))}
                        </div>
                    </PopoverContent>
                </Popover>
            )}
        </div>
    );
}
