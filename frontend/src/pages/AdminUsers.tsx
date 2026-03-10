import { useState } from "react";
import { Shield, Plus, Pencil, ShieldCheck, ShieldOff, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useAdminUsers, useCreateAdminUser, useUpdateAdminUser, useDeleteAdminUser, adminUserKeys } from "@/hooks";
import { useAuth } from "@/context/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { QRCodeSVG } from "qrcode.react";
import api from "@/lib/api";
import { toast } from "sonner";

const ROLE_LABELS: Record<string, string> = {
    admin: "관리자",
    manager: "운영진",
    viewer: "열람자",
};

const ROLE_COLORS: Record<string, string> = {
    admin: "bg-rose-500/15 text-rose-400 border-rose-500/30",
    manager: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    viewer: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
};

const DEPARTMENTS = ["회장단", "인홍부", "학술부", "기획부", "총무부"] as const;

const DEPT_COLORS: Record<string, string> = {
    "회장단": "bg-rose-500/10 text-rose-400 border-rose-500/20",
    "인홍부": "bg-purple-500/10 text-purple-400 border-purple-500/20",
    "학술부": "bg-blue-500/10 text-blue-400 border-blue-500/20",
    "기획부": "bg-green-500/10 text-green-400 border-green-500/20",
    "총무부": "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

// ── Create User Dialog ──────────────────────────────────────────────────────

function CreateUserDialog() {
    const [open, setOpen] = useState(false);
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [role, setRole] = useState("manager");
    const [department, setDepartment] = useState("");
    const { mutate, isPending } = useCreateAdminUser();

    const reset = () => { setUsername(""); setPassword(""); setDisplayName(""); setRole("manager"); setDepartment(""); };
    const handleSubmit = () => {
        mutate({ username, password, display_name: displayName, role, department: department || null }, {
            onSuccess: () => { setOpen(false); reset(); },
        });
    };

    return (
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
            <DialogTrigger asChild>
                <Button><Plus className="w-4 h-4 mr-2" />사용자 추가</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[400px]">
                <DialogHeader>
                    <DialogTitle>사용자 추가</DialogTitle>
                    <DialogDescription>새 사용자 계정을 생성합니다.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">아이디</Label>
                        <Input value={username} onChange={(e) => setUsername(e.target.value)} className="col-span-3" placeholder="username" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">비밀번호</Label>
                        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="col-span-3" placeholder="6자 이상" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">이름</Label>
                        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="col-span-3" placeholder="표시 이름" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">역할</Label>
                        <Select value={role} onValueChange={setRole}>
                            <SelectTrigger className="col-span-3"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="admin">관리자</SelectItem>
                                <SelectItem value="manager">운영진</SelectItem>
                                <SelectItem value="viewer">열람자</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {role === "manager" && (
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label className="text-right">부서</Label>
                            <Select value={department} onValueChange={setDepartment}>
                                <SelectTrigger className="col-span-3"><SelectValue placeholder="부서 선택" /></SelectTrigger>
                                <SelectContent>
                                    {DEPARTMENTS.map((d) => (
                                        <SelectItem key={d} value={d}>{d}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button onClick={handleSubmit} disabled={isPending || !username || !password || !displayName}>
                        {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        생성
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── Edit User Dialog ────────────────────────────────────────────────────────

function EditUserDialog({ user, trigger }: { user: { id: number; display_name: string; role: string; department: string | null; is_active: boolean }; trigger: React.ReactNode }) {
    const [open, setOpen] = useState(false);
    const [displayName, setDisplayName] = useState(user.display_name);
    const [role, setRole] = useState(user.role);
    const [department, setDepartment] = useState(user.department ?? "");
    const [password, setPassword] = useState("");
    const [isActive, setIsActive] = useState(user.is_active);
    const { mutate, isPending } = useUpdateAdminUser();

    const handleSubmit = () => {
        const body: Record<string, any> = { userId: user.id, display_name: displayName, role, is_active: isActive, department: department || null };
        if (password) body.password = password;
        mutate(body as any, { onSuccess: () => setOpen(false) });
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>{trigger}</DialogTrigger>
            <DialogContent className="sm:max-w-[400px]">
                <DialogHeader>
                    <DialogTitle>사용자 수정</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">이름</Label>
                        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="col-span-3" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">역할</Label>
                        <Select value={role} onValueChange={setRole}>
                            <SelectTrigger className="col-span-3"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="admin">관리자</SelectItem>
                                <SelectItem value="manager">운영진</SelectItem>
                                <SelectItem value="viewer">열람자</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {role === "manager" && (
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label className="text-right">부서</Label>
                            <Select value={department} onValueChange={setDepartment}>
                                <SelectTrigger className="col-span-3"><SelectValue placeholder="부서 선택" /></SelectTrigger>
                                <SelectContent>
                                    {DEPARTMENTS.map((d) => (
                                        <SelectItem key={d} value={d}>{d}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">비밀번호</Label>
                        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="col-span-3" placeholder="변경 시 입력" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">상태</Label>
                        <Select value={isActive ? "active" : "inactive"} onValueChange={(v) => setIsActive(v === "active")}>
                            <SelectTrigger className="col-span-3"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="active">활성</SelectItem>
                                <SelectItem value="inactive">비활성</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <DialogFooter>
                    <Button onClick={handleSubmit} disabled={isPending}>
                        {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        저장
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ── TOTP Setup Dialog ───────────────────────────────────────────────────────

function TotpSetupDialog() {
    const [open, setOpen] = useState(false);
    const [step, setStep] = useState<"idle" | "qr" | "done">("idle");
    const [secret, setSecret] = useState("");
    const [uri, setUri] = useState("");
    const [code, setCode] = useState("");
    const [loading, setLoading] = useState(false);
    const [totpEnabled, setTotpEnabled] = useState<boolean | null>(null);
    const queryClient = useQueryClient();

    const checkStatus = async () => {
        const { data } = await api.get<{ enabled: boolean }>("/auth/totp/status");
        setTotpEnabled(data.enabled);
    };

    const handleOpen = async (v: boolean) => {
        setOpen(v);
        if (v) {
            await checkStatus();
            setStep("idle");
            setCode("");
        }
    };

    const handleSetup = async () => {
        setLoading(true);
        try {
            const { data } = await api.post<{ secret: string; otpauth_uri: string }>("/auth/totp/setup");
            setSecret(data.secret);
            setUri(data.otpauth_uri);
            setStep("qr");
        } catch { toast.error("TOTP 설정 실패"); }
        finally { setLoading(false); }
    };

    const handleConfirm = async () => {
        setLoading(true);
        try {
            await api.post("/auth/totp/confirm", { secret, totp_code: code });
            toast.success("2FA가 활성화되었습니다.");
            setStep("done");
            setTotpEnabled(true);
            queryClient.invalidateQueries({ queryKey: adminUserKeys.all });
        } catch {
            toast.error("OTP 코드가 올바르지 않습니다.");
        }
        finally { setLoading(false); }
    };

    const handleDisable = async () => {
        setLoading(true);
        try {
            await api.delete("/auth/totp");
            toast.success("2FA가 비활성화되었습니다.");
            setTotpEnabled(false);
            queryClient.invalidateQueries({ queryKey: adminUserKeys.all });
        } catch { toast.error("비활성화 실패"); }
        finally { setLoading(false); }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpen}>
            <DialogTrigger asChild>
                <Button variant="outline"><Shield className="w-4 h-4 mr-2" />2FA 설정</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[420px]">
                <DialogHeader>
                    <DialogTitle>2단계 인증 (TOTP)</DialogTitle>
                    <DialogDescription>Google Authenticator 등의 앱으로 추가 인증을 설정합니다.</DialogDescription>
                </DialogHeader>

                {totpEnabled === null ? (
                    <div className="flex justify-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-muted)]" />
                    </div>
                ) : totpEnabled && step !== "qr" ? (
                    <div className="space-y-4 py-4">
                        <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                            <ShieldCheck className="w-5 h-5 text-green-400" />
                            <span className="text-sm text-green-400">2FA 활성화됨</span>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={handleDisable} disabled={loading} className="text-rose-400 hover:text-rose-300">
                                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                <ShieldOff className="w-4 h-4 mr-2" />2FA 해제
                            </Button>
                        </DialogFooter>
                    </div>
                ) : step === "idle" ? (
                    <div className="space-y-4 py-4">
                        <p className="text-sm text-[var(--color-text-secondary)]">
                            2FA를 활성화하면 로그인 시 비밀번호 외에 OTP 코드를 추가로 입력해야 합니다.
                        </p>
                        <DialogFooter>
                            <Button onClick={handleSetup} disabled={loading}>
                                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                설정 시작
                            </Button>
                        </DialogFooter>
                    </div>
                ) : step === "qr" ? (
                    <div className="space-y-4 py-4">
                        <p className="text-sm text-[var(--color-text-secondary)]">
                            Google Authenticator 앱에서 QR 코드를 스캔하세요:
                        </p>
                        <div className="flex justify-center p-4 rounded-lg bg-white">
                            <QRCodeSVG value={uri} size={180} />
                        </div>
                        <p className="text-xs text-[var(--color-text-muted)] text-center">
                            스캔이 안 되면 아래 키를 수동 입력:
                        </p>
                        <div className="p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] font-mono text-sm break-all text-center select-all">
                            {secret}
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label className="text-right">OTP 코드</Label>
                            <Input
                                value={code}
                                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                                className="col-span-3 font-mono text-center text-lg tracking-widest"
                                placeholder="000000"
                                maxLength={6}
                            />
                        </div>
                        <DialogFooter>
                            <Button onClick={handleConfirm} disabled={loading || code.length !== 6}>
                                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                확인 및 활성화
                            </Button>
                        </DialogFooter>
                    </div>
                ) : (
                    <div className="space-y-4 py-4">
                        <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                            <ShieldCheck className="w-5 h-5 text-green-400" />
                            <span className="text-sm text-green-400">2FA가 성공적으로 활성화되었습니다.</span>
                        </div>
                        <DialogFooter>
                            <Button onClick={() => setOpen(false)}>완료</Button>
                        </DialogFooter>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

// ── Semester Reset ───────────────────────────────────────────────────────────

function SemesterResetButton() {
    const [loading, setLoading] = useState(false);
    const queryClient = useQueryClient();

    const handleReset = async () => {
        setLoading(true);
        try {
            const { data } = await api.post<{ reset_members: number }>("/auth/reset-semester");
            toast.success(`기수 초기화 완료 — ${data.reset_members}명 디파짓 2만원 리셋`);
            queryClient.invalidateQueries();
        } catch {
            toast.error("초기화 실패");
        } finally {
            setLoading(false);
        }
    };

    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>
                <Button variant="outline" className="text-rose-400 border-rose-500/30 hover:bg-rose-500/10">
                    <RotateCcw className="w-4 h-4 mr-2" />
                    기수 초기화
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>기수 초기화</AlertDialogTitle>
                    <AlertDialogDescription className="space-y-2">
                        <span className="block">모든 세션, 장부, 출석, 과제 기록이 삭제됩니다.</span>
                        <span className="block">멤버 명단은 유지되며 디파짓이 2만원으로 초기화됩니다.</span>
                        <span className="block font-bold text-rose-400">이 작업은 되돌릴 수 없습니다.</span>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>취소</AlertDialogCancel>
                    <AlertDialogAction onClick={handleReset} disabled={loading} className="bg-rose-500 hover:bg-rose-600">
                        {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        초기화 실행
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function AdminUsers() {
    const { data: users, isLoading } = useAdminUsers();
    const { mutate: deleteUser } = useDeleteAdminUser();
    const { user: currentUser } = useAuth();

    return (
        <div className="flex flex-col h-full">
            <PageHeader
                title="사용자 관리"
                subtitle="운영진 계정을 관리합니다"
                actions={
                    <div className="flex gap-2">
                        {currentUser?.role === "admin" && <SemesterResetButton />}
                        {currentUser?.role === "admin" && <TotpSetupDialog />}
                        <CreateUserDialog />
                    </div>
                }
            />

            <div className="p-6">
                <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
                    <Table>
                        <TableHeader>
                            <TableRow className="border-b border-[var(--color-border-subtle)] hover:bg-transparent">
                                <TableHead className="text-[var(--color-text-muted)]">아이디</TableHead>
                                <TableHead className="text-[var(--color-text-muted)]">이름</TableHead>
                                <TableHead className="text-[var(--color-text-muted)]">역할</TableHead>
                                <TableHead className="text-[var(--color-text-muted)]">부서</TableHead>
                                <TableHead className="text-[var(--color-text-muted)]">2FA</TableHead>
                                <TableHead className="text-[var(--color-text-muted)]">상태</TableHead>
                                <TableHead className="text-[var(--color-text-muted)]">생성일</TableHead>
                                <TableHead className="text-right text-[var(--color-text-muted)]" />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                Array.from({ length: 3 }).map((_, i) => (
                                    <TableRow key={i}>
                                        {Array.from({ length: 8 }).map((_, j) => (
                                            <TableCell key={j}><div className="h-4 rounded bg-[var(--color-surface)] animate-pulse" /></TableCell>
                                        ))}
                                    </TableRow>
                                ))
                            ) : !users?.length ? (
                                <TableRow>
                                    <TableCell colSpan={8} className="text-center py-8 text-[var(--color-text-muted)]">
                                        사용자가 없습니다
                                    </TableCell>
                                </TableRow>
                            ) : (
                                users.map((u) => (
                                    <TableRow key={u.id} className="group/row border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-hover)]">
                                        <TableCell className="font-mono text-sm">{u.username}</TableCell>
                                        <TableCell>{u.display_name}</TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className={ROLE_COLORS[u.role] ?? ""}>
                                                {ROLE_LABELS[u.role] ?? u.role}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            {u.department ? (
                                                <Badge variant="outline" className={DEPT_COLORS[u.department] ?? "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"}>
                                                    {u.department}
                                                </Badge>
                                            ) : (
                                                <span className="text-[var(--color-text-muted)]">-</span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {u.has_totp ? (
                                                <ShieldCheck className="w-4 h-4 text-green-400" />
                                            ) : (
                                                <span className="text-[var(--color-text-muted)]">-</span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            {u.is_active ? (
                                                <span className="text-green-400 text-xs">활성</span>
                                            ) : (
                                                <span className="text-[var(--color-text-muted)] text-xs">비활성</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-[var(--color-text-muted)] text-xs">
                                            {new Date(u.created_at).toLocaleDateString("ko-KR")}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex items-center justify-end gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
                                                <EditUserDialog
                                                    user={u}
                                                    trigger={
                                                        <Button variant="ghost" size="icon" className="h-7 w-7">
                                                            <Pencil className="w-3.5 h-3.5" />
                                                        </Button>
                                                    }
                                                />
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-400 hover:text-rose-300">
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </Button>
                                                    </AlertDialogTrigger>
                                                    <AlertDialogContent>
                                                        <AlertDialogHeader>
                                                            <AlertDialogTitle>사용자 삭제</AlertDialogTitle>
                                                            <AlertDialogDescription>
                                                                {u.display_name} ({u.username})을(를) 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
                                                            </AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                            <AlertDialogCancel>취소</AlertDialogCancel>
                                                            <AlertDialogAction onClick={() => deleteUser(u.id)} className="bg-rose-500 hover:bg-rose-600">
                                                                삭제
                                                            </AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </div>
        </div>
    );
}
