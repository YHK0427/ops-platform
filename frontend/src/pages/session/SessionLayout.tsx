import { useState } from "react";
import { NavLink, Outlet, useParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useSession, useUpdateSessionStatus, useDeleteSession, useUpdateSessionConfig } from "@/hooks";
import { type Session } from "@/hooks/useSessions";
import { Lock, Trash2, Clock, Pencil, Check, X } from "lucide-react";

export default function SessionLayout() {
    const { id } = useParams<{ id: string }>();
    const sessionId = Number(id);
    const { mutate: updateStatus } = useUpdateSessionStatus();
    const { mutate: deleteSession, isPending: isDeleting } = useDeleteSession();
    const { data: session, isLoading } = useSession(sessionId);

    if (isLoading) return <div>로딩 중...</div>;
    if (!session) return <div>세션을 찾을 수 없습니다</div>;

    const typedSession = session as Session;

    const STATUS_LABEL_MAP: Record<string, string> = {
        PREP: "출석", OPS: "과제 준비", POST: "과제 검사", SETTLEMENT: "정산",
    };
    const handleStatusChange = (newStatus: string) => {
        const label = STATUS_LABEL_MAP[newStatus] ?? newStatus;
        if (confirm(`세션 상태를 '${label}' 단계로 변경하시겠습니까?`)) {
            updateStatus({ sessionId, status: newStatus });
        }
    };

    const renderStatusAction = () => {
        switch (typedSession.status) {
            case "SETUP":
                return (
                    <Button
                        size="sm"
                        onClick={() => handleStatusChange("PREP")}
                        className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                        {typedSession.type === "INDIVIDUAL" ? "출석 시작" : "팀 확정 (출석 시작)"}
                    </Button>
                );
            case "PREP":
                return (
                    <Button
                        size="sm"
                        onClick={() => handleStatusChange("OPS")}
                        className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                        과제 준비 시작
                    </Button>
                );
            case "OPS":
                return (
                    <Button
                        size="sm"
                        onClick={() => handleStatusChange("POST")}
                        className="bg-purple-600 hover:bg-purple-700 text-white"
                    >
                        과제 검사 시작
                    </Button>
                );
            case "POST":
                return (
                    <Button
                        size="sm"
                        onClick={() => handleStatusChange("SETTLEMENT")}
                        className="bg-green-600 hover:bg-green-700 text-white"
                    >
                        정산 시작
                    </Button>
                );
            default:
                return null;
        }
    };

    const tabs = [
        { id: "prep",       label: "출석" },
        { id: "ops",        label: "과제 준비" },
        { id: "post",       label: "과제 검사" },
        { id: "settlement", label: "정산" },
    ];

    return (
        <div className="min-h-screen bg-[var(--color-base)] flex flex-col">
            {/* Header */}
            <PageHeader
                title={`[${session.week_num}주차] ${session.title}`}
                subtitle={`${session.date} (${session.type})`}
                showBackButton
                backTo="/sessions"
                actions={
                    <div className="flex items-center gap-2">
                        {typedSession.status !== "FINALIZED" && (
                            <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => {
                                    if (confirm("세션을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.")) {
                                        deleteSession(sessionId);
                                    }
                                }}
                                disabled={isDeleting}
                                className="bg-red-50 hover:bg-red-100 border-red-200 text-red-600"
                            >
                                <Trash2 className="w-3.5 h-3.5 mr-1" />
                                {isDeleting ? "삭제 중..." : "세션 삭제"}
                            </Button>
                        )}
                        {renderStatusAction()}
                        <div className="h-6 w-px bg-gray-200 mx-2" />
                        {typedSession.status === "FINALIZED" && (
                            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-50 border border-gray-200 text-xs font-medium text-[var(--color-text-muted)]">
                                <Lock className="w-3.5 h-3.5" />
                                세션 확정됨
                            </span>
                        )}
                        <StatusBadge status={typedSession.status} />
                    </div>
                }
            />

            <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] sticky top-[60px] z-10 backdrop-blur-md">
                <div className="container mx-auto px-4">
                    <div className="flex space-x-1">
                        {tabs.map((tab) => {
                            const unlockedTabs: Record<string, string[]> = {
                                SETUP:      ["prep"],
                                PREP:       ["prep"],
                                OPS:        ["prep", "ops"],
                                POST:       ["prep", "ops", "post"],
                                SETTLEMENT: ["prep", "ops", "post", "settlement"],
                                FINALIZED:  ["prep", "ops", "post", "settlement"],
                            };
                            const allowed = unlockedTabs[typedSession.status] ?? tabs.map(t => t.id);
                            const locked = !allowed.includes(tab.id);
                            return locked ? (
                                <span
                                    key={tab.id}
                                    className="px-4 py-3 text-sm font-medium border-b-2 border-transparent text-gray-600 cursor-not-allowed select-none"
                                >
                                    {tab.label}
                                </span>
                            ) : (
                                <NavLink
                                    key={tab.id}
                                    to={tab.id}
                                    className={({ isActive }) =>
                                        cn(
                                            "px-4 py-3 text-sm font-medium border-b-2 transition-colors",
                                            isActive
                                                ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                                                : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-highlight)]"
                                        )
                                    }
                                >
                                    {tab.label}
                                </NavLink>
                            );
                        })}
                    </div>
                </div>
            </div>

            <div className="flex-1 container mx-auto px-4 py-6">
                <DeadlineBar session={typedSession} />
                <Outlet context={{ session: typedSession }} />
            </div>
        </div>
    );
}

function DeadlineBar({ session }: { session: Session }) {
    const cfg = session.config || {};
    const { mutate: updateConfig, isPending } = useUpdateSessionConfig();
    const [editing, setEditing] = useState(false);
    const [pptEmail, setPptEmail] = useState(cfg.deadline_ppt_email || "");
    const [pptEmailLate, setPptEmailLate] = useState(cfg.deadline_ppt_email_late || "");
    const [post, setPost] = useState(cfg.deadline_post || "");

    const hasPptEmail = cfg.has_ppt_email !== false;
    const hasPostTasks = cfg.has_review !== false || cfg.has_feedback !== false;
    const hasDeadlines = cfg.deadline_ppt_email || cfg.deadline_ppt_email_late || cfg.deadline_post;
    const isFinalized = session.status === "FINALIZED";

    if (!hasDeadlines && !editing) return null;

    const fmt = (v: string) => v ? v.replace("T", " ") : "—";

    const handleSave = () => {
        updateConfig({
            sessionId: session.id,
            config: {
                deadline_ppt_email: pptEmail || null,
                deadline_ppt_email_late: pptEmailLate || null,
                deadline_post: post || null,
            },
        }, {
            onSuccess: () => setEditing(false),
        });
    };

    const handleCancel = () => {
        setPptEmail(cfg.deadline_ppt_email || "");
        setPptEmailLate(cfg.deadline_ppt_email_late || "");
        setPost(cfg.deadline_post || "");
        setEditing(false);
    };

    return (
        <div className="mb-4 px-4 py-2.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center gap-4 text-sm">
            <Clock className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />
            {editing ? (
                <>
                    {hasPptEmail && (
                        <>
                            <div className="flex items-center gap-1.5">
                                <span className="text-[var(--color-text-secondary)] text-xs whitespace-nowrap">PPT 이메일:</span>
                                <Input
                                    type="datetime-local"
                                    value={pptEmail}
                                    onChange={(e) => setPptEmail(e.target.value)}
                                    className="h-7 text-xs w-44"
                                />
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="text-[var(--color-text-secondary)] text-xs whitespace-nowrap">지각:</span>
                                <Input
                                    type="datetime-local"
                                    value={pptEmailLate}
                                    onChange={(e) => setPptEmailLate(e.target.value)}
                                    className="h-7 text-xs w-44"
                                />
                            </div>
                        </>
                    )}
                    {hasPostTasks && (
                        <div className="flex items-center gap-1.5">
                            <span className="text-[var(--color-text-secondary)] text-xs whitespace-nowrap">후속 과제:</span>
                            <Input
                                type="datetime-local"
                                value={post}
                                onChange={(e) => setPost(e.target.value)}
                                className="h-7 text-xs w-44"
                            />
                        </div>
                    )}
                    <div className="flex items-center gap-1 ml-auto">
                        <Button size="sm" variant="ghost" onClick={handleSave} disabled={isPending} className="h-7 w-7 p-0">
                            <Check className="w-3.5 h-3.5 text-green-500" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={handleCancel} className="h-7 w-7 p-0">
                            <X className="w-3.5 h-3.5 text-red-500" />
                        </Button>
                    </div>
                </>
            ) : (
                <>
                    {hasPptEmail && cfg.deadline_ppt_email && (
                        <span className="text-[var(--color-text-secondary)]">
                            PPT 이메일: <span className="text-[var(--color-text-primary)]">{fmt(cfg.deadline_ppt_email)}</span>
                        </span>
                    )}
                    {hasPptEmail && cfg.deadline_ppt_email_late && (
                        <span className="text-[var(--color-text-secondary)]">
                            지각: <span className="text-[var(--color-text-primary)]">{fmt(cfg.deadline_ppt_email_late)}</span>
                        </span>
                    )}
                    {hasPostTasks && cfg.deadline_post && (
                        <span className="text-[var(--color-text-secondary)]">
                            후속 과제: <span className="text-[var(--color-text-primary)]">{fmt(cfg.deadline_post)}</span>
                        </span>
                    )}
                    {!isFinalized && (
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditing(true)}
                            className="h-7 w-7 p-0 ml-auto"
                        >
                            <Pencil className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                        </Button>
                    )}
                </>
            )}
        </div>
    );
}
