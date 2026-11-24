import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import api from "@/lib/api";
import { useBlobUrl } from "@/hooks/useBlobUrl";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wrench, Send, Loader2, MessageSquareWarning, CornerDownRight, Megaphone, ImagePlus, X } from "lucide-react";
import { useDevFeedbackList, useSendDevFeedback, useReplyDevFeedback, type DevFeedbackEntry } from "@/hooks";
import { renderSafeHangul } from "@/components/SafeText";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { PatchNoteWriter } from "@/components/PatchNoteWriter";

const DEVELOPER_USERNAME = "adminyhk";
const MAX_IMAGES = 5;
const MAX_BYTES = 10 * 1024 * 1024;

/** 글 하나에 붙일 이미지 — 캡처 후 Ctrl+V 붙여넣기 또는 파일 선택. 전송은 글 저장 뒤 훅이 한다. */
function useImageDraft() {
    const [files, setFiles] = useState<File[]>([]);
    const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
    useEffect(() => () => previews.forEach(URL.revokeObjectURL), [previews]);

    const add = (list: File[]) => {
        const imgs = list.filter((f) => f.type.startsWith("image/"));
        if (!imgs.length) return false;
        if (imgs.some((f) => f.size > MAX_BYTES)) toast.error("10MB 넘는 이미지는 뺐어요");
        const ok = imgs.filter((f) => f.size <= MAX_BYTES);
        if (files.length + ok.length > MAX_IMAGES) toast.error(`이미지는 ${MAX_IMAGES}장까지 붙일 수 있어요`);
        setFiles((prev) => [...prev, ...ok].slice(0, MAX_IMAGES));
        return true;
    };
    // 클립보드에 이미지가 있으면 그걸 붙이고, 글자만 있으면 평소처럼 붙여넣기
    const onPaste = (e: React.ClipboardEvent) => {
        if (add(Array.from(e.clipboardData.files))) e.preventDefault();
    };
    const remove = (i: number) => setFiles((prev) => prev.filter((_, j) => j !== i));
    return { files, previews, add, onPaste, remove, clear: () => setFiles([]) };
}

function ImageDraftRow({ draft }: { draft: ReturnType<typeof useImageDraft> }) {
    return (
        <div className="flex flex-wrap items-center gap-2">
            {draft.previews.map((src, i) => (
                <div key={src} className="relative w-16 h-16 shrink-0">
                    <img src={src} alt={`첨부 ${i + 1}`} className="w-full h-full rounded-lg object-cover border border-[var(--color-border)]" />
                    <button
                        type="button"
                        onClick={() => draft.remove(i)}
                        aria-label="이미지 빼기"
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-900/80 text-white flex items-center justify-center"
                    >
                        <X className="w-3 h-3" />
                    </button>
                </div>
            ))}
            {draft.files.length < MAX_IMAGES && (
                <label className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] cursor-pointer hover:text-[var(--color-text-secondary)]">
                    <ImagePlus className="w-4 h-4" />
                    이미지 추가 <span className="hidden md:inline">(캡처 후 Ctrl+V로 붙여넣기도 돼요)</span>
                    <input type="file" accept="image/*" multiple className="hidden"
                        onChange={(e) => { draft.add(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
                </label>
            )}
        </div>
    );
}

function FeedbackImage({ id, onOpen }: { id: number; onOpen: (url: string) => void }) {
    const url = useBlobUrl(api, `/dev-feedback/images/${id}`);
    return (
        <button
            type="button"
            onClick={() => url && onOpen(url)}
            className="w-20 h-20 shrink-0 rounded-lg overflow-hidden border border-[var(--color-border)] bg-gray-100"
        >
            {url && <img src={url} alt="첨부 이미지" className="w-full h-full object-cover" />}
        </button>
    );
}

function FeedbackImages({ images }: { images?: { id: number }[] }) {
    const [viewing, setViewing] = useState<string | null>(null);
    if (!images?.length) return null;
    return (
        <>
            <div className="flex flex-wrap gap-2 mt-1.5">
                {images.map((im) => <FeedbackImage key={im.id} id={im.id} onOpen={setViewing} />)}
            </div>
            {viewing && createPortal(
                <div className="fixed inset-0 z-[100] bg-black/85 flex items-center justify-center p-4" onClick={() => setViewing(null)}>
                    <img src={viewing} alt="첨부 이미지" className="max-w-full max-h-full object-contain" />
                    <button type="button" aria-label="닫기" className="absolute top-4 right-4 text-white">
                        <X className="w-6 h-6" />
                    </button>
                </div>,
                document.body,
            )}
        </>
    );
}

function ReplyBox({ entry }: { entry: DevFeedbackEntry }) {
    const [text, setText] = useState("");
    const draft = useImageDraft();
    const { mutate: reply, isPending } = useReplyDevFeedback();

    const submit = () => {
        const trimmed = text.trim();
        if (!trimmed) return;
        reply({ id: entry.id, reply: trimmed, files: draft.files }, { onSuccess: () => { setText(""); draft.clear(); } });
    };

    return (
        <div className="mt-2 pl-4 border-l-2 border-[var(--color-border)] space-y-2">
            <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onPaste={draft.onPaste}
                placeholder="이어서 쓰기... (요청자·운영진·💢 모두 가능)"
                rows={2}
                maxLength={2000}
                className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--color-border)] bg-white text-[var(--color-text-primary)] text-sm resize-y focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30"
            />
            <div className="flex items-start justify-between gap-2">
                <ImageDraftRow draft={draft} />
                <Button size="sm" className="shrink-0" onClick={submit} disabled={isPending || !text.trim()}>
                    {isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                    {entry.replies.length > 0 ? "이어서 쓰기" : "글 남기기"}
                </Button>
            </div>
        </div>
    );
}

function relTime(iso: string) {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "방금";
    if (s < 3600) return `${Math.floor(s / 60)}분 전`;
    if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
    return `${Math.floor(s / 86400)}일 전`;
}

export default function DevFeedback() {
    const [message, setMessage] = useState("");
    const draft = useImageDraft();
    const [writerOpen, setWriterOpen] = useState(false);
    const { user } = useAuth();
    const isDeveloper = user?.username === DEVELOPER_USERNAME;
    const { data: entries, isLoading } = useDevFeedbackList();
    const { mutate: send, isPending } = useSendDevFeedback();

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = message.trim();
        if (!trimmed) return;
        send({ message: trimmed, files: draft.files }, { onSuccess: () => { setMessage(""); draft.clear(); } });
    };

    return (
        <div className="flex flex-col h-full">
            <PageHeader
                title="버그 제보 · 기능 요청"
                subtitle="버그나 신기능 요청하시면 시간 남을 때 고쳐드림"
                actions={isDeveloper ? (
                    <Button variant="outline" onClick={() => setWriterOpen(true)}>
                        <Megaphone className="w-4 h-4 mr-2" />
                        패치노트 쓰기
                    </Button>
                ) : undefined}
            />
            {isDeveloper && <PatchNoteWriter open={writerOpen} onOpenChange={setWriterOpen} />}
            <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4 max-w-2xl">
                <Card className="bg-[var(--color-surface)] border-[var(--color-border)]">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Wrench className="w-4 h-4 text-[var(--color-accent)]" />
                            버그 제보 / 신기능 요청
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit} className="space-y-3">
                            <textarea
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                onPaste={draft.onPaste}
                                placeholder="예: 출석 탭에서 버튼 누르면 튕겨요 / 이런 기능 있었으면 좋겠어요..."
                                rows={4}
                                maxLength={2000}
                                required
                                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white text-[var(--color-text-primary)] text-sm resize-y focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30"
                            />
                            <div className="flex items-start justify-between gap-2">
                                <ImageDraftRow draft={draft} />
                                <Button type="submit" className="shrink-0" disabled={isPending || !message.trim()}>
                                    {isPending ? (
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    ) : (
                                        <Send className="w-4 h-4 mr-2" />
                                    )}
                                    {isPending ? "요청하는 중..." : "요청하기"}
                                </Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>

                <Card className="bg-[var(--color-surface)] border-[var(--color-border)]">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <MessageSquareWarning className="w-4 h-4 text-[var(--color-text-muted)]" />
                            최근 요청 {isDeveloper ? "(전체 기수)" : "(우리 기수만)"}
                        </CardTitle>
                        <CardDescription>같은 걸 또 보내기 전에 한 번 확인해보세요.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {isLoading ? (
                            <p className="text-sm text-[var(--color-text-muted)]">불러오는 중...</p>
                        ) : !entries || entries.length === 0 ? (
                            <p className="text-sm text-[var(--color-text-muted)]">아직 요청이 없습니다.</p>
                        ) : (
                            entries.map((e) => (
                                <div key={e.id} className="border-b border-[var(--color-border-subtle)] pb-3 last:border-0 last:pb-0">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-xs font-medium text-[var(--color-text-secondary)]">{e.reporter_display_name}</span>
                                        <span className="text-[11px] text-[var(--color-text-muted)]">{relTime(e.created_at)}</span>
                                    </div>
                                    <p className="text-sm text-[var(--color-text-primary)] whitespace-pre-wrap [word-break:keep-all]">
                                        {renderSafeHangul(e.message)}
                                    </p>
                                    <FeedbackImages images={e.images} />
                                    {e.replies.map((r) => {
                                        const mine = !!user && r.author_username === user.username;
                                        return (
                                            <div
                                                key={r.id}
                                                className={cn(
                                                    "mt-2 pl-4 border-l-2",
                                                    r.is_developer ? "border-[var(--color-accent)]/40"
                                                        : mine ? "border-sky-400/50" : "border-gray-300",
                                                )}
                                            >
                                                <div className="flex items-start gap-1.5">
                                                    <CornerDownRight className={cn(
                                                        "w-3.5 h-3.5 shrink-0 mt-0.5",
                                                        r.is_developer ? "text-[var(--color-accent)]" : mine ? "text-sky-500" : "text-gray-400",
                                                    )} />
                                                    <div className="min-w-0">
                                                        <span className={cn(
                                                            r.is_developer ? "text-base leading-none" : "text-[11px] font-bold",  // 💢는 이모지라 11px면 안 보인다
                                                            r.is_developer ? "text-[var(--color-accent)]" : mine ? "text-sky-600" : "text-gray-500",
                                                        )}>
                                                            {r.author_display_name || r.author_username}{mine && !r.is_developer ? " (나)" : ""}
                                                        </span>
                                                        <p className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap [word-break:keep-all]">
                                                            {renderSafeHangul(r.reply)}
                                                        </p>
                                                        <FeedbackImages images={r.images} />
                                                    </div>
                                                </div>
                                                <p className="text-[10px] text-[var(--color-text-muted)] pl-5">{relTime(r.created_at)}</p>
                                            </div>
                                        );
                                    })}
                                    {/* 개발자·요청자·같은 기수 운영진 모두 이어서 쓸 수 있다 */}
                                    <ReplyBox entry={e} />
                                </div>
                            ))
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
