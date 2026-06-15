import { useMemo, useState } from "react";
import DOMPurify, { type Config } from "dompurify";
import { X } from "lucide-react";
import "./richtext.css";

// 유튜브 외 iframe 은 제거 (XSS 방지). 모듈 로드 시 1회 등록.
DOMPurify.addHook("uponSanitizeElement", (node, data) => {
    if (data.tagName === "iframe") {
        const el = node as Element;
        const src = el.getAttribute?.("src") || "";
        if (!/^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com)\//.test(src)) {
            el.parentNode?.removeChild(el);
        }
    }
});

const SANITIZE_OPTS: Config = {
    ALLOWED_TAGS: [
        "p", "br", "strong", "b", "em", "i", "u", "s", "mark", "span",
        "h1", "h2", "h3", "ul", "ol", "li", "blockquote", "pre", "code",
        "hr", "a", "img", "label", "input", "div", "figure",
        "table", "thead", "tbody", "tr", "th", "td", "colgroup", "col", "iframe",
    ],
    ALLOWED_ATTR: [
        "href", "target", "rel", "src", "alt", "style", "class",
        "data-type", "data-checked", "type", "checked", "disabled",
        "colspan", "rowspan", "width", "height",
        "allow", "allowfullscreen", "frameborder", "scrolling",
        "data-link-card", "data-url", "data-title", "data-description", "data-image", "data-site",
        "data-align", "data-width", "data-youtube-video",
    ],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|\/|data:image\/)/i,
};

/** 공지 본문(HTML)을 XSS 정제 후 렌더 + 이미지 클릭 확대(라이트박스). */
export default function RichContent({ html, className }: { html: string; className?: string }) {
    const [zoom, setZoom] = useState<string | null>(null);
    const clean = useMemo(() => DOMPurify.sanitize(html || "", SANITIZE_OPTS), [html]);

    const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
        const t = e.target as HTMLElement;
        if (t.tagName === "IMG" && !t.closest("a.link-card")) {
            setZoom((t as HTMLImageElement).src);
        }
    };

    return (
        <>
            <div
                className={`rich-content ${className ?? ""}`}
                onClick={onClick}
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: clean }}
            />
            {zoom && (
                <div className="fixed inset-0 z-[100] bg-black/85 flex items-center justify-center p-4" onClick={() => setZoom(null)}>
                    <button className="absolute top-4 right-4 text-white/80 hover:text-white" onClick={() => setZoom(null)}>
                        <X className="w-7 h-7" />
                    </button>
                    <img src={zoom} alt="" className="max-w-full max-h-full object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
                </div>
            )}
        </>
    );
}
