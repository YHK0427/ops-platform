export type SessionType = "INDIVIDUAL" | "TEAM";

export interface WizardState {
    week_num: number;
    title: string;
    date: string;
    type: SessionType;
    teams: Record<string, number[]>; // team_id -> member_ids

    // Config Options
    has_ppt: boolean;
    has_review: boolean;
    has_feedback: boolean;
    is_holiday: boolean;
}

export interface StepProps {
    state: WizardState;
    onChange: (updates: Partial<WizardState>) => void;
    onNext: () => void;
    onBack: () => void;
}
