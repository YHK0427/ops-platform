import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Trash2, Loader2, Megaphone } from "lucide-react";
import { toast } from "sonner";
import { useAllPatchNotes, useCreatePatchNote, useDeletePatchNote } from "@/hooks/usePatchNotes";

const AUDIENCES = [
    { key: "staff", label: "운영진 사이트" },
    { key: "member", label: "기수 포털" },
    { key: "all", label: "둘 다" },
] as const;

/** 개발자 전용 — 패치노트 작성/삭제. 작성 시점 이후에 접속하는 사람에게 모달로 뜬다. */
export function PatchNoteWriter({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
    const [audience, setAudience] = useState<string>("staff");
    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    const { data: notes } = useAllPatchNotes(open);
    const { mutate: create, isPending } = useCreatePatchNote();
    const { mutate: remove } = useDeletePatchNote();

    const submit = () => {
        if (!title.trim() || !body.trim()) return;
        create({ audience, title: title.trim(), body: body.trim() }, {
            onSuccess: () => { setTitle(""); setBody(""); toast.success("패치노트 발행됨"); },
            onError: () => toast.error("발행 실패"),
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl min-w-0">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Megaphone className="w-4 h-4 text-[var(--color-accent)]" />
                        업데이트 패치노트
                    </DialogTitle>
                    <DialogDescription>
                        발행하면, 그 이후에 접속하는 사람에게 한 번 모달로 뜹니다. 이미 확인한 사람에겐 다시 안 뜹니다.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                    <div className="flex gap-2">
                        {AUDIENCES.map((a) => (
                            <button
                                key={a.key}
                                type="button"
                                onClick={() => setAudience(a.key)}
                                className={`px-3 py-1.5 rounded-lg text-sm border transition ${
                                    audience === a.key
                                        ? "border-[var(--color-accent)] bg-[var(--color-accent-dim)] text-[var(--color-accent)] font-bold"
                                        : "border-[var(--color-border)] text-[var(--color-text-muted)]"
                                }`}
                            >
                                {a.label}
                            </button>
                        ))}
                    </div>
                    <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="제목 — 예: 공지 읽음 확인 기능이 생겼어요"
                        maxLength={200}
                        className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30"
                    />
                    <textarea
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        placeholder={"내용 (줄바꿈 그대로 보임)\n- 공지 상세를 열면 읽음으로 잡혀요\n- 팀빌딩에서 운영진 고정이 가능해요"}
                        rows={6}
                        maxLength={20000}
                        className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-white text-sm resize-y focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30"
                    />
                    <div className="flex justify-end">
                        <Button onClick={submit} disabled={isPending || !title.trim() || !body.trim()}>
                            {isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                            발행하기
                        </Button>
                    </div>
                </div>

                <div className="border-t border-[var(--color-border)] pt-3 max-h-[35vh] overflow-y-auto space-y-2">
                    {(notes ?? []).length === 0 ? (
                        <div className="text-sm text-[var(--color-text-muted)]">발행한 패치노트가 없습니다.</div>
                    ) : (notes ?? []).map((n) => (
                        <div key={n.id} className="flex items-start gap-2 rounded-lg border border-[var(--color-border)] p-2">
                            <div className="min-w-0 flex-1">
                                <div className="text-sm font-bold truncate">
                                    <span className="text-[11px] font-normal text-[var(--color-text-muted)] mr-1.5">
                                        [{AUDIENCES.find((a) => a.key === n.audience)?.label}]
                                    </span>
                                    {n.title}
                                </div>
                                <div className="text-[11px] text-[var(--color-text-muted)]">
                                    {new Date(n.published_at).toLocaleString("ko-KR")}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => { if (confirm("이 패치노트를 삭제할까요?")) remove(n.id); }}
                                className="shrink-0 p-1 text-[var(--color-text-muted)] hover:text-rose-500"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
}
