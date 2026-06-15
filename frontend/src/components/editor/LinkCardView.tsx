import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { X, Link as LinkIcon } from "lucide-react";

export interface LinkCardData {
    url: string;
    title?: string;
    description?: string;
    image?: string; // 로컬로 받아온 썸네일 URL (백엔드가 다운로드)
    site?: string;
}

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        linkCard: {
            setLinkCard: (data: LinkCardData) => ReturnType;
        };
    }
}

function LinkCardComponent({ node, deleteNode, editor, selected }: NodeViewProps) {
    const { url, title, description, image, site } = node.attrs as LinkCardData;
    return (
        <NodeViewWrapper className="rich-linkcard-wrap" data-drag-handle>
            <div className={`link-card-edit ${selected ? "ring-2 ring-rose-400" : ""}`}>
                <a href={url} target="_blank" rel="noopener noreferrer" className="link-card" onClick={(e) => editor.isEditable && e.preventDefault()}>
                    {image ? (
                        <img className="link-card-thumb" src={image} alt="" />
                    ) : (
                        <div className="link-card-thumb link-card-thumb--empty"><LinkIcon className="w-6 h-6 text-gray-300" /></div>
                    )}
                    <div className="link-card-body">
                        <div className="link-card-title">{title || url}</div>
                        {description && <div className="link-card-desc">{description}</div>}
                        <div className="link-card-site">{site || new URL(url).hostname}</div>
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
            site: { default: "" },
        };
    },

    parseHTML() {
        return [
            {
                tag: "a[data-link-card]",
                getAttrs: (el: HTMLElement) => ({
                    url: el.getAttribute("data-url") || el.getAttribute("href") || "",
                    title: el.getAttribute("data-title") || "",
                    description: el.getAttribute("data-description") || "",
                    image: el.getAttribute("data-image") || "",
                    site: el.getAttribute("data-site") || "",
                }),
            },
        ];
    },

    // 멤버 렌더(직렬화) — iframe 아닌 안전한 anchor 카드.
    renderHTML({ node }) {
        const { url, title, description, image, site } = node.attrs as LinkCardData;
        const body: (string | object)[] = ["div", { class: "link-card-body" },
            ["div", { class: "link-card-title" }, title || url],
        ];
        if (description) body.push(["div", { class: "link-card-desc" }, description]);
        body.push(["div", { class: "link-card-site" }, site || ""]);

        const children: unknown[] = [];
        if (image) children.push(["img", { class: "link-card-thumb", src: image, alt: "" }]);
        children.push(body);

        return [
            "a",
            mergeAttributes({
                href: url,
                class: "link-card",
                target: "_blank",
                rel: "noopener noreferrer",
                "data-link-card": "true",
                "data-url": url,
                "data-title": title || "",
                "data-description": description || "",
                "data-image": image || "",
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
