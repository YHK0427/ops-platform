import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import {
    Bold, Italic, Underline as UnderlineIcon, Strikethrough, Type, Highlighter,
    List, ListOrdered, ListChecks, Quote, Code2, Minus, Link2, Link2Off,
    AlignLeft, AlignCenter, AlignRight, Undo2, Redo2, ChevronDown,
    Image as ImageIcon, Table as TableIcon, Youtube as YoutubeIcon, Bookmark, Link as LinkIcon, ExternalLink, Trash2,
    Rows3, Columns3, ALargeSmall, CaseSensitive, AlignVerticalSpaceAround, Paperclip, Pilcrow,
} from "lucide-react";
import { FONT_SIZES, FONT_SIZE_DEFAULT, FONT_FAMILIES, LINE_HEIGHTS, BLOCKQUOTE_VARIANTS } from "./extensions";

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

// 드롭다운/팝오버 — 툴바의 overflow 박스에 갇혀 잘리지 않도록 body 포털 + fixed 위치.
function Popover({ trigger, children, width }: { trigger: React.ReactNode; children: (close: () => void) => React.ReactNode; width?: string }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

    const toggle = () => {
        if (!open && ref.current) {
            const r = ref.current.getBoundingClientRect();
            setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 240)) });
        }
        setOpen((v) => !v);
    };

    return (
        <div className="shrink-0" ref={ref}>
            <div onMouseDown={(e) => e.preventDefault()} onClick={toggle}>{trigger}</div>
            {open && createPortal(
                <>
                    <div className="fixed inset-0 z-[60]" onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(false)} />
                    <div
                        className={`fixed z-[61] bg-white rounded-lg shadow-xl border border-gray-200 p-1.5 max-h-[60vh] overflow-y-auto ${width ?? ""}`}
                        style={{ top: pos.top, left: pos.left }}
                        onMouseDown={(e) => e.preventDefault()}
                    >
                        {children(() => setOpen(false))}
                    </div>
                </>,
                document.body,
            )}
        </div>
    );
}

// 텍스트 드롭다운 (문단스타일/글자크기/줄간격/글꼴 공용)
function SelectMenu({ label, items, current, onPick, minW, icon }: {
    label: string; items: { label: string; value: string }[]; current: string; onPick: (v: string) => void; minW?: string; icon?: React.ReactNode;
}) {
    return (
        <Popover width="min-w-[130px]" trigger={
            <button type="button" title={label}
                className={`flex items-center gap-1 h-8 px-2 shrink-0 rounded-md text-xs font-medium text-gray-700 hover:bg-gray-100 ${minW ?? ""}`}>
                {icon && <span className="text-gray-500 shrink-0">{icon}</span>}
                <span className="truncate">{current}</span>
                <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" />
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
    return <SelectMenu label="문단 스타일" current={current} minW="min-w-[64px]" icon={<Pilcrow className="w-4 h-4" />}
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

function QuoteMenu({ editor }: { editor: Editor }) {
    const active = editor.isActive("blockquote");
    const cur = (editor.getAttributes("blockquote").variant as string) || "line";
    const setQuote = (variant: string) => {
        const c = editor.chain().focus();
        if (!editor.isActive("blockquote")) c.toggleBlockquote();
        c.updateAttributes("blockquote", { variant }).run();
    };
    return (
        <Popover width="w-40" trigger={<Btn title="인용구" active={active} onClick={() => {}}><Quote className="w-4 h-4" /></Btn>}>
            {(close) => (
                <div className="flex flex-col">
                    {BLOCKQUOTE_VARIANTS.map((v) => (
                        <button key={v.value} type="button" onMouseDown={(e) => e.preventDefault()}
                            onClick={() => { setQuote(v.value); close(); }}
                            className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left hover:bg-rose-50 ${active && cur === v.value ? "text-rose-600 font-semibold" : "text-gray-700"}`}>
                            <span className={`qv-swatch qv-${v.value}`} />
                            {v.label}
                        </button>
                    ))}
                    {active && (
                        <button type="button" onMouseDown={(e) => e.preventDefault()}
                            onClick={() => { editor.chain().focus().toggleBlockquote().run(); close(); }}
                            className="px-3 py-2 mt-0.5 border-t border-gray-100 rounded-md text-sm text-left text-gray-500 hover:bg-gray-50">
                            인용 해제
                        </button>
                    )}
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

// URL 입력 팝오버 (유튜브/링크카드 삽입용)
function UrlPopover({ title, icon, placeholder, onSubmit }: {
    title: string; icon: React.ReactNode; placeholder: string; onSubmit: (url: string) => void;
}) {
    const [url, setUrl] = useState("");
    return (
        <Popover width="w-60" trigger={<Btn title={title} onClick={() => setUrl("")}>{icon}</Btn>}>
            {(close) => (
                <div className="flex flex-col gap-2">
                    <p className="text-xs font-semibold text-gray-600 px-1">{title}</p>
                    <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder={placeholder}
                        className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-rose-400" />
                    <button type="button" onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { if (url.trim()) onSubmit(url.trim()); close(); }}
                        className="px-2 py-1.5 rounded-md text-xs font-semibold bg-rose-500 text-white hover:bg-rose-600">삽입</button>
                </div>
            )}
        </Popover>
    );
}

export function MainToolbar({ editor, onPickImage, onPickFile, onInsertLinkCard }: {
    editor: Editor; onPickImage: () => void; onPickFile: () => void; onInsertLinkCard: (url: string) => void;
}) {
    const fontSize = (editor.getAttributes("textStyle").fontSize as string) || "";
    const fontFamily = (editor.getAttributes("textStyle").fontFamily as string) || "";
    const lineHeight = (editor.getAttributes("paragraph").lineHeight as string) || (editor.getAttributes("heading").lineHeight as string) || "1.7";
    const fsLabel = FONT_SIZES.find((f) => f.value === fontSize)?.label || FONT_SIZE_DEFAULT;
    const ffLabel = FONT_FAMILIES.find((f) => f.value === fontFamily)?.label || "기본";
    const lhLabel = LINE_HEIGHTS.find((f) => f.value === lineHeight)?.label || "기본";

    // 정렬 — 이미지/링크카드/파일 첨부가 선택돼 있으면 그 블록의 align 속성을, 아니면 텍스트 정렬.
    const alignNode = ["image", "linkCard", "fileAttachment"].find((n) => editor.isActive(n));
    const applyAlign = (a: string) =>
        alignNode ? editor.chain().focus().updateAttributes(alignNode, { align: a }).run()
            : editor.chain().focus().setTextAlign(a).run();
    const alignActive = (a: string) =>
        alignNode ? editor.getAttributes(alignNode).align === a : editor.isActive({ textAlign: a });

    return (
        <div className="flex flex-nowrap md:flex-wrap items-center gap-0.5 p-2 border-b border-gray-200 bg-gray-50 overflow-x-auto">
            <Btn title="실행 취소" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}><Undo2 className="w-4 h-4" /></Btn>
            <Btn title="다시 실행" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}><Redo2 className="w-4 h-4" /></Btn>
            <Divider />
            <ParagraphStyle editor={editor} />
            <SelectMenu label="글자 크기" current={fsLabel} items={FONT_SIZES} icon={<ALargeSmall className="w-4 h-4" />}
                onPick={(v) => v ? editor.chain().focus().setFontSize(v).run() : editor.chain().focus().unsetFontSize().run()} />
            <SelectMenu label="글꼴" current={ffLabel} items={FONT_FAMILIES} icon={<CaseSensitive className="w-4 h-4" />}
                onPick={(v) => v ? editor.chain().focus().setFontFamily(v).run() : editor.chain().focus().unsetFontFamily().run()} />
            <SelectMenu label="줄 간격" current={lhLabel} items={LINE_HEIGHTS} icon={<AlignVerticalSpaceAround className="w-4 h-4" />}
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
            <Btn title="왼쪽 정렬" active={alignActive("left")} onClick={() => applyAlign("left")}><AlignLeft className="w-4 h-4" /></Btn>
            <Btn title="가운데 정렬" active={alignActive("center")} onClick={() => applyAlign("center")}><AlignCenter className="w-4 h-4" /></Btn>
            <Btn title="오른쪽 정렬" active={alignActive("right")} onClick={() => applyAlign("right")}><AlignRight className="w-4 h-4" /></Btn>
            <Divider />
            <QuoteMenu editor={editor} />
            <Btn title="코드 블록" active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><Code2 className="w-4 h-4" /></Btn>
            <Btn title="구분선" onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus className="w-4 h-4" /></Btn>
            <LinkPopover editor={editor} onConvertCard={onInsertLinkCard} />
            <Divider />
            {/* 삽입 — 드롭다운 없이 직접 버튼 */}
            <Btn title="이미지" onClick={onPickImage}><ImageIcon className="w-4 h-4" /></Btn>
            <Btn title="파일 첨부" onClick={onPickFile}><Paperclip className="w-4 h-4" /></Btn>
            <Btn title="표" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon className="w-4 h-4" /></Btn>
            <UrlPopover title="유튜브 동영상" icon={<YoutubeIcon className="w-4 h-4" />} placeholder="유튜브 URL"
                onSubmit={(url) => editor.commands.setYoutubeVideo({ src: url })} />
            <UrlPopover title="링크 카드" icon={<Bookmark className="w-4 h-4" />} placeholder="링크 URL"
                onSubmit={(url) => onInsertLinkCard(url)} />
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
