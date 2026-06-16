import { useEffect, useMemo, useRef, useState } from "react";
import api from "@/lib/api";
import { useMembers } from "@/hooks";
import RichEditor from "@/components/RichEditor";
import RichContent from "@/components/RichContent";
import AnnouncementReactions from "@/components/AnnouncementReactions";
import type { LinkCardData } from "@/components/editor/LinkCardView";
import type { FileData } from "@/components/editor/FileAttachmentView";
import PushToggle from "@/components/PushToggle";
import { PageHeader } from "@/components/PageHeader";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
    Plus, Pencil, Trash2, Send, X, BellRing, Check, Megaphone, Hash,
} from "lucide-react";

type Target = "all" | "members" | "staff" | "select";

interface Announcement {
    id: number;
    title: string;
    content: string;
    target: Target;
    target_member_ids: number[] | null;
    tags: string[] | null;
    created_by: string | null;
    pushed: boolean;
    created_at: string;
    reactions: Record<string, number>;
    my_reactions: string[];
}

const TARGET_LABEL: Record<Target, string> = {
    all: "기수 전체 (기수원+운영진)",
    members: "기수원",
    staff: "운영진",
    select: "특정 멤버",
};

const uploadImage = async (file: File): Promise<string> => {
    const fd = new FormData();
    fd.append("file", file);
    // Content-Type 를 직접 'multipart/form-data' 로 박으면 boundary 가 빠져 서버가 파싱 못 함.
    // undefined 로 두면 axios 가 FormData 를 감지해 boundary 포함 헤더를 자동 생성한다.
    const { data } = await api.post<{ url: string }>("/notifications/manage/upload-image", fd, {
        headers: { "Content-Type": undefined },
    });
    return data.url;
};

const unfurlLink = async (url: string): Promise<LinkCardData> => {
    const { data } = await api.post<LinkCardData>("/notifications/manage/link-preview", { url });
    return data;
};

const uploadFile = async (file: File): Promise<FileData> => {
    const fd = new FormData();
    fd.append("file", file);
    const { data } = await api.post<FileData>("/notifications/manage/upload-file", fd, {
        headers: { "Content-Type": undefined },
    });
    return data;
};

// ── 임시저장(자동 초안) — localStorage ─────────────────────────────────────────
const DRAFT_KEY = "univpt_announcement_draft_v1";
interface Draft { title: string; content: string; target: Target; memberIds: number[]; tags?: string[]; savedAt: number; }
const loadDraft = (): Draft | null => {
    try { const r = localStorage.getItem(DRAFT_KEY); return r ? (JSON.parse(r) as Draft) : null; } catch { return null; }
};
const saveDraft = (d: Draft) => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* noop */ } };
const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* noop */ } };
const stripHtml = (h: string) => (h || "").replace(/<[^>]+>/g, "").trim();
const draftHasContent = (d: Draft | null) => !!d && (!!d.title.trim() || stripHtml(d.content).length > 0);
const relTime = (ts: number) => {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return "방금";
    if (s < 3600) return `${Math.floor(s / 60)}분 전`;
    if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
    return `${Math.floor(s / 86400)}일 전`;
};

function formatDate(iso: string) {
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function Announcements() {
    const [items, setItems] = useState<Announcement[]>([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<Announcement | "new" | null>(null);
    const [viewing, setViewing] = useState<Announcement | null>(null);
    const [quickPush, setQuickPush] = useState(false);

    const reload = () => {
        setLoading(true);
        api.get<Announcement[]>("/notifications/manage/announcements")
            .then(({ data }) => setItems(data))
            .catch(() => toast.error("공지 목록을 불러오지 못했습니다"))
            .finally(() => setLoading(false));
    };
    useEffect(reload, []);

    const remove = async (id: number) => {
        if (!confirm("이 공지를 삭제할까요?")) return;
        try {
            await api.delete(`/notifications/manage/announcements/${id}`);
            toast.success("삭제했습니다");
            reload();
        } catch {
            toast.error("삭제에 실패했습니다");
        }
    };

    return (
        <div className="min-h-full">
            <PageHeader
                title="공지/알림"
                subtitle="기수원에게 공지를 올리고 푸시 알림을 보냅니다"
                actions={
                    <>
                        <PushToggle http={api} endpoints={{ subscribePath: "/notifications/ops/subscribe" }} tone="accent" />
                        <button
                            onClick={() => setQuickPush(true)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border border-gray-300 text-gray-700 hover:bg-gray-50"
                        >
                            <BellRing className="w-4 h-4" /> 빠른 알림
                        </button>
                        <button
                            onClick={() => setEditing("new")}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-[var(--color-accent)] text-white hover:opacity-90"
                        >
                            <Plus className="w-4 h-4" /> 새 공지
                        </button>
                    </>
                }
            />

            <div className="p-4 md:p-6">
                {loading ? (
                    <div className="py-20 text-center text-sm text-gray-400">불러오는 중…</div>
                ) : items.length === 0 ? (
                    <div className="py-20 text-center text-sm text-gray-400">아직 작성한 공지가 없습니다</div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
                        {items.map((a) => (
                            <div key={a.id} className="flex flex-col rounded-2xl border border-gray-200 bg-white p-4 shadow-sm hover:border-gray-300 transition-colors">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 cursor-pointer" onClick={() => setViewing(a)}>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <h3 className="font-bold text-gray-900 break-words hover:text-[var(--color-accent)]">{a.title}</h3>
                                            {a.pushed && (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">
                                                    <Send className="w-3 h-3" /> 푸시발송
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-[11px] text-gray-400 mt-0.5">
                                            {formatDate(a.created_at)} · 대상 {TARGET_LABEL[a.target]}
                                            {a.created_by ? ` · ${a.created_by}` : ""}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button onClick={() => setEditing(a)} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100" title="수정">
                                            <Pencil className="w-4 h-4" />
                                        </button>
                                        <button onClick={() => remove(a.id)} className="p-1.5 text-gray-400 hover:text-rose-600 rounded-lg hover:bg-rose-50" title="삭제">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                                <div className="mt-2 max-h-40 overflow-hidden relative flex-1 cursor-pointer" onClick={() => setViewing(a)}>
                                    <RichContent html={a.content} className="text-sm" />
                                    <div className="absolute bottom-0 inset-x-0 h-10 bg-gradient-to-t from-white to-transparent" />
                                </div>
                                {a.tags && a.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-2">
                                        {a.tags.map((t) => (
                                            <span key={t} className="px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[11px]">#{t}</span>
                                        ))}
                                    </div>
                                )}
                                <div className="flex items-center justify-between mt-2">
                                    <button onClick={() => setViewing(a)}
                                        className="text-xs font-medium text-[var(--color-accent)] hover:underline">
                                        전체 보기 →
                                    </button>
                                    <AnnouncementReactions announcementId={a.id} reactions={a.reactions || {}} readOnly />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {editing && (
                <AnnouncementModal
                    initial={editing === "new" ? null : editing}
                    onClose={() => setEditing(null)}
                    onSaved={() => { setEditing(null); reload(); }}
                />
            )}
            {viewing && (
                <AnnouncementViewModal
                    ann={viewing}
                    onClose={() => setViewing(null)}
                    onEdit={() => { setEditing(viewing); setViewing(null); }}
                    onDelete={async () => { await remove(viewing.id); setViewing(null); }}
                />
            )}
            {quickPush && <QuickPushModal onClose={() => setQuickPush(false)} />}
        </div>
    );
}

// ── 공지 전체 보기 (읽기 전용) ──────────────────────────────────────────────────
function AnnouncementViewModal({
    ann, onClose, onEdit, onDelete,
}: { ann: Announcement; onClose: () => void; onEdit: () => void; onDelete: () => void }) {
    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto" onClick={onClose}>
            <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl my-4 flex flex-col max-h-[92vh]" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 shrink-0">
                    <div className="flex items-center gap-2 text-[var(--color-accent)] text-sm font-semibold">
                        <Megaphone className="w-4 h-4" /> 공지 전체 보기
                    </div>
                    <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
                </div>
                <div className="px-6 py-5 overflow-y-auto">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h1 className="text-xl font-bold text-gray-900 break-words">{ann.title}</h1>
                        {ann.pushed && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">
                                <Send className="w-3 h-3" /> 푸시발송
                            </span>
                        )}
                    </div>
                    <p className="text-[12px] text-gray-400">
                        {formatDate(ann.created_at)} · 대상 {TARGET_LABEL[ann.target]}
                        {ann.created_by ? ` · ${ann.created_by}` : ""}
                    </p>
                    {ann.tags && ann.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                            {ann.tags.map((t) => (
                                <span key={t} className="px-2 py-0.5 rounded-full bg-[var(--color-accent-dim)] text-[var(--color-accent)] text-xs font-medium">#{t}</span>
                            ))}
                        </div>
                    )}
                    <div className="pb-4 border-b border-gray-100" />
                    <RichContent html={ann.content} className="mt-4" />
                    <div className="mt-4">
                        <p className="text-xs text-gray-400 mb-2">이 공지에 반응 남기기</p>
                        <AnnouncementReactions announcementId={ann.id} reactions={ann.reactions || {}} myReactions={ann.my_reactions || []} admin />
                    </div>
                    <div className="mt-5 pt-4 border-t border-gray-100">
                        <StaffComments announcementId={ann.id} />
                    </div>
                </div>
                <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-gray-200 shrink-0">
                    <button onClick={onDelete} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-gray-500 hover:text-rose-600 hover:bg-rose-50">
                        <Trash2 className="w-4 h-4" /> 삭제
                    </button>
                    <button onClick={onEdit} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-[var(--color-accent)] text-white hover:opacity-90">
                        <Pencil className="w-4 h-4" /> 수정
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── 운영진 댓글 모더레이션 ─────────────────────────────────────────────────────
interface StaffComment { id: number; member_id: number | null; name: string; content: string; created_at: string; is_staff: boolean; is_mine: boolean; }
function StaffComments({ announcementId }: { announcementId: number }) {
    const [comments, setComments] = useState<StaffComment[]>([]);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        api.get<StaffComment[]>(`/notifications/manage/announcements/${announcementId}/comments`)
            .then(({ data }) => setComments(data)).catch(() => {});
    }, [announcementId]);
    const submit = async () => {
        const text = input.trim();
        if (!text || busy) return;
        setBusy(true);
        try {
            const { data } = await api.post<StaffComment>(`/notifications/manage/announcements/${announcementId}/comments`, { content: text });
            setComments((c) => [...c, data]);
            setInput("");
        } catch { /* noop */ } finally { setBusy(false); }
    };
    const del = async (id: number) => {
        if (!confirm("이 댓글을 삭제할까요?")) return;
        try {
            await api.delete(`/notifications/manage/announcements/${announcementId}/comments/${id}`);
            setComments((c) => c.filter((x) => x.id !== id));
        } catch { /* noop */ }
    };
    return (
        <div>
            <p className="text-xs font-semibold text-gray-400 mb-2.5">댓글 {comments.length}</p>
            <div className="space-y-3">
                {comments.map((c) => (
                    <div key={c.id} className="flex items-start gap-2">
                        <div className={`shrink-0 w-7 h-7 rounded-full grid place-items-center text-[11px] font-bold ${c.is_staff ? "bg-[var(--color-accent)] text-white" : "bg-[var(--color-accent-dim)] text-[var(--color-accent)]"}`}>
                            {c.name.slice(0, 1)}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                                <span className="text-[13px] font-semibold text-gray-800">{c.name}</span>
                                {c.is_staff && <span className="text-[10px] font-semibold text-[var(--color-accent)] bg-[var(--color-accent-dim)] px-1.5 py-0.5 rounded-full">운영진</span>}
                                <span className="text-[11px] text-gray-400">{formatDate(c.created_at)}</span>
                            </div>
                            <p className="text-[14px] text-gray-700 mt-0.5 break-words whitespace-pre-wrap">{c.content}</p>
                        </div>
                        <button onClick={() => del(c.id)} className="text-gray-300 hover:text-rose-500 shrink-0 p-1" title="댓글 삭제">
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    </div>
                ))}
                {comments.length === 0 && <p className="text-sm text-gray-400">아직 댓글이 없어요</p>}
            </div>
            <div className="flex items-center gap-2 mt-3">
                <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                    placeholder="운영진으로 댓글 달기…"
                    maxLength={1000}
                    className="flex-1 px-3.5 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                />
                <button onClick={submit} disabled={busy || !input.trim()}
                    className="p-2.5 rounded-xl bg-[var(--color-accent)] text-white disabled:opacity-40 active:scale-95">
                    <Send className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}

// ── 대상 선택 (공용) ───────────────────────────────────────────────────────────
function TargetPicker({
    target, setTarget, memberIds, setMemberIds,
}: {
    target: Target; setTarget: (t: Target) => void;
    memberIds: number[]; setMemberIds: (ids: number[]) => void;
}) {
    const { data: members } = useMembers(true);
    const [q, setQ] = useState("");
    const filtered = useMemo(
        () => (members || []).filter((m) => m.name.toLowerCase().includes(q.toLowerCase())),
        [members, q],
    );
    const toggle = (id: number) =>
        setMemberIds(memberIds.includes(id) ? memberIds.filter((x) => x !== id) : [...memberIds, id]);

    return (
        <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">대상</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(Object.keys(TARGET_LABEL) as Target[]).map((t) => (
                    <button
                        key={t}
                        type="button"
                        onClick={() => setTarget(t)}
                        className={`px-2.5 py-2 rounded-lg text-xs font-medium border transition-colors ${
                            target === t ? "border-[var(--color-accent)] bg-[var(--color-accent-dim)] text-[var(--color-accent)]" : "border-gray-200 text-gray-600 hover:bg-gray-50"
                        }`}
                    >
                        {TARGET_LABEL[t]}
                    </button>
                ))}
            </div>
            {target === "select" && (
                <div className="mt-3 border border-gray-200 rounded-xl p-2">
                    <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="멤버 검색…"
                        className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg mb-2"
                    />
                    <div className="max-h-44 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-1">
                        {filtered.map((m) => {
                            const on = memberIds.includes(m.id);
                            return (
                                <button
                                    key={m.id}
                                    type="button"
                                    onClick={() => toggle(m.id)}
                                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm text-left ${on ? "bg-[var(--color-accent-dim)] text-[var(--color-accent)]" : "hover:bg-gray-50 text-gray-700"}`}
                                >
                                    <span className={`w-4 h-4 grid place-items-center rounded border ${on ? "bg-[var(--color-accent)] border-[var(--color-accent)]" : "border-gray-300"}`}>
                                        {on && <Check className="w-3 h-3 text-white" />}
                                    </span>
                                    <span className="truncate">{m.name}</span>
                                </button>
                            );
                        })}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1.5">{memberIds.length}명 선택됨</p>
                </div>
            )}
        </div>
    );
}

// ── 해시태그 입력 ──────────────────────────────────────────────────────────────
function TagInput({ tags, setTags }: { tags: string[]; setTags: (t: string[]) => void }) {
    const [input, setInput] = useState("");
    const add = () => {
        const t = input.trim().replace(/^#+/, "").trim().slice(0, 30);
        if (t && !tags.includes(t) && tags.length < 10) setTags([...tags, t]);
        setInput("");
    };
    return (
        <div className="shrink-0">
            <label className="flex items-center gap-1 text-sm font-semibold text-gray-700 mb-1.5">
                <Hash className="w-3.5 h-3.5 text-gray-400" /> 해시태그
            </label>
            <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-xl focus-within:ring-2 focus-within:ring-[var(--color-accent)]">
                {tags.map((t) => (
                    <span key={t} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--color-accent-dim)] text-[var(--color-accent)] text-xs font-medium">
                        #{t}
                        <button type="button" onClick={() => setTags(tags.filter((x) => x !== t))} className="hover:text-rose-700"><X className="w-3 h-3" /></button>
                    </span>
                ))}
                <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }}
                    onBlur={add}
                    placeholder={tags.length === 0 ? "태그 입력 후 Enter (예: BP데이)" : "태그 추가"}
                    className="flex-1 min-w-[120px] text-sm outline-none bg-transparent py-0.5"
                />
            </div>
        </div>
    );
}

// ── 공지 작성/수정 모달 ────────────────────────────────────────────────────────
function AnnouncementModal({
    initial, onClose, onSaved,
}: { initial: Announcement | null; onClose: () => void; onSaved: () => void }) {
    const [title, setTitle] = useState(initial?.title || "");
    const [content, setContent] = useState(initial?.content || "");
    const [target, setTarget] = useState<Target>(initial?.target || "members");
    const [memberIds, setMemberIds] = useState<number[]>(initial?.target_member_ids || []);
    const [tags, setTags] = useState<string[]>(initial?.tags || []);
    const [push, setPush] = useState(true);
    const [saving, setSaving] = useState(false);
    const isEdit = !!initial;

    // 임시저장 — 새 공지에서만. 열 때 초안 있으면 배너 제안.
    const offeredDraft = useRef<Draft | null>(isEdit ? null : loadDraft());
    const [bannerOpen, setBannerOpen] = useState(!isEdit && draftHasContent(offeredDraft.current));
    const [editorKey, setEditorKey] = useState(0);
    const [savedAt, setSavedAt] = useState<number | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    // 자동 저장(디바운스) — 배너 결정 전엔 보존 위해 멈춤.
    useEffect(() => {
        if (isEdit || bannerOpen) return;
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            if (!title.trim() && stripHtml(content).length === 0) return;
            const now = Date.now();
            saveDraft({ title, content, target, memberIds, tags, savedAt: now });
            setSavedAt(now);
        }, 800);
        return () => clearTimeout(debounceRef.current);
    }, [title, content, target, memberIds, tags, isEdit, bannerOpen]);

    const restoreDraft = () => {
        const d = offeredDraft.current;
        if (!d) return;
        setTitle(d.title); setContent(d.content); setTarget(d.target); setMemberIds(d.memberIds); setTags(d.tags || []);
        setEditorKey((k) => k + 1); setSavedAt(d.savedAt); setBannerOpen(false);
    };
    const discardDraft = () => { clearDraft(); setBannerOpen(false); };

    const submit = async () => {
        if (!title.trim()) return toast.error("제목을 입력하세요");
        if (target === "select" && memberIds.length === 0) return toast.error("대상 멤버를 선택하세요");
        setSaving(true);
        try {
            const body = {
                title: title.trim(),
                content,
                target,
                target_member_ids: target === "select" ? memberIds : null,
                tags,
                push: isEdit ? false : push,
            };
            if (isEdit) {
                await api.patch(`/notifications/manage/announcements/${initial!.id}`, body);
                toast.success("수정했습니다");
            } else {
                const { data } = await api.post<Announcement>("/notifications/manage/announcements", body);
                toast.success(data.pushed ? "공지를 등록하고 푸시를 보냈습니다 🔔" : "공지를 등록했습니다");
                clearDraft();
            }
            onSaved();
        } catch (e) {
            const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            toast.error(msg || "저장에 실패했습니다");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
            <motion.div
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                transition={{ type: "spring", stiffness: 320, damping: 34 }}
                className="w-full sm:w-[600px] md:w-[58vw] lg:w-[52vw] xl:w-[46vw] max-w-[900px] h-full bg-white shadow-2xl flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 shrink-0">
                    <h2 className="font-bold text-gray-900">{isEdit ? "공지 수정" : "새 공지 작성"}</h2>
                    <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-5 space-y-4 flex flex-col">
                    {bannerOpen && offeredDraft.current && (
                        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 shrink-0">
                            <p className="text-sm text-amber-800">
                                임시저장된 글이 있어요 <span className="text-amber-600">({relTime(offeredDraft.current.savedAt)})</span>
                            </p>
                            <div className="flex items-center gap-1.5 shrink-0">
                                <button onClick={restoreDraft} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 text-white hover:bg-amber-600">이어서 쓰기</button>
                                <button onClick={discardDraft} className="px-3 py-1.5 rounded-lg text-xs font-medium text-amber-700 hover:bg-amber-100">새로 작성</button>
                            </div>
                        </div>
                    )}
                    <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="공지 제목"
                        maxLength={200}
                        className="w-full px-4 py-2.5 text-lg font-semibold border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] shrink-0"
                    />
                    <div className="flex-1 min-h-[45vh] flex flex-col">
                        <RichEditor key={editorKey} value={content} onChange={setContent} uploadImage={uploadImage} uploadFile={uploadFile} unfurlLink={unfurlLink} />
                    </div>
                    <TagInput tags={tags} setTags={setTags} />
                    <TargetPicker target={target} setTarget={setTarget} memberIds={memberIds} setMemberIds={setMemberIds} />
                    {!isEdit ? (
                        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer shrink-0">
                            <input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} className="w-4 h-4 accent-[var(--color-accent)]" />
                            작성과 동시에 푸시 알림 보내기
                        </label>
                    ) : (
                        <p className="text-[11px] text-gray-400 shrink-0">※ 수정 시에는 푸시가 다시 발송되지 않습니다.</p>
                    )}
                </div>
                <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-gray-200 shrink-0">
                    {!isEdit && savedAt && (
                        <span className="mr-auto text-[11px] text-gray-400">자동 저장됨 · {relTime(savedAt)}</span>
                    )}
                    <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100">취소</button>
                    <button onClick={submit} disabled={saving} className="px-4 py-2 rounded-xl text-sm font-semibold bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50">
                        {saving ? "저장 중…" : isEdit ? "수정" : push ? "등록 + 푸시" : "등록"}
                    </button>
                </div>
            </motion.div>
        </div>
    );
}

// ── 빠른 알림 (임의 푸시) 모달 ──────────────────────────────────────────────────
function QuickPushModal({ onClose }: { onClose: () => void }) {
    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    const [target, setTarget] = useState<Target>("members");
    const [memberIds, setMemberIds] = useState<number[]>([]);
    const [sending, setSending] = useState(false);

    const send = async () => {
        if (!title.trim() || !body.trim()) return toast.error("제목과 내용을 입력하세요");
        if (target === "select" && memberIds.length === 0) return toast.error("대상 멤버를 선택하세요");
        setSending(true);
        try {
            const { data } = await api.post<{ queued: number }>("/notifications/manage/push", {
                title: title.trim(),
                body: body.trim(),
                target,
                target_member_ids: target === "select" ? memberIds : null,
            });
            toast.success(`${data.queued}개 기기로 알림을 보냈습니다`);
            onClose();
        } catch (e) {
            const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            toast.error(msg || "발송에 실패했습니다");
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto" onClick={onClose}>
            <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl my-4" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200">
                    <h2 className="flex items-center gap-2 font-bold text-gray-900"><BellRing className="w-5 h-5 text-[var(--color-accent)]" /> 빠른 알림 보내기</h2>
                    <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
                </div>
                <div className="p-5 space-y-4">
                    <p className="text-xs text-gray-500">공지로 남기지 않고 알림만 즉시 보냅니다. (예: “오늘 세션 30분 늦춰집니다”)</p>
                    <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="알림 제목" maxLength={120}
                        className="w-full px-4 py-2.5 font-semibold border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]" />
                    <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="알림 내용" rows={3} maxLength={300}
                        className="w-full px-4 py-2.5 text-sm border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] resize-none" />
                    <TargetPicker target={target} setTarget={setTarget} memberIds={memberIds} setMemberIds={setMemberIds} />
                </div>
                <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-gray-200">
                    <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100">취소</button>
                    <button onClick={send} disabled={sending} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50">
                        <Send className="w-4 h-4" /> {sending ? "보내는 중…" : "발송"}
                    </button>
                </div>
            </div>
        </div>
    );
}
