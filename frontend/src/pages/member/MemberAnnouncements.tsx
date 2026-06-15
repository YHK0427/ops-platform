import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import memberApi from "@/lib/memberApi";
import PushToggle from "@/components/PushToggle";
import AnnouncementReactions from "@/components/AnnouncementReactions";
import { Megaphone, ChevronRight } from "lucide-react";

interface Announcement {
    id: number;
    title: string;
    content: string;
    created_by: string | null;
    created_at: string;
    tags?: string[] | null;
    reactions?: Record<string, number>;
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
    const [items, setItems] = useState<Announcement[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        memberApi
            .get<Announcement[]>("/notifications/announcements")
            .then(({ data }) => setItems(data))
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    return (
        <main className="mx-auto max-w-lg px-4 py-4">
            <div className="flex items-center justify-between mb-4">
                <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
                    <Megaphone className="w-5 h-5 text-rose-500" />
                    공지사항
                </h2>
                <PushToggle
                    http={memberApi}
                    endpoints={{ subscribePath: "/notifications/subscribe" }}
                    tone="rose"
                />
            </div>

            {loading ? (
                <div className="py-20 text-center text-sm text-gray-400">불러오는 중…</div>
            ) : items.length === 0 ? (
                <div className="py-20 text-center text-sm text-gray-400">아직 공지가 없어요</div>
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
                                    <p className="font-semibold text-gray-900 break-words line-clamp-1">{a.title}</p>
                                    {excerpt && (
                                        <p className="text-[13px] text-gray-500 mt-1 leading-relaxed line-clamp-2">{excerpt}</p>
                                    )}
                                    <p className="text-[11px] text-gray-400 mt-1.5">
                                        {formatDate(a.created_at)}
                                        {a.created_by ? ` · ${a.created_by}` : ""}
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
