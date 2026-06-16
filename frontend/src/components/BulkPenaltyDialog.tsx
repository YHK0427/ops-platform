import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useGivePenalty, useCreateTransaction, useMembers, useSessions } from "@/hooks";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

// ── 모드 ────────────────────────────────────────────────────────────

type Mode = "preset" | "manual";

// ── 프리셋 (penalty_engine 매트릭스 전체) ────────────────────────────

interface Preset {
    label: string;
    score: number;
    deposit: number;
    reason: string;
}

const PENALTY_PRESETS: Preset[] = [
    // 출결 — 지각 (10분 미만)
    { label: "10분미만 지각 (사전)", score: 1, deposit: 2000, reason: "지각(10분 미만) (사전)" },
    { label: "10분미만 지각 (사후)", score: 1, deposit: 3000, reason: "지각(10분 미만) (사후)" },
    { label: "10분미만 지각 (사유서X)", score: 1, deposit: 4000, reason: "지각(10분 미만) (사유서없음)" },
    // 출결 — 지각 (10분 이상)
    { label: "10분이상 지각 (사전)", score: 2, deposit: 2000, reason: "지각(10분 이상) (사전)" },
    { label: "10분이상 지각 (사후)", score: 2, deposit: 3000, reason: "지각(10분 이상) (사후)" },
    { label: "10분이상 지각 (사유서X)", score: 2, deposit: 4000, reason: "지각(10분 이상) (사유서없음)" },
    // 출결 — 조퇴
    { label: "조퇴 (사전)", score: 2, deposit: 2000, reason: "조퇴 (사전)" },
    { label: "조퇴 (사후)", score: 2, deposit: 3000, reason: "조퇴 (사후)" },
    { label: "조퇴 (사유서X)", score: 2, deposit: 4000, reason: "조퇴 (사유서없음)" },
    // 출결 — 결석
    { label: "결석 (사전)", score: 4, deposit: 4000, reason: "결석 (사전)" },
    { label: "결석 (사후)", score: 4, deposit: 6000, reason: "결석 (사후)" },
    { label: "결석 (사유서X)", score: 4, deposit: 8000, reason: "결석 (사유서없음)" },
    // PPT 이메일
    { label: "PPT이메일 지연제출", score: 1, deposit: 1000, reason: "PPT이메일 지연제출" },
    { label: "PPT이메일 미제출", score: 2, deposit: 3000, reason: "PPT이메일 미제출" },
    // 과제/리뷰/피드백
    { label: "과제 미제출", score: 1, deposit: 1000, reason: "미제출: 과제" },
    // 기타
    { label: "무임승차 (주요세션)", score: 5, deposit: 0, reason: "주요세션 무임승차" },
];

// ── 수동 거래 유형 ──────────────────────────────────────────────────

const MANUAL_TYPES = [
    { value: "FINE", label: "벌금 (-)", deduct: true },
    { value: "DEPOSIT_RECHARGE", label: "디파짓 충전 (+)", deduct: false },
    { value: "DEPOSIT_ADJUST", label: "디파짓 차감 (-)", deduct: true },
    { value: "DEPOSIT_REFUND", label: "디파짓 환급 (+)", deduct: false },
    { value: "ADJUSTMENT", label: "기타 조정", deduct: false },
];

interface BulkPenaltyDialogProps {
    trigger?: React.ReactNode;
}

export function BulkPenaltyDialog({ trigger }: BulkPenaltyDialogProps) {
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<Mode>("preset");

    // 공통
    const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
    const [reason, setReason] = useState("");
    const [sessionId, setSessionId] = useState<number | undefined>(undefined);
    const [memberSearch, setMemberSearch] = useState("");
    const [processing, setProcessing] = useState(false);

    // 프리셋 모드
    const [activePreset, setActivePreset] = useState<number | null>(null);
    const [score, setScore] = useState(1);
    const [deposit, setDeposit] = useState(0);

    // 수동 모드
    const [manualType, setManualType] = useState("FINE");
    const [manualAmount, setManualAmount] = useState(0);
    const [manualScore, setManualScore] = useState(0);

    const { data: members } = useMembers(true);
    const { data: sessions } = useSessions();
    const { mutateAsync: givePenalty } = useGivePenalty();
    const { mutateAsync: createTransaction } = useCreateTransaction();
    const filteredMembers = members?.filter((m: any) => m.name.includes(memberSearch));

    const selectPreset = (idx: number) => {
        const p = PENALTY_PRESETS[idx];
        setActivePreset(idx);
        setScore(p.score);
        setDeposit(p.deposit);
        if (p.reason) setReason(p.reason);
    };

    const toggleMember = (id: number) => {
        setSelectedMembers(prev =>
            prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
        );
    };

    const resetForm = () => {
        setSelectedMembers([]);
        setReason("");
        setScore(1);
        setDeposit(0);
        setActivePreset(null);
        setManualType("FINE");
        setManualAmount(0);
        setManualScore(0);
        setSessionId(undefined);
        setMemberSearch("");
    };

    const handleSubmit = async () => {
        if (selectedMembers.length === 0) return toast.error("멤버를 선택해주세요.");
        if (!reason) return toast.error("사유를 입력해주세요.");

        setProcessing(true);
        try {
            if (mode === "preset") {
                for (const memberId of selectedMembers) {
                    await givePenalty({
                        member_id: memberId,
                        score_delta: -score,
                        deposit_delta: deposit > 0 ? -deposit : 0,
                        description: reason,
                        session_id: sessionId,
                    });
                }
            } else {
                const isDeduct = MANUAL_TYPES.find(t => t.value === manualType)?.deduct ?? false;
                for (const memberId of selectedMembers) {
                    await createTransaction({
                        member_id: memberId,
                        type: manualType,
                        amount_krw: isDeduct ? -Math.abs(manualAmount) : Math.abs(manualAmount),
                        score_delta: manualScore,
                        description: reason,
                        session_id: sessionId,
                    });
                }
            }
            setOpen(false);
            resetForm();
        } catch {
            toast.error("처리 실패");
        } finally {
            setProcessing(false);
        }
    };

    const isDeduct = MANUAL_TYPES.find(t => t.value === manualType)?.deduct ?? false;

    return (
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setActivePreset(null); } }}>
            <DialogTrigger asChild>
                {trigger || (
                    <Button variant="outline" className="text-rose-500 border-rose-500/20 hover:bg-rose-500/10">
                        <AlertTriangle className="w-4 h-4 mr-2" />
                        벌점/벌금 부여
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[520px] flex flex-col max-h-[90vh]">
                <DialogHeader>
                    <DialogTitle>벌점 및 벌금 부여</DialogTitle>
                    <DialogDescription>
                        프리셋으로 벌점+벌금을 동시에 부여하거나, 수동으로 거래를 생성합니다.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4 overflow-y-auto min-h-0 flex-1">
                    {/* 모드 전환 */}
                    <div className="flex gap-1 p-0.5 bg-[var(--color-hover)] rounded-lg">
                        <button
                            type="button"
                            onClick={() => setMode("preset")}
                            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                                mode === "preset" ? "bg-white shadow text-rose-600" : "text-[var(--color-text-muted)]"
                            }`}
                        >
                            벌점 프리셋
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode("manual")}
                            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                                mode === "manual" ? "bg-white shadow text-blue-600" : "text-[var(--color-text-muted)]"
                            }`}
                        >
                            수동 거래
                        </button>
                    </div>

                    {mode === "preset" ? (
                        <>
                            {/* 프리셋 선택 */}
                            <div className="space-y-2">
                                <Label>프리셋 선택</Label>
                                <div className="grid grid-cols-3 gap-1.5 max-h-[180px] overflow-y-auto">
                                    {PENALTY_PRESETS.map((p, idx) => (
                                        <button
                                            key={idx}
                                            type="button"
                                            onClick={() => selectPreset(idx)}
                                            className={`px-2 py-1.5 text-xs rounded-lg border transition-colors text-left ${
                                                activePreset === idx
                                                    ? "bg-rose-500/15 border-rose-500/40 text-rose-500"
                                                    : "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-rose-500/30"
                                            }`}
                                        >
                                            <div className="font-medium leading-tight">{p.label}</div>
                                            <div className="text-[10px] opacity-60 mt-0.5">
                                                -{p.score}점{p.deposit > 0 ? ` / -${p.deposit.toLocaleString()}원` : ""}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label className="text-right">벌점</Label>
                                <div className="col-span-3 relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-rose-500 font-medium text-sm">-</span>
                                    <Input type="number" value={score}
                                        onChange={(e) => { setScore(Math.abs(Number(e.target.value)) || 0); setActivePreset(null); }}
                                        min={1} className="pl-7" />
                                </div>
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label className="text-right">디파짓 차감</Label>
                                <div className="col-span-3 relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-rose-500 font-medium text-sm">-</span>
                                    <Input type="number" value={deposit}
                                        onChange={(e) => { setDeposit(Math.abs(Number(e.target.value)) || 0); setActivePreset(null); }}
                                        min={0} placeholder="0" className="pl-7" />
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            {/* 수동 거래 */}
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label className="text-right">유형</Label>
                                <Select value={manualType} onValueChange={(v) => { setManualType(v); setManualAmount(0); }}>
                                    <SelectTrigger className="col-span-3">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {MANUAL_TYPES.map(t => (
                                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label className="text-right">{isDeduct ? "차감 금액" : "금액"}</Label>
                                <div className="col-span-3 relative">
                                    <span className={`absolute left-3 top-1/2 -translate-y-1/2 font-medium text-sm ${isDeduct ? "text-rose-500" : "text-green-600"}`}>
                                        {isDeduct ? "-" : "+"}
                                    </span>
                                    <Input type="number" value={manualAmount}
                                        onChange={(e) => setManualAmount(Math.abs(parseInt(e.target.value) || 0))}
                                        min={0} className="pl-7" placeholder="원" />
                                </div>
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label className="text-right">점수</Label>
                                <Input type="number" value={manualScore}
                                    onChange={(e) => setManualScore(parseInt(e.target.value) || 0)}
                                    className="col-span-3" placeholder="0 (변동 없으면 0)" />
                            </div>
                        </>
                    )}

                    {/* 공통: 사유 */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">사유</Label>
                        <Input value={reason}
                            onChange={(e) => { setReason(e.target.value); if (activePreset !== null) setActivePreset(null); }}
                            placeholder="사유를 입력하세요"
                            className="col-span-3" />
                    </div>

                    {/* 공통: 세션 */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">세션</Label>
                        <Select value={sessionId != null ? String(sessionId) : "none"} onValueChange={(v) => setSessionId(v === "none" ? undefined : Number(v))}>
                            <SelectTrigger className="col-span-3 h-9">
                                <SelectValue placeholder="세션 없음" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">세션 없음</SelectItem>
                                {(sessions ?? []).map((s: any) => (
                                    <SelectItem key={s.id} value={String(s.id)}>{s.week_num}주차 — {s.title}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* 공통: 멤버 선택 */}
                    <div className="space-y-2">
                        <Label>멤버 선택 ({selectedMembers.length}명)</Label>
                        <Input placeholder="멤버 검색..."
                            value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)}
                            className="h-8 text-sm" />
                        <div className="h-[160px] overflow-y-auto border rounded-md p-2 space-y-1">
                            {filteredMembers?.map((member: any) => (
                                <div key={member.id}
                                    className="flex items-center space-x-2 p-1 hover:bg-accent rounded cursor-pointer"
                                    onClick={() => toggleMember(member.id)}>
                                    <Checkbox checked={selectedMembers.includes(member.id)} />
                                    <span className="text-sm">{member.name}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* 미리보기 */}
                    {selectedMembers.length > 0 && reason && (
                        <div className="rounded-lg bg-rose-500/5 border border-rose-500/20 px-4 py-3 text-sm space-y-1">
                            {mode === "preset" ? (
                                <>
                                    <div className="flex justify-between">
                                        <span className="text-[var(--color-text-muted)]">{selectedMembers.length}명 × -{score}점</span>
                                        <span className="text-rose-500 font-medium">"{reason}"</span>
                                    </div>
                                    {deposit > 0 && (
                                        <div className="flex justify-between">
                                            <span className="text-[var(--color-text-muted)]">디파짓 차감</span>
                                            <span className="text-rose-500">-{deposit.toLocaleString()}원 × {selectedMembers.length}명</span>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="flex justify-between">
                                    <span className="text-[var(--color-text-muted)]">{selectedMembers.length}명 × {isDeduct ? "-" : "+"}{manualAmount.toLocaleString()}원</span>
                                    <span className="text-[var(--color-text-secondary)] font-medium">"{reason}"</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button
                        onClick={handleSubmit}
                        disabled={processing || selectedMembers.length === 0 || !reason ||
                            (mode === "preset" && score <= 0) ||
                            (mode === "manual" && manualAmount === 0 && manualScore === 0)}
                        className={mode === "preset" ? "bg-rose-600 hover:bg-rose-700" : "bg-blue-600 hover:bg-blue-700"}
                    >
                        {processing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        {processing ? `처리 중 (${selectedMembers.length}명)...` : mode === "preset" ? "벌점/벌금 부여" : "거래 생성"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
