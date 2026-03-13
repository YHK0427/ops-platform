import { AlertCircle, AlertTriangle, Info, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

type Level = "error" | "warning" | "info";

interface WarningBannerProps {
    level: Level;
    title?: string;
    message: string;
    dismissible?: boolean;
    icon?: React.ReactNode;
    action?: {
        label: string;
        onClick: () => void;
    };
}

const CONFIG: Record<
    Level,
    { icon: React.ElementType; containerClass: string; iconClass: string }
> = {
    error: {
        icon: AlertCircle,
        containerClass:
            "border-rose-500/40 bg-rose-500/10 text-rose-700",
        iconClass: "text-rose-500",
    },
    warning: {
        icon: AlertTriangle,
        containerClass:
            "border-amber-500/40 bg-amber-500/10 text-amber-800",
        iconClass: "text-amber-600",
    },
    info: {
        icon: Info,
        containerClass:
            "border-blue-500/40 bg-blue-500/10 text-blue-700",
        iconClass: "text-blue-600",
    },
};

export function WarningBanner({
    level,
    title,
    message,
    dismissible = false,
    icon,
    action,
}: WarningBannerProps) {
    const [dismissed, setDismissed] = useState(false);
    if (dismissed) return null;

    const { icon: DefaultIcon, containerClass, iconClass } = CONFIG[level];

    return (
        <div
            className={cn(
                "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
                containerClass
            )}
        >
            <div className={cn("mt-0.5", iconClass)}>
                {icon ? icon : <DefaultIcon className="w-4 h-4 shrink-0" />}
            </div>
            <div className="flex-1">
                {title && <h4 className="font-bold mb-1">{title}</h4>}
                <div className="flex flex-col gap-2">
                    <span>{message}</span>
                    {action && (
                        <button
                            onClick={action.onClick}
                            className="self-start text-xs font-bold underline underline-offset-2 hover:opacity-80"
                        >
                            {action.label}
                        </button>
                    )}
                </div>
            </div>
            {dismissible && (
                <button
                    onClick={() => setDismissed(true)}
                    className="opacity-60 hover:opacity-100 transition-opacity"
                >
                    <X className="w-4 h-4" />
                </button>
            )}
        </div>
    );
}
