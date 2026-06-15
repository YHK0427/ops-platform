import type { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Bold, Italic, Underline as UnderlineIcon, Strikethrough, Highlighter, Link2 } from "lucide-react";

// 노션식 선택 버블메뉴 — 텍스트 선택 시 떠오르는 빠른 서식.
export function BubbleToolbar({ editor }: { editor: Editor }) {
    const B = ({ active, title, onClick, children }: { active?: boolean; title: string; onClick: () => void; children: React.ReactNode }) => (
        <button type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
            className={`w-7 h-7 grid place-items-center rounded-md ${active ? "bg-rose-500 text-white" : "text-gray-200 hover:bg-white/10"}`}>
            {children}
        </button>
    );
    return (
        <BubbleMenu
            editor={editor}
            shouldShow={({ editor, from, to }) =>
                from !== to && !editor.isActive("image") && !editor.isActive("linkCard") && !editor.isActive("codeBlock")
            }
        >
            <div className="flex items-center gap-0.5 px-1 py-1 rounded-lg bg-gray-900 shadow-xl border border-black/20">
                <B title="굵게" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="w-4 h-4" /></B>
                <B title="기울임" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="w-4 h-4" /></B>
                <B title="밑줄" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon className="w-4 h-4" /></B>
                <B title="취소선" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough className="w-4 h-4" /></B>
                <span className="w-px h-5 bg-white/20 mx-0.5" />
                <B title="형광펜" active={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight({ color: "#fef08a" }).run()}><Highlighter className="w-4 h-4" /></B>
                <B title="빨강" active={false} onClick={() => editor.chain().focus().setColor("#e11d48").run()}>
                    <span className="w-3.5 h-3.5 rounded-full bg-rose-500 border border-white/40" />
                </B>
                <span className="w-px h-5 bg-white/20 mx-0.5" />
                <B title="링크" active={editor.isActive("link")} onClick={() => {
                    const prev = (editor.getAttributes("link").href as string) || "https://";
                    const url = window.prompt("링크 URL", prev);
                    if (url === null) return;
                    if (url === "") editor.chain().focus().unsetLink().run();
                    else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
                }}><Link2 className="w-4 h-4" /></B>
            </div>
        </BubbleMenu>
    );
}
