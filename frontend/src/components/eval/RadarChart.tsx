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
    PLANNING: "기획 (Planning)",
    DESIGN: "디자인 (Design)",
    SPEECH: "스피치 (Speech)",
};

export { RadarChart };
export default function RadarChart({
    selfScores,
    audienceScores,
    size = 300,
    variant = "dark",
}: RadarChartProps) {
    const isLight = variant === "light";

    const chartData = (["PLANNING", "DESIGN", "SPEECH"] as const).map((domain) => ({
        domain: DOMAIN_LABELS[domain],
        self: selfScores[domain],
        ...(audienceScores ? { audience: audienceScores[domain] } : {}),
    }));

    return (
        <div style={{ width: "100%", height: size }}>
            <ResponsiveContainer width="100%" height="100%">
                <RechartsRadarChart data={chartData} cx="50%" cy="50%" outerRadius="70%">
                    <PolarGrid
                        stroke={isLight ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.15)"}
                        gridType="polygon"
                    />
                    <PolarAngleAxis
                        dataKey="domain"
                        tick={{
                            fill: isLight ? "#374151" : "rgba(255,255,255,0.8)",
                            fontSize: 12,
                            fontWeight: 600,
                        }}
                    />
                    <PolarRadiusAxis
                        angle={90}
                        domain={[0, 5]}
                        tickCount={6}
                        tick={{
                            fill: isLight ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.35)",
                            fontSize: 10,
                        }}
                        axisLine={false}
                    />
                    <Radar
                        name="자기평가"
                        dataKey="self"
                        stroke="#60a5fa"
                        fill="#60a5fa"
                        fillOpacity={isLight ? 0.15 : 0.25}
                        strokeWidth={2}
                        dot={{ r: 4, fill: "#60a5fa" }}
                    />
                    {audienceScores && (
                        <Radar
                            name="청중평가"
                            dataKey="audience"
                            stroke="#f472b6"
                            fill="#f472b6"
                            fillOpacity={isLight ? 0.15 : 0.2}
                            strokeWidth={2}
                            dot={{ r: 4, fill: "#f472b6" }}
                        />
                    )}
                </RechartsRadarChart>
            </ResponsiveContainer>
        </div>
    );
}
