import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, FileText } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CATEGORY_LABEL, REVIEW_LABEL, useReviewExcuse, useStaffExcuses, type Excuse } from "@/hooks/useExcuses";

function ymd(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDay(iso: string) {
    const d = new Date(`${iso}T00:00:00`);
    return `${d.getMonth() + 1}/${d.getDate()} (${"일월화수목금토"[d.getDay()]})`;
}

export function ReviewButtons({ excuse }: { excuse: Excuse }) {
    const review = useReviewExcuse();
    const decide = (decision: "APPROVED" | "REJECTED") =>
        review.mutate({ id: excuse.id, decision }, {
            onSuccess: () => toast.success(decision === "APPROVED" ? "공결을 승인했습니다." : "공결을 반려했습니다."),
            onError: (error: any) => toast.error(error?.response?.data?.detail ?? "공결 처리 실패"),
        });
    return (
        <div className="flex gap-1.5 shrink-0">
            <button type="button" disabled={review.isPending} onClick={() => decide("APPROVED")}
                className="px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-600 text-white disabled:opacity-50">승인</button>
            <button type="button" disabled={review.isPending} onClick={() => decide("REJECTED")}
                className="px-2.5 py-1 rounded-md text-xs font-bold border border-[var(--color-border)] text-[var(--color-text-secondary)] disabled:opacity-50">반려</button>
        </div>
    );
}

function reviewCls(r: Excuse["review"]) {
    return r === "APPROVED" ? "text-emerald-600 bg-emerald-500/10"
        : r === "REJECTED" ? "text-rose-600 bg-rose-500/10"
        : "text-amber-600 bg-amber-500/10";
}

function Row({ e }: { e: Excuse }) {
    const [open, setOpen] = useState(false);
    const pending = e.reason_kind === "RECOGNIZED" && e.review === "PENDING";
    return (
        <div className="px-3 py-2.5">
            <div className="flex items-center gap-2">
                <button type="button" onClick={() => setOpen(o => !o)} className="flex-1 min-w-0 flex items-center gap-2 text-left">
                    <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)] transition-transform ${open ? "" : "-rotate-90"}`} />
                    <span className="text-sm font-semibold text-[var(--color-text-primary)] shrink-0">{e.member_name}</span>
                    <span className="text-xs text-[var(--color-text-secondary)] truncate">
                        {CATEGORY_LABEL[e.category]} · {e.excuse_type === "PRE" ? "사전" : "사후"} · {e.reason_kind === "RECOGNIZED" ? "인정사유" : "일반사유"}
                    </span>
                    {e.reason_kind === "RECOGNIZED" && e.review && !pending && (
                        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${reviewCls(e.review)}`}>
                            {REVIEW_LABEL[e.review]}
                        </span>
                    )}
                </button>
                {pending && <ReviewButtons excuse={e} />}
            </div>
            {open && (
                <p className="mt-2 ml-6 text-xs text-[var(--color-text-secondary)] whitespace-pre-line break-words">{e.reason}</p>
            )}
        </div>
    );
}

export function ExcuseInbox() {
    const range = useMemo(() => {
        const from = new Date(); from.setDate(from.getDate() - 7);
        const to = new Date(); to.setDate(to.getDate() + 30);
        return { date_from: ymd(from), date_to: ymd(to) };
    }, []);
    const { data: excuses } = useStaffExcuses(range);

    const groups = useMemo(() => {
        const m = new Map<string, Excuse[]>();
        for (const e of [...(excuses ?? [])].sort((a, b) => a.target_date.localeCompare(b.target_date))) {
            m.set(e.target_date, [...(m.get(e.target_date) ?? []), e]);
        }
        return [...m.entries()];
    }, [excuses]);
    const pendingCount = (excuses ?? []).filter(e => e.review === "PENDING").length;

    return (
        <div className="space-y-4">
            <h2 className="text-sm font-bold text-[var(--color-text-secondary)] uppercase tracking-wider flex items-center gap-2">
                <FileText className="w-4 h-4 text-[var(--color-accent)]" />
                사유서
                {pendingCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-white tracking-normal">
                        공결 승인 대기 {pendingCount}
                    </span>
                )}
            </h2>
            {groups.length === 0 ? (
                <div className="px-4 py-3 rounded-lg border border-dashed border-[var(--color-border)] text-sm text-[var(--color-text-muted)]">
                    들어온 사유서가 없습니다.
                </div>
            ) : (
                <div className="grid gap-3 md:grid-cols-2">
                    {groups.map(([date, list]) => (
                        <div key={date} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
                            <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-elevated)]">
                                <span className="text-sm font-bold text-[var(--color-text-primary)]">{fmtDay(date)}</span>
                                <span className="text-xs text-[var(--color-text-muted)]">{list.length}명</span>
                                {list[0].session_id === null && (
                                    <span className="ml-auto px-1.5 py-0.5 rounded text-[10px] font-bold bg-[var(--color-hover)] text-[var(--color-text-muted)]">
                                        세션 생성 전
                                    </span>
                                )}
                            </div>
                            <div className="divide-y divide-[var(--color-border)]">
                                {list.map(e => <Row key={e.id} e={e} />)}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export function PendingExcuseBadge({ excuse }: { excuse: Excuse }) {
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button type="button" onClick={(ev) => ev.stopPropagation()}
                    className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-700 border border-amber-500/30">
                    공결 요청
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 bg-[var(--color-elevated)] border-[var(--color-border)] p-3 text-sm space-y-3" align="end">
                <p className="text-xs font-bold text-[var(--color-text-primary)]">
                    {excuse.member_name} · {CATEGORY_LABEL[excuse.category]} · 인정사유
                </p>
                <p className="text-xs text-[var(--color-text-secondary)] whitespace-pre-line break-words">{excuse.reason}</p>
                <ReviewButtons excuse={excuse} />
            </PopoverContent>
        </Popover>
    );
}
