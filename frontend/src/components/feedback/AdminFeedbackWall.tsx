import { useMemo, useState } from "react";
import { Trash2, EyeOff, Eye, Wifi, WifiOff, Plus, Send, X, Loader2, ChevronDown, MessageCircle, UserPlus, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
    useAdminBoard,
    useAdminPosts,
    useDeletePost,
    useHidePost,
    useStaffCreatePost,
    useStaffToggleReaction,
    useStaffCreateComment,
    useStaffDeleteComment,
    usePresenterCandidates,
    useAddPresenter,
    useRemovePresenter,
    type FeedbackPost,
    type FeedbackCategory,
    type PresenterColumn,
} from "@/hooks/useLiveFeedback";

function genNonce(): string {
    try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`; }
}
import { useLiveFeedbackSocket } from "@/hooks/useLiveFeedbackSocket";
import { colorClasses, formatFeedbackTime } from "@/lib/feedbackColors";
import { ReactionBar } from "@/components/feedback/ReactionBar";

function groupBadgeClass(g: number | null): string {
    if (g === 1) return "bg-sky-50 text-sky-600";
    if (g === 2) return "bg-violet-50 text-violet-600";
    return "bg-gray-100 text-gray-500";
}

function PostCard({ post, categories, boardId }: { post: FeedbackPost; categories: FeedbackCategory[]; boardId: number }) {
    const del = useDeletePost();
    const hide = useHidePost();
    const react = useStaffToggleReaction(boardId);
    const addComment = useStaffCreateComment(boardId);
    const delComment = useStaffDeleteComment(boardId);
    const [commentOpen, setCommentOpen] = useState(false);
    const [commentText, setCommentText] = useState("");
    const submitComment = async () => {
        const trimmed = commentText.trim();
        if (!trimmed) return;
        await addComment.mutateAsync({ postId: post.id, content: trimmed, is_anonymous: false });
        setCommentText("");
    };
    return (
        <div
            className={cn(
                "rounded-xl border p-3 text-sm transition-colors",
                post.is_hidden ? "border-gray-200 bg-gray-50 opacity-60" : "border-gray-200 bg-white",
            )}
        >
            <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs font-semibold text-gray-900 truncate">{post.author_name}</span>
                    {post.author_is_staff && (
                        <span className="px-1.5 py-0.5 rounded bg-[var(--color-accent-dim)] text-[var(--color-accent)] text-[10px] font-bold shrink-0">
                            운영진
                        </span>
                    )}
                    {post.is_anonymous && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-medium shrink-0">
                            익명
                        </span>
                    )}
                    <span className="text-[11px] text-gray-400 tabular-nums shrink-0">{formatFeedbackTime(post.created_at)}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    <button
                        onClick={() => hide.mutate({ postId: post.id, isHidden: !post.is_hidden })}
                        className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                        title={post.is_hidden ? "다시 표시" : "가리기"}
                    >
                        {post.is_hidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    </button>
                    <button
                        onClick={() => del.mutate(post.id)}
                        className="p-1 rounded hover:bg-rose-50 text-gray-400 hover:text-rose-500"
                        title="삭제"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>
            <div className="space-y-1.5">
                {categories.filter((c) => post.contents?.[c.key]).map((c) => {
                    const cc = colorClasses(c.color);
                    return (
                        <div key={c.key} className={cn("rounded-lg p-2", cc.section)}>
                            <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold mb-1", cc.chipStrong)}>{c.label}</span>
                            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap [word-break:keep-all]">{post.contents[c.key]}</p>
                        </div>
                    );
                })}
                {Object.keys(post.contents ?? {}).filter((k) => !categories.some((c) => c.key === k)).map((k) => (
                    <div key={k} className="rounded-lg p-2 bg-slate-50">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold mb-1 bg-slate-200 text-slate-700">{k}</span>
                        <p className="text-gray-700 leading-relaxed whitespace-pre-wrap [word-break:keep-all]">{post.contents[k]}</p>
                    </div>
                ))}
            </div>
            <div className="mt-2">
                <ReactionBar
                    reactions={post.reactions}
                    myReactions={post.my_reactions}
                    canReact={!post.is_hidden}
                    onToggle={(emoji, active) => react.mutate({ postId: post.id, emoji, active })}
                />
            </div>

            <div className="mt-2 pt-2 border-t border-gray-100">
                <button
                    onClick={() => setCommentOpen((v) => !v)}
                    className="flex items-center gap-1 text-[11px] font-semibold text-gray-400 hover:text-gray-600"
                >
                    <MessageCircle className="w-3 h-3" />
                    댓글 {post.comments.length > 0 ? post.comments.length : ""}
                </button>
                {commentOpen && (
                    <div className="mt-1.5 space-y-1.5">
                        {post.comments.map((c) => (
                            <div key={c.id} className="flex items-start justify-between gap-2 bg-gray-50 rounded-lg px-2 py-1">
                                <div className="min-w-0">
                                    <span className="text-[10px] font-semibold text-gray-500">{c.author_name}</span>
                                    {c.is_anonymous && (
                                        <span className="ml-1 px-1 py-0.5 rounded bg-slate-100 text-slate-500 text-[9px] font-medium">
                                            익명{c.anon_alias ? `(${c.anon_alias})` : ""}
                                        </span>
                                    )}
                                    <p className="text-xs text-gray-700 whitespace-pre-wrap [word-break:keep-all]">{c.content}</p>
                                </div>
                                <button
                                    onClick={() => delComment.mutate(c.id)}
                                    className="shrink-0 text-gray-300 hover:text-rose-500 p-0.5"
                                    title="삭제(모더레이션)"
                                >
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            </div>
                        ))}
                        <div className="flex items-center gap-1.5">
                            <input
                                value={commentText}
                                onChange={(e) => setCommentText(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter" && !addComment.isPending) submitComment(); }}
                                placeholder="운영진 댓글..."
                                maxLength={500}
                                className="flex-1 min-w-0 rounded-full border border-gray-200 px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                            />
                            <button
                                onClick={submitComment}
                                disabled={addComment.isPending || !commentText.trim()}
                                className="shrink-0 p-1 rounded-full bg-[var(--color-accent)] text-white disabled:opacity-40"
                            >
                                {addComment.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function StaffComposer({ boardId, presenterId, presenterName, categories }: {
    boardId: number; presenterId: number; presenterName: string; categories: FeedbackCategory[];
}) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<Record<string, string>>({});
    const [anon, setAnon] = useState(false);
    const create = useStaffCreatePost(boardId);

    const filled = () => {
        const out: Record<string, string> = {};
        for (const c of categories) { const t = (draft[c.key] ?? "").trim(); if (t) out[c.key] = t; }
        return out;
    };
    const submit = async () => {
        const contents = filled();
        if (Object.keys(contents).length === 0) return;
        await create.mutateAsync({ presenter_member_id: presenterId, contents, is_anonymous: anon, client_nonce: genNonce() });
        setDraft({}); setOpen(false);
    };

    if (!open) {
        return (
            <button onClick={() => setOpen(true)}
                className="w-full mt-2 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-gray-300 text-xs font-semibold text-gray-500 hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors">
                <Plus className="w-3.5 h-3.5" /> 운영진 피드백
            </button>
        );
    }
    return (
        <div className="mt-2 rounded-xl border border-[var(--color-accent)]/40 bg-white p-2.5 space-y-2">
            <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-gray-500 truncate">{presenterName} 님에게</span>
                <button onClick={() => setOpen(false)} className="text-gray-300 hover:text-gray-500"><X className="w-3.5 h-3.5" /></button>
            </div>
            {categories.map((c) => {
                const cc = colorClasses(c.color);
                return (
                    <div key={c.key} className={cn("rounded-lg p-2", cc.section)}>
                        <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold mb-1", cc.chipStrong)}>{c.label}</span>
                        <textarea value={draft[c.key] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [c.key]: e.target.value }))}
                            rows={2} maxLength={1000} placeholder={`${c.label} 내용`}
                            className="w-full bg-white/70 rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]" />
                    </div>
                );
            })}
            <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 text-[11px] text-gray-600 cursor-pointer select-none">
                    <input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} className="w-3.5 h-3.5 accent-[var(--color-accent)]" />
                    익명 (기수원에겐 닉네임 — 운영진끼린 실명)
                </label>
                <button onClick={submit} disabled={create.isPending || Object.keys(filled()).length === 0}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-[var(--color-accent)] text-white disabled:opacity-40">
                    {create.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} 작성
                </button>
            </div>
        </div>
    );
}


const STATUS_LABEL: Record<string, string> = {
    PENDING: "미처리", PRESENT: "출석", LATE_UNDER10: "지각", LATE_OVER10: "지각", EARLY_LEAVE: "조퇴", ABSENT: "결석", EXCUSED: "공결",
};

function errText(e: any, fallback: string) {
    const d = e?.response?.data?.detail;
    return typeof d === "string" ? d : fallback;
}

/** 발표자 추가 — 명단에 없는 세션 인원(결석자·뺀 사람 포함) 또는 외부 발표자 이름 직접 입력 */
function AddPresenterDialog({ boardId, hasGroups, open, onOpenChange }: {
    boardId: number; hasGroups: boolean; open: boolean; onOpenChange: (v: boolean) => void;
}) {
    const { data: candidates } = usePresenterCandidates(boardId, open);
    const add = useAddPresenter(boardId);
    const [guestName, setGuestName] = useState("");
    const [group, setGroup] = useState<number | null>(hasGroups ? 1 : null);

    const addMember = (c: { member_id: number; name: string; group_num: number | null }) =>
        add.mutate({ member_id: c.member_id, group_num: hasGroups ? (c.group_num ?? group) : null }, {
            onSuccess: () => toast.success(`${c.name}을(를) 발표자에 넣었습니다.`),
            onError: (e) => toast.error(errText(e, "추가 실패")),
        });
    const addGuest = () => {
        const name = guestName.trim();
        if (!name) return;
        add.mutate({ name, group_num: hasGroups ? group : null }, {
            onSuccess: () => { toast.success(`외부 발표자 ${name}을(를) 넣었습니다.`); setGuestName(""); },
            onError: (e) => toast.error(errText(e, "추가 실패")),
        });
    };
    const GroupPicker = () => hasGroups ? (
        <div className="flex gap-1">
            {[1, 2].map((g) => (
                <button key={g} type="button" onClick={() => setGroup(g)}
                    className={cn("px-2 py-1 rounded-md text-xs font-bold border",
                        group === g ? groupBadgeClass(g) + " border-current" : "border-gray-200 text-gray-400")}>
                    {g}분반
                </button>
            ))}
            <button type="button" onClick={() => setGroup(null)}
                className={cn("px-2 py-1 rounded-md text-xs font-bold border", group === null ? "bg-gray-100 text-gray-600 border-gray-300" : "border-gray-200 text-gray-400")}>
                전체
            </button>
        </div>
    ) : null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md min-w-0">
                <DialogHeader><DialogTitle>발표자 추가</DialogTitle></DialogHeader>
                <div className="space-y-5">
                    <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-bold text-gray-900">외부 발표자</p>
                            <GroupPicker />
                        </div>
                        {hasGroups && <p className="text-[11px] text-gray-400">'전체'로 넣으면 모든 분반에 보입니다.</p>}
                        <div className="flex gap-2">
                            <input value={guestName} onChange={(e) => setGuestName(e.target.value)} maxLength={50}
                                onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) addGuest(); }}
                                placeholder="이름 직접 입력 (예: 초청 강사 김OO)"
                                className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                            <button type="button" onClick={addGuest} disabled={!guestName.trim() || add.isPending}
                                className="px-3 py-2 rounded-lg bg-gray-900 text-white text-sm font-bold disabled:opacity-40">추가</button>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <p className="text-sm font-bold text-gray-900">세션 인원 <span className="text-xs font-normal text-gray-400">(명단에 없는 사람 · 결석자 포함)</span></p>
                        <div className="max-h-[40vh] overflow-y-auto divide-y divide-gray-100 rounded-lg border border-gray-200">
                            {(candidates ?? []).length === 0 ? (
                                <p className="px-3 py-4 text-center text-xs text-gray-400">추가할 사람이 없습니다</p>
                            ) : (candidates ?? []).map((c) => (
                                <div key={c.member_id} className="flex items-center gap-2 px-3 py-2">
                                    <span className="text-sm font-semibold text-gray-900">{c.name}</span>
                                    <span className="text-[11px] text-gray-400">{STATUS_LABEL[c.status] ?? c.status}</span>
                                    {c.group_num != null && (
                                        <span className={cn("px-1.5 py-0.5 rounded-full text-[10px] font-bold", groupBadgeClass(c.group_num))}>{c.group_num}분반</span>
                                    )}
                                    <button type="button" onClick={() => addMember(c)} disabled={add.isPending}
                                        className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                                        <Plus className="w-3 h-3" />넣기
                                    </button>
                                </div>
                            ))}
                        </div>
                        {hasGroups && <p className="text-[11px] text-gray-400">분반이 없는 사람은 위에서 고른 분반으로 들어갑니다.</p>}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export function AdminFeedbackWall({ boardId }: { boardId: number }) {
    const { data: board } = useAdminBoard(boardId);
    const { data: posts } = useAdminPosts(boardId);
    const { connected } = useLiveFeedbackSocket(boardId, "admin");

    const presenters: PresenterColumn[] = board?.presenters ?? [];
    const categories: FeedbackCategory[] = board?.categories ?? [];
    const isOpen = board?.is_open ?? false;
    const hasGroups = presenters.some((p) => p.group_num != null);
    const [addOpen, setAddOpen] = useState(false);
    const remove = useRemovePresenter(boardId);
    const removePresenter = (pr: PresenterColumn, count: number) => {
        const msg = pr.is_guest
            ? `외부 발표자 ${pr.name}을(를) 지웁니다.${count ? ` 달린 피드백 ${count}개도 함께 삭제됩니다.` : ""}`
            : `${pr.name}을(를) 발표자 명단에서 뺍니다. 달린 피드백은 남고, 다시 넣으면 돌아옵니다.`;
        if (!confirm(msg)) return;
        remove.mutate(pr.presenter_member_id, {
            onSuccess: () => toast.success(pr.is_guest ? "외부 발표자를 지웠습니다." : "명단에서 뺐습니다."),
            onError: (e) => toast.error(errText(e, "빼기 실패")),
        });
    };
    // 다 본 발표자는 접어둘 수 있게 — 기본 펼침, 접힌 발표자 id 집합
    const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
    const toggleCollapse = (id: number) => setCollapsed((prev) => {
        const n = new Set(prev);
        n.has(id) ? n.delete(id) : n.add(id);
        return n;
    });
    const postsByPresenter = useMemo(() => {
        const map = new Map<number, FeedbackPost[]>();
        for (const p of posts ?? []) {
            const arr = map.get(p.presenter_member_id) ?? [];
            arr.push(p);
            map.set(p.presenter_member_id, arr);
        }
        return map;
    }, [posts]);

    return (
        <div>
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="text-sm text-gray-500">
                        총 <span className="font-bold text-gray-900">{posts?.length ?? 0}</span>개 피드백
                    </div>
                    <button type="button" onClick={() => setAddOpen(true)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50">
                        <UserPlus className="w-3.5 h-3.5" />발표자 추가
                    </button>
                </div>
                <span
                    className={cn(
                        "inline-flex items-center gap-1 text-xs font-medium",
                        connected ? "text-emerald-600" : "text-gray-400",
                    )}
                >
                    {connected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                    {connected ? "실시간" : "연결 중…"}
                </span>
            </div>

            <AddPresenterDialog boardId={boardId} hasGroups={hasGroups} open={addOpen} onOpenChange={setAddOpen} />
            {presenters.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
                    발표자가 없습니다. 출석 탭에서 분반을 배정하거나 '발표자 추가'로 넣어주세요.
                </div>
            ) : (
                <div className="columns-1 md:columns-2 lg:columns-3 gap-4">
                    {presenters.map((pr) => {
                        const list = postsByPresenter.get(pr.presenter_member_id) ?? [];
                        const open = !collapsed.has(pr.presenter_member_id);
                        return (
                            <div key={pr.presenter_member_id} className={cn("rounded-2xl border border-gray-200 bg-gray-50/50 p-3 mb-4 break-inside-avoid", !open && "opacity-90")}>
                                <button
                                    onClick={() => toggleCollapse(pr.presenter_member_id)}
                                    className={cn("w-full flex items-center justify-between px-1 text-left", open && "mb-2.5")}
                                >
                                    <div className="flex items-center gap-2 min-w-0">
                                        {pr.group_num != null && (
                                            <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-bold shrink-0", groupBadgeClass(pr.group_num))}>
                                                {pr.group_num}분반
                                            </span>
                                        )}
                                        <span className="text-sm font-bold text-gray-900 truncate">{pr.name}</span>
                                        {pr.is_guest && (
                                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-600 shrink-0">외부</span>
                                        )}
                                        {pr.presenter_order != null && (
                                            <span className="text-[11px] text-gray-400 shrink-0">#{pr.presenter_order}</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0 text-gray-400">
                                        <span className="text-xs tabular-nums">{list.length}</span>
                                        <span role="button" tabIndex={0} title="발표자에서 빼기"
                                            onClick={(e) => { e.stopPropagation(); removePresenter(pr, list.length); }}
                                            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); removePresenter(pr, list.length); } }}
                                            className="p-1 rounded hover:bg-rose-50 hover:text-rose-500">
                                            <UserMinus className="w-3.5 h-3.5" />
                                        </span>
                                        <ChevronDown className={cn("w-4 h-4 transition-transform", !open && "-rotate-90")} />
                                    </div>
                                </button>
                                {open && (
                                    <>
                                        <div className="space-y-2">
                                            {list.length === 0 ? (
                                                <p className="text-xs text-gray-400 px-1 py-3 text-center">아직 피드백이 없습니다</p>
                                            ) : (
                                                list.map((post) => <PostCard key={post.id} post={post} categories={categories} boardId={boardId} />)
                                            )}
                                        </div>
                                        {isOpen && (
                                            <StaffComposer boardId={boardId} presenterId={pr.presenter_member_id}
                                                presenterName={pr.name} categories={categories} />
                                        )}
                                    </>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
