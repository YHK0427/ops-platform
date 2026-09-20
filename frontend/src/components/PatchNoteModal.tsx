import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { useUnseenPatchNotes, useMarkPatchNotesSeen } from "@/hooks/usePatchNotes";

/**
 * 마지막으로 '확인' 누른 시점 이후에 올라온 패치노트를 접속 시 한 번 띄운다.
 * 운영진 사이트(staff)와 기수 포털(member)이 각자 다른 노트를 본다.
 */
export function PatchNoteModal({ side }: { side: "staff" | "member" }) {
    const { data } = useUnseenPatchNotes(side);
    const { mutate: markSeen } = useMarkPatchNotesSeen(side);
    const [open, setOpen] = useState(false);

    useEffect(() => { if (data && data.length > 0) setOpen(true); }, [data]);

    const close = () => { setOpen(false); markSeen(); };

    if (!data || data.length === 0) return null;

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
            <DialogContent className="max-w-lg min-w-0">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-[var(--color-accent)]" />
                        업데이트 안내
                    </DialogTitle>
                </DialogHeader>
                <div className="max-h-[60vh] overflow-y-auto space-y-4 pr-1">
                    {data.map((n) => (
                        <div key={n.id} className="rounded-xl border border-[var(--color-border)] bg-white p-3">
                            <div className="flex items-baseline justify-between gap-2">
                                <div className="font-bold text-sm">{n.title}</div>
                                <div className="text-[11px] text-[var(--color-text-muted)] shrink-0">
                                    {new Date(n.published_at).toLocaleDateString("ko-KR")}
                                </div>
                            </div>
                            <div className="mt-1.5 text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap leading-relaxed">
                                {n.body}
                            </div>
                        </div>
                    ))}
                </div>
                <div className="flex justify-end">
                    <Button onClick={close}>확인했어요</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
