import { GrantMeritDialog } from "@/components/GrantMeritDialog";
import { useOutletContext } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { UploadCloud, Trophy, AlertTriangle } from "lucide-react";
import { WarningBanner } from "@/components/WarningBanner";
import api from "@/lib/api";
import { toast } from "sonner";
import { useCrawlerTask, useUploadVideos } from "@/hooks";
import { useState } from "react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import type { Session } from "@/hooks/useSessions";

export default function OpsTab() {
    const { session } = useOutletContext<{ session: Session }>();

    const [uploadTaskId, setUploadTaskId] = useState<string | null>(null);
    const { mutate: uploadVideos, isPending: isUploading } = useUploadVideos();
    const { data: taskStatus } = useCrawlerTask(uploadTaskId);

    // D+1 Warning Logic
    const sessionDate = new Date(session.date);
    const today = new Date();

    // Reset hours to compare dates only
    const d1 = new Date(sessionDate.getFullYear(), sessionDate.getMonth(), sessionDate.getDate());
    const d2 = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    // Calculate difference in days
    const diffTime = d2.getTime() - d1.getTime();
    const diffDays = diffTime / (1000 * 60 * 60 * 24);

    const isNextDay = diffDays === 1;

    const handleCafeUpload = () => {
        uploadVideos({ sessionId: session.id }, {
            onSuccess: (data) => {
                toast.success("업로드 작업이 시작되었습니다.");
                setUploadTaskId(data.task_id);
            },
            onError: () => toast.error("요청 실패"),
        });
    };

    const renderTaskStatus = () => {
        if (!uploadTaskId || !taskStatus) return (
            <div className="bg-[var(--color-base)] rounded-lg p-4 border border-[var(--color-border)] min-h-[100px] flex items-center justify-center text-[var(--color-text-muted)] text-sm">
                Task status will appear here...
            </div>
        );

        return (
            <div className="bg-[var(--color-base)] rounded-lg p-4 border border-[var(--color-border)] min-h-[100px] flex flex-col items-center justify-center text-sm gap-2">
                {taskStatus.status === "in_progress" || taskStatus.status === "queued" ? (
                    <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent)]" />
                ) : taskStatus.status === "complete" ? (
                    <CheckCircle2 className="w-8 h-8 text-green-500" />
                ) : (
                    <XCircle className="w-8 h-8 text-red-500" />
                )}
                <div className="font-mono text-xs text-[var(--color-text-muted)]">Task ID: {uploadTaskId}</div>
                <div className="font-bold">{taskStatus.status.toUpperCase()}</div>
            </div>
        );
    };

    return (
        <div className="space-y-8">
            {isNextDay && (
                <WarningBanner
                    level="warning"
                    title="영상 업로드 마감 경고"
                    message="오늘은 세션 다음 날입니다. 자정 전까지 영상 업로드를 완료해주세요."
                    icon={<AlertTriangle className="w-5 h-5 text-orange-400" />}
                />
            )}

            {/* Video Upload Panel */}
            <div className="bg-[var(--color-surface)] p-6 rounded-xl border border-[var(--color-border)]">
                <div className="flex items-start justify-between mb-6">
                    <div>
                        <h3 className="font-bold text-lg mb-1">Video Upload</h3>
                        <p className="text-sm text-[var(--color-text-secondary)]">
                            구글 드라이브 영상을 다운로드하여 네이버 카페에 업로드합니다.
                        </p>
                    </div>
                    <Button onClick={handleCafeUpload} disabled={isUploading} className="bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]">
                        <UploadCloud className="w-4 h-4 mr-2" />
                        {isUploading ? "Starting..." : "Start Upload Process"}
                    </Button>
                </div>

                {renderTaskStatus()}
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-2 gap-4">
                <GrantMeritDialog trigger={
                    <div className="bg-[var(--color-surface)] p-6 rounded-xl border border-[var(--color-border)] flex items-center justify-between cursor-pointer hover:border-[var(--color-accent)]/50 transition-colors">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-full bg-yellow-500/10 flex items-center justify-center text-yellow-500">
                                <Trophy className="w-6 h-6" />
                            </div>
                            <div>
                                <h4 className="font-bold">Grant Merits</h4>
                                <p className="text-xs text-[var(--color-text-secondary)]">우수 발표자/질문자 상점 부여</p>
                            </div>
                        </div>
                    </div>
                } />
            </div>
        </div>
    );
}
