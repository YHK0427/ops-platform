import { useMemo } from "react";
import { CalendarCheck } from "lucide-react";
import { useMyAttendance, type MyAttendance } from "@/hooks/useMemberLedger";

// 출결 상태 → 라벨·색
const STATUS: Record<string, { label: string; cls: string; dot: string }> = {
    PRESENT:      { label: "출석",            cls: "bg-emerald-50 text-emerald-600 border-emerald-200", dot: "bg-emerald-500" },
    LATE_UNDER10: { label: "지각(10분 미만)", cls: "bg-amber-50 text-amber-600 border-amber-200",       dot: "bg-amber-500" },
    LATE_OVER10:  { label: "지각(10분 이상)", cls: "bg-orange-50 text-orange-600 border-orange-200",    dot: "bg-orange-500" },
    EARLY_LEAVE:  { label: "조퇴",            cls: "bg-orange-50 text-orange-600 border-orange-200",    dot: "bg-orange-500" },
    ABSENT:       { label: "결석",            cls: "bg-rose-50 text-rose-600 border-rose-200",          dot: "bg-rose-500" },
    EXCUSED:      { label: "공결",            cls: "bg-slate-100 text-slate-600 border-slate-200",      dot: "bg-slate-400" },
};

function statusOf(s: string) {
    return STATUS[s] ?? { label: s, cls: "bg-gray-100 text-gray-600 border-gray-200", dot: "bg-gray-400" };
}

function fmtDate(iso: string | null) {
    if (!iso) return "";
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function MemberAttendance() {
    const { data: rows, isLoading } = useMyAttendance();

    const summary = useMemo(() => {
        const s = { present: 0, late: 0, absent: 0, excused: 0 };
        for (const r of rows ?? []) {
            if (r.status === "PRESENT") s.present++;
            else if (r.status === "LATE_UNDER10" || r.status === "LATE_OVER10") s.late++;
            else if (r.status === "ABSENT") s.absent++;
            else if (r.status === "EXCUSED") s.excused++;
            else if (r.status === "EARLY_LEAVE") s.late++; // 조퇴는 지각류로 집계
        }
        return s;
    }, [rows]);

    return (
        <main className="mx-auto max-w-lg px-4 py-4">
            <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900 mb-4">
                <CalendarCheck className="w-5 h-5 text-rose-500" />
                내 출결
            </h2>

            {/* 요약 */}
            <div className="grid grid-cols-4 gap-2 mb-4">
                {[
                    { label: "출석", val: summary.present, cls: "text-emerald-600" },
                    { label: "지각·조퇴", val: summary.late, cls: "text-amber-600" },
                    { label: "결석", val: summary.absent, cls: "text-rose-600" },
                    { label: "공결", val: summary.excused, cls: "text-slate-500" },
                ].map((c) => (
                    <div key={c.label} className="rounded-xl border border-gray-200 bg-white p-2.5 text-center">
                        <p className={`text-xl font-extrabold tabular-nums ${c.cls}`}>{c.val}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">{c.label}</p>
                    </div>
                ))}
            </div>

            {isLoading ? (
                <div className="py-20 text-center text-sm text-gray-400">불러오는 중…</div>
            ) : !rows || rows.length === 0 ? (
                <div className="py-20 text-center text-sm text-gray-400">아직 출결 기록이 없어요</div>
            ) : (
                <div className="space-y-2.5">
                    {rows.map((r: MyAttendance) => {
                        const st = statusOf(r.status);
                        return (
                            <div key={r.session_id} className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3.5">
                                <div className="shrink-0 w-10 text-center">
                                    <p className="text-[11px] text-gray-400 leading-none">{r.week_num}주차</p>
                                    <p className="text-xs font-semibold text-gray-500 mt-1">{fmtDate(r.session_date)}</p>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-gray-900 truncate">{r.title}</p>
                                    {(r.note || r.excuse_type) && (
                                        <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                                            {r.excuse_type === "PRE" ? "사전 공결" : r.excuse_type === "POST" ? "사후 공결" : ""}
                                            {r.note ? `${r.excuse_type ? " · " : ""}${r.note}` : ""}
                                        </p>
                                    )}
                                </div>
                                <span className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-bold ${st.cls}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                                    {st.label}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </main>
    );
}
