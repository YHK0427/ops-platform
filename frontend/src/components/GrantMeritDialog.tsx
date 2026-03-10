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
import { Trophy, Loader2 } from "lucide-react";
import { useGiveMerit, useMembers, useAddStagedMerit } from "@/hooks";
import { Checkbox } from "@/components/ui/checkbox";

interface TeamInfo {
    name: string;
    memberIds: number[];
}

interface Preset {
    label: string;
    score: number;
    reason: string;
}

// 세션 내에서 사용 (Settlement 탭)
const SESSION_PRESETS: Preset[] = [
    { label: "친바 선정팀", score: 1, reason: "친바 선정팀 포상" },
    { label: "LU/BP 1등", score: 4, reason: "Listen Up/BP 1등" },
    { label: "LU/BP 2등", score: 4, reason: "Listen Up/BP 2등" },
    { label: "피날래 본선 진출", score: 3, reason: "피날래 본선 진출" },
    { label: "베스트 협력상", score: 1, reason: "베스트 협력상" },
];

// 세션 외부에서 사용 (장부/멤버 페이지)
const GENERAL_PRESETS: Preset[] = [
    { label: "발전왕 선발", score: 4, reason: "발전왕 선발" },
    { label: "추억상자 글 작성", score: 1, reason: "추억상자 글 작성" },
    { label: "번개 주최 완료", score: 1, reason: "번개 주최 완료" },
    { label: "번개 참석 (2회)", score: 1, reason: "번개 참석 2회" },
    { label: "오프/오피", score: 1, reason: "오프/오피 참여" },
    { label: "정보성 자료 공유", score: 1, reason: "카페 정보성 자료 공유" },
];

interface GrantMeritDialogProps {
    trigger?: React.ReactNode;
    preselectedMemberId?: number;
    sessionId?: number;
    teams?: TeamInfo[];
}

export function GrantMeritDialog({ trigger, preselectedMemberId, sessionId, teams }: GrantMeritDialogProps) {
    const [open, setOpen] = useState(false);
    const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
    const [reason, setReason] = useState("");
    const [score, setScore] = useState(1);
    const [activePreset, setActivePreset] = useState<number | null>(null);
    const [memberSearch, setMemberSearch] = useState("");

    const { data: members } = useMembers(true);
    const filteredMembers = members?.filter((m: any) => m.name.includes(memberSearch));
    const { mutate: addStagedMerit, isPending: isStagedPending } = useAddStagedMerit();
    const { mutate: giveMerit, isPending: isDirectPending } = useGiveMerit();

    const isSession = sessionId != null;
    const isPending = isSession ? isStagedPending : isDirectPending;
    const effectiveMembers = preselectedMemberId ? [preselectedMemberId] : selectedMembers;
    const presets = isSession ? SESSION_PRESETS : GENERAL_PRESETS;

    const selectPreset = (idx: number) => {
        const p = presets[idx];
        setActivePreset(idx);
        setScore(p.score);
        setReason(p.reason);
    };

    const handleSubmit = () => {
        if (effectiveMembers.length === 0) return;

        const onSuccess = () => {
            setOpen(false);
            setSelectedMembers([]);
            setReason("");
            setScore(1);
            setActivePreset(null);
        };

        if (isSession) {
            addStagedMerit({
                sessionId: sessionId!,
                member_ids: effectiveMembers,
                score_delta: score,
                reason,
            }, { onSuccess });
        } else {
            giveMerit({
                member_ids: effectiveMembers,
                score_delta: score,
                reason,
            }, { onSuccess });
        }
    };

    const toggleMember = (id: number) => {
        setSelectedMembers(prev =>
            prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
        );
    };

    const toggleTeam = (memberIds: number[]) => {
        const allSelected = memberIds.every(id => selectedMembers.includes(id));
        if (allSelected) {
            setSelectedMembers(prev => prev.filter(id => !memberIds.includes(id)));
        } else {
            setSelectedMembers(prev => [...new Set([...prev, ...memberIds])]);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setActivePreset(null); }}>
            <DialogTrigger asChild>
                {trigger || (
                    <Button variant="outline">
                        <Trophy className="w-4 h-4 mr-2" />
                        상점 부여
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[460px]">
                <DialogHeader>
                    <DialogTitle>{isSession ? "상점 추가 (대기)" : "상점 부여"}</DialogTitle>
                    <DialogDescription>
                        {isSession
                            ? "세션 마감 시 일괄 적용됩니다."
                            : "우수 활동 멤버에게 상점을 부여합니다."}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    {/* Presets */}
                    <div className="space-y-2">
                        <Label>프리셋 선택</Label>
                        <div className="flex flex-wrap gap-1.5">
                            {presets.map((p, idx) => (
                                <button
                                    key={idx}
                                    type="button"
                                    onClick={() => selectPreset(idx)}
                                    className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
                                        activePreset === idx
                                            ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                                            : "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-emerald-500/30"
                                    }`}
                                >
                                    {p.label} <span className="opacity-60">+{p.score}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="score" className="text-right">
                            점수
                        </Label>
                        <div className="col-span-3 relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-400 font-medium text-sm">+</span>
                            <Input
                                id="score"
                                type="number"
                                value={score}
                                onChange={(e) => { setScore(Number(e.target.value)); setActivePreset(null); }}
                                min={1}
                                className="pl-7"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="reason" className="text-right">
                            사유
                        </Label>
                        <Input
                            id="reason"
                            value={reason}
                            onChange={(e) => { setReason(e.target.value); if (activePreset !== null) setActivePreset(null); }}
                            placeholder="예: 우수 질문"
                            className="col-span-3"
                        />
                    </div>
                    {!preselectedMemberId && (
                        <div className="space-y-2">
                            <Label>멤버 선택 ({selectedMembers.length}명)</Label>
                            {teams && teams.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {teams.map((team) => {
                                        const allSelected = team.memberIds.every(id => selectedMembers.includes(id));
                                        return (
                                            <button
                                                key={team.name}
                                                type="button"
                                                onClick={() => toggleTeam(team.memberIds)}
                                                className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                                                    allSelected
                                                        ? "bg-[var(--color-accent)]/20 border-[var(--color-accent)]/60 text-[var(--color-accent)]"
                                                        : "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/40"
                                                }`}
                                            >
                                                {team.name}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                            <Input
                                placeholder="멤버 검색..."
                                value={memberSearch}
                                onChange={(e) => setMemberSearch(e.target.value)}
                                className="h-8 text-sm"
                            />
                            <div className="h-[200px] overflow-y-auto border rounded-md p-2 space-y-1">
                                {filteredMembers?.map(member => (
                                    <div key={member.id} className="flex items-center space-x-2 p-1 hover:bg-accent rounded cursor-pointer" onClick={() => toggleMember(member.id)}>
                                        <Checkbox checked={selectedMembers.includes(member.id)} />
                                        <span className="text-sm">{member.name}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Preview */}
                    {effectiveMembers.length > 0 && score > 0 && reason && (
                        <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 px-4 py-3 text-sm">
                            <div className="flex justify-between">
                                <span className="text-[var(--color-text-muted)]">{effectiveMembers.length}명 × +{score}점</span>
                                <span className="text-emerald-400 font-medium">"{reason}"</span>
                            </div>
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleSubmit} disabled={isPending || effectiveMembers.length === 0 || score <= 0 || !reason}>
                        {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        {isSession ? "추가" : "부여"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
