import { useState } from "react";
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
import { AlertTriangle, Loader2 } from "lucide-react";
import { useGivePenalty, useMembers } from "@/hooks";
import { Checkbox } from "@/components/ui/checkbox";

interface Preset {
    label: string;
    score: number;
    reason: string;
}

const PRESETS: Preset[] = [
    { label: "무임승차 (주요세션)", score: 5, reason: "주요세션 무임승차" },
    { label: "기타 벌점 (1점)", score: 1, reason: "" },
    { label: "기타 벌점 (2점)", score: 2, reason: "" },
];

interface BulkPenaltyDialogProps {
    trigger?: React.ReactNode;
}

export function BulkPenaltyDialog({ trigger }: BulkPenaltyDialogProps) {
    const [open, setOpen] = useState(false);
    const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
    const [score, setScore] = useState(1);
    const [reason, setReason] = useState("");
    const [activePreset, setActivePreset] = useState<number | null>(null);
    const [processing, setProcessing] = useState(false);
    const [memberSearch, setMemberSearch] = useState("");

    const { data: members } = useMembers(true);
    const filteredMembers = members?.filter((m: any) => m.name.includes(memberSearch));
    const { mutateAsync: givePenalty } = useGivePenalty();

    const selectPreset = (idx: number) => {
        const p = PRESETS[idx];
        setActivePreset(idx);
        setScore(p.score);
        if (p.reason) setReason(p.reason);
    };

    const toggleMember = (id: number) => {
        setSelectedMembers(prev =>
            prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
        );
    };

    const handleSubmit = async () => {
        if (selectedMembers.length === 0 || score <= 0 || !reason) return;
        setProcessing(true);
        try {
            for (const memberId of selectedMembers) {
                await givePenalty({
                    member_id: memberId,
                    score_delta: -score,
                    description: reason,
                });
            }
            setOpen(false);
            setSelectedMembers([]);
            setScore(1);
            setReason("");
            setActivePreset(null);
        } finally {
            setProcessing(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setActivePreset(null); }}>
            <DialogTrigger asChild>
                {trigger || (
                    <Button variant="outline" className="text-rose-400 border-rose-500/20 hover:bg-rose-500/10">
                        <AlertTriangle className="w-4 h-4 mr-2" />
                        벌점 부여
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[460px]">
                <DialogHeader>
                    <DialogTitle>벌점 일괄 부여</DialogTitle>
                    <DialogDescription>
                        선택한 멤버들에게 벌점을 부여합니다. 누적벌점 10점 단위 도달 시 벌금이 자동 부과됩니다.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    {/* Presets */}
                    <div className="space-y-2">
                        <Label>프리셋 선택</Label>
                        <div className="flex flex-wrap gap-1.5">
                            {PRESETS.map((p, idx) => (
                                <button
                                    key={idx}
                                    type="button"
                                    onClick={() => selectPreset(idx)}
                                    className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
                                        activePreset === idx
                                            ? "bg-rose-500/15 border-rose-500/40 text-rose-400"
                                            : "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-rose-500/30"
                                    }`}
                                >
                                    {p.label} <span className="opacity-60">-{p.score}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">벌점</Label>
                        <div className="col-span-3 relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-rose-400 font-medium text-sm">-</span>
                            <Input
                                type="number"
                                value={score}
                                onChange={(e) => { setScore(Math.abs(Number(e.target.value)) || 0); setActivePreset(null); }}
                                min={1}
                                className="pl-7"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">사유</Label>
                        <Input
                            value={reason}
                            onChange={(e) => { setReason(e.target.value); if (activePreset !== null) setActivePreset(null); }}
                            placeholder="예: Listen Up 무임승차"
                            className="col-span-3"
                        />
                    </div>

                    {/* Member select */}
                    <div className="space-y-2">
                        <Label>멤버 선택 ({selectedMembers.length}명)</Label>
                        <Input
                            placeholder="멤버 검색..."
                            value={memberSearch}
                            onChange={(e) => setMemberSearch(e.target.value)}
                            className="h-8 text-sm"
                        />
                        <div className="h-[200px] overflow-y-auto border rounded-md p-2 space-y-1">
                            {filteredMembers?.map(member => (
                                <div
                                    key={member.id}
                                    className="flex items-center space-x-2 p-1 hover:bg-accent rounded cursor-pointer"
                                    onClick={() => toggleMember(member.id)}
                                >
                                    <Checkbox checked={selectedMembers.includes(member.id)} />
                                    <span className="text-sm">{member.name}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Preview */}
                    {selectedMembers.length > 0 && score > 0 && reason && (
                        <div className="rounded-lg bg-rose-500/5 border border-rose-500/20 px-4 py-3 text-sm">
                            <div className="flex justify-between">
                                <span className="text-[var(--color-text-muted)]">{selectedMembers.length}명 × -{score}점</span>
                                <span className="text-rose-400 font-medium">"{reason}"</span>
                            </div>
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button
                        onClick={handleSubmit}
                        disabled={processing || selectedMembers.length === 0 || score <= 0 || !reason}
                        className="bg-rose-600 hover:bg-rose-700"
                    >
                        {processing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        {processing ? `처리 중 (${selectedMembers.length}명)...` : "벌점 부여"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
