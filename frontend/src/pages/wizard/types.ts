export type SessionType = "INDIVIDUAL" | "TEAM";

export interface WizardState {
    week_num: number;
    title: string;
    date: string;
    type: SessionType;
    teams: Record<string, number[]>; // team_id -> member_ids

    // Config Options
    has_ppt_email: boolean;
    has_review: boolean;
    has_feedback: boolean;
    is_holiday: boolean;

    // Deadlines (ISO datetime strings, e.g. "2026-03-05T09:00")
    deadline_ppt_email: string;
    deadline_post: string;
}

export interface StepProps {
    state: WizardState;
    onChange: (updates: Partial<WizardState>) => void;
    onNext: () => void;
    onBack: () => void;
}
