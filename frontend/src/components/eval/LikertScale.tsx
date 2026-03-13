import { motion } from "framer-motion";

interface LikertScaleProps {
    value: number | null;
    onChange: (value: number) => void;
    disabled?: boolean;
    variant?: "dark" | "light";
}

const LABELS = [
    "매우 그렇지 않다",
    "그렇지 않다",
    "보통이다",
    "그렇다",
    "매우 그렇다",
] as const;

const SHORT_LABELS = ["1", "2", "3", "4", "5"] as const;

export { LikertScale };
export default function LikertScale({ value, onChange, disabled = false, variant = "dark" }: LikertScaleProps) {
    const isLight = variant === "light";

    return (
        <div className="flex items-center justify-between gap-2 sm:gap-3">
            {LABELS.map((label, idx) => {
                const score = idx + 1;
                const isSelected = value === score;

                return (
                    <div key={score} className="flex flex-col items-center gap-1.5 flex-1">
                        <button
                            type="button"
                            disabled={disabled}
                            onClick={() => onChange(score)}
                            className="group relative"
                            aria-label={label}
                            title={label}
                        >
                            <motion.div
                                className={[
                                    "w-10 h-10 sm:w-11 sm:h-11 rounded-full border-2 transition-colors",
                                    "flex items-center justify-center text-sm font-semibold",
                                    disabled
                                        ? "cursor-not-allowed opacity-50"
                                        : "cursor-pointer",
                                    isSelected
                                        ? isLight
                                            ? "border-rose-500 bg-rose-500 text-white shadow-md shadow-rose-500/25"
                                            : "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
                                        : isLight
                                            ? "border-gray-200 bg-white text-gray-400 hover:border-rose-300 hover:text-rose-500"
                                            : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:border-[var(--color-border-highlight)] hover:text-[var(--color-text-primary)]",
                                ].join(" ")}
                                whileTap={disabled ? {} : { scale: 0.9 }}
                                animate={
                                    isSelected
                                        ? {
                                              boxShadow: isLight
                                                  ? "0 4px 14px rgba(244,63,94,0.3)"
                                                  : "0 0 12px rgba(99,102,241,0.5)",
                                          }
                                        : { boxShadow: "0 0 0px transparent" }
                                }
                            >
                                {score}
                            </motion.div>
                        </button>
                        <span
                            className={[
                                "text-[9px] sm:text-[11px] text-center leading-tight max-w-[52px] select-none",
                                isLight ? "text-gray-400" : "text-[var(--color-text-muted)]",
                            ].join(" ")}
                            title={label}
                        >
                            <span className="hidden sm:inline">{label}</span>
                            <span className="sm:hidden">{SHORT_LABELS[idx]}</span>
                        </span>
                    </div>
                );
            })}
        </div>
    );
}
