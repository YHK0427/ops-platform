import type { Extensions } from "@tiptap/core";
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

export const FONT_FAMILIES = [
    { label: "기본", value: "" },
    { label: "Paperlogy", value: '"Paperlogy", sans-serif' },
    { label: "명조", value: '"Noto Serif KR", serif' },
    { label: "고정폭", value: 'ui-monospace, monospace' },
];
export const FONT_SIZES = [
    { label: "작게", value: "13px" },
    { label: "기본", value: "" },
    { label: "조금 크게", value: "17px" },
    { label: "크게", value: "20px" },
    { label: "아주 크게", value: "24px" },
];
export const LINE_HEIGHTS = [
    { label: "좁게", value: "1.4" },
    { label: "기본", value: "1.7" },
    { label: "넓게", value: "2.2" },
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
        TableKit.configure({ table: { resizable: true } }),
        Youtube.configure({ nocookie: true, controls: true, modestBranding: true, HTMLAttributes: { class: "rich-youtube" } }),
        Placeholder.configure({ placeholder: placeholder || "내용을 자유롭게 작성하세요…" }),
    ];
}
