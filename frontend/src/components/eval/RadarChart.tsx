import {
    RadarChart as RechartsRadarChart,
    PolarGrid,
    PolarAngleAxis,
    PolarRadiusAxis,
    Radar,
    ResponsiveContainer,
} from "recharts";

interface RadarChartProps {
    selfScores: { PLANNING: number; DESIGN: number; SPEECH: number };
    audienceScores?: { PLANNING: number; DESIGN: number; SPEECH: number };
    size?: number;
    variant?: "dark" | "light";
}

const DOMAIN_LABELS: Record<string, string> = {
    PLANNING: "기획",
    DESIGN: "디자인",
    SPEECH: "스피치",
};

const DOMAIN_COLORS: Record<string, string> = {
    기획: "#3b82f6",
    디자인: "#10b981",
    스피치: "#f59e0b",
};

const SELF_COLOR = "#f43f5e";
const AUD_COLOR = "#ec4899";

/** 소수점 둘째 자리에서 반올림하여 첫째 자리까지 표시 (IEEE 754 안전) */
function roundScore(val: number | null): string {
    if (val == null) return "-";
    const [int, dec = "00"] = val.toFixed(2).split(".");
    let d0 = +dec[0];
    const d1 = +dec[1];
    if (d1 >= 5) d0++;
    if (d0 >= 10) return `${+int + 1}.0`;
    return `${int}.${d0}`;
}

export { RadarChart };
export default function RadarChart({
    selfScores,
    audienceScores,
    size = 320,
    variant = "light",
}: RadarChartProps) {
    const isLight = variant === "light";

    const chartData = (["PLANNING", "DESIGN", "SPEECH"] as const).map((domain) => ({
        domain: DOMAIN_LABELS[domain],
        fullMark: 5,
        self: selfScores[domain],
        ...(audienceScores ? { audience: audienceScores[domain] } : {}),
    }));

    // Custom label for each axis with domain-colored text and colored scores
    const renderAxisTick = ({ x, y, payload }: { x: number; y: number; payload: { value: string } }) => {
        const label = payload.value;
        const color = DOMAIN_COLORS[label] ?? (isLight ? "#374151" : "#fff");
        const entry = chartData.find((d) => d.domain === label);
        const selfVal = entry?.self;
        const audVal = entry && "audience" in entry ? (entry as { audience?: number }).audience : undefined;

        const isTop = y < size / 2 - 20;
        const yOff = isTop ? -4 : 4;

        return (
            <g transform={`translate(${x},${y + yOff})`}>
                <text
                    textAnchor="middle"
                    fill={color}
                    fontSize={14}
                    fontWeight={700}
                    dy={isTop ? -6 : 2}
                >
                    {label}
                </text>
                {/* Self score in self color, audience score in audience color */}
                <text
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={600}
                    dy={isTop ? 10 : 18}
                >
                    <tspan fill={audVal != null ? SELF_COLOR : color}>
                        {roundScore(selfVal ?? null)}
                    </tspan>
                    {audVal != null && (
                        <>
                            <tspan fill={isLight ? "#9ca3af" : "rgba(255,255,255,0.4)"}> / </tspan>
                            <tspan fill={AUD_COLOR}>{roundScore(audVal)}</tspan>
                        </>
                    )}
                </text>
            </g>
        );
    };

    return (
        <div style={{ width: "100%", height: size, margin: "-8px 0" }}>
            <ResponsiveContainer width="100%" height="100%">
                <RechartsRadarChart data={chartData} cx="50%" cy="50%" outerRadius="72%">
                    <defs>
                        <linearGradient id="selfGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="#fda4af" stopOpacity={0.08} />
                        </linearGradient>
                        <linearGradient id="audGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#ec4899" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="#f472b6" stopOpacity={0.05} />
                        </linearGradient>
                    </defs>
                    <PolarGrid
                        stroke={isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.1)"}
                        gridType="polygon"
                    />
                    <PolarAngleAxis
                        dataKey="domain"
                        tick={renderAxisTick as never}
                    />
                    <PolarRadiusAxis
                        angle={90}
                        domain={[0, 5]}
                        tickCount={6}
                        tick={{
                            fill: isLight ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.25)",
                            fontSize: 9,
                        }}
                        axisLine={false}
                    />
                    <Radar
                        name="자기평가"
                        dataKey="self"
                        stroke={SELF_COLOR}
                        fill="url(#selfGrad)"
                        strokeWidth={2.5}
                        dot={{ r: 1.5, fill: SELF_COLOR }}
                    />
                    {audienceScores && (
                        <Radar
                            name="청중평가"
                            dataKey="audience"
                            stroke={AUD_COLOR}
                            fill="url(#audGrad)"
                            strokeWidth={2.5}
                            dot={{ r: 1.5, fill: AUD_COLOR }}
                        />
                    )}
                </RechartsRadarChart>
            </ResponsiveContainer>
        </div>
    );
}
