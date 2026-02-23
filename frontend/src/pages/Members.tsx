import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Filter } from "lucide-react";
import { useMembers } from "@/hooks";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { ScoreDisplay } from "@/components/ScoreDisplay";
import { MemberAddSheet } from "@/components/MemberAddSheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export default function Members() {
    const navigate = useNavigate();
    const [search, setSearch] = useState("");
    const [showInactive, setShowInactive] = useState(false);

    // Fetch ALL members so we can filter client-side for active/inactive toggle
    // In a real app with pagination, we'd pass showInactive to API
    const { data: members, isLoading } = useMembers(!showInactive);

    const filteredMembers = members?.filter((m) => {
        if (!search) return true;
        return (
            m.name.toLowerCase().includes(search.toLowerCase()) ||
            (m.email?.toLowerCase() ?? "").includes(search.toLowerCase())
        );
    });

    return (
        <div className="flex flex-col h-full">
            <PageHeader
                title="Members"
                subtitle={`총 ${members?.length || 0}명의 멤버`}
                actions={<MemberAddSheet />}
            />

            <div className="p-6 space-y-6">
                {/* Filters */}
                <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                    <div className="relative w-full sm:w-72">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                        <Input
                            placeholder="이름 또는 이메일 검색..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-9 bg-[var(--color-surface)] border-[var(--color-border)]"
                        />
                    </div>

                    <div className="flex items-center gap-6">
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="show-inactive"
                                checked={showInactive}
                                onCheckedChange={(checked) => setShowInactive(!!checked)}
                                className="border-[var(--color-border)] data-[state=checked]:bg-[var(--color-accent)] data-[state=checked]:border-[var(--color-accent)]"
                            />
                            <Label htmlFor="show-inactive" className="text-sm text-[var(--color-text-secondary)] font-medium cursor-pointer">
                                비활성 멤버 포함
                            </Label>
                        </div>

                        <Button variant="outline" size="icon" className="h-9 w-9 border-[var(--color-border)]">
                            <Filter className="w-4 h-4 text-[var(--color-text-secondary)]" />
                        </Button>
                    </div>
                </div>

                {/* Table */}
                <div className="rounded-xl border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)]/50 backdrop-blur-sm">
                    <Table>
                        <TableHeader className="bg-[var(--color-surface)] hover:bg-[var(--color-surface)]">
                            <TableRow className="border-b-[var(--color-border)] hover:bg-transparent">
                                <TableHead className="w-[100px] text-[var(--color-text-muted)]">ID</TableHead>
                                <TableHead className="text-[var(--color-text-muted)]">이름 / 이메일</TableHead>
                                <TableHead className="text-[var(--color-text-muted)]">태그</TableHead>
                                <TableHead className="text-center text-[var(--color-text-muted)]">현황 (Dep/Score)</TableHead>
                                <TableHead className="text-right text-[var(--color-text-muted)]">가입일</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-24 text-center text-[var(--color-text-muted)]">
                                        Loading members...
                                    </TableCell>
                                </TableRow>
                            ) : filteredMembers?.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-32 text-center text-[var(--color-text-muted)]">
                                        데이터가 없습니다.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredMembers?.map((member) => (
                                    <TableRow
                                        key={member.id}
                                        className="cursor-pointer border-b-[var(--color-border-subtle)] hover:bg-[var(--color-hover)] transition-colors"
                                        onClick={() => navigate(`/members/${member.id}`)}
                                    >
                                        <TableCell className="font-mono text-[var(--color-text-muted)]">#{member.id}</TableCell>
                                        <TableCell>
                                            <div className="flex flex-col">
                                                <span className="font-medium text-[var(--color-text-primary)] flex items-center gap-2">
                                                    {member.name}
                                                    {!member.is_active && <StatusBadge status="ABSENT" className="px-1.5 py-0 text-[10px]" />}
                                                </span>
                                                <span className="text-xs text-[var(--color-text-muted)]">{member.email}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-wrap gap-1">
                                                {member.tags.map((tag) => (
                                                    <span key={tag} className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] text-[var(--color-text-secondary)]">
                                                        {tag}
                                                    </span>
                                                ))}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <div className="flex flex-col items-center gap-1">
                                                <span className={(member.current_deposit || 0) < 10000 ? "text-rose-400 font-mono text-xs" : "text-[var(--color-text-secondary)] font-mono text-xs"}>
                                                    ₩{(member.current_deposit || 0).toLocaleString()}
                                                </span>
                                                <ScoreDisplay
                                                    totalPlus={member.total_plus_score || 0}
                                                    totalMinus={member.total_minus_score || 0}
                                                    netScore={member.net_score || 0}
                                                    className="scale-90"
                                                />
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right text-xs text-[var(--color-text-muted)] font-mono">
                                            {new Date(member.created_at).toLocaleDateString()}
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
