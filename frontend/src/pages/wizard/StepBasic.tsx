import type { StepProps } from "./types";
import { calcDefaultDeadlines } from "./deadlineDefaults";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

export function StepBasic({ state, onChange, onNext }: StepProps) {
    const navigate = useNavigate();

    const isValid = state.week_num > 0 && state.title.trim().length > 0 && state.date;

    return (
        <div className="space-y-6 max-w-2xl mx-auto">
            <Card className="bg-[var(--color-surface)] border-[var(--color-border)]">
                <CardHeader>
                    <CardTitle>Step 1: 기본 설정</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>주차 (Week)</Label>
                            <Input
                                type="number"
                                value={state.week_num}
                                onChange={(e) => onChange({ week_num: Number(e.target.value) })}
                                min={1}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>세션 날짜</Label>
                            <Input
                                type="date"
                                value={state.date}
                                onChange={(e) => {
                                    const newDate = e.target.value;
                                    const defaults = calcDefaultDeadlines(newDate);
                                    onChange({
                                        date: newDate,
                                        deadline_ppt_email: defaults.pptEmail,
                                        deadline_post: defaults.post,
                                    });
                                }}
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>세션 주제</Label>
                        <Input
                            value={state.title}
                            onChange={(e) => onChange({ title: e.target.value })}
                            placeholder="예: 자유주제 발표"
                        />
                        {state.title && (
                            <p className="text-xs text-[var(--color-text-muted)]">
                                ℹ️ 영상 파일명 예시:{" "}
                                <span className="font-mono text-[var(--color-accent)]">
                                    {state.week_num}주차_{state.title}_홍길동.mp4
                                </span>
                            </p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label>세션 타입</Label>
                        <Select
                            value={state.type}
                            onValueChange={(val: any) => onChange({ type: val })}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="INDIVIDUAL">개인 발표 (INDIVIDUAL)</SelectItem>
                                <SelectItem value="TEAM">팀 세션 (TEAM)</SelectItem>
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-[var(--color-text-muted)]">
                            * TEAM 타입인 경우 다음 단계에서 팀 빌딩을 진행합니다.
                        </p>
                    </div>

                    <div className="space-y-3 pt-4 border-t border-[var(--color-border)]">
                        <Label>세션 옵션</Label>
                        <div className="grid grid-cols-2 gap-4">
                            <label className="flex items-center space-x-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="rounded border-gray-600 bg-gray-800 text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                                    checked={state.has_ppt_email}
                                    onChange={(e) => onChange({ has_ppt_email: e.target.checked })}
                                />
                                <span className="text-sm">PPT 이메일 제출</span>
                            </label>
                            <label className="flex items-center space-x-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="rounded border-gray-600 bg-gray-800 text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                                    checked={state.has_review}
                                    onChange={(e) => onChange({ has_review: e.target.checked })}
                                />
                                <span className="text-sm">피어 리뷰 포함</span>
                            </label>
                            <label className="flex items-center space-x-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="rounded border-gray-600 bg-gray-800 text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                                    checked={state.has_feedback}
                                    onChange={(e) => onChange({ has_feedback: e.target.checked })}
                                />
                                <span className="text-sm">훈수(피드백) 포함</span>
                            </label>
                            <label className="flex items-center space-x-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="rounded border-gray-600 bg-gray-800 text-red-500 focus:ring-red-500"
                                    checked={state.is_holiday}
                                    onChange={(e) => onChange({ is_holiday: e.target.checked })}
                                />
                                <span className="text-sm text-red-400">휴일 (Penalty 면제)</span>
                            </label>
                        </div>
                    </div>

                    <div className="space-y-3 pt-4 border-t border-[var(--color-border)]">
                        <Label>제출 기한 설정</Label>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <Label className="text-xs text-[var(--color-text-secondary)]">PPT 이메일 제출 기한</Label>
                                <Input
                                    type="datetime-local"
                                    value={state.deadline_ppt_email}
                                    onChange={(e) => onChange({ deadline_ppt_email: e.target.value })}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs text-[var(--color-text-secondary)]">후속 과제 기한 (리뷰/PPT게시판/피드백)</Label>
                                <Input
                                    type="datetime-local"
                                    value={state.deadline_post}
                                    onChange={(e) => onChange({ deadline_post: e.target.value })}
                                />
                            </div>
                        </div>
                        <p className="text-xs text-[var(--color-text-muted)]">
                            * 날짜 변경 시 기본값이 자동 설정됩니다. (PPT 이메일: 당일 09:00, 후속 과제: 다음 수요일 21:59)
                        </p>
                    </div>
                </CardContent>
            </Card>

            <div className="flex justify-between">
                <Button variant="outline" onClick={() => navigate(-1)}>
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    취소
                </Button>
                <Button onClick={onNext} disabled={!isValid} className="bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]">
                    다음: {state.type === "TEAM" ? "팀 빌딩" : "확인"}
                    <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
            </div>
        </div>
    );
}
