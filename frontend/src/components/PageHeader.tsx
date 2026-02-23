import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface PageHeaderProps {
    title: string;
    subtitle?: string;
    actions?: React.ReactNode;
    className?: string;
    showBackButton?: boolean;
    backTo?: string; // If provided, navigates there. If not, navigate(-1)
}

export function PageHeader({ title, subtitle, actions, className, showBackButton, backTo }: PageHeaderProps) {
    const navigate = useNavigate();

    const handleBack = () => {
        if (backTo) {
            navigate(backTo);
        } else {
            navigate(-1);
        }
    };

    return (
        <header
            className={cn(
                "sticky top-0 z-10 flex items-center justify-between gap-4",
                "px-6 py-4 border-b border-[var(--color-border-subtle)]",
                "bg-black/30 backdrop-blur-md",
                className
            )}
        >
            <div className="flex items-center gap-4">
                {showBackButton && (
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleBack}
                        className="h-8 w-8 text-[var(--color-text-muted)] hover:text-white"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </Button>
                )}
                <div>
                    <h1 className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-white via-white to-white/60">
                        {title}
                    </h1>
                    {subtitle && (
                        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{subtitle}</p>
                    )}
                </div>
            </div>
            {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
    );
}
