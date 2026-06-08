// 카테고리 색 → 정적 Tailwind 클래스 매핑.
// ⚠️ Tailwind JIT는 동적 문자열 조합을 인식 못 하므로 색마다 클래스를 명시적으로 둔다.
// 백엔드 ALLOWED_COLORS 와 키가 일치해야 한다.

export interface ColorClasses {
    chip: string;       // 연한 배지 (라벨 칩)
    chipStrong: string; // 진한 배지 (카드 섹션 라벨)
    section: string;    // 카드 섹션 배경
    ring: string;       // textarea 포커스 링
    dot: string;        // 색 미리보기 점
}

export const FEEDBACK_COLORS: Record<string, ColorClasses> = {
    emerald: { chip: "bg-emerald-50 text-emerald-600", chipStrong: "bg-emerald-100 text-emerald-700", section: "bg-emerald-50/60", ring: "focus:ring-emerald-200", dot: "bg-emerald-500" },
    amber:   { chip: "bg-amber-50 text-amber-600",     chipStrong: "bg-amber-100 text-amber-700",     section: "bg-amber-50/60",   ring: "focus:ring-amber-200",   dot: "bg-amber-500" },
    sky:     { chip: "bg-sky-50 text-sky-600",         chipStrong: "bg-sky-100 text-sky-700",         section: "bg-sky-50/60",     ring: "focus:ring-sky-200",     dot: "bg-sky-500" },
    violet:  { chip: "bg-violet-50 text-violet-600",   chipStrong: "bg-violet-100 text-violet-700",   section: "bg-violet-50/60",  ring: "focus:ring-violet-200",  dot: "bg-violet-500" },
    rose:    { chip: "bg-rose-50 text-rose-600",       chipStrong: "bg-rose-100 text-rose-700",       section: "bg-rose-50/60",    ring: "focus:ring-rose-200",    dot: "bg-rose-500" },
    indigo:  { chip: "bg-indigo-50 text-indigo-600",   chipStrong: "bg-indigo-100 text-indigo-700",   section: "bg-indigo-50/60",  ring: "focus:ring-indigo-200",  dot: "bg-indigo-500" },
    teal:    { chip: "bg-teal-50 text-teal-600",       chipStrong: "bg-teal-100 text-teal-700",       section: "bg-teal-50/60",    ring: "focus:ring-teal-200",    dot: "bg-teal-500" },
    slate:   { chip: "bg-slate-100 text-slate-600",    chipStrong: "bg-slate-200 text-slate-700",     section: "bg-slate-50",      ring: "focus:ring-slate-200",   dot: "bg-slate-500" },
};

export const COLOR_OPTIONS = Object.keys(FEEDBACK_COLORS);

export function colorClasses(color: string | undefined): ColorClasses {
    return FEEDBACK_COLORS[color ?? ""] ?? FEEDBACK_COLORS.slate;
}

// 생성 다이얼로그 프리셋 (클릭으로 추가)
export const CATEGORY_PRESETS: { key: string; label: string; color: string }[] = [
    { key: "praise", label: "칭찬", color: "emerald" },
    { key: "improve", label: "발전", color: "amber" },
    { key: "question", label: "질문", color: "sky" },
    { key: "summary", label: "총평", color: "violet" },
    { key: "impressive", label: "인상깊은 점", color: "rose" },
    { key: "idea", label: "아이디어", color: "indigo" },
    { key: "curious", label: "궁금한 점", color: "teal" },
];

export const DEFAULT_CATEGORIES = [
    { key: "praise", label: "칭찬", color: "emerald" },
    { key: "improve", label: "발전", color: "amber" },
];

// 피드백 작성 시간 — 초 단위까지. 오늘이 아니면 날짜 접두.
export function formatFeedbackTime(iso: string | null | undefined): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    const t = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const now = new Date();
    const sameDay =
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate();
    return sameDay ? t : `${d.getMonth() + 1}/${d.getDate()} ${t}`;
}
