import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import memberApi from "@/lib/memberApi";
import { useQueryClient } from "@tanstack/react-query";
import { memberAnnKeys } from "@/hooks/useMemberAnnouncements";
import RichContent from "@/components/RichContent";
import AnnouncementReactions from "@/components/AnnouncementReactions";
import AnnouncementComments from "@/components/AnnouncementComments";
import { ArrowLeft, Megaphone } from "lucide-react";
import ShareButton from "@/components/ShareButton";

interface Announcement {
    id: number;
    title: string;
    content: string;
    created_by: string | null;
    created_at: string;
    tags?: string[] | null;
    reactions?: Record<string, number>;
    my_reactions?: string[];
    share_path?: string | null;
}

function formatDate(iso: string) {
    const d = new Date(iso);
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function MemberAnnouncementDetail() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [ann, setAnn] = useState<Announcement | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);

    const qc = useQueryClient();

    useEffect(() => {
        setLoading(true);
        memberApi
            .get<Announcement>(`/notifications/announcements/${id}`)
            .then(({ data }) => {
                setAnn(data);
                // 이 GET 으로 서버에 읽음이 기록된다 — 목록 캐시를 무효화해야
                // 홈 배너·탭 뱃지·목록의 안읽음 표시가 같이 사라진다.
                qc.invalidateQueries({ queryKey: memberAnnKeys.list() });
            })
            .catch(() => setNotFound(true))
            .finally(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    return (
        <main className="mx-auto max-w-lg px-4 py-4">
            <button
                onClick={() => navigate("/member/announcements")}
                className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-3"
            >
                <ArrowLeft className="w-4 h-4" /> 공지 목록
            </button>

            {loading ? (
                <div className="py-20 text-center text-sm text-gray-400">불러오는 중…</div>
            ) : notFound || !ann ? (
                <div className="py-20 text-center text-sm text-gray-400">공지를 찾을 수 없어요</div>
            ) : (
                <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center gap-1.5 text-rose-500 text-xs font-semibold mb-2">
                        <Megaphone className="w-4 h-4" /> 공지
                        {ann.share_path && (
                            <ShareButton className="ml-auto" compact path={ann.share_path} title={ann.title} />
                        )}
                    </div>
                    <h1 className="text-xl font-bold text-gray-900 break-words">{ann.title}</h1>
                    <p className="text-[12px] text-gray-400 mt-1.5">
                        {formatDate(ann.created_at)}
                        {ann.created_by ? ` · ${ann.created_by}` : ""}
                    </p>
                    {ann.tags && ann.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                            {ann.tags.map((t) => (
                                <span key={t} className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-500 text-xs font-medium">#{t}</span>
                            ))}
                        </div>
                    )}
                    <div className="pb-4 border-b border-gray-100" />
                    <RichContent html={ann.content} className="mt-4 text-[15px]" />
                    <div className="mt-5 pt-4 border-t border-gray-100">
                        <p className="text-xs text-gray-400 mb-2">이 공지에 반응 남기기</p>
                        <AnnouncementReactions
                            announcementId={ann.id}
                            reactions={ann.reactions || {}}
                            myReactions={ann.my_reactions || []}
                        />
                    </div>
                    <div className="mt-5 pt-4 border-t border-gray-100">
                        <AnnouncementComments announcementId={ann.id} />
                    </div>
                </article>
            )}
        </main>
    );
}
