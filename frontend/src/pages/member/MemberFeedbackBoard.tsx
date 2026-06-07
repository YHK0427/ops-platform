import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useMemberAuth } from "@/context/MemberAuthContext";
import { ArrowLeft, Send, Wifi, WifiOff, Lock, Loader2, MessageSquareHeart } from "lucide-react";
import { cn } from "@/lib/utils";
import {
    useMemberBoard, useMemberPosts, useCreatePost, useToggleReaction,
    type FeedbackPost,
} from "@/hooks/useLiveFeedback";
import { useLiveFeedbackSocket } from "@/hooks/useLiveFeedbackSocket";

const EMOJIS = ["👍", "❤️", "👏", "🔥", "😮"];

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
    const toggleReaction = useToggleReaction(boardId);

    const [presenterId, setPresenterId] = useState<number | null>(null);
    const [praiseText, setPraiseText] = useState("");
    const [improveText, setImproveText] = useState("");
    const [isAnonymous, setIsAnonymous] = useState(true);

    const presenters = board?.presenters ?? [];
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

    const canSubmit = !!presenterId && isOpen && !isOwnSection && (praiseText.trim() !== "" || improveText.trim() !== "");

    const submit = async () => {
        if (!canSubmit) return;
        await createPost.mutateAsync({
            presenter_member_id: presenterId!,
            praise_content: praiseText.trim() || null,
            improve_content: improveText.trim() || null,
            is_anonymous: isAnonymous,
            client_nonce: genNonce(),
        });
        setPraiseText("");
        setImproveText("");
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
                                        {isOwnSection ? "다른 발표자를 선택하면 피드백을 남길 수 있어요" : "칭찬과 발전 피드백을 익명으로 남겨보세요"}
                                    </p>
                                </div>

                                {/* 작성기 (본인 섹션·마감 시 숨김) */}
                                {isOpen && !isOwnSection && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="mb-6 rounded-2xl border border-gray-200 bg-white p-4 lg:p-5 shadow-sm space-y-3"
                                    >
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <div className="space-y-1.5">
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-600">칭찬</span>
                                                <textarea
                                                    value={praiseText}
                                                    onChange={(e) => setPraiseText(e.target.value)}
                                                    placeholder="좋았던 점을 남겨주세요"
                                                    rows={6}
                                                    maxLength={1000}
                                                    className="w-full resize-y min-h-[140px] rounded-xl border border-gray-200 p-3.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-200 [word-break:keep-all]"
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-600">발전 피드백</span>
                                                <textarea
                                                    value={improveText}
                                                    onChange={(e) => setImproveText(e.target.value)}
                                                    placeholder="더 나아질 점을 남겨주세요"
                                                    rows={6}
                                                    maxLength={1000}
                                                    className="w-full resize-y min-h-[140px] rounded-xl border border-gray-200 p-3.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-amber-200 [word-break:keep-all]"
                                                />
                                            </div>
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
                                                canReact={isOpen}
                                                onReact={(emoji, active) => toggleReaction.mutate({ postId: post.id, emoji, active })}
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

function PostCard({ post, canReact, onReact }: {
    post: FeedbackPost;
    canReact: boolean;
    onReact: (emoji: string, active: boolean) => void;
}) {
    const mine = new Set(post.my_reactions ?? []);
    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm flex flex-col"
        >
            <div className="flex items-center gap-1.5 mb-2">
                <span className="text-xs font-semibold text-gray-500 truncate">{post.author_name ?? "익명"}</span>
            </div>
            <div className="space-y-2 flex-1">
                {post.praise_content && (
                    <div className="rounded-lg bg-emerald-50/60 p-2.5">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 mb-1">칭찬</span>
                        <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap [word-break:keep-all]">{post.praise_content}</p>
                    </div>
                )}
                {post.improve_content && (
                    <div className="rounded-lg bg-amber-50/60 p-2.5">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700 mb-1">발전</span>
                        <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap [word-break:keep-all]">{post.improve_content}</p>
                    </div>
                )}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">
                {EMOJIS.map((emoji) => {
                    const count = post.reactions?.[emoji] ?? 0;
                    const active = mine.has(emoji);
                    if (count === 0 && !canReact) return null;
                    return (
                        <button
                            key={emoji}
                            disabled={!canReact}
                            onClick={() => onReact(emoji, active)}
                            className={cn(
                                "inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs border transition-colors disabled:opacity-60",
                                active ? "bg-rose-50 border-rose-200 text-rose-600" : "bg-white border-gray-200 text-gray-500 hover:border-gray-300",
                            )}
                        >
                            <span>{emoji}</span>
                            {count > 0 && <span className="tabular-nums">{count}</span>}
                        </button>
                    );
                })}
            </div>
        </motion.div>
    );
}
