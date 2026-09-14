import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wrench, Send, Loader2, MessageSquareWarning } from "lucide-react";
import { useDevFeedbackList, useSendDevFeedback } from "@/hooks";
import { renderSafeHangul } from "@/components/SafeText";

function relTime(iso: string) {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "방금";
    if (s < 3600) return `${Math.floor(s / 60)}분 전`;
    if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
    return `${Math.floor(s / 86400)}일 전`;
}

export default function DevFeedback() {
    const [message, setMessage] = useState("");
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
                subtitle="버그 발견? 이런 기능 있었으면 좋겠다? 여기다 적으면 개발자한테 바로 날아갑니다 (진지하게 받아들여집니다, 아마도)."
            />
            <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4 max-w-2xl">
                <Card className="bg-[var(--color-surface)] border-[var(--color-border)]">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Wrench className="w-4 h-4 text-[var(--color-accent)]" />
                            수정 요청 / 건의사항
                        </CardTitle>
                        <CardDescription>
                            보내는 즉시 개발자 텔레그램으로 알림이 갑니다. 장난식으로 편하게 적어도 됩니다.
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
                                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white text-sm resize-y focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30"
                            />
                            <div className="flex justify-end">
                                <Button type="submit" disabled={isPending || !message.trim()}>
                                    {isPending ? (
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    ) : (
                                        <Send className="w-4 h-4 mr-2" />
                                    )}
                                    {isPending ? "전송 중..." : "개발자한테 이르기"}
                                </Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>

                <Card className="bg-[var(--color-surface)] border-[var(--color-border)]">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <MessageSquareWarning className="w-4 h-4 text-[var(--color-text-muted)]" />
                            최근 요청 (우리 기수만)
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
                                </div>
                            ))
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
