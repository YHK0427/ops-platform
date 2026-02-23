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
import { useGiveMerit, useMembers } from "@/hooks";
import { Checkbox } from "@/components/ui/checkbox";

interface GrantMeritDialogProps {
    trigger?: React.ReactNode;
}

export function GrantMeritDialog({ trigger }: GrantMeritDialogProps) {
    const [open, setOpen] = useState(false);
    const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
    const [reason, setReason] = useState("");
    const [score, setScore] = useState(1);

    const { data: members } = useMembers(true); // Active members
    const { mutate: giveMerit, isPending } = useGiveMerit();

    const handleSubmit = () => {
        if (selectedMembers.length === 0) return;

        giveMerit({
            member_ids: selectedMembers,
            score_delta: score,
            reason,
        }, {
            onSuccess: () => {
                setOpen(false);
                setSelectedMembers([]);
                setReason("");
                setScore(1);
            }
        });
    };

    const toggleMember = (id: number) => {
        setSelectedMembers(prev =>
            prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
        );
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger || (
                    <Button variant="outline">
                        <Trophy className="w-4 h-4 mr-2" />
                        Grant Merit
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Grant Merit (상점 부여)</DialogTitle>
                    <DialogDescription>
                        우수 활동 멤버에게 상점을 부여합니다.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="score" className="text-right">
                            Score
                        </Label>
                        <Input
                            id="score"
                            type="number"
                            value={score}
                            onChange={(e) => setScore(Number(e.target.value))}
                            className="col-span-3"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="reason" className="text-right">
                            Reason
                        </Label>
                        <Input
                            id="reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="e.g. Best Question"
                            className="col-span-3"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Select Members ({selectedMembers.length})</Label>
                        <div className="h-[200px] overflow-y-auto border rounded-md p-2 space-y-1">
                            {members?.map(member => (
                                <div key={member.id} className="flex items-center space-x-2 p-1 hover:bg-accent rounded cursor-pointer" onClick={() => toggleMember(member.id)}>
                                    <Checkbox checked={selectedMembers.includes(member.id)} />
                                    <span className="text-sm">{member.name}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button onClick={handleSubmit} disabled={isPending || selectedMembers.length === 0}>
                        {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        Grant
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
