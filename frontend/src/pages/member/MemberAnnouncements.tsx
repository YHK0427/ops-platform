import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import memberApi from "@/lib/memberApi";
import PushToggle from "@/components/PushToggle";
import AnnouncementReactions from "@/components/AnnouncementReactions";
import { Megaphone, ChevronRight, Search, FolderOpen } from "lucide-react";
import { useMemberAnnouncements } from "@/hooks/useMemberAnnouncements";

type Kind = "notice" | "resource";

interface Announcement {
    id: number;
    kind?: Kind;
    title: string;
    content: string;
    created_by: string | null;
    created_at: string;
    tags?: string[] | null;
    reactions?: Record<string, number>;
    is_read?: boolean | null;
    content_updated_at?: string | null;
}

function formatDate(iso: string) {
    const d = new Date(iso);
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// 미리보기(발췌 + 썸네일) 추출.
// 발췌: 링크카드/파일/표/미디어의 텍스트는 빼고 순수 본문(문단·제목)만.
// 썸네일: 콘텐츠 이미지 우선, 없으면 링크카드 대표 이미지.
function parsePreview(html: string, n = 110): { excerpt: string; thumb: string | null } {
    if (!html) return { excerpt: "", thumb: null };
    const doc = new DOMParser().parseFromString(html, "text/html");
    const thumb =
        doc.querySelector("img:not(.link-card-thumb):not(.link-card-favicon):not(.link-card-favicon-lg)")?.getAttribute("src") ||
        doc.querySelector(".link-card-thumb")?.getAttribute("src") ||
        null;
    doc.querySelectorAll(".link-card, .file-attach, table, [data-youtube-video], img").forEach((el) => el.remove());
    const txt = (doc.body.textContent || "").replace(/\s+/g, " ").trim();
    return { excerpt: txt.length > n ? txt.slice(0, n) + "…" : txt, thumb };
}

export default function MemberAnnouncements() {
    const navigate = useNavigate();
    const [kind, setKind] = useState<Kind>("notice");
    const [q, setQ] = useState("");
    const { data, isLoading: loading } = useMemberAnnouncements();
    const all = (data ?? []) as Announcement[];

    // 안 읽은 개수는 탭 배지로 — 자료실에 새 글이 와도 공지 탭만 보고 놓치지 않게
    const unreadOf = (k: Kind) => all.filter((a) => (a.kind || "notice") === k && a.is_read === false).length;

    const items = useMemo(() => {
        const kw = q.trim().toLowerCase();
        return all
            .filter((a) => (a.kind || "notice") === kind)
            .filter((a) => !kw || a.title.toLowerCase().includes(kw)
                || (a.tags || []).some((t) => t.toLowerCase().includes(kw)));
    }, [all, kind, q]);

    return (
        <main className="mx-auto max-w-lg px-4 py-4">
            <div className="flex items-center justify-between mb-3">
                <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
                    {kind === "resource"
                        ? <FolderOpen className="w-5 h-5 text-rose-500" />
                        : <Megaphone className="w-5 h-5 text-rose-500" />}
                    {kind === "resource" ? "자료실" : "공지사항"}
                </h2>
                <PushToggle
                    http={memberApi}
                    endpoints={{ subscribePath: "/notifications/subscribe" }}
                    tone="rose"
                />
            </div>

            <div className="flex rounded-xl bg-gray-100 p-1 mb-3">
                {(["notice", "resource"] as Kind[]).map((k) => {
                    const n = unreadOf(k);
                    return (
                        <button key={k} onClick={() => setKind(k)}
                            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-sm font-semibold transition ${
                                kind === k ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
                            }`}>
                            {k === "resource" ? "자료실" : "공지"}
                            {n > 0 && (
                                <span className="px-1.5 rounded-full bg-rose-500 text-white text-[10px] leading-4">{n > 9 ? "9+" : n}</span>
                            )}
                        </button>
                    );
                })}
            </div>

            {all.length > 6 && (
                <div className="relative mb-3">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="제목·태그로 찾기"
                        className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-rose-200"
                    />
                </div>
            )}

            {loading ? (
                <div className="py-20 text-center text-sm text-gray-400">불러오는 중…</div>
            ) : items.length === 0 ? (
                <div className="py-20 text-center text-sm text-gray-400">
                    {q.trim()
                        ? "찾는 글이 없어요"
                        : kind === "resource"
                            ? "아직 올라온 자료가 없어요"
                            : "아직 공지가 없어요"}
                </div>
            ) : (
                <div className="space-y-2.5">
                    {items.map((a) => {
                        const { excerpt, thumb } = parsePreview(a.content);
                        return (
                            <button
                                key={a.id}
                                onClick={() => navigate(`/member/announcements/${a.id}`)}
                                className="w-full flex items-stretch gap-3 rounded-2xl border border-gray-200 bg-white p-3.5 text-left shadow-sm active:scale-[0.99] transition-transform"
                            >
                                <div className="min-w-0 flex-1">
                                    <p className="font-semibold text-gray-900 break-words line-clamp-1">
                                        {/* 안 읽은 공지는 제목 앞에 점 — 목록에서 바로 구분된다 */}
                                        {a.is_read === false && (
                                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-500 align-middle mr-1.5" />
                                        )}
                                        {a.title}
                                    </p>
                                    {excerpt && (
                                        <p className="text-[13px] text-gray-500 mt-1 leading-relaxed line-clamp-2">{excerpt}</p>
                                    )}
                                    <p className="text-[11px] text-gray-400 mt-1.5">
                                        {formatDate(a.created_at)}
                                        {a.created_by ? ` · ${a.created_by}` : ""}
                                        {a.is_read === false && a.content_updated_at
                                            && a.content_updated_at.slice(0, 16) !== a.created_at.slice(0, 16)
                                            && <span className="ml-1 text-rose-500 font-semibold">· 수정됨</span>}
                                    </p>
                                    {((a.tags && a.tags.length > 0) || a.reactions) && (
                                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                            {a.tags?.map((t) => (
                                                <span key={t} className="px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-500 text-[11px]">#{t}</span>
                                            ))}
                                            <AnnouncementReactions announcementId={a.id} reactions={a.reactions || {}} readOnly />
                                        </div>
                                    )}
                                </div>
                                {thumb ? (
                                    <img src={thumb} alt="" className="w-16 h-16 rounded-xl object-cover shrink-0 self-center" />
                                ) : (
                                    <ChevronRight className="w-5 h-5 text-gray-300 shrink-0 self-center" />
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </main>
    );
}
