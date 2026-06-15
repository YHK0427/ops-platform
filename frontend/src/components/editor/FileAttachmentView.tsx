import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { FileDown, X } from "lucide-react";

export interface FileData {
    url: string;
    name: string;
    size?: number;
}

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        fileAttachment: {
            setFileAttachment: (data: FileData) => ReturnType;
        };
    }
}

function fmtSize(n?: number) {
    if (!n) return "";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const ALIGN_MARGIN: Record<string, React.CSSProperties> = {
    left: { marginRight: "auto", marginLeft: 0 },
    center: { marginLeft: "auto", marginRight: "auto" },
    right: { marginLeft: "auto", marginRight: 0 },
};

function FileComponent({ node, deleteNode, editor, selected }: NodeViewProps) {
    const { url, name, size } = node.attrs as FileData;
    const align = (node.attrs.align as string) || "left";
    return (
        <NodeViewWrapper className="rich-file-wrap" data-drag-handle>
            <div className={`file-attach-edit ${selected ? "ring-2 ring-rose-400" : ""}`}
                style={{ display: "block", width: "fit-content", maxWidth: "100%", ...ALIGN_MARGIN[align] }}>
                <a href={url} download={name} className="file-attach" onClick={(e) => editor.isEditable && e.preventDefault()}>
                    <span className="file-attach-icon"><FileDown className="w-5 h-5" /></span>
                    <span className="file-attach-body">
                        <span className="file-attach-name">{name}</span>
                        <span className="file-attach-meta">{fmtSize(size)} · 다운로드</span>
                    </span>
                </a>
                {editor.isEditable && (
                    <button type="button" title="첨부 삭제" onClick={() => deleteNode()}
                        className="absolute top-1.5 right-1.5 w-6 h-6 grid place-items-center rounded-full bg-white/90 border border-gray-200 text-gray-500 hover:text-rose-600 shadow">
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>
        </NodeViewWrapper>
    );
}

export const FileAttachment = Node.create({
    name: "fileAttachment",
    group: "block",
    atom: true,
    selectable: true,
    draggable: true,

    addAttributes() {
        return {
            url: { default: "" },
            name: { default: "파일" },
            size: { default: 0 },
            align: {
                default: "left",
                parseHTML: (el: HTMLElement) => el.getAttribute("data-align") || "left",
                renderHTML: () => ({}),
            },
        };
    },

    parseHTML() {
        return [{
            tag: "a[data-file-attach]",
            priority: 100, // Link 마크보다 먼저 매칭
            getAttrs: (el: HTMLElement) => ({
                url: el.getAttribute("data-url") || el.getAttribute("href") || "",
                name: el.getAttribute("data-name") || el.getAttribute("download") || "파일",
                size: Number(el.getAttribute("data-size") || 0),
            }),
        }];
    },

    renderHTML({ node }) {
        const { url, name, size } = node.attrs as FileData;
        const align = (node.attrs.align as string) || "left";
        const m = align === "center" ? "margin-left:auto;margin-right:auto;"
            : align === "right" ? "margin-left:auto;margin-right:0;" : "margin-right:auto;margin-left:0;";
        return [
            "a",
            mergeAttributes({
                href: url, download: name, class: "file-attach", style: m,
                "data-file-attach": "true", "data-align": align, "data-url": url, "data-name": name, "data-size": String(size || 0),
            }),
            ["span", { class: "file-attach-icon" }, "📎"],
            ["span", { class: "file-attach-body" },
                ["span", { class: "file-attach-name" }, name],
                ["span", { class: "file-attach-meta" }, `${fmtSize(size)} · 다운로드`],
            ],
        ];
    },

    addNodeView() {
        return ReactNodeViewRenderer(FileComponent);
    },

    addCommands() {
        return {
            setFileAttachment: (data: FileData) => ({ commands }) =>
                commands.insertContent({ type: this.name, attrs: data }),
        };
    },
});
