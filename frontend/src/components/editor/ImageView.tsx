import { useRef } from "react";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";

const ALIGN_MARGIN: Record<string, { marginLeft: string; marginRight: string }> = {
    left: { marginLeft: "0", marginRight: "auto" },
    center: { marginLeft: "auto", marginRight: "auto" },
    right: { marginLeft: "auto", marginRight: "0" },
};
const ALIGN_STYLE_STR: Record<string, string> = {
    left: "margin-right:auto;margin-left:0;",
    center: "margin-left:auto;margin-right:auto;",
    right: "margin-left:auto;margin-right:0;",
};

function ImageComponent({ node, updateAttributes, selected, editor }: NodeViewProps) {
    const align = (node.attrs.align as string) || "center";
    const width = (node.attrs.width as string | null) || null;
    const wrapRef = useRef<HTMLDivElement>(null);

    // 모서리 드래그로 width(%) 조절. 컨테이너(에디터 본문) 폭 기준.
    const startResize = (e: React.PointerEvent, dir: "left" | "right") => {
        e.preventDefault();
        e.stopPropagation();
        const editorWidth = editor.view.dom.clientWidth || 1;
        const startX = e.clientX;
        const startPx = wrapRef.current?.offsetWidth || 0;
        const onMove = (ev: PointerEvent) => {
            const delta = dir === "right" ? ev.clientX - startX : startX - ev.clientX;
            const nextPx = Math.max(60, startPx + delta);
            let pct = Math.round((nextPx / editorWidth) * 100);
            pct = Math.min(100, Math.max(15, pct));
            updateAttributes({ width: `${pct}%` });
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    const editable = editor.isEditable;

    return (
        <NodeViewWrapper
            className="rich-img-wrap"
            data-align={align}
            style={{ display: "block", width: width || "fit-content", maxWidth: "100%", ...ALIGN_MARGIN[align] }}
        >
            <div ref={wrapRef} className="relative inline-block max-w-full" style={{ width: width || "auto" }}>
                <img
                    src={node.attrs.src}
                    alt={node.attrs.alt || ""}
                    draggable={false}
                    style={{ width: "100%", display: "block", borderRadius: 12 }}
                    className={selected ? "outline outline-[3px] outline-rose-400" : ""}
                />
                {editable && selected && (
                    <>
                        <span
                            onPointerDown={(e) => startResize(e, "right")}
                            className="absolute -right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white border-2 border-rose-400 cursor-ew-resize shadow"
                        />
                        <span
                            onPointerDown={(e) => startResize(e, "left")}
                            className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white border-2 border-rose-400 cursor-ew-resize shadow"
                        />
                    </>
                )}
            </div>
        </NodeViewWrapper>
    );
}

// 정렬(margin) + 크기(width%) + 드래그 리사이즈를 지원하는 이미지 노드.
// 편집은 React NodeView, 저장(멤버 렌더)은 renderHTML 의 <img style=...> 직렬화.
export const ResizableImage = Image.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            align: {
                default: "center",
                parseHTML: (el: HTMLElement) => el.getAttribute("data-align") || "center",
                renderHTML: () => ({}),
            },
            width: {
                default: null,
                parseHTML: (el: HTMLElement) => el.getAttribute("data-width") || null,
                renderHTML: () => ({}),
            },
        };
    },
    renderHTML({ HTMLAttributes, node }) {
        const align = (node.attrs.align as string) || "center";
        const width = node.attrs.width as string | null;
        const style = `display:block;height:auto;${ALIGN_STYLE_STR[align] || ALIGN_STYLE_STR.center}${width ? `width:${width};` : "max-width:100%;"}`;
        const extra: Record<string, string> = { "data-align": align, style };
        if (width) extra["data-width"] = width;
        return ["img", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, extra)];
    },
    addNodeView() {
        return ReactNodeViewRenderer(ImageComponent);
    },
});
