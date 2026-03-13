const TEMPLATE_PATTERNS = [
    /^\d+\.\s*지각\s*\/\s*조퇴\s*\/\s*결석\s*일자\s*$/,
    /^\d+\.\s*단순사유\s*\/\s*인정사유\s*[\(（].*[\)）]\s*$/,
    /^\d+\.\s*사유\s*(및|&)\s*증빙서류\s*$/,
    /^이와\s*같은\s*이유로\s*지각\s*\/\s*조퇴\s*\/\s*결석을\s*신청합니다\.?\s*$/,
];

function isTemplateLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) return true;
    return TEMPLATE_PATTERNS.some((p) => p.test(trimmed));
}

export function ExcuseTextDisplay({ text }: { text: string }) {
    // Split header (title line + ---) from body
    const separatorIdx = text.indexOf("\n---\n");
    const header = separatorIdx >= 0 ? text.slice(0, separatorIdx) : null;
    const body = separatorIdx >= 0 ? text.slice(separatorIdx + 5) : text;

    const lines = body.split("\n");

    return (
        <div className="space-y-1.5">
            {header && (
                <p className="text-xs font-bold text-[var(--color-text-primary)] border-b border-[var(--color-border)] pb-1.5 mb-1">
                    {header}
                </p>
            )}
            <div className="text-xs whitespace-pre-wrap break-words leading-relaxed">
                {lines.map((line, i) => {
                    const tmpl = isTemplateLine(line);
                    return (
                        <span
                            key={i}
                            className={tmpl ? "text-gray-400" : "text-[var(--color-text-primary)] font-medium"}
                        >
                            {line}
                            {i < lines.length - 1 && "\n"}
                        </span>
                    );
                })}
            </div>
        </div>
    );
}
