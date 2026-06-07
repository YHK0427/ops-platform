import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Plus, Loader2, Trash2, Lock, LockOpen, MessageSquareHeart, Radio,
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
    useFeedbackBoards, useCreateBoard, useUpdateBoard, useDeleteBoard,
    type FeedbackBoardListItem,
} from "@/hooks/useLiveFeedback";
import { AdminFeedbackWall } from "@/components/feedback/AdminFeedbackWall";

type Tab = "boards" | "live";

export default function LiveFeedbackManagement() {
    const [tab, setTab] = useState<Tab>("boards");
    const [liveBoardId, setLiveBoardId] = useState<number | null>(null);
    const [createOpen, setCreateOpen] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<FeedbackBoardListItem | null>(null);

    const { data: boards, isLoading } = useFeedbackBoards();
    const updateBoard = useUpdateBoard();
    const deleteBoard = useDeleteBoard();

    const openLive = (id: number) => {
        setLiveBoardId(id);
        setTab("live");
    };

    return (
        <div className="min-h-full">
            <PageHeader
                title="실시간 피드백"
                subtitle="발표 중 기수들이 발표자에게 익명으로 남기는 상호 피드백"
                actions={
                    tab === "boards" ? (
                        <Button onClick={() => setCreateOpen(true)} size="sm">
                            <Plus className="w-4 h-4 mr-1" /> 새 보드
                        </Button>
                    ) : undefined
                }
            />

            {/* Tabs */}
            <div className="px-6 pt-4">
                <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
                    {([["boards", "보드 관리"], ["live", "라이브 보기"]] as const).map(([k, label]) => (
                        <button
                            key={k}
                            onClick={() => setTab(k)}
                            className={cn(
                                "px-4 py-1.5 rounded-md text-sm font-medium transition-colors",
                                tab === k ? "bg-white text-[var(--color-accent)] shadow-sm" : "text-gray-500 hover:text-gray-700",
                            )}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="p-6">
                <AnimatePresence mode="wait">
                    {tab === "boards" ? (
                        <motion.div
                            key="boards"
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                        >
                            {isLoading ? (
                                <div className="flex justify-center py-16">
                                    <Loader2 className="w-6 h-6 animate-spin text-gray-300" />
                                </div>
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
                                                        {b.session_week_num != null ? `${b.session_week_num}주차 · ` : ""}
                                                        {b.session_title ?? "세션"}
                                                    </p>
                                                </div>
                                                <span
                                                    className={cn(
                                                        "px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap shrink-0",
                                                        b.is_open ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-400",
                                                    )}
                                                >
                                                    {b.is_open ? "공개" : "비공개"}
                                                </span>
                                            </div>
                                            <div className="flex items-center justify-between mb-3">
                                                <p className="text-xs text-gray-500">
                                                    피드백 <span className="font-semibold text-gray-700">{b.post_count}</span>개
                                                </p>
                                                <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer select-none">
                                                    <input
                                                        type="checkbox"
                                                        checked={b.include_early_leave}
                                                        onChange={() => updateBoard.mutate({ id: b.id, include_early_leave: !b.include_early_leave })}
                                                        className="w-3.5 h-3.5 accent-rose-500"
                                                    />
                                                    조퇴자 포함
                                                </label>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Button
                                                    size="sm"
                                                    variant={b.is_open ? "outline" : "default"}
                                                    onClick={() => updateBoard.mutate({ id: b.id, is_open: !b.is_open })}
                                                    className="flex-1"
                                                >
                                                    {b.is_open ? <Lock className="w-3.5 h-3.5 mr-1" /> : <LockOpen className="w-3.5 h-3.5 mr-1" />}
                                                    {b.is_open ? "비공개로" : "공개하기"}
                                                </Button>
                                                <Button size="sm" variant="outline" onClick={() => openLive(b.id)}>
                                                    <Radio className="w-3.5 h-3.5 mr-1" /> 라이브
                                                </Button>
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="text-gray-400 hover:text-rose-500"
                                                    onClick={() => setDeleteTarget(b)}
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </motion.div>
                    ) : (
                        <motion.div
                            key="live"
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                        >
                            <div className="mb-4 max-w-xs">
                                <Select
                                    value={liveBoardId ? String(liveBoardId) : undefined}
                                    onValueChange={(v) => setLiveBoardId(Number(v))}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="보드를 선택하세요" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {(boards ?? []).map((b) => (
                                            <SelectItem key={b.id} value={String(b.id)}>
                                                {b.session_week_num != null ? `${b.session_week_num}주차 · ` : ""}{b.title} {b.is_open ? "(공개)" : "(비공개)"}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            {liveBoardId ? (
                                <AdminFeedbackWall boardId={liveBoardId} />
                            ) : (
                                <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center text-sm text-gray-500">
                                    위에서 피드백 보드를 선택하면 실시간으로 표시됩니다.
                                </div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <CreateBoardDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={openLive} />

            <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>피드백 보드 삭제</AlertDialogTitle>
                        <AlertDialogDescription>
                            "{deleteTarget?.title}" 보드와 모든 피드백·반응이 삭제됩니다. 되돌릴 수 없습니다.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>취소</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-rose-500 hover:bg-rose-600"
                            onClick={() => {
                                if (deleteTarget) deleteBoard.mutate(deleteTarget.id);
                                setDeleteTarget(null);
                            }}
                        >
                            삭제
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

function CreateBoardDialog({
    open, onOpenChange, onCreated,
}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    onCreated: (id: number) => void;
}) {
    const { data: sessions } = useSessions();
    const create = useCreateBoard();
    const [sessionId, setSessionId] = useState<string>("");
    const [title, setTitle] = useState("");
    const [includeEarly, setIncludeEarly] = useState(false);

    const individualSessions = useMemo(
        () => (sessions ?? []).filter((s) => s.type === "INDIVIDUAL"),
        [sessions],
    );

    const submit = async () => {
        if (!sessionId || !title.trim()) return;
        const board = await create.mutateAsync({
            session_id: Number(sessionId), title: title.trim(), include_early_leave: includeEarly,
        });
        onOpenChange(false);
        setSessionId("");
        setTitle("");
        setIncludeEarly(false);
        if (board?.id) onCreated(board.id);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>새 피드백 보드</DialogTitle>
                    <DialogDescription>개인(분반) 세션에 실시간 피드백 보드를 만듭니다.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="space-y-1.5">
                        <Label>세션 (개인/분반)</Label>
                        <Select value={sessionId} onValueChange={setSessionId}>
                            <SelectTrigger>
                                <SelectValue placeholder="세션을 선택하세요" />
                            </SelectTrigger>
                            <SelectContent>
                                {individualSessions.map((s) => (
                                    <SelectItem key={s.id} value={String(s.id)}>
                                        {s.week_num}주차 · {s.title}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {individualSessions.length === 0 && (
                            <p className="text-xs text-amber-600">개인(분반) 세션이 없습니다.</p>
                        )}
                    </div>
                    <div className="space-y-1.5">
                        <Label>제목</Label>
                        <Input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="예: 3주차 발표 피드백"
                            maxLength={100}
                        />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={includeEarly}
                            onChange={(e) => setIncludeEarly(e.target.checked)}
                            className="w-4 h-4 accent-rose-500"
                        />
                        조퇴자도 발표자에 포함 <span className="text-xs text-gray-400">(결석·공결은 항상 제외)</span>
                    </label>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
                    <Button onClick={submit} disabled={!sessionId || !title.trim() || create.isPending}>
                        {create.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                        생성
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
