import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useGivePenalty, useSessions } from "@/hooks";
import { usePenaltyRules } from "@/hooks/usePenaltyRules";
import { buildPenaltyPresets } from "@/lib/penaltyRules";

interface Preset {
    label: string;
    score: number;
    deposit: number;
    desc: string;
}


interface GivePenaltyDialogProps {
    memberId: number;
    memberName: string;
    trigger?: React.ReactNode;
}

export function GivePenaltyDialog({ memberId, memberName, trigger }: GivePenaltyDialogProps) {
    const [open, setOpen] = useState(false);
    const [preset, setPreset] = useState<number | null>(null);
    const [score, setScore] = useState(1);
    const [deposit, setDeposit] = useState(0);
    const [desc, setDesc] = useState("");
    const [sessionId, setSessionId] = useState<number | undefined>(undefined);
    const { mutate: givePenalty, isPending } = useGivePenalty();
    const { data: sessions } = useSessions();
    const rules = usePenaltyRules();
    // 프리셋은 기수 벌점 규칙에서 — 정산과 같은 금액. 마지막은 직접 입력.
    const PRESETS: Preset[] = useMemo(
        () => [...(rules ? buildPenaltyPresets(rules) : []), { label: "직접 입력", score: 0, deposit: 0, desc: "" }],
        [rules],
    );

    const selectPreset = (idx: number) => {
        const p = PRESETS[idx];
        setPreset(idx);
        if (idx !== PRESETS.length - 1) setScore(p.score); // 규칙상 0점(차감만)인 항목도 그대로
        setDeposit(p.deposit);
        if (p.desc) setDesc(p.desc);
    };

    const isCustom = preset === PRESETS.length - 1;

    const handleSubmit = () => {
        if ((score <= 0 && deposit <= 0) || !desc) return;
        // 양수 입력 → 음수로 변환해서 전송
        givePenalty(
            {
                member_id: memberId,
                score_delta: -score,
                deposit_delta: deposit > 0 ? -deposit : 0,
                description: desc,
                session_id: sessionId,
            },
            {
                onSuccess: () => {
                    setOpen(false);
                    setPreset(null);
                    setScore(1);
                    setDeposit(0);
                    setDesc("");
                    setSessionId(undefined);
                },
            }
        );
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger || (
                    <Button variant="outline" className="text-rose-500 border-rose-500/20 hover:bg-rose-500/10">
                        <AlertTriangle className="w-4 h-4 mr-2" />
                        벌점 부여
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] flex flex-col max-h-[90vh]">
                <DialogHeader>
                    <DialogTitle>벌점 부여 — {memberName}</DialogTitle>
                    <DialogDescription>
                        수동 벌점을 부여합니다. 누적벌점 {rules?.milestone_every ?? 10}점 단위 도달 시 벌금 {(rules?.milestone_fine ?? 5000).toLocaleString()}원이 자동 부과됩니다.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4 overflow-y-auto min-h-0 flex-1">
                    {/* Presets */}
                    <div className="space-y-2">
                        <Label>유형 선택</Label>
                        <div className="grid grid-cols-3 gap-1.5 max-h-[200px] overflow-y-auto">
                            {PRESETS.map((p, idx) => (
                                <button
                                    key={idx}
                                    type="button"
                                    onClick={() => selectPreset(idx)}
                                    className={`px-2 py-1.5 text-xs rounded-lg border transition-colors text-left ${
                                        preset === idx
                                            ? "bg-rose-500/15 border-rose-500/40 text-rose-500"
                                            : "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-rose-500/30"
                                    }`}
                                >
                                    <div className="font-medium leading-tight">{p.label}</div>
                                    {(p.score !== 0 || p.deposit !== 0) && (
                                        <div className="text-[10px] opacity-60 mt-0.5">
                                            {p.score > 0 ? `-${p.score}점` : ""}{p.score > 0 && p.deposit > 0 ? " / " : ""}{p.deposit > 0 ? `-${p.deposit.toLocaleString()}원` : ""}
                                        </div>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Score input */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">벌점</Label>
                        <div className="col-span-3 relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-rose-500 font-medium text-sm">-</span>
                            <Input
                                type="number"
                                value={score}
                                onChange={(e) => setScore(Math.abs(Number(e.target.value)) || 0)}
                                min={1}
                                className="pl-7"
                                disabled={!isCustom && preset !== null}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">디파짓 차감</Label>
                        <div className="col-span-3 relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-rose-500 font-medium text-sm">-</span>
                            <Input
                                type="number"
                                value={deposit}
                                onChange={(e) => { setDeposit(Math.abs(Number(e.target.value)) || 0); setPreset(PRESETS.length - 1); }}
                                min={0}
                                placeholder="0 (차감 없음)"
                                className="pl-7"
                                disabled={!isCustom && preset !== null}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">사유</Label>
                        <Input
                            value={desc}
                            onChange={(e) => setDesc(e.target.value)}
                            placeholder="예: Listen Up 무임승차"
                            className="col-span-3"
                        />
                    </div>

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

                    {/* Preview */}
                    {(score > 0 || deposit > 0) && (
                        <div className="rounded-lg bg-rose-500/5 border border-rose-500/20 px-4 py-3 text-sm space-y-1">
                            {score > 0 && (
                                <div className="flex justify-between">
                                    <span className="text-[var(--color-text-muted)]">벌점</span>
                                    <span className="text-rose-500 font-medium">-{score}점</span>
                                </div>
                            )}
                            {deposit > 0 && (
                                <div className="flex justify-between">
                                    <span className="text-[var(--color-text-muted)]">디파짓 차감</span>
                                    <span className="text-rose-500 font-medium">-{deposit.toLocaleString()}원</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button
                        onClick={handleSubmit}
                        disabled={isPending || (score <= 0 && deposit <= 0) || !desc}
                        className="bg-rose-600 hover:bg-rose-700"
                    >
                        {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        벌점 부여
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
