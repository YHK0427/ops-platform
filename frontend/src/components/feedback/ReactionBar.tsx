import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SmilePlus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export const FEEDBACK_EMOJIS = ["👍", "❤️", "👏", "🔥", "🎉", "😮", "😂", "🥹", "🥺", "😍", "🤩", "💯", "🙌", "💪", "🙏", "✨", "⭐", "🤔", "👀", "🫶"];
const EMOJI_LABEL: Record<string, string> = {
    "👍": "좋아요", "❤️": "최고예요", "👏": "박수", "🔥": "열정", "🎉": "축하", "😮": "놀라움",
    "😂": "웃겨요", "🥹": "감동", "🥺": "짠해요", "😍": "사랑", "🤩": "멋져요", "💯": "완벽",
    "🙌": "최고", "💪": "화이팅", "🙏": "감사", "✨": "인상적", "⭐": "별점", "🤔": "흥미로움", "👀": "주목", "🫶": "응원",
};

interface ReactionBarProps {
    reactions: Record<string, number>;
    myReactions?: string[];
    canReact?: boolean;
    onToggle?: (emoji: string, active: boolean) => void;
    size?: "sm" | "md";
}

/** 실서비스형 반응 바 — count>0 칩 + "＋😊" 팔레트 팝오버. 멤버/운영진/전체화면 공용. */
export function ReactionBar({ reactions, myReactions = [], canReact = false, onToggle, size = "sm" }: ReactionBarProps) {
    const [open, setOpen] = useState(false);
    const mine = new Set(myReactions);
    const active = FEEDBACK_EMOJIS.filter((e) => (reactions?.[e] ?? 0) > 0);
    const pad = size === "md" ? "px-3 py-1 text-base" : "px-2 py-0.5 text-xs";

    return (
        <div className="flex flex-wrap items-center gap-1.5">
            <AnimatePresence initial={false}>
                {active.map((emoji) => {
                    const count = reactions[emoji];
                    const isMine = mine.has(emoji);
                    return (
                        <motion.button
                            key={emoji}
                            layout
                            initial={{ scale: 0.6, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.6, opacity: 0 }}
                            whileTap={canReact ? { scale: 0.88 } : undefined}
                            disabled={!canReact}
                            aria-label={`${EMOJI_LABEL[emoji] ?? emoji} ${count}`}
                            onClick={() => canReact && onToggle?.(emoji, isMine)}
                            className={cn(
                                "inline-flex items-center gap-1 rounded-full border font-medium transition-colors disabled:cursor-default",
                                pad,
                                isMine
                                    ? "bg-rose-50 border-rose-300 text-rose-600"
                                    : "bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300",
                            )}
                        >
                            <span className="leading-none">{emoji}</span>
                            <span className="tabular-nums leading-none">{count}</span>
                        </motion.button>
                    );
                })}
            </AnimatePresence>

            {canReact && (
                <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                        <motion.button
                            whileTap={{ scale: 0.88 }}
                            aria-label="반응 추가"
                            className={cn(
                                "inline-flex items-center justify-center rounded-full border border-dashed border-gray-300 text-gray-400 hover:text-rose-500 hover:border-rose-300 transition-colors",
                                size === "md" ? "h-9 w-9" : "h-6 w-6",
                            )}
                        >
                            <SmilePlus className={size === "md" ? "w-5 h-5" : "w-3.5 h-3.5"} />
                        </motion.button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-auto p-1.5">
                        <div className="flex flex-wrap gap-1 max-w-[264px]">
                            {FEEDBACK_EMOJIS.map((emoji) => {
                                const isMine = mine.has(emoji);
                                return (
                                    <motion.button
                                        key={emoji}
                                        whileTap={{ scale: 0.85 }}
                                        whileHover={{ scale: 1.15 }}
                                        aria-label={EMOJI_LABEL[emoji] ?? emoji}
                                        onClick={() => { onToggle?.(emoji, isMine); setOpen(false); }}
                                        className={cn(
                                            "h-9 w-9 rounded-lg text-xl flex items-center justify-center transition-colors",
                                            isMine ? "bg-rose-50 ring-1 ring-rose-200" : "hover:bg-gray-100",
                                        )}
                                    >
                                        {emoji}
                                    </motion.button>
                                );
                            })}
                        </div>
                    </PopoverContent>
                </Popover>
            )}
        </div>
    );
}
