import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
    Plus, Loader2, Trash2, Lock, LockOpen, MessageSquareHeart, Radio, Maximize2, Pencil, X,
    ChevronDown, HelpCircle, EyeOff, Users, Tag, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useSessions } from "@/hooks/useSessions";
import {
    useFeedbackBoards, useCreateBoard, useUpdateBoard, useDeleteBoard, useEarlyLeaveCandidates,
    type FeedbackBoardListItem, type FeedbackCategory,
} from "@/hooks/useLiveFeedback";
import { AdminFeedbackWall } from "@/components/feedback/AdminFeedbackWall";
import { CATEGORY_PRESETS, DEFAULT_CATEGORIES, COLOR_OPTIONS, colorClasses } from "@/lib/feedbackColors";

type Tab = "boards" | "live";

const COLOR_LABEL: Record<string, string> = {
    emerald: "초록", amber: "노랑", sky: "하늘", violet: "보라",
    rose: "분홍", indigo: "남색", teal: "청록", slate: "회색",
};

export default function LiveFeedbackManagement() {
    const navigate = useNavigate();
    const [tab, setTab] = useState<Tab>("boards");
    const [liveBoardId, setLiveBoardId] = useState<number | null>(null);
    const [dialogBoard, setDialogBoard] = useState<FeedbackBoardListItem | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<FeedbackBoardListItem | null>(null);

    const { data: boards, isLoading } = useFeedbackBoards();
    const updateBoard = useUpdateBoard();
    const deleteBoard = useDeleteBoard();

    const openLive = (id: number) => { setLiveBoardId(id); setTab("live"); };
    const openCreate = () => { setDialogBoard(null); setDialogOpen(true); };
    const openEdit = (b: FeedbackBoardListItem) => { setDialogBoard(b); setDialogOpen(true); };

    return (
        <div className="min-h-full">
            <PageHeader
                title="실시간 피드백"
                subtitle="발표 중 기수들이 발표자에게 익명으로 남기는 상호 피드백"
                actions={tab === "boards" ? (
                    <Button onClick={openCreate} size="sm"><Plus className="w-4 h-4 mr-1" /> 새 보드</Button>
                ) : undefined}
            />

            <div className="px-6 pt-4">
                <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
                    {([["boards", "보드 관리"], ["live", "라이브 보기"]] as const).map(([k, label]) => (
                        <button key={k} onClick={() => setTab(k)}
                            className={cn("px-4 py-1.5 rounded-md text-sm font-medium transition-colors",
                                tab === k ? "bg-white text-[var(--color-accent)] shadow-sm" : "text-gray-500 hover:text-gray-700")}>
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="p-6">
                <AnimatePresence mode="wait">
                    {tab === "boards" ? (
                        <motion.div key="boards" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                            <HelpPanel />
                            {isLoading ? (
                                <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-300" /></div>
                            ) : !boards || boards.length === 0 ? (
                                <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center">
                                    <MessageSquareHeart className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                                    <p className="text-sm text-gray-500">아직 생성된 피드백 보드가 없습니다.</p>
                                    <p className="text-xs text-gray-400 mt-1">개인(분반) 세션을 골라 보드를 만들어 보세요.</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {boards.map((b) => (
                                        <div key={b.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                                            <div className="flex items-start justify-between gap-2 mb-2">
                                                <div className="min-w-0">
                                                    <h3 className="text-sm font-bold text-gray-900 truncate">{b.title}</h3>
                                                    <p className="text-xs text-gray-400 mt-0.5">
                                                        {b.session_week_num != null ? `${b.session_week_num}주차 · ` : ""}{b.session_title ?? "세션"}
                                                    </p>
                                                </div>
                                                <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap shrink-0",
                                                    b.is_open ? "bg-emerald-50 text-emerald-600" : b.closed_at ? "bg-gray-100 text-gray-400" : "bg-amber-50 text-amber-600")}>
                                                    {b.is_open ? "진행 중" : b.closed_at ? "마감" : "대기 중"}
                                                </span>
                                            </div>
                                            {/* 카테고리 미리보기 */}
                                            <div className="flex flex-wrap gap-1 mb-2.5">
                                                {(b.categories ?? []).map((c) => {
                                                    const cc = colorClasses(c.color);
                                                    return <span key={c.key} className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold", cc.chip)}>{c.label}</span>;
                                                })}
                                            </div>
                                            <p className="text-xs text-gray-500 mb-3">
                                                피드백 <span className="font-semibold text-gray-700">{b.post_count}</span>개
                                                {(b.early_leave_member_ids?.length ?? 0) > 0 && (
                                                    <span className="text-gray-400"> · 조퇴 포함 {b.early_leave_member_ids.length}명</span>
                                                )}
                                            </p>
                                            <div className="flex items-center gap-2">
                                                <Button size="sm" variant={b.is_open ? "outline" : "default"}
                                                    onClick={() => updateBoard.mutate({ id: b.id, is_open: !b.is_open })} className="flex-1">
                                                    {b.is_open ? <Lock className="w-3.5 h-3.5 mr-1" /> : <LockOpen className="w-3.5 h-3.5 mr-1" />}
                                                    {b.is_open ? "마감하기" : b.closed_at ? "다시 열기" : "열기"}
                                                </Button>
                                                <Button size="icon" variant="outline" title="라이브 보기" onClick={() => openLive(b.id)}>
                                                    <Radio className="w-4 h-4" />
                                                </Button>
                                                <Button size="icon" variant="outline" title="전체화면(발표용)" onClick={() => navigate(`/live-feedback/${b.id}/present`)}>
                                                    <Maximize2 className="w-4 h-4" />
                                                </Button>
                                                <Button size="icon" variant="ghost" title="수정" onClick={() => openEdit(b)}>
                                                    <Pencil className="w-4 h-4 text-gray-400" />
                                                </Button>
                                                <Button size="icon" variant="ghost" className="text-gray-400 hover:text-rose-500" title="삭제" onClick={() => setDeleteTarget(b)}>
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </motion.div>
                    ) : (
                        <motion.div key="live" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                            <div className="mb-4 flex items-center gap-2 max-w-md">
                                <Select value={liveBoardId ? String(liveBoardId) : undefined} onValueChange={(v) => setLiveBoardId(Number(v))}>
                                    <SelectTrigger><SelectValue placeholder="보드를 선택하세요" /></SelectTrigger>
                                    <SelectContent>
                                        {(boards ?? []).map((b) => (
                                            <SelectItem key={b.id} value={String(b.id)}>
                                                {b.session_week_num != null ? `${b.session_week_num}주차 · ` : ""}{b.title} {b.is_open ? "(진행 중)" : "(마감)"}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {liveBoardId && (
                                    <Button variant="outline" size="sm" onClick={() => navigate(`/live-feedback/${liveBoardId}/present`)}>
                                        <Maximize2 className="w-4 h-4 mr-1" /> 전체화면
                                    </Button>
                                )}
                            </div>
                            {liveBoardId ? <AdminFeedbackWall boardId={liveBoardId} /> : (
                                <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center text-sm text-gray-500">
                                    위에서 피드백 보드를 선택하면 실시간으로 표시됩니다.
                                </div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <BoardDialog open={dialogOpen} onOpenChange={setDialogOpen} editBoard={dialogBoard} onCreated={openLive} />

            <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>피드백 보드 삭제</AlertDialogTitle>
                        <AlertDialogDescription>"{deleteTarget?.title}" 보드와 모든 피드백·반응이 삭제됩니다. 되돌릴 수 없습니다.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>취소</AlertDialogCancel>
                        <AlertDialogAction className="bg-rose-500 hover:bg-rose-600"
                            onClick={() => { if (deleteTarget) deleteBoard.mutate(deleteTarget.id); setDeleteTarget(null); }}>
                            삭제
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

// ── 사용법 안내 패널 ─────────────────────────────────────────────────────────────
function HelpPanel() {
    const [open, setOpen] = useState(true);
    const steps = [
        { icon: Plus, title: "1. 보드 만들기", body: "우측 상단 [새 보드] → 개인(분반) 세션을 고르고 제목을 입력하세요. 한 세션에 보드 1개입니다." },
        { icon: Tag, title: "2. 카테고리 정하기", body: "기수가 작성할 항목입니다. 기본은 칭찬·발전이고, 프리셋(질문·총평·인상깊은 점 등)이나 [직접 추가]로 자유롭게 구성·색 지정할 수 있어요. 만든 뒤에도 카드의 연필(수정)에서 변경 가능합니다." },
        { icon: Users, title: "3. 발표자 = 출석자", body: "결석·공결자는 자동 제외됩니다. 조퇴자는 보드 설정에서 개별로 체크한 사람만 발표자 목록에 들어갑니다. 발표 순서는 기수에게 보이지 않습니다." },
        { icon: LockOpen, title: "4. 열기 / 마감", body: "[열기]를 누르면 상태가 '진행 중'이 되고, 그때부터 기수 화면(홈·피드백 탭)에 보드가 떠서 작성할 수 있습니다. [마감하기]를 누르면 기수는 더 이상 작성할 수 없고 읽기만 됩니다. (※ 공개/비공개가 아니라 '작성 받기'를 여닫는 것)" },
        { icon: Radio, title: "5. 라이브 보기", body: "[라이브] 버튼으로 실시간으로 올라오는 피드백을 분반·발표자별로 모니터링합니다. 부적절한 글은 눈(가리기)·휴지통(삭제)으로 정리할 수 있어요." },
        { icon: Maximize2, title: "6. 전체화면(발표용)", body: "[전체화면] 버튼은 강의실 화면 투사용입니다. 발표자를 ◀▶로 넘기면서 그 사람의 피드백을 크게 띄울 수 있습니다." },
        { icon: EyeOff, title: "7. 익명 / 분반", body: "기수 작성은 기본 익명(귀여운 닉네임)이며, 운영진은 항상 실명과 '익명' 배지를 함께 봅니다. 분반이 나뉘면 기수는 같은 분반 발표자에게만 피드백할 수 있습니다." },
    ];
    return (
        <div className="mb-5 rounded-2xl border border-rose-100 bg-rose-50/40 overflow-hidden">
            <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-4 py-3">
                <span className="flex items-center gap-2 text-sm font-bold text-rose-700">
                    <HelpCircle className="w-4 h-4" /> 실시간 피드백 사용법
                </span>
                <ChevronDown className={cn("w-4 h-4 text-rose-400 transition-transform", open && "rotate-180")} />
            </button>
            <AnimatePresence initial={false}>
                {open && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                        <div className="px-4 pb-4 space-y-4">
            {/* 화면 안내 스크린샷 (화살표 주석) */}
                            <div className="grid gap-5 xl:grid-cols-2">
                                {[
                                    { src: "/help/boards.png", cap: "운영진 · 보드 관리 — 각 버튼 역할 (①새 보드 ③열기/마감 ④라이브 ⑤전체화면 ⑥수정 ⑦삭제)" },
                                    { src: "/help/create.png", cap: "운영진 · 새 보드 만들기 — 세션·카테고리·색·프리셋 설정" },
                                    { src: "/help/member.png", cap: "기수(작성자) 화면 — 발표자 선택·항목별 작성·익명·등록·반응" },
                                    { src: "/help/live.png", cap: "운영진 · 라이브 모니터 — 분반/발표자별 실시간 + 가리기·삭제" },
                                    { src: "/help/present.png", cap: "운영진 · 발표용 전체화면 — 발표자 넘기며 크게 투사" },
                                ].map((f) => (
                                    <figure key={f.src} className="rounded-xl bg-white/70 p-2.5 border border-rose-100">
                                        <img src={f.src} alt={f.cap} loading="lazy" className="w-full rounded-lg border border-gray-200" />
                                        <figcaption className="text-sm font-semibold text-gray-700 mt-2 px-1 [word-break:keep-all]">{f.cap}</figcaption>
                                    </figure>
                                ))}
                            </div>
                            {/* 단계 설명 */}
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                {steps.map((s) => (
                                    <div key={s.title} className="flex gap-2.5 rounded-xl bg-white/70 p-3">
                                        <s.icon className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                                        <div>
                                            <p className="text-xs font-bold text-gray-900 mb-0.5">{s.title}</p>
                                            <p className="text-[11px] text-gray-500 leading-relaxed [word-break:keep-all]">{s.body}</p>
                                        </div>
                                    </div>
                                ))}
                                <div className="flex gap-2.5 rounded-xl bg-white/70 p-3">
                                    <Sparkles className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                                    <div>
                                        <p className="text-xs font-bold text-gray-900 mb-0.5">팁</p>
                                        <p className="text-[11px] text-gray-500 leading-relaxed [word-break:keep-all]">발표 시작 직전에 [열기], 끝나면 [마감하기]. 분반/출석은 출석 탭에서 먼저 정리하면 발표자 목록이 정확해집니다.</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// ── 카테고리 에디터 ─────────────────────────────────────────────────────────────
function CategoryEditor({ cats, setCats }: { cats: FeedbackCategory[]; setCats: (c: FeedbackCategory[]) => void }) {
    const addPreset = (p: FeedbackCategory) => {
        if (cats.some((c) => c.key === p.key)) return;
        setCats([...cats, { ...p }]);
    };
    const addCustom = () => {
        let n = 1;
        while (cats.some((c) => c.key === `custom-${n}`)) n++;
        setCats([...cats, { key: `custom-${n}`, label: "", color: "slate" }]);
    };
    const update = (i: number, patch: Partial<FeedbackCategory>) =>
        setCats(cats.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
    const remove = (i: number) => setCats(cats.filter((_, idx) => idx !== i));

    return (
        <div className="space-y-2">
            <div className="space-y-1.5">
                {cats.map((c, i) => {
                    const cc = colorClasses(c.color);
                    return (
                        <div key={c.key} className="flex items-center gap-2">
                            <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", cc.dot)} />
                            <Input value={c.label} maxLength={20} placeholder="카테고리 이름"
                                onChange={(e) => update(i, { label: e.target.value })} className="flex-1 h-9" />
                            <Select value={c.color} onValueChange={(v) => update(i, { color: v })}>
                                <SelectTrigger className="w-24 h-9"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {COLOR_OPTIONS.map((col) => (
                                        <SelectItem key={col} value={col}>
                                            <span className="flex items-center gap-1.5">
                                                <span className={cn("w-2.5 h-2.5 rounded-full", colorClasses(col).dot)} />
                                                {COLOR_LABEL[col] ?? col}
                                            </span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <button onClick={() => remove(i)} disabled={cats.length <= 1}
                                className="p-1.5 rounded text-gray-400 hover:text-rose-500 disabled:opacity-30" title="삭제">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    );
                })}
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
                {CATEGORY_PRESETS.filter((p) => !cats.some((c) => c.key === p.key)).map((p) => {
                    const cc = colorClasses(p.color);
                    return (
                        <button key={p.key} onClick={() => addPreset(p)}
                            className={cn("inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium border border-dashed border-gray-300 hover:border-gray-400", cc.chip)}>
                            <Plus className="w-3 h-3" /> {p.label}
                        </button>
                    );
                })}
                <button onClick={addCustom} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium border border-dashed border-gray-300 text-gray-500 hover:border-gray-400">
                    <Plus className="w-3 h-3" /> 직접 추가
                </button>
            </div>
        </div>
    );
}

// ── 보드 생성/수정 다이얼로그 ────────────────────────────────────────────────────
function BoardDialog({
    open, onOpenChange, editBoard, onCreated,
}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    editBoard: FeedbackBoardListItem | null;
    onCreated: (id: number) => void;
}) {
    const isEdit = !!editBoard;
    const { data: sessions } = useSessions();
    const create = useCreateBoard();
    const update = useUpdateBoard();

    const [sessionId, setSessionId] = useState<string>("");
    const [title, setTitle] = useState("");
    const [cats, setCats] = useState<FeedbackCategory[]>(DEFAULT_CATEGORIES);
    const [earlyIds, setEarlyIds] = useState<number[]>([]);

    // 다이얼로그 열릴 때 초기화/프리필
    useEffect(() => {
        if (!open) return;
        if (editBoard) {
            setSessionId(String(editBoard.session_id));
            setTitle(editBoard.title);
            setCats(editBoard.categories?.length ? editBoard.categories : DEFAULT_CATEGORIES);
            setEarlyIds(editBoard.early_leave_member_ids ?? []);
        } else {
            setSessionId(""); setTitle(""); setCats(DEFAULT_CATEGORIES); setEarlyIds([]);
        }
    }, [open, editBoard]);

    const individualSessions = useMemo(() => (sessions ?? []).filter((s) => s.type === "INDIVIDUAL"), [sessions]);
    const { data: earlyCandidates } = useEarlyLeaveCandidates(sessionId ? Number(sessionId) : null);

    const catsValid = cats.length > 0 && cats.every((c) => c.label.trim());
    const canSubmit = !!sessionId && !!title.trim() && catsValid;

    const submit = async () => {
        if (!canSubmit) return;
        const payloadCats = cats.map((c) => ({ key: c.key, label: c.label.trim(), color: c.color }));
        if (isEdit && editBoard) {
            await update.mutateAsync({ id: editBoard.id, title: title.trim(), categories: payloadCats, early_leave_member_ids: earlyIds });
            onOpenChange(false);
        } else {
            const board = await create.mutateAsync({
                session_id: Number(sessionId), title: title.trim(), categories: payloadCats, early_leave_member_ids: earlyIds,
            });
            onOpenChange(false);
            if (board?.id) onCreated(board.id);
        }
    };

    const pending = create.isPending || update.isPending;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[88vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{isEdit ? "피드백 보드 수정" : "새 피드백 보드"}</DialogTitle>
                    <DialogDescription>개인(분반) 세션의 실시간 피드백 보드를 설정합니다.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="space-y-1.5">
                        <Label>세션 (개인/분반)</Label>
                        <Select value={sessionId} onValueChange={setSessionId} disabled={isEdit}>
                            <SelectTrigger><SelectValue placeholder="세션을 선택하세요" /></SelectTrigger>
                            <SelectContent>
                                {individualSessions.map((s) => (
                                    <SelectItem key={s.id} value={String(s.id)}>{s.week_num}주차 · {s.title}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {!isEdit && individualSessions.length === 0 && <p className="text-xs text-amber-600">개인(분반) 세션이 없습니다.</p>}
                    </div>
                    <div className="space-y-1.5">
                        <Label>제목</Label>
                        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 3주차 발표 피드백" maxLength={100} />
                    </div>
                    <div className="space-y-1.5">
                        <Label>피드백 카테고리 <span className="text-xs text-gray-400 font-normal">(작성 항목 — 기본 칭찬·발전)</span></Label>
                        <CategoryEditor cats={cats} setCats={setCats} />
                    </div>
                    {/* 조퇴자 개별 포함 */}
                    {(earlyCandidates?.length ?? 0) > 0 && (
                        <div className="space-y-1.5">
                            <Label>조퇴자 포함 <span className="text-xs text-gray-400 font-normal">(체크한 사람만 발표자에 포함 · 결석/공결은 항상 제외)</span></Label>
                            <div className="flex flex-wrap gap-2">
                                {earlyCandidates!.map((m) => {
                                    const checked = earlyIds.includes(m.member_id);
                                    return (
                                        <label key={m.member_id} className={cn(
                                            "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-sm cursor-pointer select-none",
                                            checked ? "border-rose-300 bg-rose-50 text-rose-600" : "border-gray-200 text-gray-600")}>
                                            <input type="checkbox" checked={checked}
                                                onChange={() => setEarlyIds((ids) => checked ? ids.filter((x) => x !== m.member_id) : [...ids, m.member_id])}
                                                className="w-3.5 h-3.5 accent-rose-500" />
                                            {m.name}{m.group_num != null && <span className="text-[10px] opacity-60">{m.group_num}분반</span>}
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
                    <Button onClick={submit} disabled={!canSubmit || pending}>
                        {pending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                        {isEdit ? "저장" : "생성"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
