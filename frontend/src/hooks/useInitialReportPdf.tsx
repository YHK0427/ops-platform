import { useCallback, useRef, useState } from "react";
import InitialReportPdf, { type InitialReportPdfData } from "@/components/eval/InitialReportPdf";

export interface InitialReportPdfInput {
    data: InitialReportPdfData;
    slogan: string;
    cohortLabel: string;
}

/**
 * 초기(단일) 리포트 PDF(2페이지) 생성 훅 — 기수 결과 화면과 운영진 결과 카드가 같이 쓴다.
 * useGrowthReportPdf(후기 비교 리포트)와 같은 사용법: JSX 에 {node} 를 두고 generate(...) 호출.
 */
export function useInitialReportPdf() {
    const page1Ref = useRef<HTMLDivElement>(null);
    const page2Ref = useRef<HTMLDivElement>(null);
    const [input, setInput] = useState<InitialReportPdfInput | null>(null);
    const [generating, setGenerating] = useState(false);

    const generate = useCallback(async (d: InitialReportPdfInput) => {
        setGenerating(true);
        setInput(d);
        // 오프스크린 렌더 + 레이더 차트 안정화 대기
        await new Promise((r) => setTimeout(r, 800));
        try {
            const { toJpeg } = await import("html-to-image");
            const { jsPDF } = await import("jspdf");
            const PW = 210; // A4 폭(mm)
            // 각 페이지를 콘텐츠 높이에 맞춰 캡처 → 페이지 크기를 콘텐츠에 맞춰 생성(빈 공간 제거)
            const capture = async (el: HTMLDivElement) => {
                const url = await toJpeg(el, { pixelRatio: 2, quality: 0.95, backgroundColor: "#ffffff" });
                const img = await new Promise<HTMLImageElement>((res) => {
                    const i = new Image();
                    i.onload = () => res(i);
                    i.src = url;
                });
                return { url, h: (PW * img.height) / img.width };
            };
            const els = [page1Ref.current, page2Ref.current].filter(Boolean) as HTMLDivElement[];
            if (!els.length) return;
            const first = await capture(els[0]);
            const pdf = new jsPDF({ unit: "mm", format: [PW, first.h] });
            pdf.addImage(first.url, "JPEG", 0, 0, PW, first.h);
            for (let i = 1; i < els.length; i++) {
                const p = await capture(els[i]);
                pdf.addPage([PW, p.h]);
                pdf.addImage(p.url, "JPEG", 0, 0, PW, p.h);
            }
            pdf.save(`${d.data.member_name}_발표 성장 리포트.pdf`);
        } finally {
            setGenerating(false);
            setInput(null);
        }
    }, []);

    const node = input ? (
        <div style={{ position: "fixed", left: -99999, top: 0, zIndex: -1 }} aria-hidden>
            <InitialReportPdf data={input.data} slogan={input.slogan} cohortLabel={input.cohortLabel}
                page1Ref={page1Ref} page2Ref={page2Ref} />
        </div>
    ) : null;

    return { generate, node, generating };
}
