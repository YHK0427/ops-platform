import { useRef, useState } from "react";
import { toJpeg } from "html-to-image";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Camera, Download, Loader2, Sun, Moon } from "lucide-react";
import { formatNumber } from "@/lib/utils";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { translateDescription } from "@/hooks";

// --- Types ---
interface ReportEntry {
    id: number;
    type: string;
    score_delta: number;
    amount_krw: number;
    description: string;
    created_at: string | null;
}
interface ReportSession {
    id: number;
    week_num: number;
    title: string;
    date: string | null;
}
interface ReportMember {
    id: number;
    name: string;
    total_plus_score: number;
    total_minus_score: number;
    net_score: number;
    current_deposit: number;
    by_session: Record<string, ReportEntry[]>;
    no_session: ReportEntry[];
    attendance: Record<string, string>;
}
interface ReportData {
    sessions: ReportSession[];
    members: ReportMember[];
}

// --- Theme ---
interface Theme {
    bg: string;
    surface: string;
    surfaceAlt: string;
    text: string;
    textSecondary: string;
    textMuted: string;
    textDim: string;
    border: string;
    borderSubtle: string;
    accent: string;
    green: string;
    red: string;
    blue: string;
    yellow: string;
    orange: string;
    newBg: string;
    newText: string;
    rowEven: string;
    rowOdd: string;
    headerBg: string;
    depositBg: string;
    footerBorder: string;
    separator: string;
    entryBg: string;
}

const DARK: Theme = {
    bg: "#08080F",
    surface: "#0E0E16",
    surfaceAlt: "#13131D",
    text: "#EAEAF2",
    textSecondary: "#B0B0C8",
    textMuted: "#6B6B84",
    textDim: "#5C5C74",
    border: "rgba(255,255,255,0.06)",
    borderSubtle: "rgba(255,255,255,0.04)",
    accent: "#F43F5E",
    green: "#34D399",
    red: "#FB7185",
    blue: "#60A5FA",
    yellow: "#FBBF24",
    orange: "#F97316",
    newBg: "rgba(96,165,250,0.15)",
    newText: "#60A5FA",
    rowEven: "#0D0D15",
    rowOdd: "#101018",
    headerBg: "#13131D",
    depositBg: "rgba(96,165,250,0.06)",
    footerBorder: "rgba(255,255,255,0.06)",
    separator: "#3A3A50",
    entryBg: "rgba(0,0,0,0.15)",
};

const LIGHT: Theme = {
    bg: "#FFFFFF",
    surface: "#F5F5F7",
    surfaceAlt: "#EDEDF0",
    text: "#1A1A2E",
    textSecondary: "#4A4A60",
    textMuted: "#8888A0",
    textDim: "#AAAAB8",
    border: "rgba(0,0,0,0.08)",
    borderSubtle: "rgba(0,0,0,0.04)",
    accent: "#E11D48",
    green: "#059669",
    red: "#E11D48",
    blue: "#2563EB",
    yellow: "#D97706",
    orange: "#EA580C",
    newBg: "rgba(37,99,235,0.1)",
    newText: "#2563EB",
    rowEven: "#FAFAFC",
    rowOdd: "#F0F0F4",
    headerBg: "#EDEDF0",
    depositBg: "rgba(37,99,235,0.06)",
    footerBorder: "rgba(0,0,0,0.08)",
    separator: "#CCCCDD",
    entryBg: "rgba(0,0,0,0.03)",
};

function useReportData(enabled: boolean) {
    return useQuery<ReportData>({
        queryKey: ["ledger", "report"],
        queryFn: () => api.get("/ledger/report").then(r => r.data),
        enabled,
    });
}

const font = "'Pretendard Variable', -apple-system, sans-serif";

function shortDesc(desc: string): string {
    return translateDescription(desc);
}

function categorizeEntry(e: ReportEntry): "penalty" | "merit" | "fine" {
    if (e.type === "MERIT") return "merit";
    if (e.type === "MILESTONE_FINE" || (e.type === "FINE" && e.score_delta === 0)) return "fine";
    return "penalty";
}

function getAttLabels(t: Theme): Record<string, { short: string; color: string }> {
    return {
        PRESENT: { short: "출석", color: t.green },
        LATE_UNDER10: { short: "지각(<10분)", color: t.yellow },
        LATE_OVER10: { short: "지각(≥10분)", color: t.orange },
        EARLY_LEAVE: { short: "조퇴", color: t.orange },
        ABSENT: { short: "결석", color: t.red },
        EXCUSED: { short: "공결", color: t.blue },
        PENDING: { short: "-", color: t.textDim },
    };
}

function reportHeader(title: string, sub: string, dateStr: string, t: Theme) {
    return (
        <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: t.accent, letterSpacing: "0.1em", marginBottom: 6 }}>UNIVPT 33기</div>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em" }}>{title}</div>
            <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4 }}>{dateStr} 기준{sub && ` · ${sub}`}</div>
        </div>
    );
}

function reportFooter(t: Theme) {
    return (
        <div style={{
            marginTop: 20, paddingTop: 12,
            borderTop: `1px solid ${t.footerBorder}`,
            display: "flex", justifyContent: "space-between",
            fontSize: 10, color: t.textDim,
        }}>
            <div>UnivPT Ops Platform</div>
            <div>이의 제기 시 학술부에게 문의 주세요</div>
        </div>
    );
}

function getDateStr() {
    const today = new Date();
    return `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, "0")}.${String(today.getDate()).padStart(2, "0")}`;
}

// ═══════════════════════════════════════════════════
// IMAGE 1: 현황판 (Overview — landscape card grid)
// ═══════════════════════════════════════════════════

function MemberCard({ member, t }: { member: ReportMember; t: Theme }) {
    return (
        <div style={{
            background: t.surface,
            border: `1px solid ${t.border}`,
            borderRadius: 12,
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            minWidth: 0,
        }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {member.name}
                </span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4, fontSize: 12 }}>
                <span style={{ color: t.green, fontWeight: 600 }}>+{member.total_plus_score}</span>
                <span style={{ color: t.textDim, fontSize: 10 }}>/</span>
                <span style={{ color: t.red, fontWeight: 600 }}>{member.total_minus_score}</span>
                <span style={{ color: t.textDim, fontSize: 10 }}>=</span>
                <span style={{
                    fontSize: 16, fontWeight: 800,
                    color: member.net_score > 0 ? t.green : member.net_score < 0 ? t.red : t.text,
                }}>
                    {member.net_score > 0 ? "+" : ""}{member.net_score}
                </span>
                <span style={{ color: t.textDim, fontSize: 10 }}>점</span>
            </div>
            <div style={{
                fontSize: 12, fontWeight: 700, color: t.blue,
                background: t.depositBg,
                borderRadius: 6, padding: "4px 8px",
                textAlign: "center",
            }}>
                ₩{formatNumber(member.current_deposit)}
            </div>
        </div>
    );
}

function OverviewImage({ data, t }: { data: ReportData; t: Theme }) {
    const sorted = [...data.members].sort((a, b) => a.name.localeCompare(b.name, "ko"));
    return (
        <div style={{ width: 920, fontFamily: font, color: t.text, background: t.bg, padding: "32px 32px 24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
                {reportHeader("주간 현황판", "", getDateStr(), t)}
                <div style={{ display: "flex", gap: 16, fontSize: 11, color: t.textMuted }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: t.green }} />상점
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: t.red }} />벌점
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: t.blue }} />디파짓
                    </div>
                </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                {sorted.map(m => <MemberCard key={m.id} member={m} t={t} />)}
            </div>
            {reportFooter(t)}
        </div>
    );
}

// ═══════════════════════════════════════════════════
// IMAGE 2: 출석부 (Attendance grid)
// ═══════════════════════════════════════════════════

function AttendanceImage({ data, t }: { data: ReportData; t: Theme }) {
    const { sessions, members } = data;
    const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name, "ko"));
    const sessionsWithAtt = sessions.filter(s =>
        members.some(m => m.attendance[String(s.id)])
    );
    const labels = getAttLabels(t);

    const cellW = Math.min(72, Math.max(56, Math.floor((920 - 120) / (sessionsWithAtt.length || 1))));
    const totalW = 120 + sessionsWithAtt.length * cellW;

    return (
        <div style={{ width: Math.max(920, totalW), fontFamily: font, color: t.text, background: t.bg, padding: "32px 32px 24px" }}>
            {reportHeader("출석부", "", getDateStr(), t)}

            {/* Legend */}
            <div style={{ display: "flex", gap: 14, fontSize: 11, color: t.textMuted, marginBottom: 14 }}>
                {Object.entries(labels).filter(([k]) => k !== "PENDING").map(([, v]) => (
                    <div key={v.short + v.color} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: v.color }} />{v.short}
                    </div>
                ))}
            </div>

            <div style={{ borderRadius: 14, overflow: "hidden", border: `1px solid ${t.border}` }}>
                {/* Header row */}
                <div style={{
                    display: "flex",
                    background: t.headerBg,
                    borderBottom: `1px solid ${t.border}`,
                    fontSize: 11, fontWeight: 700, color: t.textDim,
                }}>
                    <div style={{ width: 120, padding: "10px 14px", flexShrink: 0 }}>이름</div>
                    {sessionsWithAtt.map(s => (
                        <div key={s.id} style={{ width: cellW, textAlign: "center", padding: "8px 4px", flexShrink: 0, lineHeight: 1.3 }}>
                            <div style={{ fontSize: 10, color: t.textDim }}>{s.week_num}주차</div>
                            <div>{s.title}</div>
                        </div>
                    ))}
                </div>

                {/* Member rows */}
                {sorted.map((m, idx) => (
                    <div key={m.id} style={{
                        display: "flex",
                        background: idx % 2 === 0 ? t.rowEven : t.rowOdd,
                        borderBottom: `1px solid ${t.borderSubtle}`,
                        fontSize: 12,
                    }}>
                        <div style={{ width: 120, padding: "8px 14px", fontWeight: 600, flexShrink: 0 }}>{m.name}</div>
                        {sessionsWithAtt.map(s => {
                            const status = m.attendance[String(s.id)] || "PENDING";
                            const info = labels[status] || labels.PENDING;
                            return (
                                <div key={s.id} style={{
                                    width: cellW,
                                    textAlign: "center",
                                    padding: "8px 4px",
                                    fontWeight: 600,
                                    fontSize: 11,
                                    color: info.color,
                                    flexShrink: 0,
                                }}>
                                    {info.short}
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
            {reportFooter(t)}
        </div>
    );
}

// ═══════════════════════════════════════════════════
// IMAGE 3: 상세 내역 (Detail breakdown)
// ═══════════════════════════════════════════════════

function MemberDetail({ member, sessionMap, newCutoff, t }: { member: ReportMember; sessionMap: Map<string, ReportSession>; newCutoff: string; t: Theme }) {
    type Item = { session: string; dateStr: string; createdAt: string; desc: string; score: number; amount: number; cat: "penalty" | "merit" | "fine" };
    const items: Item[] = [];

    const fmtDate = (d: string | null) => {
        if (!d) return "";
        return d.slice(5, 10).replace("-", "/");
    };

    for (const [sid, entries] of Object.entries(member.by_session)) {
        const s = sessionMap.get(sid);
        const sessionLabel = s ? s.title : "";
        const dateStr = s ? fmtDate(s.date) : "";
        for (const e of entries) {
            items.push({
                session: sessionLabel, dateStr, createdAt: e.created_at || "",
                desc: shortDesc(e.description),
                score: e.score_delta, amount: e.amount_krw,
                cat: categorizeEntry(e),
            });
        }
    }
    for (const e of member.no_session) {
        items.push({
            session: "", dateStr: fmtDate(e.created_at), createdAt: e.created_at || "",
            desc: shortDesc(e.description),
            score: e.score_delta, amount: e.amount_krw,
            cat: categorizeEntry(e),
        });
    }

    if (items.length === 0) return null;

    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const catColor = (cat: string) => cat === "merit" ? t.green : cat === "fine" ? t.yellow : t.red;

    return (
        <div style={{
            background: t.surface,
            borderRadius: 12,
            border: `1px solid ${t.border}`,
            padding: "12px 16px",
        }}>
            <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                marginBottom: 8,
            }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{member.name}</span>
                <div style={{ display: "flex", gap: 8, fontSize: 12 }}>
                    <span style={{ color: t.green, fontWeight: 700 }}>+{member.total_plus_score}</span>
                    <span style={{ color: t.red, fontWeight: 700 }}>{member.total_minus_score}</span>
                    <span style={{ color: t.textDim }}>=</span>
                    <span style={{
                        fontWeight: 800,
                        color: member.net_score > 0 ? t.green : member.net_score < 0 ? t.red : t.text,
                    }}>
                        {member.net_score > 0 ? "+" : ""}{member.net_score}점
                    </span>
                    <span style={{ color: t.separator }}>|</span>
                    <span style={{ color: t.blue, fontWeight: 700 }}>₩{formatNumber(member.current_deposit)}</span>
                </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {items.map((item, i) => (
                    <EntryRow key={i} item={item} color={catColor(item.cat)} isNew={item.createdAt >= newCutoff} dateStr={item.dateStr} t={t} />
                ))}
            </div>
        </div>
    );
}

function EntryRow({ item, color, isNew, dateStr, t }: { item: { session: string; desc: string; score: number; amount: number }; color: string; isNew?: boolean; dateStr?: string; t: Theme }) {
    return (
        <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "4px 8px",
            fontSize: 11.5,
            borderRadius: 6,
            background: isNew ? t.newBg : t.entryBg,
        }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: color, flexShrink: 0 }} />
            {isNew && (
                <span style={{
                    fontSize: 8, fontWeight: 800, padding: "1px 4px", borderRadius: 3,
                    background: t.newBg, color: t.newText, letterSpacing: "0.05em", flexShrink: 0,
                }}>NEW</span>
            )}
            {dateStr && (
                <span style={{ color: t.textDim, fontSize: 10, fontWeight: 600, flexShrink: 0 }}>{dateStr}</span>
            )}
            {item.session && (
                <span style={{ color: t.textMuted, flexShrink: 0 }}>{item.session}</span>
            )}
            {(dateStr || item.session) && <span style={{ color: t.separator }}>·</span>}
            <span style={{ color: t.textSecondary, flex: 1 }}>{item.desc}</span>
            {item.score !== 0 && (
                <span style={{ fontWeight: 700, color, flexShrink: 0 }}>
                    {item.score > 0 ? "+" : ""}{item.score}점
                </span>
            )}
            {item.amount !== 0 && (
                <span style={{ fontWeight: 600, fontSize: 10.5, color: item.amount < 0 ? t.red : t.blue, flexShrink: 0, opacity: 0.8 }}>
                    {item.amount > 0 ? "+" : ""}{formatNumber(item.amount)}원
                </span>
            )}
        </div>
    );
}

function DetailImage({ data, t }: { data: ReportData; t: Theme }) {
    const { members, sessions } = data;
    const sorted = [...members].sort((a, b) => b.net_score - a.net_score);
    const sessionMap = new Map(sessions.map(s => [String(s.id), s]));

    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const newCutoff = cutoff.toISOString();

    const membersWithEntries = sorted.filter(m =>
        Object.keys(m.by_session).length > 0 || m.no_session.length > 0
    );

    if (membersWithEntries.length === 0) return null;

    return (
        <div style={{ width: 920, fontFamily: font, color: t.text, background: t.bg, padding: "32px 32px 24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20 }}>
                {reportHeader("상세 내역", "최신순", getDateStr(), t)}
                <div style={{ display: "flex", gap: 16, fontSize: 11, color: t.textMuted }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: t.red }} />벌점
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: t.green }} />상점
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: t.yellow }} />벌금
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{
                            fontSize: 8, fontWeight: 800, padding: "1px 4px", borderRadius: 3,
                            background: t.newBg, color: t.newText,
                        }}>NEW</span>
                        최근 7일
                    </div>
                </div>
            </div>
            <div style={{ columnCount: 2, columnGap: 8 }}>
                {membersWithEntries.map(m => (
                    <div key={m.id} style={{ breakInside: "avoid", marginBottom: 8 }}>
                        <MemberDetail member={m} sessionMap={sessionMap} newCutoff={newCutoff} t={t} />
                    </div>
                ))}
            </div>
            {reportFooter(t)}
        </div>
    );
}

// ═══════════════════════════════════════════════════
// Export Dialog — 3 tabs + theme toggle
// ═══════════════════════════════════════════════════

type ImageTab = "overview" | "attendance" | "detail";

const TAB_META: { key: ImageTab; label: string; suffix: string }[] = [
    { key: "overview", label: "현황판", suffix: "현황판" },
    { key: "attendance", label: "출석부", suffix: "출석부" },
    { key: "detail", label: "상세 내역", suffix: "상세내역" },
];

export function WeeklyReportButton() {
    const [open, setOpen] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [activeTab, setActiveTab] = useState<ImageTab>("overview");
    const [light, setLight] = useState(false);
    const overviewRef = useRef<HTMLDivElement>(null);
    const attendanceRef = useRef<HTMLDivElement>(null);
    const detailRef = useRef<HTMLDivElement>(null);
    const { data, isLoading } = useReportData(open);

    const theme = light ? LIGHT : DARK;

    const refMap: Record<ImageTab, React.RefObject<HTMLDivElement | null>> = {
        overview: overviewRef,
        attendance: attendanceRef,
        detail: detailRef,
    };

    const capture = async (ref: React.RefObject<HTMLDivElement | null>) => {
        if (!ref.current) return null;
        return toJpeg(ref.current, { pixelRatio: 2, backgroundColor: theme.bg, quality: 0.95 });
    };

    const handleDownload = async () => {
        setGenerating(true);
        try {
            const url = await capture(refMap[activeTab]);
            if (!url) return;
            const meta = TAB_META.find(t => t.key === activeTab)!;
            const link = document.createElement("a");
            link.download = `univpt-${meta.suffix}-${new Date().toISOString().slice(0, 10)}.jpg`;
            link.href = url;
            link.click();
            toast.success("이미지가 다운로드되었습니다.");
        } catch { toast.error("이미지 생성 실패"); }
        finally { setGenerating(false); }
    };

    const handleDownloadAll = async () => {
        setGenerating(true);
        try {
            const date = new Date().toISOString().slice(0, 10);
            const urls: [string | null, string][] = [];
            for (const meta of TAB_META) {
                urls.push([await capture(refMap[meta.key]), meta.suffix]);
            }
            for (const [url, name] of urls) {
                if (!url) continue;
                const link = document.createElement("a");
                link.download = `univpt-${name}-${date}.jpg`;
                link.href = url;
                link.click();
                await new Promise(r => setTimeout(r, 500));
            }
            toast.success(`${TAB_META.length}장 모두 다운로드되었습니다.`);
        } catch { toast.error("이미지 생성 실패"); }
        finally { setGenerating(false); }
    };

    const tabBtn = (tab: ImageTab, label: string) => (
        <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
                padding: "6px 16px",
                fontSize: 13,
                fontWeight: activeTab === tab ? 700 : 500,
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                background: activeTab === tab ? "var(--color-accent, #6366f1)" : "transparent",
                color: activeTab === tab ? "#fff" : "var(--color-text-muted, #888)",
                transition: "all 0.15s",
            }}
        >
            {label}
        </button>
    );

    const renderImage = (tab: ImageTab) => {
        if (!data) return null;
        switch (tab) {
            case "overview": return <OverviewImage data={data} t={theme} />;
            case "attendance": return <AttendanceImage data={data} t={theme} />;
            case "detail": return <DetailImage data={data} t={theme} />;
        }
    };

    const inactiveTabs = TAB_META.filter(t => t.key !== activeTab);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" className="text-violet-600 border-violet-500/20 hover:bg-violet-500/10">
                    <Camera className="mr-2 h-4 w-4" /> 현황 이미지
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-[980px] max-h-[90vh] overflow-auto">
                <DialogHeader>
                    <DialogTitle>주간 현황 이미지</DialogTitle>
                </DialogHeader>

                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--color-bg-secondary,#1a1a2e)] w-fit">
                        {TAB_META.map(t => tabBtn(t.key, t.label))}
                    </div>
                    <button
                        onClick={() => setLight(!light)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
                        style={{
                            background: light ? "#F5F5F7" : "#1a1a2e",
                            color: light ? "#1A1A2E" : "#E8E8F0",
                            borderColor: light ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.12)",
                        }}
                    >
                        {light ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                        {light ? "라이트" : "다크"}
                    </button>
                </div>

                <div className="flex gap-2 mb-2">
                    <Button onClick={handleDownload} disabled={generating || isLoading} size="sm">
                        {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                        {TAB_META.find(t => t.key === activeTab)!.label} 다운로드
                    </Button>
                    <Button variant="outline" onClick={handleDownloadAll} disabled={generating || isLoading} size="sm">
                        <Download className="mr-2 h-4 w-4" /> {TAB_META.length}장 모두 다운로드
                    </Button>
                </div>

                {isLoading ? (
                    <div className="flex items-center justify-center py-20 text-[var(--color-text-muted)]">
                        <Loader2 className="w-6 h-6 animate-spin mr-2" /> 로딩 중...
                    </div>
                ) : data ? (
                    <div style={{ position: "relative" }}>
                        {/* Active tab */}
                        <div className="rounded-xl overflow-hidden border border-[var(--color-border)] overflow-x-auto">
                            <div ref={refMap[activeTab]}>{renderImage(activeTab)}</div>
                        </div>
                        {/* Offscreen tabs for capture */}
                        {inactiveTabs.map(t => (
                            <div key={t.key} style={{ position: "absolute", left: -99999, top: 0, pointerEvents: "none" }} aria-hidden>
                                <div ref={refMap[t.key]}>{renderImage(t.key)}</div>
                            </div>
                        ))}
                    </div>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}
