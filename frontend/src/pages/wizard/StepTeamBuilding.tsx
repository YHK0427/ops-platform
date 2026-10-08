import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, X } from "lucide-react";
import { toast } from "sonner";
import type { StepProps } from "./types";
import { useMembers } from "@/hooks";
import api from "@/lib/api";
import { TeamBuildingEditor } from "@/components/TeamBuildingEditor";

interface Board {
    id: number;
    name: string;
    data: { num_teams?: number; assignment?: Record<string, "pool" | number> };
    session_id: number | null;
    session_label: string | null;
}

/** 보드 assignment({"m12": 3, "u4": 2}) → 에디터 팀 구조({"1조": [...], unassigned: [...]}). 운영진(u*)은 세션 팀에 못 들어가 제외. */
function boardToTeams(board: Board, activeIds: number[]) {
    const n = board.data.num_teams ?? 6;
    const asgn = board.data.assignment ?? {};
    const teams: Record<string, number[]> = { unassigned: [] };
    for (let t = 1; t <= n; t++) teams[`${t}조`] = [];
    for (const id of activeIds) {
        const slot = asgn[`m${id}`];
        (typeof slot === "number" && slot >= 1 && slot <= n ? teams[`${slot}조`] : teams.unassigned).push(id);
    }
    const staff = Object.entries(asgn).filter(([k, v]) => k.startsWith("u") && typeof v === "number").length;
    return { teams, staff };
}

export function StepTeamBuilding({ state, onChange, onNext, onBack }: StepProps) {
    const { data: members } = useMembers();
    const { data: boards = [] } = useQuery<Board[]>({
        queryKey: ["tb-boards"],
        queryFn: async () => (await api.get("/team-building/boards")).data,
    });
    const [seed, setSeed] = useState<Record<string, number[]> | null>(null);
    const [editorKey, setEditorKey] = useState(0);
    const boardId = state.board_id ?? null;
    const linkedBoard = boards.find((b) => b.id === boardId);

    const activeIds = (members ?? []).filter((m) => m.is_active).map((m) => m.id);
    const initialTeams = seed
        ?? (Object.keys(state.teams).length > 0 ? state.teams : { unassigned: activeIds });

    const importBoard = (id: number) => {
        const b = boards.find((x) => x.id === id);
        if (!b) return;
        const { teams, staff } = boardToTeams(b, activeIds);
        setSeed(teams);
        setEditorKey((k) => k + 1);
        onChange({ teams, board_id: b.id });
        const unassigned = teams.unassigned.length;
        toast.success(
            `'${b.name}' 팀 구성을 불러왔어요`
            + (unassigned ? ` · 미배정 ${unassigned}명` : "")
            + (staff ? ` · 운영진 ${staff}명은 세션 팀에 포함되지 않음` : ""),
        );
    };

    // 연결 안 된 보드 먼저, 연결된 보드는 뒤 (다른 세션에 이미 쓰인 구성)
    const sorted = [...boards].sort((a, b) => Number(!!a.session_id) - Number(!!b.session_id));

    return (
        <div className="space-y-4 max-w-[90vw] mx-auto h-[80vh] flex flex-col">
            <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-xl font-bold">팀 빌딩</h2>
                {boards.length > 0 && (
                    <div className="flex items-center gap-2 ml-auto flex-wrap">
                        <ClipboardList className="w-4 h-4 text-[var(--color-text-muted)]" />
                        <select
                            value=""
                            disabled={!members}
                            onChange={(e) => e.target.value && importBoard(Number(e.target.value))}
                            className="px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-sm bg-white"
                            aria-label="팀빌딩 보드에서 불러오기"
                        >
                            <option value="">{members ? "팀빌딩 보드에서 불러오기…" : "멤버 불러오는 중…"}</option>
                            {sorted.map((b) => (
                                <option key={b.id} value={b.id}>
                                    {b.name}{b.session_id ? ` (${b.session_label ?? "다른 세션"}에 연결됨)` : ""}
                                </option>
                            ))}
                        </select>
                    </div>
                )}
            </div>
            {linkedBoard && (
                <div className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-[var(--color-accent-dim)] text-[var(--color-accent)]">
                    <span className="flex-1 break-keep">
                        <b>{linkedBoard.name}</b>에서 불러옴 · 세션을 만들면 이 보드와 연결돼요
                        {linkedBoard.session_id && ` (기존 ${linkedBoard.session_label ?? "세션"} 연결은 해제됨)`}
                    </span>
                    <button onClick={() => onChange({ board_id: null })} className="shrink-0 flex items-center gap-1 text-xs hover:underline" title="팀 구성은 유지하고 보드 연결만 안 함">
                        <X className="w-3.5 h-3.5" /> 연결 안 함
                    </button>
                </div>
            )}
            <div className="flex-1 min-h-0">
                <TeamBuildingEditor
                    // 멤버 목록이 늦게 오면 처음 그린 에디터가 빈 미배정으로 굳는다 — 도착 시 한 번 다시 그림
                    key={`${editorKey}-${members ? "ready" : "loading"}`}
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
