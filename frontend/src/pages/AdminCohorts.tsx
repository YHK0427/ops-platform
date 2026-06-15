import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Check, Eye, UserPlus, Archive, ArchiveRestore, Loader2, Layers } from "lucide-react";
import api, { getActiveCohort, setActiveCohort } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

interface Cohort {
    id: number;
    number: number;
    name: string;
    is_current: boolean;
    is_active: boolean;
    archived_at: string | null;
}

const DEPARTMENTS = ["회장단", "인홍부", "학술부", "기획부", "총무부"] as const;

export default function AdminCohorts() {
    const { user } = useAuth();
    const qc = useQueryClient();
    const [active, setActive] = useState<number | null>(getActiveCohort());

    const { data: cohorts = [], isLoading } = useQuery<Cohort[]>({
        queryKey: ["cohorts"],
        queryFn: async () => (await api.get("/cohorts")).data,
        enabled: !!user?.is_superadmin,
    });

    const createMut = useMutation({
        mutationFn: async (body: { number: number; name?: string }) =>
            (await api.post("/cohorts", body)).data,
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["cohorts"] });
            toast.success("기수 공간을 만들었습니다");
        },
        onError: (e: any) => toast.error(e?.response?.data?.detail ?? "생성 실패"),
    });

    const toggleCurrentMut = useMutation({
        mutationFn: async ({ id, value }: { id: number; value: boolean }) =>
            (await api.patch(`/cohorts/${id}`, { is_current: value })).data,
        onSuccess: (_d, v) => {
            qc.invalidateQueries({ queryKey: ["cohorts"] });
            toast.success(v.value ? "활성 기수로 표시했습니다" : "활성 표시를 해제했습니다");
        },
    });

    const archiveMut = useMutation({
        mutationFn: async ({ id, archived }: { id: number; archived: boolean }) =>
            (await api.patch(`/cohorts/${id}`, { archived })).data,
        onSuccess: (_d, v) => {
            qc.invalidateQueries({ queryKey: ["cohorts"] });
            toast.success(v.archived ? "기수를 보관했습니다 (로그인 차단)" : "보관을 해제했습니다 (로그인 재허용)");
        },
    });

    function viewCohort(c: Cohort) {
        setActiveCohort(c.id);
        setActive(c.id);
        toast.success(`${c.name} 공간으로 전환했습니다`);
        // 모든 데이터 재조회
        qc.invalidateQueries();
    }

    if (!user?.is_superadmin) {
        return (
            <div className="p-8 text-[var(--color-text-secondary)]">
                기수 공간 관리는 전체 관리자(슈퍼관리자)만 접근할 수 있습니다.
            </div>
        );
    }

    const activeName = cohorts.find((c) => c.id === active)?.name ?? "미선택";

    return (
        <div className="flex flex-col h-full">
            <PageHeader
                title="기수 공간 관리"
                subtitle={`기수별 독립 공간 · 현재 보는 기수: ${activeName}`}
                actions={
                    <CreateCohortDialog
                        onCreate={(num, name) => createMut.mutate({ number: num, name: name || undefined })}
                        pending={createMut.isPending}
                    />
                }
            />

            <div className="flex-1 overflow-auto px-6 py-4">
                {isLoading ? (
                    <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-muted)]" /></div>
                ) : (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                        {cohorts.map((c) => (
                            <div
                                key={c.id}
                                className="flex items-center gap-3 p-4 rounded-xl border border-[var(--color-border-subtle)] bg-white shadow-sm"
                            >
                                <div className="w-11 h-11 shrink-0 rounded-lg bg-[var(--color-accent-dim)] flex items-center justify-center">
                                    <Layers className="w-5 h-5 text-[var(--color-accent)]" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-bold text-[var(--color-text-primary)]">{c.name}</span>
                                        {c.is_current && <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">활성 기수</Badge>}
                                        {c.id === active && <Badge className="bg-blue-500/15 text-blue-600 border-blue-500/30">보는 중</Badge>}
                                        {c.archived_at && <Badge className="bg-zinc-500/15 text-zinc-600 border-zinc-500/30">보관됨</Badge>}
                                    </div>
                                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{c.number}기</p>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <Button size="sm" variant={c.id === active ? "default" : "outline"} onClick={() => viewCohort(c)}>
                                        <Eye className="w-4 h-4 mr-1" /> 보기
                                    </Button>
                                    {!c.archived_at && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className={c.is_current ? "text-emerald-600" : ""}
                                            onClick={() => toggleCurrentMut.mutate({ id: c.id, value: !c.is_current })}
                                        >
                                            <Check className="w-4 h-4 mr-1" /> {c.is_current ? "활성 해제" : "활성으로"}
                                        </Button>
                                    )}
                                    <SeedStaffDialog cohort={c} />
                                    {c.archived_at ? (
                                        <Button size="sm" variant="outline" title="보관 해제(로그인 재허용)" onClick={() => archiveMut.mutate({ id: c.id, archived: false })}>
                                            <ArchiveRestore className="w-4 h-4 mr-1" /> 보관 해제
                                        </Button>
                                    ) : (
                                        <Button size="sm" variant="ghost" title="보관(비활성·로그인 차단)" onClick={() => archiveMut.mutate({ id: c.id, archived: true })}>
                                            <Archive className="w-4 h-4" />
                                        </Button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function CreateCohortDialog({ onCreate, pending }: { onCreate: (n: number, name: string) => void; pending: boolean }) {
    const [open, setOpen] = useState(false);
    const [num, setNum] = useState("");
    const [name, setName] = useState("");
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button size="sm"><Plus className="w-4 h-4 mr-1" /> 새 기수 만들기</Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>새 기수 공간 만들기</DialogTitle>
                    <DialogDescription>빈 공간이 생성됩니다. 멤버·세션은 새로 등록하세요.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    <div>
                        <Label>기수 번호</Label>
                        <Input type="number" value={num} onChange={(e) => setNum(e.target.value)} placeholder="예: 34" />
                    </div>
                    <div>
                        <Label>이름 (선택)</Label>
                        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="비우면 'N기'" />
                    </div>
                </div>
                <DialogFooter>
                    <Button
                        disabled={!num || pending}
                        onClick={() => { onCreate(Number(num), name); setOpen(false); setNum(""); setName(""); }}
                    >
                        만들기
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function SeedStaffDialog({ cohort }: { cohort: Cohort }) {
    const [open, setOpen] = useState(false);
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [role, setRole] = useState("manager");
    const [dept, setDept] = useState<string>("회장단");
    const mut = useMutation({
        mutationFn: async () =>
            (await api.post(`/cohorts/${cohort.id}/seed-staff`, {
                staff: [{ username, password, display_name: displayName, role, department: dept }],
            })).data,
        onSuccess: () => { toast.success("운영진을 추가했습니다"); setOpen(false); setUsername(""); setPassword(""); setDisplayName(""); },
        onError: (e: any) => toast.error(e?.response?.data?.detail ?? "추가 실패"),
    });
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button size="sm" variant="outline"><UserPlus className="w-4 h-4 mr-1" /> 운영진 추가</Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{cohort.name} 운영진 추가</DialogTitle>
                    <DialogDescription>이 기수에 소속된 운영진 계정을 만듭니다. (admin 역할은 불가)</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    <div><Label>아이디</Label><Input value={username} onChange={(e) => setUsername(e.target.value)} /></div>
                    <div><Label>비밀번호</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
                    <div><Label>표시 이름</Label><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></div>
                    <div className="flex gap-3">
                        <div className="flex-1">
                            <Label>권한</Label>
                            <Select value={role} onValueChange={setRole}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="manager">운영진</SelectItem>
                                    <SelectItem value="viewer">열람자</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex-1">
                            <Label>부서</Label>
                            <Select value={dept} onValueChange={setDept}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button disabled={!username || !password || !displayName || mut.isPending} onClick={() => mut.mutate()}>추가</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
