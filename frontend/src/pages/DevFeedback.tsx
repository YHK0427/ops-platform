import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wrench, Send, Loader2, MessageSquareWarning, CornerDownRight, Megaphone } from "lucide-react";
import { useDevFeedbackList, useSendDevFeedback, useReplyDevFeedback, type DevFeedbackEntry } from "@/hooks";
import { renderSafeHangul } from "@/components/SafeText";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { PatchNoteWriter } from "@/components/PatchNoteWriter";

const DEVELOPER_USERNAME = "adminyhk";

function ReplyBox({ entry }: { entry: DevFeedbackEntry }) {
    const [text, setText] = useState("");
    const { mutate: reply, isPending } = useReplyDevFeedback();

    const submit = () => {
        const trimmed = text.trim();
        if (!trimmed) return;
        reply({ id: entry.id, reply: trimmed }, { onSuccess: () => setText("") });
    };

    return (
        <div className="mt-2 pl-4 border-l-2 border-[var(--color-border)] space-y-2">
            <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="이어서 쓰기... (요청자·운영진·개발자 모두 가능)"
                rows={2}
                maxLength={2000}
                className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--color-border)] bg-white text-[var(--color-text-primary)] text-sm resize-y focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30"
            />
            <div className="flex justify-end">
                <Button size="sm" onClick={submit} disabled={isPending || !text.trim()}>
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
    const [writerOpen, setWriterOpen] = useState(false);
    const { user } = useAuth();
    const isDeveloper = user?.username === DEVELOPER_USERNAME;
    const { data: entries, isLoading } = useDevFeedbackList();
    const { mutate: send, isPending } = useSendDevFeedback();

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = message.trim();
        if (!trimmed) return;
        send(trimmed, { onSuccess: () => setMessage("") });
    };

    return (
        <div className="flex flex-col h-full">
            <PageHeader
                title="개발자 호출"
                subtitle="버그든 뭐든 대충 적어두면 개발자가 기분 내키면 고쳐줌."
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
                            수정 요청 / 건의사항
                        </CardTitle>
                        <CardDescription>
                            그냥 대충 요청해도 됩니다.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit} className="space-y-3">
                            <textarea
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                placeholder="예: 출석 탭에서 버튼 누르면 튕겨요 / 이런 기능 있었으면 좋겠어요..."
                                rows={4}
                                maxLength={2000}
                                required
                                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white text-[var(--color-text-primary)] text-sm resize-y focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30"
                            />
                            <div className="flex justify-end">
                                <Button type="submit" disabled={isPending || !message.trim()}>
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
                                                            "text-[11px] font-bold",
                                                            r.is_developer ? "text-[var(--color-accent)]" : mine ? "text-sky-600" : "text-gray-500",
                                                        )}>
                                                            {r.author_display_name || r.author_username}{mine && !r.is_developer ? " (나)" : ""}
                                                        </span>
                                                        <p className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap [word-break:keep-all]">
                                                            {renderSafeHangul(r.reply)}
                                                        </p>
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
