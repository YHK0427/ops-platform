import type { StepProps } from "./types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Check } from "lucide-react";
import api from "@/lib/api";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

export function StepConfirmation({ state, onBack }: StepProps) {
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(false);

    const handleCreate = async () => {
        setIsLoading(true);
        try {
            // 1. Create Session
            const sessionPayload = {
                week_num: state.week_num,
                title: state.title,
                date: state.date,
                type: state.type,
                config: {
                    has_ppt_email: state.has_ppt_email,
                    has_ppt: state.has_ppt,
                    has_review: state.has_review,
                    has_feedback: state.has_feedback,
                    has_groups: state.has_groups,
                    is_holiday: state.is_holiday,
                    deadline_ppt_email: state.deadline_ppt_email || null,
                    deadline_ppt_email_late: state.deadline_ppt_email_late || null,
                    deadline_post: state.deadline_post || null,
                }
            };

            const { data: session } = await api.post<{ id: number }>("/sessions", sessionPayload);
            const sessionId = session.id;

            // 2. Assign Teams (if TEAM and teams exist)
            if (state.type === "TEAM" && Object.keys(state.teams).length > 0) {
                // Filter out unassigned and empty teams
                const teamsList = Object.entries(state.teams)
                    .filter(([key, members]) => key !== "unassigned" && members.length > 0)
                    .map(([key, members]) => ({
                        name: key,
                        members: members.map(id => ({ member_id: id }))
                    }));

                if (teamsList.length > 0) {
                    await api.patch(`/sessions/${sessionId}/teams`, { teams: teamsList });
                }
            }

            // 3. Assign Groups (if INDIVIDUAL + has_groups)
            if (state.type === "INDIVIDUAL" && state.has_groups && Object.keys(state.groups).length > 0) {
                const groupPayload: Record<string, number[]> = {};
                for (const [key, ids] of Object.entries(state.groups)) {
                    if (key === "unassigned" || ids.length === 0) continue;
                    // "1분반" → "1", "2분반" → "2"
                    const num = key.replace(/분반/, "").trim();
                    groupPayload[num] = ids;
                }
                if (Object.keys(groupPayload).length > 0) {
                    await api.patch(`/sessions/${sessionId}/groups`, {
                        groups: groupPayload,
                        staff_groups: state.staff_groups ?? {},
                    });
                }
            }

            toast.success("세션이 성공적으로 생성되었습니다.");
            navigate(`/sessions/${sessionId}/prep`);
        } catch (error) {
            console.error(error);
            toast.error("세션 생성 중 오류가 발생했습니다.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="space-y-6 max-w-2xl mx-auto">
            <Card className="bg-[var(--color-surface)] border-[var(--color-border)]">
                <CardHeader>
                    <CardTitle>Step 3: 최종 확인</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                            <span className="text-[var(--color-text-secondary)]">주차</span>
                            <p className="text-lg tabular-nums">{state.week_num}주차</p>
                        </div>
                        <div>
                            <span className="text-[var(--color-text-secondary)]">날짜</span>
                            <p className="text-lg">{state.date}</p>
                        </div>
                        <div className="col-span-2">
                            <span className="text-[var(--color-text-secondary)]">주제</span>
                            <p className="text-lg font-bold text-[var(--color-text-primary)]">{state.title}</p>
                        </div>
                        <div>
                            <span className="text-[var(--color-text-secondary)]">타입</span>
                            <p className="text-[var(--color-accent)]">{state.type}</p>
                        </div>
                        {state.type === "TEAM" && (
                            <div>
                                <span className="text-[var(--color-text-secondary)]">배정된 팀 수</span>
                                <p className="text-lg tabular-nums">{Object.keys(state.teams).filter(k => k !== "unassigned").length}팀</p>
                            </div>
                        )}
                        {state.type === "INDIVIDUAL" && state.has_groups && (
                            <div>
                                <span className="text-[var(--color-text-secondary)]">분반</span>
                                <p className="text-lg tabular-nums">
                                    1분반 {state.groups["1분반"]?.length ?? 0}명 / 2분반 {state.groups["2분반"]?.length ?? 0}명
                                </p>
                            </div>
                        )}
                    </div>
                    {(state.has_ppt_email || state.has_ppt || state.has_review || state.has_feedback) && (
                    <div className="grid grid-cols-2 gap-4 text-sm pt-4 border-t border-[var(--color-border)]">
                        {state.has_ppt_email && (
                            <>
                                <div>
                                    <span className="text-[var(--color-text-secondary)]">PPT 이메일 기한</span>
                                    <p className="">{state.deadline_ppt_email ? state.deadline_ppt_email.replace("T", " ") : "—"}</p>
                                </div>
                                <div>
                                    <span className="text-[var(--color-text-secondary)]">PPT 이메일 지각 기한</span>
                                    <p className="">{state.deadline_ppt_email_late ? state.deadline_ppt_email_late.replace("T", " ") : "—"}</p>
                                </div>
                            </>
                        )}
                        {(state.has_ppt || state.has_review || state.has_feedback) && (
                            <div>
                                <span className="text-[var(--color-text-secondary)]">후속 과제 기한</span>
                                <p className="">{state.deadline_post ? state.deadline_post.replace("T", " ") : "—"}</p>
                            </div>
                        )}
                    </div>
                    )}
                </CardContent>
            </Card>

            <div className="flex justify-between">
                <Button variant="outline" onClick={onBack} disabled={isLoading}>
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    이전
                </Button>
                <Button
                    onClick={handleCreate}
                    disabled={isLoading}
                    className="bg-[var(--color-green)] hover:bg-green-600 text-white"
                >
                    {isLoading ? (
                        <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                    ) : (
                        <Check className="w-4 h-4 mr-2" />
                    )}
                    세션 생성 완료
                </Button>
            </div>
        </div>
    );
}
