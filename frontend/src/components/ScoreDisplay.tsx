import { cn } from "@/lib/utils";

interface ScoreDisplayProps {
    totalPlus: number;
    totalMinus: number;
    netScore: number;
    className?: string;
}

const EVICTION_THRESHOLD = -13;
const WARNING_THRESHOLD = -7;

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
            <span className="text-sm text-green-600">
                +{totalPlus}
            </span>

            {/* Minus */}
            <span className="text-sm text-rose-500">
                {totalMinus}
            </span>

            {/* Net */}
            <span
                className={cn(
                    "font-bold text-base",
                    isEviction
                        ? "text-rose-500 drop-shadow-[0_0_8px_rgba(244,63,94,0.5)]"
                        : isWarning
                            ? "text-amber-600"
                            : netScore > 0
                                ? "text-green-600"
                                : netScore < 0
                                    ? "text-rose-500"
                                    : "text-gray-500"
                )}
            >
                {netScore >= 0 ? "+" : ""}
                {netScore}
            </span>

            {/* Badge */}
            {isEviction && (
                <span className="text-xs bg-rose-500/10 text-rose-600 border border-rose-500/30 px-1.5 py-0.5 rounded shadow-[0_0_8px_rgba(244,63,94,0.3)] animate-pulse">
                    퇴출대상
                </span>
            )}
            {isWarning && (
                <span className="text-xs bg-yellow-500/10 text-amber-600 border border-yellow-500/30 px-1.5 py-0.5 rounded">
                    경고
                </span>
            )}
        </div>
    );
}
