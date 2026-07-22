import { useState, useMemo } from "react";
import { Shield, Plus, Pencil, ShieldCheck, ShieldOff, Loader2, RotateCcw, Trash2, Users, UserCog, Check, X, KeyRound } from "lucide-react";
import { useAdminUsers, useCreateAdminUser, useUpdateAdminUser, useDeleteAdminUser, useBulkCreateGeneration, useBulkDeleteGeneration, useBulkResetGenPassword, useCreateGenAccount, useUpdateGenAccount, useDeleteGenAccount, useGenAccounts, adminUserKeys, useMembers } from "@/hooks";
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
    scoring_only: "외부 임시(심사 전용)",
};

const ROLE_COLORS: Record<string, string> = {
    admin: "bg-rose-500/15 text-rose-600 border-rose-500/30",
    manager: "bg-blue-500/15 text-blue-600 border-blue-500/30",
    viewer: "bg-zinc-500/15 text-zinc-600 border-zinc-500/30",
    scoring_only: "bg-amber-500/15 text-amber-600 border-amber-500/30",
};

const DEPARTMENTS = ["회장단", "인홍부", "학술부", "기획부", "총무부"] as const;

const DEPT_COLORS: Record<string, string> = {
    "회장단": "bg-rose-500/10 text-rose-600 border-rose-500/20",
    "인홍부": "bg-purple-500/10 text-purple-600 border-purple-500/20",
    "학술부": "bg-blue-500/10 text-blue-600 border-blue-500/20",
    "기획부": "bg-green-500/10 text-green-600 border-green-500/20",
    "총무부": "bg-amber-500/10 text-amber-600 border-amber-500/20",
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
                                <SelectItem value="scoring_only">외부 임시(심사 전용)</SelectItem>
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

function EditUserDialog({ user, trigger }: { user: { id: number; username: string; display_name: string; role: string; department: string | null; is_active: boolean }; trigger: React.ReactNode }) {
    const [open, setOpen] = useState(false);
    const [username, setUsername] = useState(user.username);
    const [displayName, setDisplayName] = useState(user.display_name);
    const [role, setRole] = useState(user.role);
    const [department, setDepartment] = useState(user.department ?? "");
    const [password, setPassword] = useState("");
    const [isActive, setIsActive] = useState(user.is_active);
    const { mutate, isPending } = useUpdateAdminUser();

    const handleSubmit = () => {
        const body: Record<string, any> = { userId: user.id, display_name: displayName, role, is_active: isActive, department: department || null };
        if (username !== user.username) body.username = username;
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
                        <Label className="text-right">아이디</Label>
                        <Input value={username} onChange={(e) => setUsername(e.target.value)} className="col-span-3" />
                    </div>
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
                                <SelectItem value="scoring_only">외부 임시(심사 전용)</SelectItem>
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
            setCode("");
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
                            <ShieldCheck className="w-5 h-5 text-green-600" />
                            <span className="text-sm text-green-600">2FA 활성화됨</span>
                        </div>
                        <p className="text-xs text-[var(--color-text-muted)]">
                            새 기기에서 다시 등록하려면 QR을 다시 띄워 스캔하세요. (이 계정의 기존 2FA는 새 등록으로 교체됩니다)
                        </p>
                        <DialogFooter className="gap-2">
                            <Button variant="outline" onClick={handleSetup} disabled={loading}>
                                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                <Shield className="w-4 h-4 mr-2" />QR 다시 보기 (재등록)
                            </Button>
                            <Button variant="outline" onClick={handleDisable} disabled={loading} className="text-rose-500 hover:text-rose-600">
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
                            <ShieldCheck className="w-5 h-5 text-green-600" />
                            <span className="text-sm text-green-600">2FA가 성공적으로 활성화되었습니다.</span>
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
                <Button variant="outline" className="text-rose-600 border-rose-500/30 hover:bg-rose-500/10">
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
                        <span className="block font-bold text-rose-600">이 작업은 되돌릴 수 없습니다.</span>
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

// ── Generation Tab ──────────────────────────────────────────────────────────

function GenerationTab() {
    const { data: members, isLoading: membersLoading } = useMembers();
    const { data: accounts, isLoading: accountsLoading } = useGenAccounts();
    const { mutate: bulkCreate, isPending: isCreating } = useBulkCreateGeneration();
    const { mutate: bulkDelete, isPending: isDeleting } = useBulkDeleteGeneration();
    const { mutate: deleteAccount } = useDeleteGenAccount();
    const { mutate: bulkResetPw, isPending: isResettingPw } = useBulkResetGenPassword();
    const updateAccount = useUpdateGenAccount();
    const createAccount = useCreateGenAccount();
    const [bulkPassword, setBulkPassword] = useState("univpt33");
    const [resetPwOpen, setResetPwOpen] = useState(false);
    const [newBulkPw, setNewBulkPw] = useState("");
    const [editPwAccountId, setEditPwAccountId] = useState<number | null>(null);
    const [editPwValue, setEditPwValue] = useState("");
    // 개별 생성 / 아이디 수정
    const [createMember, setCreateMember] = useState<{ id: number; name: string } | null>(null);
    const [newUsername, setNewUsername] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [editIdAccount, setEditIdAccount] = useState<{ id: number; username: string } | null>(null);
    const [editIdValue, setEditIdValue] = useState("");

    const memberAccountStatus = useMemo(() => {
        if (!members || !accounts) return [];
        const accountMap = new Map(accounts.map((a) => [a.member_id, a]));
        return members
            .filter((m) => m.is_active)
            .map((m) => ({
                id: m.id,
                name: m.name,
                account: accountMap.get(m.id) ?? null,
            }))
            .sort((a, b) => a.name.localeCompare(b.name, "ko"));
    }, [members, accounts]);

    const accountCount = memberAccountStatus.filter((m) => m.account).length;
    const totalCount = memberAccountStatus.length;

    return (
        <div className="p-6 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="text-sm text-[var(--color-text-secondary)]">
                    활성 멤버 {totalCount}명 중 {accountCount}명 계정 보유
                </div>
                <div className="flex gap-2">
                    {accountCount > 0 && (
                        <Dialog open={resetPwOpen} onOpenChange={(v) => { setResetPwOpen(v); if (!v) setNewBulkPw(""); }}>
                            <DialogTrigger asChild>
                                <Button variant="outline">
                                    <KeyRound className="w-4 h-4 mr-2" />
                                    일괄 비번 변경
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[360px]">
                                <DialogHeader>
                                    <DialogTitle>일괄 비밀번호 변경</DialogTitle>
                                    <DialogDescription>기수 계정 {accountCount}개의 비밀번호를 일괄 변경합니다.</DialogDescription>
                                </DialogHeader>
                                <div className="grid grid-cols-4 items-center gap-4 py-2">
                                    <Label className="text-right">새 비번</Label>
                                    <Input value={newBulkPw} onChange={(e) => setNewBulkPw(e.target.value)} className="col-span-3" placeholder="새 비밀번호 입력" />
                                </div>
                                <DialogFooter>
                                    <Button onClick={() => { bulkResetPw(newBulkPw, { onSuccess: () => setResetPwOpen(false) }); }} disabled={isResettingPw || newBulkPw.length < 4}>
                                        {isResettingPw && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                        변경
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    )}
                    {accountCount > 0 && (
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="outline" className="text-rose-600 border-rose-500/30 hover:bg-rose-500/10" disabled={isDeleting}>
                                    {isDeleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    일괄 삭제
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>기수 계정 일괄 삭제</AlertDialogTitle>
                                    <AlertDialogDescription className="space-y-2">
                                        <span className="block">기수 계정 {accountCount}개를 모두 삭제합니다.</span>
                                        <span className="block font-bold text-rose-600">이 작업은 되돌릴 수 없습니다.</span>
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>취소</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => bulkDelete()} className="bg-rose-500 hover:bg-rose-600">삭제</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    )}
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button disabled={isCreating || totalCount === accountCount}>
                                {isCreating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                <Users className="w-4 h-4 mr-2" />
                                일괄 생성
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>기수 계정 일괄 생성</AlertDialogTitle>
                                <AlertDialogDescription className="space-y-2">
                                    <span className="block">활성 멤버 {totalCount - accountCount}명에 대해 계정을 생성합니다.</span>
                                    <span className="block">아이디: 멤버 이름 / 이미 계정이 있는 멤버는 건너뜁니다.</span>
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <div className="grid grid-cols-4 items-center gap-4 py-2">
                                <Label className="text-right">비밀번호</Label>
                                <Input value={bulkPassword} onChange={(e) => setBulkPassword(e.target.value)} className="col-span-3" placeholder="일괄 비밀번호" />
                            </div>
                            <AlertDialogFooter>
                                <AlertDialogCancel>취소</AlertDialogCancel>
                                <AlertDialogAction onClick={() => bulkCreate(bulkPassword)} disabled={!bulkPassword}>생성</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </div>

            <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="border-b border-[var(--color-border-subtle)] hover:bg-transparent">
                            <TableHead className="text-[var(--color-text-muted)]">이름</TableHead>
                            <TableHead className="text-[var(--color-text-muted)]">아이디</TableHead>
                            <TableHead className="text-[var(--color-text-muted)]">계정</TableHead>
                            <TableHead className="text-right text-[var(--color-text-muted)]" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {membersLoading || accountsLoading ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <TableRow key={i}>
                                    {Array.from({ length: 4 }).map((_, j) => (
                                        <TableCell key={j}><div className="h-4 rounded bg-[var(--color-surface)] animate-pulse" /></TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : !memberAccountStatus.length ? (
                            <TableRow>
                                <TableCell colSpan={4} className="text-center py-8 text-[var(--color-text-muted)]">
                                    활성 멤버가 없습니다
                                </TableCell>
                            </TableRow>
                        ) : (
                            memberAccountStatus.map((m) => (
                                <TableRow key={m.id} className="group/row border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-hover)]">
                                    <TableCell>{m.name}</TableCell>
                                    <TableCell className="font-mono text-sm text-[var(--color-text-secondary)]">
                                        {m.account?.username ?? "-"}
                                    </TableCell>
                                    <TableCell>
                                        {m.account ? (
                                            <Check className="w-4 h-4 text-green-600" />
                                        ) : (
                                            <X className="w-4 h-4 text-[var(--color-text-muted)]" />
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {!m.account ? (
                                            <Button variant="outline" size="sm" className="h-7"
                                                onClick={() => { setCreateMember({ id: m.id, name: m.name }); setNewUsername(""); setNewPassword(""); }}>
                                                <Plus className="w-3.5 h-3.5 mr-1" /> 계정 생성
                                            </Button>
                                        ) : (
                                            <div className="flex items-center justify-end gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
                                                <Button variant="ghost" size="icon" className="h-7 w-7" title="아이디 수정"
                                                    onClick={() => { setEditIdAccount({ id: m.account!.id, username: m.account!.username }); setEditIdValue(m.account!.username); }}>
                                                    <Pencil className="w-3.5 h-3.5" />
                                                </Button>
                                                <Button variant="ghost" size="icon" className="h-7 w-7" title="비밀번호 변경"
                                                    onClick={() => { setEditPwAccountId(m.account!.id); setEditPwValue(""); }}>
                                                    <KeyRound className="w-3.5 h-3.5" />
                                                </Button>
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-500 hover:text-rose-600" title="계정 삭제">
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </Button>
                                                    </AlertDialogTrigger>
                                                    <AlertDialogContent>
                                                        <AlertDialogHeader>
                                                            <AlertDialogTitle>계정 삭제</AlertDialogTitle>
                                                            <AlertDialogDescription>
                                                                {m.name}의 기수 계정을 삭제하시겠습니까?
                                                            </AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                            <AlertDialogCancel>취소</AlertDialogCancel>
                                                            <AlertDialogAction onClick={() => deleteAccount(m.account!.id)} className="bg-rose-500 hover:bg-rose-600">
                                                                삭제
                                                            </AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            </div>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            <Dialog open={editPwAccountId !== null} onOpenChange={(open) => { if (!open) setEditPwAccountId(null); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>비밀번호 변경</DialogTitle>
                        <DialogDescription>
                            새 비밀번호를 입력하세요. 비워두면 기본값(univpt33)으로 설정됩니다.
                        </DialogDescription>
                    </DialogHeader>
                    <Input
                        type="password"
                        placeholder="비워두면 univpt33"
                        value={editPwValue}
                        onChange={(e) => setEditPwValue(e.target.value)}
                    />
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditPwAccountId(null)}>취소</Button>
                        <Button
                            disabled={editPwValue.length > 0 && editPwValue.length < 4 || updateAccount.isPending}
                            onClick={() => {
                                if (editPwAccountId == null) return;
                                const pw = editPwValue.trim() || "univpt33";
                                updateAccount.mutate({ id: editPwAccountId, password: pw }, {
                                    onSuccess: () => setEditPwAccountId(null),
                                });
                            }}
                        >
                            {updateAccount.isPending ? "변경 중..." : "변경"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* 개별 계정 생성 */}
            <Dialog open={createMember !== null} onOpenChange={(o) => { if (!o) setCreateMember(null); }}>
                <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                        <DialogTitle>계정 생성</DialogTitle>
                        <DialogDescription>{createMember?.name}님의 기수 계정을 만듭니다.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-2">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label className="text-right">아이디</Label>
                            <Input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} className="col-span-3" placeholder="비우면 이름+기수번호 자동" />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label className="text-right">비밀번호</Label>
                            <Input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="col-span-3" placeholder="비우면 기본 비번(univpt+기수)" />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCreateMember(null)}>취소</Button>
                        <Button
                            disabled={createAccount.isPending || (newPassword.length > 0 && newPassword.length < 4)}
                            onClick={() => {
                                if (!createMember) return;
                                createAccount.mutate(
                                    { member_id: createMember.id, username: newUsername.trim() || undefined, password: newPassword.trim() || undefined },
                                    { onSuccess: () => setCreateMember(null) },
                                );
                            }}
                        >
                            {createAccount.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            생성
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* 아이디 수정 */}
            <Dialog open={editIdAccount !== null} onOpenChange={(o) => { if (!o) setEditIdAccount(null); }}>
                <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                        <DialogTitle>아이디 수정</DialogTitle>
                        <DialogDescription>로그인 아이디를 변경합니다.</DialogDescription>
                    </DialogHeader>
                    <div className="grid grid-cols-4 items-center gap-4 py-2">
                        <Label className="text-right">아이디</Label>
                        <Input value={editIdValue} onChange={(e) => setEditIdValue(e.target.value)} className="col-span-3" placeholder="새 아이디" />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditIdAccount(null)}>취소</Button>
                        <Button
                            disabled={updateAccount.isPending || !editIdValue.trim() || editIdValue.trim() === editIdAccount?.username}
                            onClick={() => {
                                if (!editIdAccount) return;
                                updateAccount.mutate({ id: editIdAccount.id, username: editIdValue.trim() }, {
                                    onSuccess: () => setEditIdAccount(null),
                                });
                            }}
                        >
                            {updateAccount.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            저장
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function AdminUsers() {
    const [tab, setTab] = useState<"users" | "generation">("users");
    const { data: users, isLoading } = useAdminUsers();
    const { mutate: deleteUser } = useDeleteAdminUser();
    const { user: currentUser } = useAuth();

    return (
        <div className="flex flex-col h-full">
            <PageHeader
                title="관리자"
                subtitle="사용자 및 기수 계정을 관리합니다"
                actions={
                    <div className="flex gap-2">
                        {currentUser?.role === "admin" && <SemesterResetButton />}
                        {currentUser?.role === "admin" && <TotpSetupDialog />}
                        {tab === "users" && <CreateUserDialog />}
                    </div>
                }
            />

            {/* Tab bar */}
            <div className="px-6 pt-2 flex gap-1 border-b border-[var(--color-border)]">
                <button
                    onClick={() => setTab("users")}
                    className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
                        tab === "users"
                            ? "bg-[var(--color-surface)] text-[var(--color-text-primary)] border border-b-0 border-[var(--color-border)]"
                            : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                    }`}
                >
                    <UserCog className="w-4 h-4" />
                    사용자 관리
                </button>
                <button
                    onClick={() => setTab("generation")}
                    className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
                        tab === "generation"
                            ? "bg-[var(--color-surface)] text-[var(--color-text-primary)] border border-b-0 border-[var(--color-border)]"
                            : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                    }`}
                >
                    <Users className="w-4 h-4" />
                    기수 관리
                </button>
            </div>

            {tab === "users" ? (
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
                                                    <Badge variant="outline" className={DEPT_COLORS[u.department] ?? "bg-zinc-500/10 text-zinc-600 border-zinc-500/20"}>
                                                        {u.department}
                                                    </Badge>
                                                ) : (
                                                    <span className="text-[var(--color-text-muted)]">-</span>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                {u.has_totp ? (
                                                    <ShieldCheck className="w-4 h-4 text-green-600" />
                                                ) : (
                                                    <span className="text-[var(--color-text-muted)]">-</span>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                {u.is_active ? (
                                                    <span className="text-green-600 text-xs">활성</span>
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
                                                            <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-500 hover:text-rose-600">
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
            ) : (
                <GenerationTab />
            )}
        </div>
    );
}
