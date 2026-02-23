import { useNavigate } from "react-router-dom";
import { Plus, ArrowRight, Calendar, Users, Briefcase, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useSessions, useDeleteSession } from "@/hooks";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function SessionList() {
    const navigate = useNavigate();
    const { data: sessions, isLoading, error } = useSessions();
    const { mutate: deleteSession } = useDeleteSession();

    const sortedSessions = sessions?.sort((a, b) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    return (
        <div className="flex flex-col h-full bg-[var(--color-base)] min-h-screen">
            <PageHeader
                title="All Sessions"
                subtitle="전체 세션 목록 및 상태 관리"
                actions={
                    <Button
                        onClick={() => navigate("/sessions/new")}
                        className="gap-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white"
                        size="sm"
                    >
                        <Plus className="w-4 h-4" />
                        New Session
                    </Button>
                }
            />

            <div className="p-6 max-w-7xl mx-auto w-full">
                {isLoading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {[1, 2, 3, 4, 5, 6].map((i) => (
                            <Skeleton key={i} className="h-48 rounded-xl bg-[var(--color-surface)]" />
                        ))}
                    </div>
                ) : error ? (
                    <div className="text-center py-20 text-rose-400">
                        세션 목록을 불러오는 중 오류가 발생했습니다.
                    </div>
                ) : sortedSessions?.length === 0 ? (
                    <div className="text-center py-20 border border-dashed border-[var(--color-border)] rounded-xl bg-[var(--color-surface)]/50">
                        <p className="text-[var(--color-text-muted)] mb-4">등록된 세션이 없습니다.</p>
                        <Button onClick={() => navigate("/sessions/new")}>
                            첫번째 세션 생성하기
                        </Button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {sortedSessions?.map((session) => (
                            <Card
                                key={session.id}
                                className="group relative overflow-hidden bg-[var(--color-surface)] border-[var(--color-border)] hover:border-[var(--color-border-highlight)] transition-all cursor-pointer hover:shadow-lg hover:shadow-[var(--color-accent)]/5"
                                onClick={() => navigate(`/sessions/${session.id}`)}
                            >
                                <CardHeader className="pb-3">
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex items-center gap-2">
                                            <span className="px-2 py-0.5 rounded text-xs font-bold bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/20">
                                                {session.week_num}주차
                                            </span>
                                            <StatusBadge status={session.status} className="px-1.5 py-0 text-[10px]" />
                                        </div>
                                        {session.status === 'SETUP' ? (
                                            <button
                                                className="p-1 rounded text-red-400/60 hover:text-red-400 hover:bg-red-400/10 transition-colors opacity-0 group-hover:opacity-100"
                                                title="세션 삭제"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (confirm(`"${session.title}" 세션을 삭제하시겠습니까?`)) {
                                                        deleteSession(session.id);
                                                    }
                                                }}
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        ) : (
                                            <ArrowRight className="w-4 h-4 text-[var(--color-text-muted)] group-hover:text-[var(--color-accent)] transition-colors opacity-0 group-hover:opacity-100 transform -translate-x-2 group-hover:translate-x-0" />
                                        )}
                                    </div>
                                    <h3 className="text-lg font-bold text-white group-hover:text-[var(--color-accent)] transition-colors line-clamp-1">
                                        {session.title}
                                    </h3>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-2 text-sm text-[var(--color-text-secondary)]">
                                        <div className="flex items-center gap-2">
                                            <Calendar className="w-4 h-4 text-[var(--color-text-muted)]" />
                                            <span className="font-mono text-xs">{session.date}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Briefcase className="w-4 h-4 text-[var(--color-text-muted)]" />
                                            <span className="text-xs">{session.type} SESSION</span>
                                        </div>
                                        {session.type === 'TEAM' && session.teams && (
                                            <div className="flex items-center gap-2">
                                                <Users className="w-4 h-4 text-[var(--color-text-muted)]" />
                                                <span className="text-xs">{session.teams.length} Teams Assigned</span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="absolute bottom-0 left-0 w-full h-1 bg-[var(--color-accent)] transform scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-300" />
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
