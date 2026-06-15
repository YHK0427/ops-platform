import { useState } from "react";
import type { Editor } from "@tiptap/react";
import {
    Bold, Italic, Underline as UnderlineIcon, Strikethrough, Type, Highlighter,
    List, ListOrdered, ListChecks, Quote, Code2, Minus, Link2, Link2Off,
    AlignLeft, AlignCenter, AlignRight, Undo2, Redo2, ChevronDown, Plus,
    Image as ImageIcon, Table as TableIcon, Youtube as YoutubeIcon, Link as LinkIcon, ExternalLink, Trash2,
    Rows3, Columns3,
} from "lucide-react";
import { FONT_SIZES, FONT_FAMILIES, LINE_HEIGHTS } from "./extensions";

const TEXT_COLORS = ["#1f2937", "#e11d48", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#2563eb", "#7c3aed"];
const HIGHLIGHTS = ["transparent", "#fef08a", "#fecaca", "#bbf7d0", "#bfdbfe", "#e9d5ff", "#fed7aa"];

export function Btn({ onClick, active, disabled, title, children }: {
    onClick: () => void; active?: boolean; disabled?: boolean; title: string; children: React.ReactNode;
}) {
    return (
        <button type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick} disabled={disabled}
            className={`w-8 h-8 shrink-0 grid place-items-center rounded-md text-sm transition-colors disabled:opacity-30 ${active ? "bg-rose-100 text-rose-600" : "text-gray-600 hover:bg-gray-100"}`}>
            {children}
        </button>
    );
}
export const Divider = () => <span className="w-px h-5 bg-gray-200 mx-0.5 shrink-0" />;

function Popover({ trigger, children, width }: { trigger: React.ReactNode; children: (close: () => void) => React.ReactNode; width?: string }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="relative shrink-0">
            <div onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((v) => !v)}>{trigger}</div>
            {open && (
                <>
                    <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
                    <div className={`absolute z-30 top-9 left-0 bg-white rounded-lg shadow-lg border border-gray-200 p-1.5 ${width ?? ""}`}>
                        {children(() => setOpen(false))}
                    </div>
                </>
            )}
        </div>
    );
}

// 텍스트 드롭다운 (문단스타일/글자크기/줄간격/글꼴 공용)
function SelectMenu({ label, items, current, onPick, minW }: {
    label: string; items: { label: string; value: string }[]; current: string; onPick: (v: string) => void; minW?: string;
}) {
    return (
        <Popover width="min-w-[120px]" trigger={
            <button type="button" title={label}
                className={`flex items-center gap-1 h-8 px-2 shrink-0 rounded-md text-xs font-medium text-gray-700 hover:bg-gray-100 ${minW ?? ""}`}>
                <span className="truncate">{current}</span>
                <ChevronDown className="w-3 h-3 text-gray-400" />
            </button>
        }>
            {(close) => (
                <div className="flex flex-col">
                    {items.map((it) => (
                        <button key={it.value || "default"} type="button" onMouseDown={(e) => e.preventDefault()}
                            onClick={() => { onPick(it.value); close(); }}
                            className="text-left px-3 py-1.5 rounded-md text-sm text-gray-700 hover:bg-rose-50 whitespace-nowrap">
                            {it.label}
                        </button>
                    ))}
                </div>
            )}
        </Popover>
    );
}

function ParagraphStyle({ editor }: { editor: Editor }) {
    const current = editor.isActive("heading", { level: 1 }) ? "제목 1"
        : editor.isActive("heading", { level: 2 }) ? "제목 2"
        : editor.isActive("heading", { level: 3 }) ? "제목 3" : "본문";
    const pick = (v: string) => {
        const c = editor.chain().focus();
        if (v === "p") c.setParagraph().run();
        else c.toggleHeading({ level: Number(v) as 1 | 2 | 3 }).run();
    };
    return <SelectMenu label="문단 스타일" current={current} minW="min-w-[64px]"
        items={[{ label: "본문", value: "p" }, { label: "제목 1", value: "1" }, { label: "제목 2", value: "2" }, { label: "제목 3", value: "3" }]}
        onPick={pick} />;
}

function ColorMenu({ editor }: { editor: Editor }) {
    const current = (editor.getAttributes("textStyle").color as string) || "#1f2937";
    return (
        <Popover trigger={<Btn title="글자색" onClick={() => {}}><Type className="w-4 h-4" style={{ color: current }} /></Btn>}>
            {(close) => (
                <div className="grid grid-cols-4 gap-1.5">
                    {TEXT_COLORS.map((c) => (
                        <button key={c} type="button" title={c} onMouseDown={(e) => e.preventDefault()}
                            onClick={() => { editor.chain().focus().setColor(c).run(); close(); }}
                            className="w-6 h-6 rounded-full border border-gray-300" style={{ background: c }} />
                    ))}
                </div>
            )}
        </Popover>
    );
}

function HighlightMenu({ editor }: { editor: Editor }) {
    return (
        <Popover trigger={<Btn title="형광펜" active={editor.isActive("highlight")} onClick={() => {}}><Highlighter className="w-4 h-4" /></Btn>}>
            {(close) => (
                <div className="flex gap-1.5">
                    {HIGHLIGHTS.map((c) => (
                        <button key={c} type="button" title={c === "transparent" ? "지우기" : c} onMouseDown={(e) => e.preventDefault()}
                            onClick={() => { c === "transparent" ? editor.chain().focus().unsetHighlight().run() : editor.chain().focus().toggleHighlight({ color: c }).run(); close(); }}
                            className="w-6 h-6 rounded-md border border-gray-300 grid place-items-center text-[10px] text-gray-400"
                            style={{ background: c === "transparent" ? "#fff" : c }}>{c === "transparent" ? "✕" : ""}</button>
                    ))}
                </div>
            )}
        </Popover>
    );
}

function LinkPopover({ editor, onConvertCard }: { editor: Editor; onConvertCard: (url: string) => void }) {
    const active = editor.isActive("link");
    const href = (editor.getAttributes("link").href as string) || "";
    const [val, setVal] = useState(href || "https://");
    return (
        <Popover width="w-64" trigger={<Btn title="링크" active={active} onClick={() => setVal(href || "https://")}><Link2 className="w-4 h-4" /></Btn>}>
            {(close) => (
                <div className="flex flex-col gap-2">
                    <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="https://…"
                        className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-rose-400" />
                    <div className="flex items-center gap-1.5">
                        <button type="button" onMouseDown={(e) => e.preventDefault()}
                            onClick={() => { if (val) editor.chain().focus().extendMarkRange("link").setLink({ href: val }).run(); close(); }}
                            className="flex-1 px-2 py-1.5 rounded-md text-xs font-semibold bg-rose-500 text-white hover:bg-rose-600">적용</button>
                        {val && <a href={val} target="_blank" rel="noreferrer" title="열기" className="px-2 py-1.5 rounded-md text-gray-500 hover:bg-gray-100"><ExternalLink className="w-4 h-4" /></a>}
                        {active && <button type="button" title="제거" onMouseDown={(e) => e.preventDefault()}
                            onClick={() => { editor.chain().focus().unsetLink().run(); close(); }}
                            className="px-2 py-1.5 rounded-md text-gray-500 hover:bg-gray-100"><Link2Off className="w-4 h-4" /></button>}
                    </div>
                    <button type="button" onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { if (val) onConvertCard(val); close(); }}
                        className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium text-gray-600 border border-gray-200 hover:bg-gray-50">
                        <LinkIcon className="w-3.5 h-3.5" /> 카드로 변환
                    </button>
                </div>
            )}
        </Popover>
    );
}

function InsertMenu({ editor, onPickImage, onInsertLinkCard }: {
    editor: Editor; onPickImage: () => void; onInsertLinkCard: (url: string) => void;
}) {
    const [mode, setMode] = useState<"menu" | "youtube" | "card">("menu");
    const [url, setUrl] = useState("");
    return (
        <Popover width="w-60" trigger={
            <button type="button" title="삽입" className="flex items-center gap-1 h-8 px-2 shrink-0 rounded-md text-xs font-semibold text-rose-600 hover:bg-rose-50">
                <Plus className="w-4 h-4" /> 삽입
            </button>
        }>
            {(close) => mode === "menu" ? (
                <div className="flex flex-col">
                    <MenuItem icon={<ImageIcon className="w-4 h-4" />} label="이미지" onClick={() => { onPickImage(); close(); }} />
                    <MenuItem icon={<TableIcon className="w-4 h-4" />} label="표" onClick={() => { editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); close(); }} />
                    <MenuItem icon={<YoutubeIcon className="w-4 h-4" />} label="유튜브 동영상" onClick={() => { setUrl(""); setMode("youtube"); }} />
                    <MenuItem icon={<LinkIcon className="w-4 h-4" />} label="링크 카드" onClick={() => { setUrl(""); setMode("card"); }} />
                    <MenuItem icon={<Minus className="w-4 h-4" />} label="구분선" onClick={() => { editor.chain().focus().setHorizontalRule().run(); close(); }} />
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    <p className="text-xs font-semibold text-gray-600 px-1">{mode === "youtube" ? "유튜브 URL" : "링크 URL"}</p>
                    <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…"
                        className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-rose-400" />
                    <div className="flex gap-1.5">
                        <button type="button" onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                                if (!url) return;
                                if (mode === "youtube") editor.commands.setYoutubeVideo({ src: url });
                                else onInsertLinkCard(url);
                                close(); setMode("menu");
                            }}
                            className="flex-1 px-2 py-1.5 rounded-md text-xs font-semibold bg-rose-500 text-white hover:bg-rose-600">삽입</button>
                        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setMode("menu")}
                            className="px-2 py-1.5 rounded-md text-xs text-gray-500 hover:bg-gray-100">뒤로</button>
                    </div>
                </div>
            )}
        </Popover>
    );
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
    return (
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick}
            className="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-gray-700 hover:bg-rose-50 whitespace-nowrap">
            <span className="text-gray-500">{icon}</span>{label}
        </button>
    );
}

export function MainToolbar({ editor, onPickImage, onInsertLinkCard }: {
    editor: Editor; onPickImage: () => void; onInsertLinkCard: (url: string) => void;
}) {
    const fontSize = (editor.getAttributes("textStyle").fontSize as string) || "";
    const fontFamily = (editor.getAttributes("textStyle").fontFamily as string) || "";
    const lineHeight = (editor.getAttributes("paragraph").lineHeight as string) || (editor.getAttributes("heading").lineHeight as string) || "1.7";
    const fsLabel = FONT_SIZES.find((f) => f.value === fontSize)?.label || "기본";
    const ffLabel = FONT_FAMILIES.find((f) => f.value === fontFamily)?.label || "기본";
    const lhLabel = LINE_HEIGHTS.find((f) => f.value === lineHeight)?.label || "기본";

    return (
        <div className="flex flex-nowrap md:flex-wrap items-center gap-0.5 p-2 border-b border-gray-200 bg-gray-50 overflow-x-auto">
            <Btn title="실행 취소" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}><Undo2 className="w-4 h-4" /></Btn>
            <Btn title="다시 실행" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}><Redo2 className="w-4 h-4" /></Btn>
            <Divider />
            <ParagraphStyle editor={editor} />
            <SelectMenu label="글자 크기" current={fsLabel} items={FONT_SIZES}
                onPick={(v) => v ? editor.chain().focus().setFontSize(v).run() : editor.chain().focus().unsetFontSize().run()} />
            <SelectMenu label="글꼴" current={ffLabel} items={FONT_FAMILIES}
                onPick={(v) => v ? editor.chain().focus().setFontFamily(v).run() : editor.chain().focus().unsetFontFamily().run()} />
            <SelectMenu label="줄 간격" current={lhLabel} items={LINE_HEIGHTS}
                onPick={(v) => editor.chain().focus().setLineHeight(v).run()} />
            <Divider />
            <Btn title="굵게" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="w-4 h-4" /></Btn>
            <Btn title="기울임" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="w-4 h-4" /></Btn>
            <Btn title="밑줄" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon className="w-4 h-4" /></Btn>
            <Btn title="취소선" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough className="w-4 h-4" /></Btn>
            <ColorMenu editor={editor} />
            <HighlightMenu editor={editor} />
            <Divider />
            <Btn title="글머리 목록" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="w-4 h-4" /></Btn>
            <Btn title="번호 목록" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="w-4 h-4" /></Btn>
            <Btn title="체크리스트" active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()}><ListChecks className="w-4 h-4" /></Btn>
            <Divider />
            <Btn title="왼쪽 정렬" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}><AlignLeft className="w-4 h-4" /></Btn>
            <Btn title="가운데 정렬" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}><AlignCenter className="w-4 h-4" /></Btn>
            <Btn title="오른쪽 정렬" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}><AlignRight className="w-4 h-4" /></Btn>
            <Divider />
            <Btn title="인용" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote className="w-4 h-4" /></Btn>
            <Btn title="코드 블록" active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><Code2 className="w-4 h-4" /></Btn>
            <LinkPopover editor={editor} onConvertCard={onInsertLinkCard} />
            <Divider />
            <InsertMenu editor={editor} onPickImage={onPickImage} onInsertLinkCard={onInsertLinkCard} />
        </div>
    );
}

// 이미지 선택 시 컨텍스트 툴바
export function ImageToolbar({ editor }: { editor: Editor }) {
    const curAlign = (editor.getAttributes("image").align as string) || "center";
    const curWidth = (editor.getAttributes("image").width as string | null) || null;
    const setAlign = (align: string) => editor.chain().focus().updateAttributes("image", { align }).run();
    const setWidth = (width: string | null) => editor.chain().focus().updateAttributes("image", { width }).run();
    const sizeBtn = (label: string, w: string | null) => (
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setWidth(w)}
            className={`px-2 h-7 rounded-md text-xs font-medium shrink-0 ${curWidth === w ? "bg-rose-100 text-rose-600" : "text-gray-600 hover:bg-gray-100"}`}>{label}</button>
    );
    return (
        <div className="flex flex-nowrap items-center gap-1 px-2 py-1.5 border-b border-gray-200 bg-rose-50/60 overflow-x-auto">
            <span className="text-[11px] font-semibold text-rose-500 mr-1 shrink-0">이미지</span>
            <Btn title="왼쪽" active={curAlign === "left"} onClick={() => setAlign("left")}><AlignLeft className="w-4 h-4" /></Btn>
            <Btn title="가운데" active={curAlign === "center"} onClick={() => setAlign("center")}><AlignCenter className="w-4 h-4" /></Btn>
            <Btn title="오른쪽" active={curAlign === "right"} onClick={() => setAlign("right")}><AlignRight className="w-4 h-4" /></Btn>
            <Divider />
            {sizeBtn("작게", "33%")}{sizeBtn("보통", "60%")}{sizeBtn("크게", "100%")}{sizeBtn("원본", null)}
            <Divider />
            <Btn title="이미지 삭제" onClick={() => editor.chain().focus().deleteSelection().run()}><Trash2 className="w-4 h-4" /></Btn>
        </div>
    );
}

// 표 안에 있을 때 컨텍스트 툴바
export function TableToolbar({ editor }: { editor: Editor }) {
    return (
        <div className="flex flex-nowrap items-center gap-1 px-2 py-1.5 border-b border-gray-200 bg-blue-50/60 overflow-x-auto">
            <span className="text-[11px] font-semibold text-blue-500 mr-1 shrink-0">표</span>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().addRowAfter().run()}
                className="flex items-center gap-1 px-2 h-7 rounded-md text-xs text-gray-600 hover:bg-gray-100 shrink-0"><Rows3 className="w-3.5 h-3.5" /> 행 추가</button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().deleteRow().run()}
                className="px-2 h-7 rounded-md text-xs text-gray-600 hover:bg-gray-100 shrink-0">행 삭제</button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().addColumnAfter().run()}
                className="flex items-center gap-1 px-2 h-7 rounded-md text-xs text-gray-600 hover:bg-gray-100 shrink-0"><Columns3 className="w-3.5 h-3.5" /> 열 추가</button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().deleteColumn().run()}
                className="px-2 h-7 rounded-md text-xs text-gray-600 hover:bg-gray-100 shrink-0">열 삭제</button>
            <Divider />
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().deleteTable().run()}
                className="px-2 h-7 rounded-md text-xs text-rose-600 hover:bg-rose-50 shrink-0">표 삭제</button>
        </div>
    );
}
