import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import memberApi from "@/lib/memberApi";
import PushToggle from "@/components/PushToggle";
import { Megaphone, ChevronRight } from "lucide-react";

interface Announcement {
    id: number;
    title: string;
    content: string;
    created_by: string | null;
    created_at: string;
}

function formatDate(iso: string) {
    const d = new Date(iso);
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// HTML 미리보기용 텍스트 추출
function excerpt(html: string, n = 120) {
    const txt = (html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return txt.length > n ? txt.slice(0, n) + "…" : txt;
}

// 본문 첫 이미지 추출 (썸네일)
function firstImage(html: string): string | null {
    const m = (html || "").match(/<img[^>]+src=["']([^"']+)["']/i);
    return m ? m[1] : null;
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
                        const thumb = firstImage(a.content);
                        return (
                            <button
                                key={a.id}
                                onClick={() => navigate(`/member/announcements/${a.id}`)}
                                className="w-full flex items-stretch gap-3 rounded-2xl border border-gray-200 bg-white p-3.5 text-left shadow-sm active:scale-[0.99] transition-transform"
                            >
                                <div className="min-w-0 flex-1">
                                    <p className="font-semibold text-gray-900 break-words line-clamp-1">{a.title}</p>
                                    <p className="text-[13px] text-gray-500 mt-1 leading-relaxed line-clamp-3">{excerpt(a.content)}</p>
                                    <p className="text-[11px] text-gray-400 mt-1.5">
                                        {formatDate(a.created_at)}
                                        {a.created_by ? ` · ${a.created_by}` : ""}
                                    </p>
                                </div>
                                {thumb ? (
                                    <img src={thumb} alt="" className="w-20 h-20 rounded-xl object-cover shrink-0 self-center" />
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
