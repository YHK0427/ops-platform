import type { StepProps } from "./types";
import { useMembers } from "@/hooks";
import { TeamBuildingEditor } from "@/components/TeamBuildingEditor";

export function StepTeamBuilding({ state, onChange, onNext, onBack }: StepProps) {
    const { data: members } = useMembers();

    const initialTeams = Object.keys(state.teams).length > 0
        ? state.teams
        : { unassigned: (members ?? []).filter((m) => m.is_active).map((m) => m.id) };

    return (
        <div className="space-y-6 max-w-[90vw] mx-auto h-[80vh] flex flex-col">
            <h2 className="text-xl font-bold">Team Building</h2>
            <div className="flex-1 min-h-0">
                <TeamBuildingEditor
                    members={members ?? []}
                    initialTeams={initialTeams}
                    onSave={(teams) => {
                        onChange({ teams });
                        onNext();
                    }}
                    onCancel={onBack}
                    saveLabel="다음: 확인"
                    cancelLabel="이전"
                />
            </div>
        </div>
    );
}
