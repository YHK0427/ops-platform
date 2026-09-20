import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Link as LinkIcon, X, FileText } from "lucide-react";
import { toast } from "sonner";
import { buildExtensions } from "./editor/extensions";
import { MainToolbar, ImageToolbar, TableToolbar } from "./editor/Toolbar";
import type { LinkCardData } from "./editor/LinkCardView";
import type { FileData } from "./editor/FileAttachmentView";
import "./richtext.css";

interface Props {
    value: string;
    onChange: (html: string) => void;
    uploadImage: (file: File) => Promise<string>;
    uploadFile: (file: File) => Promise<FileData>;
    unfurlLink: (url: string) => Promise<LinkCardData>;
    /** PDF 를 페이지별 이미지 URL 로 변환. 넘기면 PDF 첨부 시 변환 여부를 물어본다. */
    pdfToImages?: (file: File) => Promise<string[]>;
    placeholder?: string;
}

const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
const isOfficeSlide = (f: File) => /\.pptx?$/i.test(f.name);

/** 클라이언트 측 이미지 리사이즈/압축 (max 1600px). */
async function compressImage(file: File): Promise<File> {
    if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
    try {
        const bitmap = await createImageBitmap(file);
        const MAX = 1600;
        const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
        if (scale >= 1 && file.size < 1.2 * 1024 * 1024) return file;
        const w = Math.round(bitmap.width * scale);
        const h = Math.round(bitmap.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return file;
        ctx.drawImage(bitmap, 0, 0, w, h);
        const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.85));
        if (!blob) return file;
        return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
    } catch {
        return file;
    }
}

export default function RichEditor({ value, onChange, uploadImage, uploadFile, unfurlLink, pdfToImages, placeholder }: Props) {
    const fileRef = useRef<HTMLInputElement>(null);
    const attachRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState<string | null>(null);
    // 붙여넣은 링크 옆에 뜨는 "카드로 바꾸기" 인라인 팝업
    const [linkPrompt, setLinkPrompt] = useState<{ x: number; y: number; url: string; from: number; to: number } | null>(null);
    const promptTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    // PDF 첨부 시 "이미지로 변환할까요?" 물어보는 대기열 (한 번에 하나씩)
    const [pdfQueue, setPdfQueue] = useState<File[]>([]);
    const [pdfOpts, setPdfOpts] = useState({ convert: true, attach: true });

    const editor = useEditor({
        extensions: buildExtensions(placeholder),
        content: value || "",
        onUpdate: ({ editor }) => onChange(editor.getHTML()),
        editorProps: {
            attributes: { class: "rich-content px-5 py-4 min-h-[45vh]" },
            handlePaste: (view, event) => {
                const files = Array.from(event.clipboardData?.files || []).filter((f) => f.type.startsWith("image/"));
                if (files.length > 0) {
                    event.preventDefault();
                    void uploadFiles(files);
                    return true;
                }
                // 단일 URL 붙여넣기 → 일반 링크로 넣고, 그 줄 옆에 "카드로 바꾸기" 인라인 팝업
                const text = (event.clipboardData?.getData("text/plain") || "").trim();
                if (editor && view.state.selection.empty && /^https?:\/\/[^\s]+$/.test(text)) {
                    event.preventDefault();
                    const from = view.state.selection.from;
                    editor.chain().focus().insertContent(text + " ").run();
                    const to = editor.state.selection.from;
                    const coords = view.coordsAtPos(Math.max(from, to - 1));
                    setLinkPrompt({ x: coords.left, y: coords.bottom, url: text, from, to });
                    clearTimeout(promptTimer.current);
                    promptTimer.current = setTimeout(() => setLinkPrompt(null), 8000);
                    return true;
                }
                return false;
            },
            handleDrop: (_view, event) => {
                const dt = (event as DragEvent).dataTransfer;
                const all = Array.from(dt?.files || []);
                if (all.length === 0) return false;
                event.preventDefault();
                const images = all.filter((f) => f.type.startsWith("image/"));
                const others = all.filter((f) => !f.type.startsWith("image/"));
                if (images.length) void uploadFiles(images);
                // 드래그로 넣은 파일도 파일 버튼과 똑같이 처리해야 PDF 변환을 물어본다
                if (others.length) void routeAttachments(others);
                return true;
            },
        },
    });

    // Tiptap v3는 성능상 트랜잭션마다 리렌더하지 않음 → 커서 이동만으로는 툴바 상태가 안 바뀜.
    // selection/transaction 구독해 강제 리렌더(툴바가 커서 위치 서식을 즉시 반영).
    const [, forceTick] = useState(0);
    useEffect(() => {
        if (!editor) return;
        const rerender = () => forceTick((t) => t + 1);
        editor.on("selectionUpdate", rerender);
        editor.on("transaction", rerender);
        return () => {
            editor.off("selectionUpdate", rerender);
            editor.off("transaction", rerender);
        };
    }, [editor]);

    async function uploadFiles(files: File[]) {
        if (!editor) return;
        setBusy("이미지 업로드 중…");
        try {
            for (const file of files) {
                const compressed = await compressImage(file);
                const url = await uploadImage(compressed);
                // focus("end"): 직전에 넣은 이미지가 선택돼 있으면 새 이미지가 그걸 교체한다
                editor.chain().focus("end").setImage({ src: url }).run();
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "이미지 업로드 실패");
        } finally {
            setBusy(null);
        }
    }

    async function uploadAttachments(files: File[]) {
        if (!editor) return;
        setBusy("파일 업로드 중…");
        try {
            for (const file of files) {
                const data = await uploadFile(file);
                editor.chain().focus("end").setFileAttachment(data).run();
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "파일 업로드 실패");
        } finally {
            setBusy(null);
        }
    }

    async function handleFiles(files: FileList | null) {
        if (!files || files.length === 0) return;
        await uploadFiles(Array.from(files));
        if (fileRef.current) fileRef.current.value = "";
    }

    /** 첨부 파일 분류 — PDF 는 변환 여부를 묻고, 나머지는 바로 올린다.
     *  파일 버튼과 드래그앤드롭이 같은 길을 타야 한쪽만 동작하는 일이 없다. */
    async function routeAttachments(all: File[]) {
        if (all.some(isOfficeSlide)) {
            // PPT 는 서버에서 변환하면 글꼴이 치환돼 레이아웃이 깨진다 — 첨부만 하고 안내한다
            toast.info("PPT는 이미지로 변환할 수 없어요. PowerPoint에서 'PDF로 저장' 후 올리면 페이지별 이미지로 넣을 수 있어요.");
        }
        const pdfs = pdfToImages ? all.filter(isPdf) : [];
        const rest = all.filter((f) => !pdfs.includes(f));
        if (rest.length) await uploadAttachments(rest);
        if (pdfs.length) setPdfQueue(pdfs);
    }

    async function handleAttachFiles(files: FileList | null) {
        if (!files || files.length === 0) return;
        await routeAttachments(Array.from(files));
        if (attachRef.current) attachRef.current.value = "";
    }

    /** PDF 물음표 대화상자 확정 — 변환/원본첨부 선택대로 처리하고 다음 PDF 로 넘어간다 */
    async function resolvePdf() {
        const file = pdfQueue[0];
        if (!file || !editor) return;
        setPdfQueue((q) => q.slice(1));
        const { convert, attach } = pdfOpts;
        if (!convert && !attach) return;
        setBusy(convert ? "PDF 변환 중… (페이지가 많으면 시간이 걸려요)" : "파일 업로드 중…");
        try {
            if (convert && pdfToImages) {
                // 한 번에 넣는다. 한 장씩 setImage 하면 방금 넣은 이미지가 '선택' 상태로
                // 남아서 다음 삽입이 그 노드를 교체해버린다(결국 마지막 1장만 남음).
                const urls = await pdfToImages(file);
                editor.chain().focus().insertContent(
                    urls.map((src) => ({ type: "image", attrs: { src } })),
                ).run();
            }
            if (attach) {
                // 위와 같은 이유 — 커서를 끝으로 보내 마지막 이미지를 덮어쓰지 않게 한다
                editor.chain().focus("end").setFileAttachment(await uploadFile(file)).run();
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "PDF 처리 실패");
        } finally {
            setBusy(null);
        }
    }

    function convertLinkPrompt() {
        if (!linkPrompt || !editor) return;
        const { url, from, to } = linkPrompt;
        setLinkPrompt(null);
        clearTimeout(promptTimer.current);
        try { editor.chain().focus().deleteRange({ from, to }).run(); } catch { /* noop */ }
        void insertLinkCard(url);
    }

    async function insertLinkCard(url: string) {
        if (!editor) return;
        const clean = url.trim();
        if (!/^https?:\/\//i.test(clean)) { toast.error("http(s) 링크만 카드로 만들 수 있어요"); return; }
        setBusy("링크 정보를 불러오는 중…");
        try {
            const data = await unfurlLink(clean);
            editor.chain().focus().setLinkCard(data).run();
        } catch {
            // 실패해도 최소 카드(도메인만) 삽입
            let site = clean;
            try { site = new URL(clean).hostname; } catch { /* noop */ }
            editor.chain().focus().setLinkCard({ url: clean, title: clean, site }).run();
        } finally {
            setBusy(null);
        }
    }

    if (!editor) return null;

    const imageSelected = editor.isActive("image");
    const tableActive = editor.isActive("table");

    return (
        <div className="border border-gray-300 rounded-xl bg-white overflow-hidden flex flex-col">
            <div className="sticky top-0 z-10">
                <MainToolbar editor={editor} onPickImage={() => fileRef.current?.click()} onPickFile={() => attachRef.current?.click()} onInsertLinkCard={insertLinkCard} />
                {imageSelected && <ImageToolbar editor={editor} />}
                {tableActive && !imageSelected && <TableToolbar editor={editor} />}
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden"
                onChange={(e) => handleFiles(e.target.files)} />
            <input ref={attachRef} type="file" className="hidden" onChange={(e) => handleAttachFiles(e.target.files)} />
            <div className="relative flex-1 overflow-y-auto">
                <EditorContent editor={editor} />
                {busy && (
                    <div className="absolute inset-0 bg-white/60 grid place-items-center text-sm text-gray-500">{busy}</div>
                )}
            </div>
            {linkPrompt && (
                <div className="fixed z-[70] flex items-center gap-1 px-1.5 py-1 rounded-lg bg-gray-900 text-white shadow-xl"
                    style={{ left: Math.min(linkPrompt.x, window.innerWidth - 180), top: linkPrompt.y + 6 }}>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={convertLinkPrompt}
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold hover:bg-white/15">
                        <LinkIcon className="w-3.5 h-3.5" /> 링크 카드로
                    </button>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setLinkPrompt(null)}
                        className="px-1 py-1 rounded-md text-white/60 hover:text-white hover:bg-white/15"><X className="w-3.5 h-3.5" /></button>
                </div>
            )}
            {pdfQueue.length > 0 && (
                <div className="fixed inset-0 z-[80] bg-black/40 grid place-items-center p-4">
                    <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
                        <div className="flex items-center gap-2 font-bold">
                            <FileText className="w-4 h-4 text-[var(--color-accent)]" />
                            PDF를 어떻게 넣을까요?
                        </div>
                        <div className="mt-1 text-sm text-gray-500 truncate">{pdfQueue[0].name}</div>
                        <div className="mt-4 space-y-2">
                            <label className="flex items-start gap-2 text-sm cursor-pointer">
                                <input type="checkbox" className="mt-0.5" checked={pdfOpts.convert}
                                    onChange={(e) => setPdfOpts((o) => ({ ...o, convert: e.target.checked }))} />
                                <span>
                                    <b>페이지를 이미지로 변환해서 본문에 넣기</b>
                                    <span className="block text-gray-500">앱에서 바로 넘겨볼 수 있어요. 최대 100페이지.</span>
                                </span>
                            </label>
                            <label className="flex items-start gap-2 text-sm cursor-pointer">
                                <input type="checkbox" className="mt-0.5" checked={pdfOpts.attach}
                                    onChange={(e) => setPdfOpts((o) => ({ ...o, attach: e.target.checked }))} />
                                <span>
                                    <b>원본 PDF도 첨부하기</b>
                                    <span className="block text-gray-500">받아서 인쇄하거나 확대해 볼 수 있어요.</span>
                                </span>
                            </label>
                        </div>
                        <div className="mt-5 flex justify-end gap-2">
                            <button type="button" onClick={() => setPdfQueue((q) => q.slice(1))}
                                className="px-3 py-1.5 rounded-lg text-sm text-gray-500 hover:bg-gray-100">취소</button>
                            <button type="button" onClick={resolvePdf} disabled={!pdfOpts.convert && !pdfOpts.attach}
                                className="px-3 py-1.5 rounded-lg text-sm font-bold text-white bg-[var(--color-accent)] disabled:opacity-40">
                                넣기
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
