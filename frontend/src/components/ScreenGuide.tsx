import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { HelpCircle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface GuideImage {
    src: string;
    cap: string;
}

export interface GuideStep {
    title: string;
    body: string;
}

interface ScreenGuideProps {
    title?: string;
    /** 접힘 상태 기억용 키 (화면별 고유) */
    storageKey: string;
    images?: GuideImage[];
    steps: GuideStep[];
    /** 기본 펼침 여부 (기본 true, 한번 닫으면 기억) */
    defaultOpen?: boolean;
    className?: string;
}

/** 화면별 사용법 안내 — 접이식 패널 + 화살표 주석 스크린샷 + 단계 설명. 공용. */
export function ScreenGuide({ title = "사용법 안내", storageKey, images = [], steps, defaultOpen = true, className }: ScreenGuideProps) {
    const key = `guide_${storageKey}`;
    const [open, setOpen] = useState<boolean>(() => {
        const v = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
        return v == null ? defaultOpen : v === "open";
    });
    const toggle = () => {
        setOpen((v) => {
            const nv = !v;
            try { localStorage.setItem(key, nv ? "open" : "closed"); } catch { /* ignore */ }
            return nv;
        });
    };

    return (
        <div className={cn("mb-5 rounded-2xl border border-rose-100 bg-rose-50/40 overflow-hidden", className)}>
            <button onClick={toggle} className="w-full flex items-center justify-between px-4 py-3">
                <span className="flex items-center gap-2 text-sm font-bold text-rose-700">
                    <HelpCircle className="w-4 h-4" /> {title}
                </span>
                <ChevronDown className={cn("w-4 h-4 text-rose-400 transition-transform", open && "rotate-180")} />
            </button>
            <AnimatePresence initial={false}>
                {open && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                        <div className="px-4 pb-4 space-y-4">
                            {images.length > 0 && (
                                <div className={cn("grid gap-5", images.length > 1 && "xl:grid-cols-2")}>
                                    {images.map((f) => (
                                        <figure key={f.src} className="rounded-xl bg-white/70 p-2.5 border border-rose-100">
                                            <img src={f.src} alt={f.cap} loading="lazy" className="w-full rounded-lg border border-gray-200" />
                                            <figcaption className="text-sm font-semibold text-gray-700 mt-2 px-1 [word-break:keep-all]">{f.cap}</figcaption>
                                        </figure>
                                    ))}
                                </div>
                            )}
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                {steps.map((s) => (
                                    <div key={s.title} className="rounded-xl bg-white/70 p-3">
                                        <p className="text-xs font-bold text-gray-900 mb-0.5">{s.title}</p>
                                        <p className="text-[11px] text-gray-500 leading-relaxed [word-break:keep-all]">{s.body}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
