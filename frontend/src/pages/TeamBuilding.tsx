import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users2, Plus, Trash2, Loader2, ChevronRight } from "lucide-react";
import api from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface Board {
    id: number;
    name: string;
    data: Record<string, unknown>;
    created_at: string;
    updated_at: string | null;
}

export default function TeamBuilding() {
    const qc = useQueryClient();
    const navigate = useNavigate();
    const { data: boards = [], isLoading } = useQuery<Board[]>({
        queryKey: ["tb-boards"],
        queryFn: async () => (await api.get("/team-building/boards")).data,
    });

    const createMut = useMutation({
        mutationFn: async (name: string) => (await api.post("/team-building/boards", { name })).data,
        onSuccess: (b: Board) => {
            qc.invalidateQueries({ queryKey: ["tb-boards"] });
            navigate(`/team-building/${b.id}`);
        },
        onError: () => toast.error("생성 실패"),
    });
    const deleteMut = useMutation({
        mutationFn: async (id: number) => api.delete(`/team-building/boards/${id}`),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["tb-boards"] }); toast.success("삭제됨"); },
    });

    return (
        <div className="flex flex-col h-full">
            <PageHeader
                title="팀 빌딩"
                subtitle="과거 팀세션과 겹치지 않게 팀을 짜는 도우미 — 리슨업·BP 등 보드별로 관리"
                actions={<CreateBoardDialog onCreate={(n) => createMut.mutate(n)} pending={createMut.isPending} />}
            />
            <div className="flex-1 overflow-auto px-6 py-4">
                {isLoading ? (
                    <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-muted)]" /></div>
                ) : boards.length === 0 ? (
                    <div className="text-center py-16 text-[var(--color-text-secondary)]">
                        <Users2 className="w-10 h-10 mx-auto mb-3 text-[var(--color-text-muted)]" />
                        아직 팀빌딩 보드가 없어요. <b>새 팀빌딩</b>으로 만들어보세요. (예: 리슨업 팀 빌딩, BP 팀 빌딩)
                    </div>
                ) : (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                        {boards.map((b) => (
                            <div
                                key={b.id}
                                className="group flex items-center gap-3 p-4 rounded-xl border border-[var(--color-border-subtle)] bg-white shadow-sm hover:border-[var(--color-accent)]/40 cursor-pointer transition-colors"
                                onClick={() => navigate(`/team-building/${b.id}`)}
                            >
                                <div className="w-11 h-11 shrink-0 rounded-lg bg-[var(--color-accent-dim)] flex items-center justify-center">
                                    <Users2 className="w-5 h-5 text-[var(--color-accent)]" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-[var(--color-text-primary)] truncate">{b.name}</div>
                                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                                        수정 {new Date(b.updated_at ?? b.created_at).toLocaleDateString("ko-KR")}
                                    </p>
                                </div>
                                <Button
                                    size="sm" variant="ghost"
                                    className="text-rose-500 opacity-0 group-hover:opacity-100"
                                    onClick={(e) => { e.stopPropagation(); if (confirm(`'${b.name}' 보드를 삭제할까요?`)) deleteMut.mutate(b.id); }}
                                >
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                                <ChevronRight className="w-4 h-4 text-[var(--color-text-muted)]" />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function CreateBoardDialog({ onCreate, pending }: { onCreate: (name: string) => void; pending: boolean }) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button size="sm"><Plus className="w-4 h-4 mr-1" /> 새 팀빌딩</Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>새 팀빌딩 보드</DialogTitle>
                    <DialogDescription>이름을 정해 보드를 만듭니다. (예: 리슨업 팀 빌딩, BP 팀 빌딩)</DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                    <Label>보드 이름</Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: BP 팀 빌딩" autoFocus
                        onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) { onCreate(name.trim()); setOpen(false); setName(""); } }} />
                </div>
                <DialogFooter>
                    <Button disabled={!name.trim() || pending} onClick={() => { onCreate(name.trim()); setOpen(false); setName(""); }}>만들기</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
