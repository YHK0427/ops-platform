import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";

// ── Types ────────────────────────────────────────────────────────────────────

export type ObserverMode = "SCORE" | "RANK";
export type ScoringRole = "JUDGE" | "OBSERVER";

export interface Criterion {
    id: number;
    area_id?: number | null;
    label: string;
    description?: string | null;
    max_score: number;
    order_num: number;
}

export interface Area {
    id: number;
    label: string;
    description?: string | null;
    max_score: number;
    order_num: number;
    criteria: Criterion[];  // 세부항목 (없으면 영역 통째로 채점)
}

export type DeductionKind = "TIME" | "DURATION" | "FLAG";

export interface DeductionRule {
    id: number;
    label: string;
    description?: string | null;
    kind: DeductionKind;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: Record<string, any>;
    order_num: number;
}

export interface Deduction {
    target_id: number;
    rule_id: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: Record<string, any>;
    points: number;
    disqualified: boolean;
    note?: string | null;
}

export interface Target {
    id: number;
    name: string;
    /** 평가 폼·결과에 실제로 보이는 이름. 비어 있으면 name을 쓴다. */
    display_name?: string | null;
    order_num: number;
    team_id?: number | null;
    member_ids: number[];
    member_names: string[];
}

export interface RosterEntry {
    id: number;
    name: string;
    role: ScoringRole | "ANY";
    member_id?: number | null;
    note?: string | null;
    /** 이 사람의 기본 소그룹 — 제출 시 본인이 안 고르면 물려받는다. */
    group_label?: string | null;
}

export interface RankPoint {
    rank: number;
    points: number;
}

export interface ScoringRound {
    id: number;
    name: string;
    intro?: string | null;
    session_id?: number | null;
    session_label?: string | null;
    public_token: string;
    is_open: boolean;
    judge_weight: number;
    observer_weight: number;
    observer_mode: ObserverMode;
    rank_points: RankPoint[];
    exclude_own_team: boolean;
    /** 청중(RANK 모드) 전용 — 켜면 팀별 피드백을 모두 채워야 제출된다. 심사위원 총평엔 적용 안 함. */
    require_feedback: boolean;
    /** 청중 소그룹 라벨 (기수/운영진/청중 …). 분류·표시용 — 집계엔 영향 없음. */
    observer_groups: string[];
    areas: Area[];
    criteria: Criterion[];  // 미분류(평면) 기준만
    targets: Target[];
    roster: RosterEntry[];
    deduction_rules: DeductionRule[];
    submitted_count: number;
    created_at?: string | null;
}

export interface RoundListItem {
    id: number;
    name: string;
    session_label?: string | null;
    public_token: string;
    is_open: boolean;
    observer_mode: ObserverMode;
    target_count: number;
    submitted_count: number;
    created_at?: string | null;
}

export interface Participant {
    id: number;
    role: ScoringRole;
    entered_name: string;
    group_label?: string | null;
    matched_roster_id?: number | null;
    matched_member_id?: number | null;
    is_proxy: boolean;
    proxy_by?: string | null;
    submitted_at?: string | null;
    /** 청중 순위/피드백 링크가 분리돼 있어(RANK 모드) 둘 중 하나만 냈을 수 있다 */
    has_ranks: boolean;
    has_feedback: boolean;
    suggestions: RosterEntry[];
}

export interface SubmissionStatus {
    participants: Participant[];
    roster: RosterEntry[];
    roster_submitted: Record<number, number>;
}

export interface TargetComment {
    participant_name: string;
    role: string;
    criterion_id?: number | null;
    body: string;
}

export interface TargetResult {
    target_id: number;
    name: string;
    judge_points: number;
    observer_points: number;
    pre_deduction: number;
    deduction: number;
    total: number;
    disqualified: boolean;
    rank: number;
    judge_count: number;
    observer_count: number;
    criterion_avg: Record<number, number>;
    area_avg: Record<number, number>;
    rank_votes: Record<number, number>;
    comments: TargetComment[];
}

export interface JudgeDetail {
    participant_id: number;
    name: string;
    role: string;
    is_proxy: boolean;
    totals: Record<number, number>;
}

export interface Submitter {
    participant_id: number;
    name: string;
    role: ScoringRole;
    group_label?: string | null;
    submitted_at?: string | null;
}

export interface Results {
    round: ScoringRound;
    results: TargetResult[];
    judges: JudgeDetail[];
    /** 제출자 목록 — 개별 제출 내용을 열어보기 위한 인덱스. */
    submitters: Submitter[];
    judge_submitted: number;
    observer_submitted: number;
    /** 청중 소그룹별 제출 인원 — 분류용 표시. */
    observer_by_group: Record<string, number>;
    /** 팀별 감점 상세 {target_id: [{rule_label, points, disqualified}]} */
    deduction_detail: Record<number, { rule_label: string; points: number; disqualified: boolean }[]>;
    has_deductions: boolean;
    roster_total: number;
}

export interface ScoreEntry {
    target_id: number;
    /** 세부항목/미분류면 criterion_id, 영역 통째면 area_id (둘 중 하나) */
    criterion_id?: number | null;
    area_id?: number | null;
    score: number;
}

export interface RankEntry {
    target_id: number;
    rank: number;
}

export interface CommentEntry {
    target_id: number;
    criterion_id?: number | null;
    body: string;
}

export interface Submission {
    participant_token: string;
    role: ScoringRole;
    entered_name: string;
    group_label?: string | null;
    submitted: boolean;
    scores: ScoreEntry[];
    ranks: RankEntry[];
    comments: CommentEntry[];
    blocked_target_ids: number[];
}

// ── Query keys ───────────────────────────────────────────────────────────────

export const scoringKeys = {
    all: ["scoring"] as const,
    rounds: () => [...scoringKeys.all, "rounds"] as const,
    round: (id: number) => [...scoringKeys.all, "round", id] as const,
    participants: (id: number) => [...scoringKeys.all, "participants", id] as const,
    results: (id: number) => [...scoringKeys.all, "results", id] as const,
    deductions: (id: number) => [...scoringKeys.all, "deductions", id] as const,
};

export interface DeductionsGrid {
    rules: DeductionRule[];
    deductions: Deduction[];
}

// ── Queries ──────────────────────────────────────────────────────────────────

export function useScoringRounds() {
    return useQuery({
        queryKey: scoringKeys.rounds(),
        queryFn: async () => (await api.get<RoundListItem[]>("/scoring/rounds")).data,
    });
}

export function useScoringRound(id: number | null) {
    return useQuery({
        queryKey: scoringKeys.round(id ?? 0),
        queryFn: async () => (await api.get<ScoringRound>(`/scoring/rounds/${id}`)).data,
        enabled: !!id,
    });
}

export function useScoringParticipants(id: number | null) {
    return useQuery({
        queryKey: scoringKeys.participants(id ?? 0),
        queryFn: async () => (await api.get<SubmissionStatus>(`/scoring/rounds/${id}/participants`)).data,
        enabled: !!id,
    });
}

export type ResultsFilter = { role: "ALL" | "JUDGE" | "OBSERVER"; groups: string[] };

/**
 * 집계 결과. 필터를 주면 그 부분집합만으로 **서버에서 다시 집계**한다
 * (프론트에서 자르면 정규화가 깨진다 — 인원수로 나누는 계산이라).
 */
export function useScoringResults(id: number | null, filter?: ResultsFilter) {
    const role = filter?.role ?? "ALL";
    const groups = filter?.groups ?? [];
    return useQuery({
        queryKey: [...scoringKeys.results(id ?? 0), role, [...groups].sort().join(",")],
        queryFn: async () =>
            (await api.get<Results>(`/scoring/rounds/${id}/results`, {
                params: {
                    role,
                    ...(groups.length ? { groups: groups.join(",") } : {}),
                },
            })).data,
        enabled: !!id,
    });
}

// ── Mutations ────────────────────────────────────────────────────────────────

function useRoundMutation<TArgs>(
    fn: (roundId: number, args: TArgs) => Promise<unknown>,
    roundId: number,
) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (args: TArgs) => fn(roundId, args),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: scoringKeys.round(roundId) });
            qc.invalidateQueries({ queryKey: scoringKeys.results(roundId) });
            qc.invalidateQueries({ queryKey: scoringKeys.participants(roundId) });
            qc.invalidateQueries({ queryKey: scoringKeys.deductions(roundId) });
            qc.invalidateQueries({ queryKey: scoringKeys.rounds() });
        },
    });
}

// ── 루브릭 (영역/세부항목) ──

export interface RubricAreaInput {
    id?: number;
    label: string;
    description?: string | null;
    max_score?: number | null;  // 세부항목 있으면 합으로 자동
    criteria: { id?: number; label: string; description?: string | null; max_score: number }[];
}

export interface RubricInput {
    areas: RubricAreaInput[];
    ungrouped: { id?: number; label: string; description?: string | null; max_score: number }[];
}

export function useSaveRubric(roundId: number) {
    return useRoundMutation(
        (id, body: RubricInput) => api.put(`/scoring/rounds/${id}/rubric`, body),
        roundId,
    );
}

// ── 감점 규정 / 팀별 감점 ──

export function useSaveDeductionRules(roundId: number) {
    return useRoundMutation(
        (id, body: {
            id?: number; label: string; description?: string | null;
            kind: DeductionKind; config: Record<string, unknown>;
        }[]) => api.put(`/scoring/rounds/${id}/deduction-rules`, body),
        roundId,
    );
}

export function useDeductions(id: number | null) {
    return useQuery({
        queryKey: scoringKeys.deductions(id ?? 0),
        queryFn: async () => (await api.get<DeductionsGrid>(`/scoring/rounds/${id}/deductions`)).data,
        enabled: !!id,
    });
}

export function useSaveDeductions(roundId: number) {
    return useRoundMutation(
        (id, body: { target_id: number; rule_id: number; input: Record<string, unknown>; note?: string | null }[]) =>
            api.put(`/scoring/rounds/${id}/deductions`, body),
        roundId,
    );
}

export function useCreateRound() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (body: { name: string; session_id?: number | null }) =>
            (await api.post<ScoringRound>("/scoring/rounds", body)).data,
        onSuccess: () => qc.invalidateQueries({ queryKey: scoringKeys.rounds() }),
    });
}

export function useDeleteRound() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => api.delete(`/scoring/rounds/${id}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: scoringKeys.rounds() }),
    });
}

export function useUpdateRound(roundId: number) {
    return useRoundMutation(
        (id, body: Partial<ScoringRound>) => api.patch(`/scoring/rounds/${id}`, body),
        roundId,
    );
}

export function useToggleRound(roundId: number) {
    return useRoundMutation(
        (id, open: boolean) => api.post(`/scoring/rounds/${id}/${open ? "open" : "close"}`),
        roundId,
    );
}

/** 기준 일괄 저장 — id가 없는 항목은 신규 생성, 목록에서 빠진 기존 항목은 삭제된다. */
export function useSaveCriteria(roundId: number) {
    return useRoundMutation(
        (id, body: {
            id?: number;
            label: string;
            description?: string | null;
            max_score: number;
        }[]) => api.put(`/scoring/rounds/${id}/criteria`, body),
        roundId,
    );
}

export function useSaveTargets(roundId: number) {
    return useRoundMutation(
        (id, body: { id?: number; name: string }[]) => api.put(`/scoring/rounds/${id}/targets`, body),
        roundId,
    );
}

export function useImportSessionTeams(roundId: number) {
    return useRoundMutation(
        (id, sessionId: number) =>
            api.post(`/scoring/rounds/${id}/targets/import-session`, null, {
                params: { session_id: sessionId },
            }),
        roundId,
    );
}

export function useSaveRoster(roundId: number) {
    return useRoundMutation(
        (id, body: Omit<RosterEntry, "id">[] | RosterEntry[]) => api.put(`/scoring/rounds/${id}/roster`, body),
        roundId,
    );
}

/** 기수 멤버를 명단으로 — group_label로 소그룹을 한 번에 태깅한다. */
export function useImportMembers(roundId: number) {
    return useRoundMutation(
        (id, params: { role: string; group_label?: string | null }) =>
            api.post(`/scoring/rounds/${id}/roster/import-members`, null, { params }),
        roundId,
    );
}

/** 운영진(User)을 명단으로. 운영진은 팀에 속하지 않아 자기팀 제외 대상이 아니다. */
export function useImportStaff(roundId: number) {
    return useRoundMutation(
        (id, params: { role: string; group_label?: string | null }) =>
            api.post(`/scoring/rounds/${id}/roster/import-staff`, null, { params }),
        roundId,
    );
}

export function usePatchParticipant(roundId: number) {
    return useRoundMutation(
        (_id, args: {
            participantId: number;
            matched_roster_id?: number | null;
            role?: ScoringRole;
            group_label?: string | null;
        }) => {
            const { participantId, ...body } = args;
            return api.patch(`/scoring/participants/${participantId}`, body);
        },
        roundId,
    );
}

export function useDeleteParticipant(roundId: number) {
    return useRoundMutation(
        (_id, participantId: number) => api.delete(`/scoring/participants/${participantId}`),
        roundId,
    );
}

export function useProxySubmit(roundId: number) {
    return useRoundMutation(
        (id, body: {
            participant_id?: number | null;
            name?: string;
            role?: ScoringRole;
            group_label?: string | null;
            scores: ScoreEntry[];
            ranks: RankEntry[];
            comments: CommentEntry[];
        }) => api.put(`/scoring/rounds/${id}/proxy-submit`, body),
        roundId,
    );
}

/** 운영진이 대리 수정하기 전에 기존 제출분을 불러온다. */
export async function fetchParticipantSubmission(participantId: number): Promise<Submission> {
    return (await api.get<Submission>(`/scoring/participants/${participantId}/submission`)).data;
}

/** 결과 Excel 다운로드 — 결과/심사위원별/상세점수/피드백/제출현황 5개 시트. */
export async function downloadScoringExcel(roundId: number, roundName: string) {
    const res = await api.get(`/scoring/rounds/${roundId}/export`, { responseType: "blob" });
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `심사결과_${roundName}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
