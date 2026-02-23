import { useState, useEffect } from "react";
import { useUpdateMember, type Member } from "@/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";

interface MemberEditSheetProps {
    member: Member;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

// Predefined tags for convenience
const SUGGESTED_TAGS = ["leader", "backend", "frontend", "designer", "planner"];

export function MemberEditSheet({ member, open, onOpenChange }: MemberEditSheetProps) {
    const [name, setName] = useState(member.name);
    const [email, setEmail] = useState(member.email ?? "");
    const [tags, setTags] = useState<string[]>(member.tags || []);
    const [customTag, setCustomTag] = useState("");

    const updateMutation = useUpdateMember();

    // Reset state when member changes or sheet opens
    useEffect(() => {
        if (open) {
            setName(member.name);
            setEmail(member.email ?? "");
            setTags(member.tags || []);
        }
    }, [member, open]);

    const handleSubmit = () => {
        if (!name || !email) return;

        updateMutation.mutate(
            {
                id: member.id,
                data: { name, email, tags }
            },
            {
                onSuccess: () => {
                    onOpenChange(false);
                },
            }
        );
    };

    const toggleTag = (tag: string) => {
        if (tags.includes(tag)) {
            setTags(tags.filter((t) => t !== tag));
        } else {
            setTags([...tags, tag]);
        }
    };

    const addCustomTag = () => {
        if (customTag && !tags.includes(customTag)) {
            setTags([...tags, customTag]);
            setCustomTag("");
        }
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="bg-[var(--color-elevated)] border-l-[var(--color-border)] text-[var(--color-text-primary)]">
                <SheetHeader>
                    <SheetTitle className="text-white">Edit Member</SheetTitle>
                    <SheetDescription>
                        멤버 정보를 수정합니다.
                    </SheetDescription>
                </SheetHeader>

                <div className="grid gap-6 py-6">
                    <div className="grid gap-2">
                        <Label htmlFor="edit-name">Name</Label>
                        <Input
                            id="edit-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="bg-[var(--color-surface)] border-[var(--color-border)]"
                            placeholder="홍길동"
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="edit-email">Email</Label>
                        <Input
                            id="edit-email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="bg-[var(--color-surface)] border-[var(--color-border)]"
                            placeholder="user@example.com"
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label>Tags</Label>
                        <div className="flex flex-wrap gap-2 mb-2">
                            {SUGGESTED_TAGS.map((tag) => (
                                <button
                                    key={tag}
                                    onClick={() => toggleTag(tag)}
                                    className={`px-2 py-1 rounded text-xs border transition-colors ${tags.includes(tag)
                                        ? "bg-[var(--color-accent)] border-[var(--color-accent)] text-white"
                                        : "bg-white/5 border-white/10 hover:bg-white/10 text-[var(--color-text-secondary)]"
                                        }`}
                                >
                                    {tag}
                                </button>
                            ))}
                        </div>
                        <div className="flex gap-2">
                            <Input
                                value={customTag}
                                onChange={(e) => setCustomTag(e.target.value)}
                                placeholder="직접 입력..."
                                className="bg-[var(--color-surface)] border-[var(--color-border)] h-8 text-xs"
                                onKeyDown={(e) => e.key === "Enter" && addCustomTag()}
                            />
                            <Button size="sm" variant="outline" onClick={addCustomTag} className="h-8">Add</Button>
                        </div>

                        {tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2 p-2 rounded bg-[var(--color-surface)] border border-[var(--color-border)] min-h-[40px]">
                                {tags.map(tag => (
                                    <span key={tag} className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--color-accent)]/20 text-[var(--color-text-primary)] text-xs">
                                        {tag}
                                        <button onClick={() => toggleTag(tag)} className="hover:text-white">×</button>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <SheetFooter>
                    <Button
                        onClick={handleSubmit}
                        disabled={!name || !email || updateMutation.isPending}
                        className="bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white"
                    >
                        {updateMutation.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
}
