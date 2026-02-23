import { useState } from "react";
import type { WizardState } from "./wizard/types";
import { StepBasic } from "./wizard/StepBasic";
import { StepTeamBuilding } from "./wizard/StepTeamBuilding";
import { StepConfirmation } from "./wizard/StepConfirmation";
import { PageHeader } from "@/components/PageHeader";

export default function SessionWizard() {
    const [step, setStep] = useState(1);
    const [state, setState] = useState<WizardState>({
        week_num: 1,
        title: "",
        date: new Date().toISOString().split("T")[0],
        type: "TEAM",
        teams: {}, // { "unassigned": [id1, id2], "team1": [id3, id4] }
        has_ppt: true,
        has_review: true,
        has_feedback: true,
        is_holiday: false,
    });

    const updateState = (updates: Partial<WizardState>) => {
        setState((prev) => ({ ...prev, ...updates }));
    };

    const handleNext = () => {
        if (step === 1) {
            if (state.type === "TEAM") {
                setStep(2);
            } else {
                setStep(3);
            }
        } else if (step === 2) {
            setStep(3);
        }
    };

    const handleBack = () => {
        if (step === 3) {
            if (state.type === "TEAM") {
                setStep(2);
            } else {
                setStep(1);
            }
        } else {
            setStep((prev) => Math.max(1, prev - 1));
        }
    };

    const totalSteps = state.type === "TEAM" ? 3 : 2;
    const displayStep = state.type === "INDIVIDUAL" && step === 3 ? 2 : step;

    return (
        <div className="min-h-screen bg-[var(--color-base)] text-[var(--color-text-primary)]">
            <PageHeader
                title="Create New Session"
                subtitle={`Step ${displayStep} of ${totalSteps}`}
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
                {step === 2 && (
                    <StepTeamBuilding
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
