import { cn } from "@/lib/utils";

interface ScoreDisplayProps {
    totalPlus: number;
    totalMinus: number;
    netScore: number;
    className?: string;
}

const EVICTION_THRESHOLD = -13;
const WARNING_THRESHOLD = -10;

export function ScoreDisplay({
    totalPlus,
    totalMinus,
    netScore,
    className,
}: ScoreDisplayProps) {
    const isEviction = netScore <= EVICTION_THRESHOLD;
    const isWarning = netScore <= WARNING_THRESHOLD && !isEviction;

    return (
        <div className={cn("flex items-center gap-3", className)}>
            {/* Plus */}
            <span className="text-sm text-green-400">
                +{totalPlus}
            </span>

            {/* Minus */}
            <span className="text-sm text-rose-400">
                {totalMinus}
            </span>

            {/* Net */}
            <span
                className={cn(
                    "font-bold text-base",
                    isEviction
                        ? "text-rose-400 drop-shadow-[0_0_8px_rgba(244,63,94,0.7)]"
                        : isWarning
                            ? "text-yellow-400"
                            : netScore > 0
                                ? "text-green-400"
                                : netScore < 0
                                    ? "text-rose-400"
                                    : "text-gray-400"
                )}
            >
                {netScore >= 0 ? "+" : ""}
                {netScore}
            </span>

            {/* Badge */}
            {isEviction && (
                <span className="text-xs bg-rose-500/10 text-rose-400 border border-rose-500/30 px-1.5 py-0.5 rounded shadow-[0_0_8px_rgba(244,63,94,0.3)] animate-pulse">
                    퇴출대상
                </span>
            )}
            {isWarning && (
                <span className="text-xs bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 px-1.5 py-0.5 rounded">
                    경고
                </span>
            )}
        </div>
    );
}
