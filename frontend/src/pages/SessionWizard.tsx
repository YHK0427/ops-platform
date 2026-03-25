import { useState } from "react";
import type { WizardState } from "./wizard/types";
import { StepBasic } from "./wizard/StepBasic";
import { StepTeamBuilding } from "./wizard/StepTeamBuilding";
import { StepGroupBuilding } from "./wizard/StepGroupBuilding";
import { StepConfirmation } from "./wizard/StepConfirmation";
import { PageHeader } from "@/components/PageHeader";
import { calcDefaultDeadlines } from "./wizard/deadlineDefaults";

export default function SessionWizard() {
    const [step, setStep] = useState(1);
    const today = new Date().toISOString().split("T")[0];
    const defaults = calcDefaultDeadlines(today);
    const [state, setState] = useState<WizardState>({
        week_num: 1,
        title: "",
        date: today,
        type: "TEAM",
        teams: {}, // { "unassigned": [id1, id2], "team1": [id3, id4] }
        groups: {},
        staff_groups: {},
        has_ppt_email: true,
        has_ppt: true,
        has_review: true,
        has_feedback: true,
        has_groups: false,
        is_holiday: false,
        deadline_ppt_email: defaults.pptEmail,
        deadline_ppt_email_late: defaults.pptEmailLate,
        deadline_post: defaults.post,
    });

    const updateState = (updates: Partial<WizardState>) => {
        setState((prev) => ({ ...prev, ...updates }));
    };

    // Step 2 사용 여부: TEAM이면 팀빌딩, INDIVIDUAL+has_groups면 분반빌딩
    const needsStep2 = state.type === "TEAM" || (state.type === "INDIVIDUAL" && state.has_groups);

    const handleNext = () => {
        if (step === 1) {
            setStep(needsStep2 ? 2 : 3);
        } else if (step === 2) {
            setStep(3);
        }
    };

    const handleBack = () => {
        if (step === 3) {
            setStep(needsStep2 ? 2 : 1);
        } else {
            setStep((prev) => Math.max(1, prev - 1));
        }
    };

    const totalSteps = needsStep2 ? 3 : 2;
    const displayStep = !needsStep2 && step === 3 ? 2 : step;

    return (
        <div className="min-h-screen bg-[var(--color-base)] text-[var(--color-text-primary)]">
            <PageHeader
                title="새 세션 생성"
                subtitle={`${totalSteps}단계 중 ${displayStep}단계`}
            />

            <div className="container mx-auto px-4 py-8">
                {step === 1 && (
                    <StepBasic
                        state={state}
                        onChange={updateState}
                        onNext={handleNext}
                        onBack={handleBack}
                    />
                )}
                {step === 2 && state.type === "TEAM" && (
                    <StepTeamBuilding
                        state={state}
                        onChange={updateState}
                        onNext={handleNext}
                        onBack={handleBack}
                    />
                )}
                {step === 2 && state.type === "INDIVIDUAL" && state.has_groups && (
                    <StepGroupBuilding
                        state={state}
                        onChange={updateState}
                        onNext={handleNext}
                        onBack={handleBack}
                    />
                )}
                {step === 3 && (
                    <StepConfirmation
                        state={state}
                        onChange={updateState}
                        onNext={handleNext}
                        onBack={handleBack}
                    />
                )}
            </div>
        </div>
    );
}
