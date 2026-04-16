import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import {
    CalendarDays,
    Clock,
    Plus,
    Users,
    Lock,
    CheckCircle2,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { WarningBanner } from "@/components/WarningBanner";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrentSession, useMembers, useNaverSessionStatus, useSessionStats, useImportNaverSession, useNaverLogin, useCrawlerTask, useTreasury, crawlerKeys } from "@/hooks";
import { toast } from "sonner";

function NaverSessionCard({ naverStatus }: { naverStatus: any }) {
    const { mutate: importSession, isPending: isImporting } = useImportNaverSession();
    const { mutateAsync: naverLogin } = useNaverLogin();
    const queryClient = useQueryClient();

    const [mode, setMode] = useState<"none" | "login" | "manual">("none");
    const [jsonInput, setJsonInput] = useState("");
    const [credentials, setCredentials] = useState({ username: "", password: "" });
    const [loginTaskId, setLoginTaskId] = useState<string | null>(null);
    const { data: loginTaskData } = useCrawlerTask(loginTaskId);

    useEffect(() => {
        if (!loginTaskData) return;
        if (loginTaskData.status === "complete") {
            setLoginTaskId(null);
            queryClient.invalidateQueries({ queryKey: crawlerKeys.naverSession() });
            toast.success("네이버 로그인 성공!");
        } else if (loginTaskData.status === "failed") {
            setLoginTaskId(null);
            toast.error(`네이버 로그인 실패: ${loginTaskData.result?.reason ?? "알 수 없는 오류"}`);
        }
    }, [loginTaskData, queryClient]);

    const handleImport = () => {
        if (!jsonInput) return;
        importSession(jsonInput, {
            onSuccess: () => {
                setJsonInput("");
                setMode("none");
            }
        });
    };

    const handleLogin = async () => {
        try {
            const result = await naverLogin(credentials);
            setLoginTaskId(result.task_id);
            setMode("none");
        } catch (e) {
            toast.error("로그인 요청 실패");
        }
    };

    return (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 transition-all duration-300">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${naverStatus?.is_valid ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                        <Lock className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="font-bold text-[var(--color-text-primary)]">네이버 세션 상태</h3>
                        <p className="text-sm text-[var(--color-text-secondary)]">
                            {naverStatus?.is_valid
                                ? (() => {
                                    const d = naverStatus.expires_hint ? new Date(naverStatus.expires_hint) : null;
                                    const valid = d && d.getFullYear() > 2000;
                                    return `유효 (만료: ${valid ? d!.toLocaleDateString() : '알 수 없음'})`;
                                })()
                                : "만료됨 / 유효하지 않음"}
                        </p>
                    </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                    {loginTaskId && (
                        <div className="flex items-center gap-2 mt-2 text-xs text-blue-600">
                            <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                            <span>네이버 로그인 진행 중...</span>
                        </div>
                    )}
                    <div className="flex items-center gap-2">
                        {mode === "none" ? (
                            <>
                                <button
                                    onClick={() => setMode("login")}
                                    disabled={!!loginTaskId}
                                    className="px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-white text-xs font-bold hover:bg-[var(--color-primary-hover)] transition-colors shadow-lg shadow-[var(--color-primary)]/20 disabled:opacity-50"
                                >
                                    네이버 로그인
                                </button>
                                <button
                                    onClick={() => setMode("manual")}
                                    disabled={!!loginTaskId}
                                    className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:underline disabled:opacity-50"
                                >
                                    수동 가져오기
                                </button>
                            </>
                        ) : (
                            <button
                                onClick={() => setMode("none")}
                                className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                            >
                                취소
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {mode === "login" && (
                <div className="space-y-3 animate-in fade-in slide-in-from-top-2 bg-gray-50 p-4 rounded-lg border border-[var(--color-border)]">
                    <div className="grid gap-3">
                        <input
                            type="text"
                            placeholder="네이버 ID"
                            value={credentials.username}
                            onChange={e => setCredentials({ ...credentials, username: e.target.value })}
                            className="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
                        />
                        <input
                            type="password"
                            placeholder="비밀번호"
                            value={credentials.password}
                            onChange={e => setCredentials({ ...credentials, password: e.target.value })}
                            className="w-full px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
                        />
                    </div>
                    <div className="flex justify-end pt-2">
                        <button
                            onClick={handleLogin}
                            disabled={!credentials.username || !credentials.password}
                            className="px-4 py-2 bg-[var(--color-success)] hover:bg-green-600 text-white text-sm font-bold rounded-md disabled:opacity-50 transition-colors flex items-center gap-2"
                        >
                            자동 로그인
                        </button>
                    </div>
                    <p className="text-[10px] text-[var(--color-text-muted)] text-center">
                        * 로그인 정보는 서버에서 안전하게 처리되며 저장되지 않습니다.
                    </p>
                </div>
            )}

            {mode === "manual" && (
                <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                    <textarea
                        className="w-full h-32 px-3 py-2 bg-gray-50 border border-[var(--color-border)] rounded-md text-xs font-mono text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-accent)]"
                        placeholder='storageState.json 내용을 붙여넣으세요...'
                        value={jsonInput}
                        onChange={(e) => setJsonInput(e.target.value)}
                    />
                    <div className="flex justify-end">
                        <button
                            onClick={handleImport}
                            disabled={isImporting || !jsonInput}
                            className="px-4 py-2 bg-[var(--color-elevated)] border border-[var(--color-border)] hover:bg-[var(--color-hover)] text-[var(--color-text-primary)] text-sm font-medium rounded-md disabled:opacity-50 transition-colors"
                        >
                            {isImporting ? "가져오는 중..." : "JSON 가져오기"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}



export default function Dashboard() {
    const navigate = useNavigate();
    const { data: sessionData, isLoading: isSessionLoading } = useCurrentSession();
    const { data: sortedMembers, isLoading: isLoadingMembers } = useMembers(true); // Active only
    const { data: naverStatus, isLoading: isNaverLoading } = useNaverSessionStatus();
    const session = sessionData; // Alias for cleaner code

    // Additional data for dashboard
    const { data: stats } = useSessionStats(session?.id || 0);
    // Derived values
    const isNaverExpired = !isNaverLoading && naverStatus ? !naverStatus.is_valid : false;

    // 1. Identify Risks
    // Low Deposit: < 10,000 KRW
    const { data: treasuryData } = useTreasury();
    const unpaidMilestoneByMember = (treasuryData?.by_member ?? [])
        .filter((m: any) => (m.milestone_unpaid || 0) > 0)
        .map((m: any) => ({ member_id: m.member_id, name: m.name, unpaid: m.milestone_unpaid as number }));

    const lowDepositMembers = sortedMembers?.filter((m) => (m.current_deposit || 0) < 10000) || [];
    // Eviction Risk: net_score <= -12 (Eviction) or <= -8 (Warning)
    const riskScoreMembers = sortedMembers?.filter((m) => (m.net_score || 0) <= -8) || [];

    const isLoading = isLoadingMembers || isSessionLoading || isNaverLoading;

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center">
                <span className="inline-block w-8 h-8 border-2 border-[var(--color-border)] border-t-[var(--color-accent)] rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            <PageHeader
                title="대시보드"
                subtitle="전체 운영 현황 및 리스크 모니터링"
            />

            <div className="flex-1 overflow-y-auto p-6 space-y-8">
                {/* 1. Naver Session Card */}
                <NaverSessionCard naverStatus={naverStatus} />

                {/* 2. Current Session Card */}
                <div className="space-y-4">
                    <h2 className="text-sm font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
                        현재 세션
                    </h2>

                    {session ? (
                        <div className="relative overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] backdrop-blur-md p-6 group transition-all hover:border-[var(--color-border-highlight)]">
                            <div className="absolute top-0 right-0 p-6 opacity-30 group-hover:opacity-100 transition-opacity">
                                <StatusBadge status={session.status} className="text-sm px-3 py-1" />
                            </div>

                            <div className="mb-6">
                                <div className="flex items-center gap-3 mb-2">
                                    <span className="px-2 py-0.5 rounded text-xs font-bold bg-[var(--color-accent)]/10 text-[var(--color-accent)] border border-[var(--color-accent)]/20">
                                        {session.week_num}주차
                                    </span>
                                    {(() => {
                                        const today = new Date().toISOString().split("T")[0];
                                        const isToday = session.date === today;
                                        const isPast = session.date < today;
                                        const isClosed = isPast || (isToday && new Date().getHours() >= 22);
                                        if (!isToday && !isPast) return null;
                                        return isClosed ? (
                                            <div className="flex items-center gap-1.5 text-xs text-orange-600">
                                                <Lock className="w-3 h-3" />
                                                <span>입장 마감</span>
                                            </div>
                                        ) : null;
                                    })()}
                                </div>
                                <h3 className="text-2xl font-bold text-[var(--color-text-primary)] mb-1">
                                    {session.title}
                                </h3>
                                <p className="text-sm text-[var(--color-text-secondary)]">
                                    {session.type === "TEAM" ? "팀" : "개인"} 세션
                                </p>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-6 border-t border-[var(--color-border)]">
                                <StatBox
                                    label="출석률"
                                    value={stats ? `${stats.attendance_rate}%` : "-"}
                                    icon={Users}
                                />
                                <StatBox
                                    label="PPT 이메일"
                                    value={stats ? `${stats.ppt_email_submitted}/${stats.ppt_email_total}` : "-"}
                                    icon={Clock}
                                />
                                <StatBox
                                    label="과제 제출"
                                    value={stats ? `${stats.homework_submitted}/${stats.homework_total}` : "-"}
                                    icon={CalendarDays}
                                />
                                <button
                                    onClick={() => {
                                        const tabMap: Record<string, string> = {
                                            SETUP: "prep", PREP: "prep", OPS: "ops",
                                            POST: "post", SETTLEMENT: "settlement", FINALIZED: "settlement",
                                        };
                                        const tab = tabMap[session.status] ?? "prep";
                                        navigate(`/sessions/${session.id}/${tab}`);
                                    }}
                                    className="flex items-center justify-center gap-2 rounded-lg bg-[var(--color-elevated)] border border-[var(--color-border)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text-primary)] transition-colors text-sm font-medium"
                                >
                                    세션 관리
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-12 rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)]">
                            <p className="text-sm mb-4">예정된 세션이 없습니다.</p>
                            <button
                                onClick={() => navigate("/sessions/new")}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white text-sm font-bold hover:bg-[var(--color-accent-hover)] transition-colors shadow-[0_0_15px_var(--color-accent-dim)]"
                            >
                                <Plus className="w-4 h-4" />
                                세션 생성하기
                            </button>
                        </div>
                    )}
                </div>

                {/* 3. Warning Stack */}
                <div className="space-y-4">
                    <h2 className="text-sm font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
                        필수 조치 사항
                    </h2>

                    <div className="space-y-2">
                        {isNaverExpired && (
                            <WarningBanner
                                level="error"
                                title="네이버 로그인 만료"
                                message="네이버 카페 자동화 기능이 제한됩니다. 상단 네이버 세션 카드에서 재로그인해주세요."
                            />
                        )}

                        {lowDepositMembers.map((m) => (
                            <WarningBanner
                                key={`deposit-${m.id}`}
                                level="warning"
                                message={`[디파짓 부족] ${m.name}님의 잔액이 ${(m.current_deposit || 0).toLocaleString()}원입니다. (최저 10,000원)`}
                                action={{ label: `${m.name} 상세보기`, onClick: () => navigate(`/members/${m.id}`) }}
                            />
                        ))}

                        {unpaidMilestoneByMember.map((m: { member_id: number; name: string; unpaid: number }) => (
                            <WarningBanner
                                key={`milestone-${m.member_id}`}
                                level="warning"
                                title="누적벌점 벌금 미납"
                                message={`[누적벌점 벌금 미납] ${m.name}님의 미납 벌금 ${m.unpaid.toLocaleString()}원. 납부 확인이 필요합니다.`}
                                action={{ label: `${m.name} 상세보기`, onClick: () => navigate(`/members/${m.member_id}`) }}
                            />
                        ))}

                        {riskScoreMembers.length > 0 && (
                            <>
                                {riskScoreMembers.map(member => (
                                    <WarningBanner
                                        key={`score-${member.id}`}
                                        level={(member.net_score || 0) <= -13 ? "error" : "warning"}
                                        title={(member.net_score || 0) <= -13 ? "퇴출 위험" : "점수 경고"}
                                        message={`[점수 경고] ${member.name}님의 점수가 ${member.net_score || 0}점입니다. ${(member.net_score || 0) <= -13 ? "(퇴출 대상)" : "(경고 단계)"}`}
                                        action={{ label: `${member.name} 상세보기`, onClick: () => navigate(`/members/${member.id}`) }}
                                    />
                                ))}
                            </>
                        )}

                        {!isNaverExpired && lowDepositMembers.length === 0 && riskScoreMembers.length === 0 && unpaidMilestoneByMember.length === 0 && (
                            <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-green-500/20 bg-green-500/5 text-green-600 text-sm">
                                <CheckCircle2 className="w-4 h-4" />
                                <span>현재 조치 필요한 경고 사항이 없습니다.</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function StatBox({ label, value, icon: Icon }: { label: string; value: string; icon: React.ElementType }) {
    return (
        <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[var(--color-hover)] text-[var(--color-text-secondary)]">
                <Icon className="w-4 h-4" />
            </div>
            <div>
                <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
                <p className="font-bold text-lg text-[var(--color-text-primary)]">{value}</p>
            </div>
        </div>
    );
}
