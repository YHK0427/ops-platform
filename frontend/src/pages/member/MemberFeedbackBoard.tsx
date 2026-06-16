import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useMemberAuth } from "@/context/MemberAuthContext";
import { ArrowLeft, Send, Wifi, WifiOff, Lock, Loader2, MessageSquareHeart, Pencil, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
    useMemberBoard, useMemberPosts, useCreatePost, useToggleReaction, useUpdatePost,
    type FeedbackPost, type FeedbackCategory,
} from "@/hooks/useLiveFeedback";
import { useLiveFeedbackSocket } from "@/hooks/useLiveFeedbackSocket";
import { colorClasses, formatFeedbackTime } from "@/lib/feedbackColors";
import { ReactionBar } from "@/components/feedback/ReactionBar";

function genNonce(): string {
    try {
        return crypto.randomUUID();
    } catch {
        return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    }
}

export default function MemberFeedbackBoard() {
    const { boardId: boardIdParam } = useParams();
    const boardId = Number(boardIdParam);
    const navigate = useNavigate();
    const { member } = useMemberAuth();

    const { data: board, isLoading } = useMemberBoard(boardId);
    const { data: posts } = useMemberPosts(boardId);
    const { connected } = useLiveFeedbackSocket(boardId, "member");
    const createPost = useCreatePost(boardId);
    const updatePost = useUpdatePost(boardId);
    const toggleReaction = useToggleReaction(boardId);

    const [presenterId, setPresenterId] = useState<number | null>(null);
    const [draft, setDraft] = useState<Record<string, string>>({}); // 카테고리별 입력
    const [isAnonymous, setIsAnonymous] = useState(true);

    const presenters = board?.presenters ?? [];
    const categories: FeedbackCategory[] = board?.categories ?? [];
    const isOpen = board?.is_open ?? false;
    const myId = member?.member_id;

    // 진입 시 기본으로 자기 섹션(본인 컬럼)을 열어줌. 본인이 없으면 첫 발표자.
    useEffect(() => {
        if (presenterId == null && presenters.length > 0) {
            const own = presenters.find((p) => p.presenter_member_id === myId);
            setPresenterId(own ? own.presenter_member_id : presenters[0].presenter_member_id);
        }
    }, [presenters, presenterId, myId]);

    const selected = presenters.find((p) => p.presenter_member_id === presenterId) ?? null;
    const isOwnSection = selected != null && selected.presenter_member_id === myId;

    // 글 개수(발표자별) — 사이드바 카운트용
    const countByPresenter = useMemo(() => {
        const m = new Map<number, number>();
        for (const p of posts ?? []) m.set(p.presenter_member_id, (m.get(p.presenter_member_id) ?? 0) + 1);
        return m;
    }, [posts]);

    const selectedPosts = useMemo(
        () => (posts ?? []).filter((p) => presenterId != null && p.presenter_member_id === presenterId),
        [posts, presenterId],
    );

    const filledContents = useMemo(() => {
        const out: Record<string, string> = {};
        for (const c of categories) {
            const t = (draft[c.key] ?? "").trim();
            if (t) out[c.key] = t;
        }
        return out;
    }, [draft, categories]);

    const canSubmit = !!presenterId && isOpen && !isOwnSection && Object.keys(filledContents).length > 0;

    const submit = async () => {
        if (!canSubmit) return;
        await createPost.mutateAsync({
            presenter_member_id: presenterId!,
            contents: filledContents,
            is_anonymous: isAnonymous,
            client_nonce: genNonce(),
        });
        setDraft({});
    };

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-gray-300" />
            </div>
        );
    }

    return (
        <div className="flex h-[100dvh] flex-col bg-gray-50">
            {/* Header (full width) */}
            <header className="shrink-0 z-20 bg-white/90 backdrop-blur-md border-b border-gray-200">
                <div className="flex items-center justify-between gap-3 px-4 lg:px-6 py-3">
                    <div className="flex items-center gap-2 min-w-0">
                        <button onClick={() => navigate("/member/feedback")} className="p-1 -ml-1 text-gray-400 hover:text-gray-700">
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                        <h1 className="text-base lg:text-lg font-bold text-gray-900 truncate">{board?.title ?? "실시간 피드백"}</h1>
                        {selected?.group_num != null && (
                            <span className="hidden sm:inline px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 text-[11px] font-bold shrink-0">
                                {selected.group_num}분반
                            </span>
                        )}
                    </div>
                    <span className={cn("inline-flex items-center gap-1 text-xs font-medium shrink-0", connected ? "text-emerald-600" : "text-gray-400")}>
                        {connected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                        {connected ? "실시간" : "연결 중"}
                    </span>
                </div>
                {/* 모바일: 가로 스크롤 발표자 칩 */}
                <div className="lg:hidden border-t border-gray-100 px-3 py-2 overflow-x-auto">
                    <div className="flex gap-2 w-max">
                        {presenters.map((pr) => (
                            <PresenterChip
                                key={pr.presenter_member_id}
                                name={pr.name}
                                isOwn={pr.presenter_member_id === myId}
                                active={presenterId === pr.presenter_member_id}
                                count={countByPresenter.get(pr.presenter_member_id) ?? 0}
                                onClick={() => setPresenterId(pr.presenter_member_id)}
                            />
                        ))}
                    </div>
                </div>
            </header>

            <div className="flex flex-1 min-h-0">
                {/* 데스크탑: 좌측 발표자 레일 */}
                <aside className="hidden lg:flex lg:flex-col lg:w-72 shrink-0 border-r border-gray-200 bg-white overflow-y-auto">
                    <p className="px-4 pt-4 pb-2 text-xs font-semibold text-gray-400">발표자</p>
                    <nav className="px-2 pb-4 space-y-0.5">
                        {presenters.map((pr) => {
                            const active = presenterId === pr.presenter_member_id;
                            const own = pr.presenter_member_id === myId;
                            const cnt = countByPresenter.get(pr.presenter_member_id) ?? 0;
                            return (
                                <button
                                    key={pr.presenter_member_id}
                                    onClick={() => setPresenterId(pr.presenter_member_id)}
                                    className={cn(
                                        "w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                                        active ? "bg-rose-500 text-white" : "text-gray-600 hover:bg-gray-100",
                                    )}
                                >
                                    <span className="flex items-center gap-1.5 min-w-0">
                                        <span className="truncate">{pr.name}</span>
                                        {own && (
                                            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0", active ? "bg-white/25 text-white" : "bg-rose-50 text-rose-600")}>나</span>
                                        )}
                                    </span>
                                    {cnt > 0 && (
                                        <span className={cn("text-[11px] tabular-nums shrink-0", active ? "text-white/80" : "text-gray-400")}>{cnt}</span>
                                    )}
                                </button>
                            );
                        })}
                        {presenters.length === 0 && (
                            <p className="px-3 py-4 text-sm text-gray-400">발표자가 아직 지정되지 않았습니다.</p>
                        )}
                    </nav>
                </aside>

                {/* 우측 콘텐츠 (전체 너비 활용) */}
                <main className="flex-1 min-w-0 overflow-y-auto">
                    <div className="px-4 lg:px-8 py-5 lg:py-6">
                        {!isOpen && (
                            <div className="mb-5 flex items-center gap-2 rounded-xl bg-gray-100 px-4 py-3 text-sm text-gray-500">
                                <Lock className="w-4 h-4 shrink-0" /> 피드백이 마감되었습니다. (읽기 전용)
                            </div>
                        )}

                        {selected ? (
                            <>
                                <div className="mb-4">
                                    <h2 className="text-xl font-extrabold text-gray-900">
                                        {isOwnSection ? "내가 받은 피드백" : `${selected.name} 님에게`}
                                    </h2>
                                    <p className="text-xs text-gray-400 mt-0.5">
                                        {isOwnSection ? "다른 발표자를 선택하면 피드백을 남길 수 있어요" : "원하는 항목에 익명으로 피드백을 남겨보세요"}
                                    </p>
                                </div>

                                {/* 작성기 (본인 섹션·마감 시 숨김) — 보드 카테고리별 입력 */}
                                {isOpen && !isOwnSection && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="mb-6 rounded-2xl border border-gray-200 bg-white p-4 lg:p-5 shadow-sm space-y-3"
                                    >
                                        <div className={cn("grid grid-cols-1 gap-3", categories.length > 1 && "md:grid-cols-2")}>
                                            {categories.map((c) => {
                                                const cc = colorClasses(c.color);
                                                return (
                                                    <div key={c.key} className="space-y-1.5">
                                                        <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold", cc.chip)}>{c.label}</span>
                                                        <textarea
                                                            value={draft[c.key] ?? ""}
                                                            onChange={(e) => setDraft((d) => ({ ...d, [c.key]: e.target.value }))}
                                                            placeholder={`${c.label}을(를) 남겨주세요`}
                                                            rows={5}
                                                            maxLength={1000}
                                                            className={cn("w-full resize-y min-h-[120px] rounded-xl border border-gray-200 p-3.5 text-sm leading-relaxed focus:outline-none focus:ring-2 [word-break:keep-all]", cc.ring)}
                                                        />
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                                                <input type="checkbox" checked={isAnonymous} onChange={(e) => setIsAnonymous(e.target.checked)} className="w-4 h-4 accent-rose-500" />
                                                익명으로 작성
                                            </label>
                                            <button
                                                onClick={submit}
                                                disabled={!canSubmit || createPost.isPending}
                                                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-rose-500 text-white text-sm font-bold disabled:opacity-40 hover:bg-rose-600 transition-colors"
                                            >
                                                {createPost.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                                등록
                                            </button>
                                        </div>
                                    </motion.div>
                                )}

                                {/* 피드백 월 (전체 너비 그리드) */}
                                {selectedPosts.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-16 text-center">
                                        <MessageSquareHeart className="w-10 h-10 text-gray-200 mb-3" />
                                        <p className="text-sm text-gray-400">
                                            {isOwnSection ? "아직 받은 피드백이 없습니다." : "아직 피드백이 없습니다. 첫 번째로 남겨보세요!"}
                                        </p>
                                    </div>
                                ) : (
                                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                                        {selectedPosts.map((post) => (
                                            <PostCard
                                                key={post.id}
                                                post={post}
                                                categories={categories}
                                                canReact={isOpen}
                                                canEdit={isOpen && !!post.is_mine}
                                                saving={updatePost.isPending}
                                                onReact={(emoji, active) => toggleReaction.mutate({ postId: post.id, emoji, active })}
                                                onSave={(contents) => updatePost.mutateAsync({ postId: post.id, contents, is_anonymous: post.is_anonymous })}
                                            />
                                        ))}
                                    </div>
                                )}
                            </>
                        ) : (
                            <p className="text-center text-sm text-gray-400 py-16">발표자를 선택하세요.</p>
                        )}
                    </div>
                </main>
            </div>
        </div>
    );
}

function PresenterChip({ name, isOwn, active, count, onClick }: {
    name: string; isOwn: boolean; active: boolean; count: number; onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "px-3 py-1.5 rounded-full text-sm font-medium border transition-colors whitespace-nowrap",
                active ? "bg-rose-500 text-white border-rose-500" : "bg-white text-gray-600 border-gray-200",
            )}
        >
            {name}
            {isOwn && <span className={cn("ml-1 text-[10px] font-bold", active ? "text-white/80" : "text-rose-500")}>나</span>}
            {count > 0 && <span className={cn("ml-1 text-[11px] tabular-nums", active ? "text-white/80" : "text-gray-400")}>{count}</span>}
        </button>
    );
}

function PostCard({ post, categories, canReact, canEdit, saving, onReact, onSave }: {
    post: FeedbackPost;
    categories: FeedbackCategory[];
    canReact: boolean;
    canEdit?: boolean;
    saving?: boolean;
    onReact: (emoji: string, active: boolean) => void;
    onSave?: (contents: Record<string, string>) => Promise<unknown>;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState<Record<string, string>>({});

    // 보드 카테고리 순서대로 + 보드에 없는 키(편집으로 제거된 것)는 뒤에 폴백
    const known = categories.filter((c) => post.contents?.[c.key]);
    const orphanKeys = Object.keys(post.contents ?? {}).filter((k) => !categories.some((c) => c.key === k));

    const startEdit = () => { setDraft({ ...(post.contents ?? {}) }); setEditing(true); };
    const filled = () => {
        const out: Record<string, string> = {};
        for (const c of categories) { const t = (draft[c.key] ?? "").trim(); if (t) out[c.key] = t; }
        return out;
    };
    const save = async () => {
        const c = filled();
        if (Object.keys(c).length === 0 || !onSave) return;
        await onSave(c);
        setEditing(false);
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm flex flex-col"
        >
            <div className="flex items-center justify-between gap-1.5 mb-2">
                <span className="text-xs font-semibold text-gray-500 truncate">{post.author_name ?? "익명"}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[11px] text-gray-400 tabular-nums">{formatFeedbackTime(post.created_at)}</span>
                    {canEdit && !editing && (
                        <button onClick={startEdit} title="수정" className="text-gray-300 hover:text-rose-500 p-0.5">
                            <Pencil className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            </div>

            {editing ? (
                <div className="space-y-2 flex-1">
                    {categories.map((c) => {
                        const cc = colorClasses(c.color);
                        return (
                            <div key={c.key} className={cn("rounded-lg p-2.5", cc.section)}>
                                <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold mb-1", cc.chipStrong)}>{c.label}</span>
                                <textarea
                                    value={draft[c.key] ?? ""}
                                    onChange={(e) => setDraft((d) => ({ ...d, [c.key]: e.target.value }))}
                                    rows={2}
                                    maxLength={1000}
                                    placeholder={`${c.label} 내용`}
                                    className="w-full bg-white/70 rounded-md border border-gray-200 px-2 py-1.5 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-rose-400"
                                />
                            </div>
                        );
                    })}
                    <div className="flex items-center justify-end gap-1.5 pt-1">
                        <button onClick={() => setEditing(false)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-100">
                            <X className="w-3.5 h-3.5" /> 취소
                        </button>
                        <button onClick={save} disabled={saving || Object.keys(filled()).length === 0}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-500 text-white disabled:opacity-40">
                            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} 저장
                        </button>
                    </div>
                </div>
            ) : (
                <div className="space-y-2 flex-1">
                    {known.map((c) => {
                        const cc = colorClasses(c.color);
                        return (
                            <div key={c.key} className={cn("rounded-lg p-2.5", cc.section)}>
                                <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold mb-1", cc.chipStrong)}>{c.label}</span>
                                <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap [word-break:keep-all]">{post.contents[c.key]}</p>
                            </div>
                        );
                    })}
                    {orphanKeys.map((k) => (
                        <div key={k} className="rounded-lg p-2.5 bg-slate-50">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold mb-1 bg-slate-200 text-slate-700">{k}</span>
                            <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap [word-break:keep-all]">{post.contents[k]}</p>
                        </div>
                    ))}
                </div>
            )}

            <div className="mt-3">
                <ReactionBar
                    reactions={post.reactions}
                    myReactions={post.my_reactions}
                    canReact={canReact}
                    onToggle={onReact}
                />
            </div>
        </motion.div>
    );
}
