import { cn } from "@/lib/utils";

type AttendanceStatus =
    | "PASS"
    | "LATE"
    | "MISSING"
    | "PENDING"
    | "PRESENT"
    | "ABSENT"
    | "EXCUSED"
    | "LATE_UNDER10"
    | "LATE_OVER10"
    | "EARLY_LEAVE"
    | "FINALIZED";

type SessionStatus = "SETUP" | "PREP" | "OPS" | "POST" | "SETTLEMENT" | "FINALIZED";

type AnyStatus = AttendanceStatus | SessionStatus | string;

const STATUS_LABEL: Record<string, string> = {
    PASS: "통과",
    LATE: "지각",
    MISSING: "미제출",
    PENDING: "대기중",
    PRESENT: "출석",
    ABSENT: "결석",
    EXCUSED: "사유인정",
    LATE_UNDER10: "지각(10분이내)",
    LATE_OVER10: "지각(10분초과)",
    EARLY_LEAVE: "조퇴",
    FINALIZED: "마감",
    SETUP:      "준비중",
    PREP:       "출석",
    OPS:        "과제 준비",
    POST:       "과제 검사",
    SETTLEMENT: "정산중",
};

const BADGE_STYLE: Record<string, string> = {
    PASS: "bg-green-500/10 text-green-600 border-green-500/20 shadow-sm",
    PRESENT: "bg-green-500/10 text-green-600 border-green-500/20 shadow-sm",
    EXCUSED: "bg-green-500/10 text-green-600 border-green-500/20",
    LATE: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20 shadow-sm",
    LATE_UNDER10: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20 shadow-sm",
    LATE_OVER10: "bg-orange-500/10 text-orange-600 border-orange-500/20 shadow-sm",
    EARLY_LEAVE: "bg-orange-500/10 text-orange-600 border-orange-500/20",
    MISSING: "bg-rose-500/10 text-rose-500 border-rose-500/20 shadow-sm",
    ABSENT: "bg-rose-500/10 text-rose-500 border-rose-500/20 shadow-sm",
    PENDING: "bg-gray-50 text-[var(--color-text-secondary)] border-[var(--color-border)]",
    FINALIZED:  "bg-gray-50 text-[var(--color-text-muted)] border-[var(--color-border-subtle)]",
    SETUP:      "bg-slate-500/10 text-slate-600 border-slate-500/20",
    PREP:       "bg-blue-500/10 text-blue-600 border-blue-500/20",
    OPS:        "bg-green-500/10 text-green-600 border-green-500/20 shadow-sm animate-pulse",
    POST:       "bg-purple-500/10 text-purple-600 border-purple-500/20",
    SETTLEMENT: "bg-orange-500/10 text-orange-600 border-orange-500/20",
};

interface StatusBadgeProps {
    status: AnyStatus;
    className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
    const style = BADGE_STYLE[status] ?? "bg-gray-50 text-[var(--color-text-secondary)] border-[var(--color-border)]";
    const label = STATUS_LABEL[status] ?? status;

    return (
        <span
            className={cn(
                "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border",
                style,
                className
            )}
        >
            {label}
        </span>
    );
}
