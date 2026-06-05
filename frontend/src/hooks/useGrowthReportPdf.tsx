import { useCallback, useRef, useState } from "react";
import FinalReportPdf from "@/components/eval/FinalReportPdf";
import type { RoundScores } from "@/components/eval/FinalGrowthReport";

export interface GrowthReportPdfData {
    memberName: string;
    final: RoundScores;
    initial: RoundScores;
    growthReflection?: string | null;
}

/**
 * 후기 비교 리포트(표지·결과1·결과2 3페이지) PDF를 생성하는 공용 훅.
 * 기수(MemberResult)·운영진(EvalResultCard) 양쪽에서 재사용.
 *
 * 사용: const { generate, node, generating } = useGrowthReportPdf();
 *  - JSX 어딘가에 {node} 를 렌더(화면 밖 캡처용 컨테이너)
 *  - 버튼에서 generate(data) 호출 → 콘텐츠 높이에 맞춘 3페이지 PDF 저장
 */
export function useGrowthReportPdf() {
    const coverRef = useRef<HTMLDivElement>(null);
    const page1Ref = useRef<HTMLDivElement>(null);
    const page2Ref = useRef<HTMLDivElement>(null);
    const [data, setData] = useState<GrowthReportPdfData | null>(null);
    const [generating, setGenerating] = useState(false);

    const generate = useCallback(async (d: GrowthReportPdfData) => {
        setGenerating(true);
        setData(d);
        // 오프스크린 렌더 + 레이더(애니메이션 off) 안정화 대기
        await new Promise((r) => setTimeout(r, 700));
        try {
            const { toJpeg } = await import("html-to-image");
            const { jsPDF } = await import("jspdf");
            const PW = 210; // A4 폭(mm)

            const capture = async (el: HTMLDivElement) => {
                const url = await toJpeg(el, { pixelRatio: 2, quality: 0.95, backgroundColor: "#ffffff" });
                const img = await new Promise<HTMLImageElement>((res) => {
                    const i = new Image();
                    i.onload = () => res(i);
                    i.src = url;
                });
                return { url, h: (PW * img.height) / img.width };
            };

            const els = [coverRef.current, page1Ref.current, page2Ref.current].filter(Boolean) as HTMLDivElement[];
            if (!els.length) return;

            const first = await capture(els[0]);
            const pdf = new jsPDF({ unit: "mm", format: [PW, first.h] });
            pdf.addImage(first.url, "JPEG", 0, 0, PW, first.h);
            for (let i = 1; i < els.length; i++) {
                const p = await capture(els[i]);
                pdf.addPage([PW, p.h]);
                pdf.addImage(p.url, "JPEG", 0, 0, PW, p.h);
            }
            pdf.save(`${d.memberName}_발표 성장 리포트.pdf`);
        } finally {
            setGenerating(false);
            setData(null);
        }
    }, []);

    const node = data ? (
        <div style={{ position: "fixed", left: -99999, top: 0, zIndex: -1 }} aria-hidden>
            <FinalReportPdf
                memberName={data.memberName}
                final={data.final}
                initial={data.initial}
                growthReflection={data.growthReflection}
                coverRef={coverRef}
                page1Ref={page1Ref}
                page2Ref={page2Ref}
            />
        </div>
    ) : null;

    return { generate, node, generating };
}
