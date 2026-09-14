import { Extension, type Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, Color, FontSize, LineHeight, FontFamily } from "@tiptap/extension-text-style";
import { Highlight } from "@tiptap/extension-highlight";
import { TextAlign } from "@tiptap/extension-text-align";
import { Placeholder } from "@tiptap/extension-placeholder";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { TableKit } from "@tiptap/extension-table";
import Youtube from "@tiptap/extension-youtube";
import { ResizableImage } from "./ImageView";
import { LinkCard } from "./LinkCardView";
import { FileAttachment } from "./FileAttachmentView";

// 인용구 종류(variant) — 기존 blockquote 노드에 data-variant 속성 추가(네이버식 여러 스타일).
export const BLOCKQUOTE_VARIANTS = [
    { value: "line", label: "세로선" },
    { value: "box", label: "박스" },
    { value: "quote", label: "따옴표" },
    { value: "corner", label: "모서리선" },
];
const BlockquoteVariant = Extension.create({
    name: "blockquoteVariant",
    addGlobalAttributes() {
        return [{
            types: ["blockquote"],
            attributes: {
                variant: {
                    default: "line",
                    parseHTML: (el: HTMLElement) => el.getAttribute("data-variant") || "line",
                    renderHTML: (attrs: { variant?: string }) =>
                        attrs.variant && attrs.variant !== "line" ? { "data-variant": attrs.variant } : {},
                },
            },
        }];
    },
});

export const FONT_FAMILIES = [
    { label: "기본", value: "" },
    { label: "Paperlogy", value: '"Paperlogy", sans-serif' },
    { label: "명조", value: '"Noto Serif KR", serif' },
    { label: "고정폭", value: 'ui-monospace, monospace' },
];
// 글자 크기 — px 단위 (네이버 카페식). 기본 본문은 15px.
export const FONT_SIZE_DEFAULT = "15";
export const FONT_SIZES = [11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 28, 32, 36].map(
    (n) => ({ label: String(n), value: `${n}px` }),
);
export const LINE_HEIGHTS = [
    { label: "좁게", value: "1.4" },
    { label: "보통", value: "1.7" },
    { label: "넓게", value: "2.1" },
    { label: "아주 넓게", value: "2.6" },
];

export function buildExtensions(placeholder?: string): Extensions {
    return [
        StarterKit.configure({
            heading: { levels: [1, 2, 3] },
            link: {
                openOnClick: false,
                autolink: true,
                HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
            },
        }),
        TextStyle,
        Color,
        FontSize,
        FontFamily,
        LineHeight.configure({ types: ["heading", "paragraph"] }),
        Highlight.configure({ multicolor: true }),
        TextAlign.configure({ types: ["heading", "paragraph", "listItem", "taskItem"] }),
        TaskList,
        TaskItem.configure({ nested: true }),
        ResizableImage.configure({ inline: false }),
        LinkCard,
        FileAttachment,
        BlockquoteVariant,
        TableKit.configure({ table: { resizable: true } }),
        Youtube.configure({ nocookie: true, controls: true, modestBranding: true, HTMLAttributes: { class: "rich-youtube" } }),
        Placeholder.configure({ placeholder: placeholder || "내용을 자유롭게 작성하세요…" }),
    ];
}
