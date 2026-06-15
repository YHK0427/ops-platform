import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { X, Link as LinkIcon } from "lucide-react";

export interface LinkCardData {
    url: string;
    title?: string;
    description?: string;
    image?: string; // 로컬로 받아온 썸네일 URL (백엔드가 다운로드)
    favicon?: string; // 사이트 아이콘 (로컬)
    site?: string;
}

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        linkCard: {
            setLinkCard: (data: LinkCardData) => ReturnType;
        };
    }
}

const ALIGN_MARGIN: Record<string, React.CSSProperties> = {
    left: { marginRight: "auto", marginLeft: 0 },
    center: { marginLeft: "auto", marginRight: "auto" },
    right: { marginLeft: "auto", marginRight: 0 },
};

function LinkCardComponent({ node, deleteNode, editor, selected }: NodeViewProps) {
    const { url, title, description, image, favicon, site } = node.attrs as LinkCardData;
    const align = (node.attrs.align as string) || "left";
    return (
        <NodeViewWrapper className="rich-linkcard-wrap" data-drag-handle>
            <div className={`link-card-edit ${selected ? "ring-2 ring-rose-400" : ""}`}
                style={{ display: "block", width: "fit-content", maxWidth: "100%", ...ALIGN_MARGIN[align] }}>
                <a href={url} target="_blank" rel="noopener noreferrer" className="link-card" onClick={(e) => editor.isEditable && e.preventDefault()}>
                    {image ? (
                        <img className="link-card-thumb" src={image} alt="" />
                    ) : favicon ? (
                        <div className="link-card-thumb link-card-thumb--icon"><img src={favicon} alt="" className="w-9 h-9 object-contain" /></div>
                    ) : (
                        <div className="link-card-thumb link-card-thumb--icon"><LinkIcon className="w-6 h-6 text-gray-300" /></div>
                    )}
                    <div className="link-card-body">
                        <div className="link-card-title">{title || url}</div>
                        {description && <div className="link-card-desc">{description}</div>}
                        <div className="link-card-site">
                            {favicon && <img src={favicon} alt="" className="link-card-favicon" />}
                            {site || new URL(url).hostname}
                        </div>
                    </div>
                </a>
                {editor.isEditable && (
                    <button
                        type="button"
                        title="링크 카드 삭제"
                        onClick={() => deleteNode()}
                        className="absolute top-2 right-2 w-6 h-6 grid place-items-center rounded-full bg-white/90 border border-gray-200 text-gray-500 hover:text-rose-600 shadow"
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>
        </NodeViewWrapper>
    );
}

export const LinkCard = Node.create({
    name: "linkCard",
    group: "block",
    atom: true,
    selectable: true,
    draggable: true,

    addAttributes() {
        return {
            url: { default: "" },
            title: { default: "" },
            description: { default: "" },
            image: { default: "" },
            favicon: { default: "" },
            site: { default: "" },
            align: {
                default: "left",
                parseHTML: (el: HTMLElement) => el.getAttribute("data-align") || "left",
                renderHTML: () => ({}),
            },
        };
    },

    parseHTML() {
        return [
            {
                tag: "a[data-link-card]",
                priority: 100, // Link 마크보다 먼저 매칭 (안쪽 img가 따로 추출되는 것 방지)
                getAttrs: (el: HTMLElement) => ({
                    url: el.getAttribute("data-url") || el.getAttribute("href") || "",
                    title: el.getAttribute("data-title") || "",
                    description: el.getAttribute("data-description") || "",
                    image: el.getAttribute("data-image") || "",
                    favicon: el.getAttribute("data-favicon") || "",
                    site: el.getAttribute("data-site") || "",
                }),
            },
        ];
    },

    // 멤버 렌더(직렬화) — iframe 아닌 안전한 anchor 카드.
    renderHTML({ node }) {
        // ⚠️ <a> 안엔 블록(div)을 넣으면 HTML 재파싱 시 구조가 깨진다 → 전부 span(인라인)으로.
        const { url, title, description, image, favicon, site } = node.attrs as LinkCardData;
        const siteRow: (string | object)[] = ["span", { class: "link-card-site" }];
        if (favicon) siteRow.push(["img", { class: "link-card-favicon", src: favicon, alt: "" }]);
        siteRow.push(["span", {}, site || ""]);

        const body: (string | object)[] = ["span", { class: "link-card-body" },
            ["span", { class: "link-card-title" }, title || url],
        ];
        if (description) body.push(["span", { class: "link-card-desc" }, description]);
        body.push(siteRow);

        const children: unknown[] = [];
        if (image) children.push(["img", { class: "link-card-thumb", src: image, alt: "" }]);
        else if (favicon) children.push(["span", { class: "link-card-thumb link-card-thumb--icon" }, ["img", { class: "link-card-favicon-lg", src: favicon, alt: "" }]]);
        children.push(body);

        const align = (node.attrs.align as string) || "left";
        const m = align === "center" ? "margin-left:auto;margin-right:auto;"
            : align === "right" ? "margin-left:auto;margin-right:0;" : "margin-right:auto;margin-left:0;";

        return [
            "a",
            mergeAttributes({
                href: url,
                class: "link-card",
                target: "_blank",
                rel: "noopener noreferrer",
                style: m,
                "data-link-card": "true",
                "data-align": align,
                "data-url": url,
                "data-title": title || "",
                "data-description": description || "",
                "data-image": image || "",
                "data-favicon": favicon || "",
                "data-site": site || "",
            }),
            ...children,
        ];
    },

    addNodeView() {
        return ReactNodeViewRenderer(LinkCardComponent);
    },

    addCommands() {
        return {
            setLinkCard:
                (data: LinkCardData) =>
                ({ commands }) =>
                    commands.insertContent({ type: this.name, attrs: data }),
        };
    },
});
