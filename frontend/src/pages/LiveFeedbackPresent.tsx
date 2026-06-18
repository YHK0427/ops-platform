import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, X, Wifi, WifiOff, Loader2, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
    useAdminBoard, useAdminPosts,
    type FeedbackPost, type FeedbackCategory,
} from "@/hooks/useLiveFeedback";
import { useLiveFeedbackSocket } from "@/hooks/useLiveFeedbackSocket";
import { colorClasses, formatFeedbackTime } from "@/lib/feedbackColors";
import { ReactionBar } from "@/components/feedback/ReactionBar";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/** 운영진 발표용 전체화면 — 발표자(기수)를 골라 피드백을 크게 투사. 사이드바 없음. */
export default function LiveFeedbackPresent() {
    const { boardId: param } = useParams();
    const boardId = Number(param);
    const navigate = useNavigate();

    const { data: board, isLoading } = useAdminBoard(boardId);
    const { data: posts } = useAdminPosts(boardId);
    const { connected } = useLiveFeedbackSocket(boardId, "admin");

    const presenters = board?.presenters ?? [];
    const categories: FeedbackCategory[] = board?.categories ?? [];
    const [idx, setIdx] = useState(0);
    // 익명 적용: 켜면 익명 글을 실명 대신 닉네임으로 투사(청중에게 작성자 숨김). 기본 ON.
    const [applyAnon, setApplyAnon] = useState(true);
    // 카드 크기 조정 — 열 수가 적을수록 카드가 커짐(1~5열). 기본 5.
    const [cols, setCols] = useState(5);

    useEffect(() => {
        if (idx > presenters.length - 1) setIdx(0);
    }, [presenters.length, idx]);

    const current = presenters[idx] ?? null;
    const list = useMemo(
        () => (posts ?? []).filter((p) => current && p.presenter_member_id === current.presenter_member_id && !p.is_hidden),
        [posts, current],
    );

    if (isLoading) {
        return <div className="h-[100dvh] flex items-center justify-center bg-gray-900"><Loader2 className="w-8 h-8 animate-spin text-gray-500" /></div>;
    }

    const prev = () => setIdx((i) => (i - 1 + presenters.length) % presenters.length);
    const next = () => setIdx((i) => (i + 1) % presenters.length);

    return (
        <div className="h-[100dvh] flex flex-col bg-gray-900 text-white">
            {/* 상단 바 */}
            <header className="shrink-0 flex items-center justify-between gap-4 px-6 py-4 border-b border-white/10">
                <div className="flex items-center gap-3 min-w-0">
                    <span className="text-sm text-gray-400 truncate">{board?.title}</span>
                    <span className={cn("inline-flex items-center gap-1 text-xs", connected ? "text-emerald-400" : "text-gray-500")}>
                        {connected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                        {connected ? "실시간" : "연결 중"}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    {presenters.length > 0 && (
                        <>
                            <button onClick={prev} className="p-2 rounded-lg hover:bg-white/10" aria-label="이전 발표자"><ChevronLeft className="w-5 h-5" /></button>
                            <Select value={current ? String(current.presenter_member_id) : undefined}
                                onValueChange={(v) => setIdx(presenters.findIndex((p) => p.presenter_member_id === Number(v)))}>
                                <SelectTrigger className="w-44 bg-white/10 border-white/15 text-white"><SelectValue placeholder="발표자" /></SelectTrigger>
                                <SelectContent>
                                    {presenters.map((p) => (
                                        <SelectItem key={p.presenter_member_id} value={String(p.presenter_member_id)}>
                                            {p.group_num != null ? `${p.group_num}분반 · ` : ""}{p.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <button onClick={next} className="p-2 rounded-lg hover:bg-white/10" aria-label="다음 발표자"><ChevronRight className="w-5 h-5" /></button>
                        </>
                    )}
                    {/* 카드 크기 조정 */}
                    <div className="flex items-center gap-1 ml-2 px-1.5 py-1 rounded-lg bg-white/10">
                        <button onClick={() => setCols((c) => Math.min(5, c + 1))} disabled={cols >= 5}
                            className="p-1 rounded hover:bg-white/15 disabled:opacity-30" title="작게"><Minus className="w-4 h-4" /></button>
                        <span className="text-xs text-gray-300 tabular-nums w-4 text-center">{cols}</span>
                        <button onClick={() => setCols((c) => Math.max(1, c - 1))} disabled={cols <= 1}
                            className="p-1 rounded hover:bg-white/15 disabled:opacity-30" title="크게"><Plus className="w-4 h-4" /></button>
                    </div>
                    <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 cursor-pointer select-none text-sm">
                        <input type="checkbox" checked={applyAnon} onChange={(e) => setApplyAnon(e.target.checked)} className="w-4 h-4 accent-rose-500" />
                        익명 적용
                    </label>
                    <button onClick={() => navigate("/live-feedback")} className="p-2 rounded-lg hover:bg-white/10 ml-1" aria-label="나가기"><X className="w-5 h-5" /></button>
                </div>
            </header>

            {/* 발표자 이름 */}
            {current ? (
                <>
                    <div className="shrink-0 px-8 pt-6 pb-3">
                        <div className="flex items-baseline gap-3">
                            {current.group_num != null && <span className="text-lg font-bold text-rose-400">{current.group_num}분반</span>}
                            <h1 className="text-4xl font-extrabold">{current.name}</h1>
                            <span className="text-lg text-gray-500">{list.length}개 피드백</span>
                        </div>
                    </div>

                    {/* 피드백 그리드 */}
                    <div className="flex-1 overflow-y-auto px-8 pb-8">
                        {list.length === 0 ? (
                            <div className="h-full flex items-center justify-center text-gray-600 text-lg">아직 피드백이 없습니다</div>
                        ) : (
                            <div className="gap-4" style={{ columnCount: cols, columnGap: "1rem" }}>
                                {list.map((post) => <PresentCard key={post.id} post={post} categories={categories} applyAnon={applyAnon} />)}
                            </div>
                        )}
                    </div>
                </>
            ) : (
                <div className="flex-1 flex items-center justify-center text-gray-500">발표자가 없습니다.</div>
            )}
        </div>
    );
}

function PresentCard({ post, categories, applyAnon }: { post: FeedbackPost; categories: FeedbackCategory[]; applyAnon: boolean }) {
    // 익명 적용 ON + 익명 글 → 실명 대신 닉네임(작성자 숨김). 그 외엔 실명 + 배지.
    const hideIdentity = applyAnon && post.is_anonymous;
    const displayName = hideIdentity ? (post.anon_alias || "익명") : post.author_name;
    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-2xl bg-white text-gray-900 p-5 shadow-lg mb-4 break-inside-avoid"
        >
            <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-semibold text-gray-500">{displayName}</span>
                {!hideIdentity && post.author_is_staff && <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-500 text-[10px] font-bold">운영진</span>}
                {post.is_anonymous && <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-medium">익명</span>}
                <span className="ml-auto text-xs text-gray-400 tabular-nums">{formatFeedbackTime(post.created_at)}</span>
            </div>
            <div className="space-y-2.5">
                {categories.filter((c) => post.contents?.[c.key]).map((c) => {
                    const cc = colorClasses(c.color);
                    return (
                        <div key={c.key} className={cn("rounded-xl p-3", cc.section)}>
                            <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-bold mb-1.5", cc.chipStrong)}>{c.label}</span>
                            <p className="text-lg leading-relaxed whitespace-pre-wrap [word-break:keep-all]">{post.contents[c.key]}</p>
                        </div>
                    );
                })}
            </div>
            <div className="mt-3">
                <ReactionBar reactions={post.reactions} canReact={false} size="md" />
            </div>
        </motion.div>
    );
}
