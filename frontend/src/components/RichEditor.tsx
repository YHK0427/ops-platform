import { useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { toast } from "sonner";
import { buildExtensions } from "./editor/extensions";
import { MainToolbar, ImageToolbar, TableToolbar } from "./editor/Toolbar";
import { BubbleToolbar } from "./editor/BubbleToolbar";
import type { LinkCardData } from "./editor/LinkCardView";
import "./richtext.css";

interface Props {
    value: string;
    onChange: (html: string) => void;
    uploadImage: (file: File) => Promise<string>;
    unfurlLink: (url: string) => Promise<LinkCardData>;
    placeholder?: string;
}

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

export default function RichEditor({ value, onChange, uploadImage, unfurlLink, placeholder }: Props) {
    const fileRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState<string | null>(null);

    const editor = useEditor({
        extensions: buildExtensions(placeholder),
        content: value || "",
        onUpdate: ({ editor }) => onChange(editor.getHTML()),
        editorProps: {
            attributes: { class: "rich-content px-5 py-4 min-h-[45vh]" },
            handlePaste: (_view, event) => {
                const files = Array.from(event.clipboardData?.files || []).filter((f) => f.type.startsWith("image/"));
                if (files.length === 0) return false;
                event.preventDefault();
                void uploadFiles(files);
                return true;
            },
            handleDrop: (_view, event) => {
                const dt = (event as DragEvent).dataTransfer;
                const files = Array.from(dt?.files || []).filter((f) => f.type.startsWith("image/"));
                if (files.length === 0) return false;
                event.preventDefault();
                void uploadFiles(files);
                return true;
            },
        },
    });

    async function uploadFiles(files: File[]) {
        if (!editor) return;
        setBusy("이미지 업로드 중…");
        try {
            for (const file of files) {
                const compressed = await compressImage(file);
                const url = await uploadImage(compressed);
                editor.chain().focus().setImage({ src: url }).run();
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "이미지 업로드 실패");
        } finally {
            setBusy(null);
        }
    }

    async function handleFiles(files: FileList | null) {
        if (!files || files.length === 0) return;
        await uploadFiles(Array.from(files));
        if (fileRef.current) fileRef.current.value = "";
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
                <MainToolbar editor={editor} onPickImage={() => fileRef.current?.click()} onInsertLinkCard={insertLinkCard} />
                {imageSelected && <ImageToolbar editor={editor} />}
                {tableActive && !imageSelected && <TableToolbar editor={editor} />}
            </div>
            <BubbleToolbar editor={editor} />
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden"
                onChange={(e) => handleFiles(e.target.files)} />
            <div className="relative flex-1 overflow-y-auto">
                <EditorContent editor={editor} />
                {busy && (
                    <div className="absolute inset-0 bg-white/60 grid place-items-center text-sm text-gray-500">{busy}</div>
                )}
            </div>
        </div>
    );
}
