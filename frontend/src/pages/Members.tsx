import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Filter } from "lucide-react";
import { useMembers, useTreasury } from "@/hooks";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
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
    const { data: treasuryData } = useTreasury();

    // member_id → milestone_unpaid
    const unpaidMap = new Map<number, number>();
    (treasuryData?.by_member ?? []).forEach((m: any) => {
        if ((m.milestone_unpaid || 0) > 0) {
            unpaidMap.set(m.member_id, m.milestone_unpaid);
        }
    });

    const lowDepositCount = members?.filter(m => m.is_active && (m.current_deposit || 0) < 10000).length || 0;
    const unpaidMilestoneCount = (treasuryData?.by_member ?? []).filter((m: any) => (m.milestone_unpaid || 0) > 0).length;

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
                title="멤버"
                subtitle={`총 ${members?.length || 0}명${lowDepositCount > 0 ? ` · 충전 필요 ${lowDepositCount}명` : ""}${unpaidMilestoneCount > 0 ? ` · 벌금 미납 ${unpaidMilestoneCount}명` : ""}`}
                actions={<MemberAddSheet />}
            />

            <div className="p-3 md:p-6 space-y-4 md:space-y-6">
                {/* Filters */}
                <div className="flex flex-col sm:flex-row gap-3 md:gap-4 items-start sm:items-center justify-between">
                    <div className="relative w-full sm:w-72">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                        <Input
                            placeholder="이름 또는 이메일 검색..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-9 bg-[var(--color-surface)] border-[var(--color-border)]"
                        />
                    </div>

                    <div className="flex items-center gap-4 md:gap-6">
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="show-inactive"
                                checked={showInactive}
                                onCheckedChange={(checked) => setShowInactive(!!checked)}
                                className="border-[var(--color-border)] data-[state=checked]:bg-[var(--color-accent)] data-[state=checked]:border-[var(--color-accent)]"
                            />
                            <Label htmlFor="show-inactive" className="text-xs md:text-sm text-[var(--color-text-secondary)] font-medium cursor-pointer">
                                비활성 멤버 포함
                            </Label>
                        </div>

                        <Button variant="outline" size="icon" className="h-9 w-9 border-[var(--color-border)]">
                            <Filter className="w-4 h-4 text-[var(--color-text-secondary)]" />
                        </Button>
                    </div>
                </div>

                {/* Desktop 테이블 */}
                <div className="hidden md:block rounded-xl border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)]/50 backdrop-blur-sm">
                    <Table>
                        <TableHeader className="bg-[var(--color-surface)] hover:bg-[var(--color-surface)]">
                            <TableRow className="border-b-[var(--color-border)] hover:bg-transparent">
                                <TableHead className="w-[60px] text-[var(--color-text-muted)]">No.</TableHead>
                                <TableHead className="text-[var(--color-text-muted)]">이름 / 이메일</TableHead>
                                <TableHead className="text-[var(--color-text-muted)]">태그</TableHead>
                                <TableHead className="text-right text-[var(--color-text-muted)]">디파짓</TableHead>
                                <TableHead className="text-right text-[var(--color-text-muted)]">벌금 미납</TableHead>
                                <TableHead className="text-right text-[var(--color-text-muted)]">상점</TableHead>
                                <TableHead className="text-right text-[var(--color-text-muted)]">벌점</TableHead>
                                <TableHead className="text-right text-[var(--color-text-muted)]">순점수</TableHead>
                                <TableHead className="text-right text-[var(--color-text-muted)]">가입일</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow>
                                    <TableCell colSpan={9} className="h-24 text-center text-[var(--color-text-muted)]">
                                        로딩 중...
                                    </TableCell>
                                </TableRow>
                            ) : filteredMembers?.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={9} className="h-32 text-center text-[var(--color-text-muted)]">
                                        데이터가 없습니다.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredMembers?.map((member, index) => (
                                    <TableRow
                                        key={member.id}
                                        className="cursor-pointer border-b-[var(--color-border-subtle)] hover:bg-[var(--color-hover)] transition-colors"
                                        onClick={() => navigate(`/members/${member.id}`)}
                                    >
                                        <TableCell className="text-[var(--color-text-muted)]">{index + 1}</TableCell>
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
                                                    <span key={tag} className="px-1.5 py-0.5 rounded bg-[var(--color-hover)] border border-[var(--color-border)] text-[10px] text-[var(--color-text-secondary)]">
                                                        {tag}
                                                    </span>
                                                ))}
                                            </div>
                                        </TableCell>
                                        <TableCell className={`text-right text-sm ${(member.current_deposit || 0) < 10000 ? "text-rose-500" : "text-[var(--color-text-secondary)]"}`}>
                                            <div className="flex items-center justify-end gap-1.5">
                                                {member.is_active && (member.current_deposit || 0) < 10000 && (
                                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-500/15 text-rose-500 border border-rose-500/20">
                                                        충전요망
                                                    </span>
                                                )}
                                                ₩{(member.current_deposit || 0).toLocaleString()}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right text-sm">
                                            {unpaidMap.has(member.id) ? (
                                                <div className="flex items-center justify-end gap-1.5">
                                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-500/15 text-rose-500 border border-rose-500/20">
                                                        납부필요
                                                    </span>
                                                    <span className="text-rose-500 font-medium">₩{(unpaidMap.get(member.id) || 0).toLocaleString()}</span>
                                                </div>
                                            ) : (
                                                <span className="text-[var(--color-text-muted)]">-</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right text-sm text-green-600">
                                            {member.total_plus_score || 0 ? `+${member.total_plus_score}` : "-"}
                                        </TableCell>
                                        <TableCell className="text-right text-sm text-rose-500">
                                            {member.total_minus_score ? member.total_minus_score : "-"}
                                        </TableCell>
                                        <TableCell className={`text-right text-sm font-semibold ${(member.net_score || 0) > 0 ? "text-green-600" : (member.net_score || 0) < 0 ? "text-rose-500" : "text-[var(--color-text-muted)]"}`}>
                                            {member.net_score || 0}
                                        </TableCell>
                                        <TableCell className="text-right text-xs text-[var(--color-text-muted)]">
                                            {new Date(member.created_at).toLocaleDateString()}
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>

                {/* Mobile 카드 리스트 */}
                <div className="md:hidden space-y-2">
                    {isLoading ? (
                        <div className="text-center py-12 text-[var(--color-text-muted)] text-sm">로딩 중...</div>
                    ) : filteredMembers?.length === 0 ? (
                        <div className="text-center py-12 text-[var(--color-text-muted)] text-sm">데이터가 없습니다.</div>
                    ) : (
                        filteredMembers?.map((member, index) => {
                            const lowDeposit = member.is_active && (member.current_deposit || 0) < 10000;
                            const unpaid = unpaidMap.get(member.id) ?? 0;
                            const net = member.net_score || 0;
                            return (
                                <div
                                    key={member.id}
                                    onClick={() => navigate(`/members/${member.id}`)}
                                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 active:bg-[var(--color-hover)] transition-colors"
                                >
                                    <div className="flex items-start justify-between gap-2 mb-2">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className="text-xs text-[var(--color-text-muted)]">#{index + 1}</span>
                                                <span className="font-medium text-sm text-[var(--color-text-primary)] truncate">{member.name}</span>
                                                {!member.is_active && <StatusBadge status="ABSENT" className="px-1.5 py-0 text-[10px]" />}
                                            </div>
                                            {member.email && (
                                                <div className="text-[11px] text-[var(--color-text-muted)] truncate">{member.email}</div>
                                            )}
                                            {member.tags.length > 0 && (
                                                <div className="flex flex-wrap gap-1 mt-1">
                                                    {member.tags.map((tag) => (
                                                        <span key={tag} className="px-1.5 py-0.5 rounded bg-[var(--color-hover)] border border-[var(--color-border)] text-[10px] text-[var(--color-text-secondary)]">
                                                            {tag}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <div className={`text-right text-sm font-bold flex-shrink-0 ${net > 0 ? "text-green-600" : net < 0 ? "text-rose-500" : "text-[var(--color-text-muted)]"}`}>
                                            {net > 0 ? `+${net}` : net}
                                            <div className="text-[10px] font-normal text-[var(--color-text-muted)]">순점수</div>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                                        <div>
                                            <div className="text-[var(--color-text-muted)]">디파짓</div>
                                            <div className={`font-medium flex items-center gap-1 ${lowDeposit ? "text-rose-500" : "text-[var(--color-text-secondary)]"}`}>
                                                {lowDeposit && <span className="px-1 py-0 rounded text-[9px] font-bold bg-rose-500/15 text-rose-500 border border-rose-500/20">요</span>}
                                                ₩{(member.current_deposit || 0).toLocaleString()}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-[var(--color-text-muted)]">미납</div>
                                            <div className={`font-medium ${unpaid > 0 ? "text-rose-500" : "text-[var(--color-text-muted)]"}`}>
                                                {unpaid > 0 ? `₩${unpaid.toLocaleString()}` : "-"}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-[var(--color-text-muted)]">상/벌점</div>
                                            <div className="font-medium">
                                                <span className="text-green-600">{member.total_plus_score ? `+${member.total_plus_score}` : "0"}</span>
                                                <span className="text-[var(--color-text-muted)]"> / </span>
                                                <span className="text-rose-500">{member.total_minus_score || "0"}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}
