import { useMemo } from "react";
import { Trash2, EyeOff, Eye, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import {
    useAdminBoard,
    useAdminPosts,
    useDeletePost,
    useHidePost,
    type FeedbackPost,
    type FeedbackCategory,
    type PresenterColumn,
} from "@/hooks/useLiveFeedback";
import { useLiveFeedbackSocket } from "@/hooks/useLiveFeedbackSocket";
import { colorClasses, formatFeedbackTime } from "@/lib/feedbackColors";
import { ReactionBar } from "@/components/feedback/ReactionBar";

function groupBadgeClass(g: number | null): string {
    if (g === 1) return "bg-sky-50 text-sky-600";
    if (g === 2) return "bg-violet-50 text-violet-600";
    return "bg-gray-100 text-gray-500";
}

function PostCard({ post, categories }: { post: FeedbackPost; categories: FeedbackCategory[] }) {
    const del = useDeletePost();
    const hide = useHidePost();
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
                <ReactionBar reactions={post.reactions} myReactions={post.my_reactions} canReact={false} />
            </div>
        </div>
    );
}

export function AdminFeedbackWall({ boardId }: { boardId: number }) {
    const { data: board } = useAdminBoard(boardId);
    const { data: posts } = useAdminPosts(boardId);
    const { connected } = useLiveFeedbackSocket(boardId, "admin");

    const presenters: PresenterColumn[] = board?.presenters ?? [];
    const categories: FeedbackCategory[] = board?.categories ?? [];
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
                <div className="text-sm text-gray-500">
                    총 <span className="font-bold text-gray-900">{posts?.length ?? 0}</span>개 피드백
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

            {presenters.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
                    분반/발표순서를 먼저 지정하세요. (출석 탭에서 분반 배정)
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {presenters.map((pr) => {
                        const list = postsByPresenter.get(pr.presenter_member_id) ?? [];
                        return (
                            <div key={pr.presenter_member_id} className="rounded-2xl border border-gray-200 bg-gray-50/50 p-3">
                                <div className="flex items-center justify-between mb-2.5 px-1">
                                    <div className="flex items-center gap-2">
                                        {pr.group_num != null && (
                                            <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-bold", groupBadgeClass(pr.group_num))}>
                                                {pr.group_num}분반
                                            </span>
                                        )}
                                        <span className="text-sm font-bold text-gray-900">{pr.name}</span>
                                        {pr.presenter_order != null && (
                                            <span className="text-[11px] text-gray-400">#{pr.presenter_order}</span>
                                        )}
                                    </div>
                                    <span className="text-xs text-gray-400">{list.length}</span>
                                </div>
                                <div className="space-y-2">
                                    {list.length === 0 ? (
                                        <p className="text-xs text-gray-400 px-1 py-3 text-center">아직 피드백이 없습니다</p>
                                    ) : (
                                        list.map((post) => <PostCard key={post.id} post={post} categories={categories} />)
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
