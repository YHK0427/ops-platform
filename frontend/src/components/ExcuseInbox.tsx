import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, FileText, Paperclip } from "lucide-react";
import { ExcuseAttachments } from "@/components/ExcuseAttachments";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CATEGORY_LABEL, REVIEW_LABEL, errMsg, useReviewExcuse, useStaffExcuses, type Excuse } from "@/hooks/useExcuses";

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
            onError: (error: any) => toast.error(errMsg(error, "공결 처리 실패")),
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

function Row({ e, withDate = false, actions = false }: { e: Excuse; withDate?: boolean; actions?: boolean }) {
    const [open, setOpen] = useState(false);
    const pending = actions && e.reason_kind === "RECOGNIZED" && e.review === "PENDING" && !e.session_finalized;
    return (
        <div className="px-3 py-2.5">
            <div className="flex items-center gap-2">
                <button type="button" onClick={() => setOpen(o => !o)} className="flex-1 min-w-0 flex items-center gap-2 text-left">
                    <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)] transition-transform ${open ? "" : "-rotate-90"}`} />
                    {withDate && <span className="text-xs font-bold text-[var(--color-text-muted)] shrink-0 w-16">{fmtDay(e.target_date)}</span>}
                    <span className="text-sm font-semibold text-[var(--color-text-primary)] shrink-0">{e.member_name}</span>
                    <span className="text-xs text-[var(--color-text-secondary)] truncate">
                        {CATEGORY_LABEL[e.category]} · {e.excuse_type === "PRE" ? "사전" : "사후"} · {e.reason_kind === "RECOGNIZED" ? "인정사유" : "일반사유"}
                    </span>
                    {e.attachments.length > 0 && (
                        <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] text-[var(--color-text-muted)]">
                            <Paperclip className="w-3 h-3" />{e.attachments.length}
                        </span>
                    )}
                    {e.reason_kind === "RECOGNIZED" && e.review && !pending && (
                        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${reviewCls(e.review)}`}>
                            {REVIEW_LABEL[e.review]}
                        </span>
                    )}
                </button>
                {pending && <ReviewButtons excuse={e} />}
                {actions && e.session_finalized && (
                    <span className="shrink-0 text-[10px] text-[var(--color-text-muted)]">정산 끝남 · 장부에서 처리</span>
                )}
            </div>
            {open && (
                <div className="mt-2 ml-6 space-y-2">
                    <p className="text-xs text-[var(--color-text-secondary)] whitespace-pre-line break-words">{e.reason}</p>
                    <ExcuseAttachments excuse={e} owner="staff" />
                </div>
            )}
        </div>
    );
}

const GROUPS_STEP = 3;

function Card({ title, badge, children }: { title: string; badge?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-elevated)]">
                <span className="text-sm font-bold text-[var(--color-text-primary)]">{title}</span>
                {badge}
            </div>
            <div className="divide-y divide-[var(--color-border)]">{children}</div>
        </div>
    );
}

// 대시보드는 "지금 할 일"만: 승인 대기(날짜 무관) + 오늘 이후 날짜 몇 개.
// 지난 날짜는 이미 해당 세션 출결표에 반영돼 있으니 여기엔 쌓지 않는다.
export function ExcuseInbox() {
    const today = useMemo(() => ymd(new Date()), []);
    const { data: pending } = useStaffExcuses({ review: "PENDING" });
    const { data: upcoming } = useStaffExcuses({ date_from: today });
    const [shown, setShown] = useState(GROUPS_STEP);

    const groups = useMemo(() => {
        const m = new Map<string, Excuse[]>();
        for (const e of [...(upcoming ?? [])].sort((a, b) => a.target_date.localeCompare(b.target_date))) {
            m.set(e.target_date, [...(m.get(e.target_date) ?? []), e]);
        }
        return [...m.entries()];
    }, [upcoming]);
    const pendingSorted = useMemo(
        () => [...(pending ?? [])].sort((a, b) => a.target_date.localeCompare(b.target_date)),
        [pending],
    );
    const rest = groups.length - shown;

    return (
        <div className="space-y-4">
            <h2 className="text-sm font-bold text-[var(--color-text-secondary)] uppercase tracking-wider flex items-center gap-2">
                <FileText className="w-4 h-4 text-[var(--color-accent)]" />
                사유서
                <span className="text-[10px] font-medium text-[var(--color-text-muted)] tracking-normal normal-case">
                    (지난 날짜는 각 세션 출결표에서 확인)
                </span>
            </h2>

            {pendingSorted.length > 0 && (
                <Card title="공결 승인 대기" badge={
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-white">
                        {pendingSorted.filter(e => !e.session_finalized).length}
                    </span>
                }>
                    {pendingSorted.map(e => <Row key={e.id} e={e} withDate actions />)}
                </Card>
            )}

            {groups.length === 0 ? (
                <div className="px-4 py-3 rounded-lg border border-dashed border-[var(--color-border)] text-sm text-[var(--color-text-muted)]">
                    다가오는 세션에 들어온 사유서가 없습니다.
                </div>
            ) : (
                <div className="space-y-3">
                    {groups.slice(0, shown).map(([date, list]) => (
                        <Card key={date} title={fmtDay(date)} badge={<>
                            <span className="text-xs text-[var(--color-text-muted)]">{list.length}명</span>
                            {list[0].session_id === null && (
                                <span className="ml-auto px-1.5 py-0.5 rounded text-[10px] font-bold bg-[var(--color-hover)] text-[var(--color-text-muted)]">
                                    세션 생성 전
                                </span>
                            )}
                        </>}>
                            {list.map(e => <Row key={e.id} e={e} />)}
                        </Card>
                    ))}
                    {rest > 0 && (
                        <button type="button" onClick={() => setShown(n => n + GROUPS_STEP)}
                            className="w-full py-2 rounded-lg border border-[var(--color-border)] text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]">
                            이후 날짜 {Math.min(rest, GROUPS_STEP)}개 더보기 (남은 {rest}개)
                        </button>
                    )}
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
                <ExcuseAttachments excuse={excuse} owner="staff" />
                <ReviewButtons excuse={excuse} />
            </PopoverContent>
        </Popover>
    );
}


export function ExcuseAttachmentButton({ excuse }: { excuse: Excuse }) {
    if (!excuse.attachments.length) return null;
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button type="button" onClick={(ev) => ev.stopPropagation()} title="증빙자료"
                    className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-bold text-blue-600 hover:text-blue-500">
                    <Paperclip className="w-3.5 h-3.5" />{excuse.attachments.length}
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 bg-[var(--color-elevated)] border-[var(--color-border)] p-3 space-y-2" align="end">
                <p className="text-xs font-bold text-[var(--color-text-primary)]">{excuse.member_name} 증빙자료</p>
                <ExcuseAttachments excuse={excuse} owner="staff" />
            </PopoverContent>
        </Popover>
    );
}
