import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import {
    Check, ChevronRight, Download, Gavel, Link2, Loader2, Plus, QrCode, Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { ScreenGuide } from "@/components/ScreenGuide";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useCreateRound, useDeleteRound, useScoringRounds, type RoundListItem } from "@/hooks/useScoring";

export const publicScoringUrl = (token: string) => `${window.location.origin}/s/${token}`;

export default function ScoringManagement() {
    const navigate = useNavigate();
    const { data: rounds = [], isLoading } = useScoringRounds();
    const createMut = useCreateRound();
    const deleteMut = useDeleteRound();

    return (
        <div className="flex flex-col h-full">
            <PageHeader
                title="심사/채점"
                subtitle="공개 링크를 뿌려 심사위원·청중 점수를 모으고 실시간으로 집계합니다"
                actions={
                    <CreateRoundDialog
                        pending={createMut.isPending}
                        onCreate={(name) =>
                            createMut.mutate(
                                { name },
                                {
                                    onSuccess: (r) => navigate(`/scoring/${r.id}`),
                                    onError: () => toast.error("생성 실패"),
                                },
                            )
                        }
                    />
                }
            />
            <div className="flex-1 overflow-auto px-6 py-4">
                <ScreenGuide
                    storageKey="scoring-list"
                    title="심사/채점 사용법"
                    images={[
                        { src: "/help/scoring-weight.png", cap: "설정 · 집계 방식 — ①입력 멈추면 자동 저장 ②등수 비율(합 100% 권장) ③청중 소그룹 자유 편집" },
                        { src: "/help/scoring-rubric.png", cap: "설정 · 심사 기준 — ①영역 배점은 세부항목 합 ②세부항목 없으면 영역 통째 채점 ③영역 밖 기준도 가능" },
                        { src: "/help/scoring-deduction-rules.png", cap: "설정 · 감점 규정 — ①규정 종류는 실제 상황 이름으로 ②마감 시각 + 구간별/분당 선택 ③발표시간은 기준만 정하면 감점 탭에선 실제 시간만 입력" },
                        { src: "/help/scoring-public-toggle.png", cap: "심사위원·청중용 채점 폼 — ①세부항목별/영역 통째 채점 선택 ②세부항목 없는 영역은 통째로만 ③공용 기기면 여기서 다음 사람으로" },
                        { src: "/help/scoring-deductions-input.png", cap: "감점 탭 — ①실제 제출·발표시간만 입력하면 ②저장 시 감점이 자동 계산됩니다" },
                        { src: "/help/scoring-results.png", cap: "결과 탭 — ①실시간 자동 갱신 ②심사위원만·청중만 필터 ③감점전 → 감점 → 최종" },
                    ]}
                    steps={[
                        { title: "1. 새 심사 만들기", body: "‘새 심사’로 라운드를 만듭니다. 세션을 고르면 그 세션의 팀이 자동으로 심사 대상으로 들어옵니다. 세션 없이 팀을 직접 입력해도 됩니다(외부 대회)." },
                        { title: "2. 설정 — 기준", body: "심사 기준을 영역 → 세부항목 2단계로 짭니다. 예: ‘주제 적합성 30점’ 아래 ‘문제 재정의 10점’ 등. 세부항목을 안 두면 그 영역은 통째로 채점합니다." },
                        { title: "3. 설정 — 비중·청중", body: "심사위원 vs 청중 비중(합 100)을 정합니다. 청중은 등수 선택 또는 기준 채점 중 고르고, 소그룹(기수·운영진·참관위원 등)을 자유롭게 편집합니다." },
                        { title: "4. 설정 — 감점 규정", body: "발표자료 지각·발표시간 초과·미달·형식 미준수 같은 감점을 규정으로 정의합니다. 발표시간은 기준 시간만 정해두면 감점 탭에서 실제 발표시간을 입력할 때 자동 계산됩니다. 마감 후 제출은 실격으로 처리할 수 있습니다." },
                        { title: "5. 명단·링크 배포", body: "명단을 등록하면 ‘누가 냈는지’ 체크됩니다(없어도 됨). ‘채점 링크·QR’로 링크를 열고 배포하면 로그인 없이 누구나 이름만 넣고 채점합니다." },
                        { title: "6. 감점 입력·실시간 집계", body: "‘감점’ 탭에서 팀별 감점을 입력하고, ‘결과’ 탭에서 원점수 → 감점 → 최종점수와 순위를 실시간으로 봅니다. 엑셀로도 내보낼 수 있습니다." },
                    ]}
                />
                {isLoading ? (
                    <div className="flex justify-center py-16">
                        <Loader2 className="w-6 h-6 animate-spin text-[var(--color-text-muted)]" />
                    </div>
                ) : rounds.length === 0 ? (
                    <div className="text-center py-16 text-[var(--color-text-secondary)]">
                        <Gavel className="w-10 h-10 mx-auto mb-3 text-[var(--color-text-muted)]" />
                        아직 심사 라운드가 없어요. <b>새 심사</b>로 만들어보세요.
                        <p className="text-xs text-[var(--color-text-muted)] mt-2">
                            심사 기준과 대상 팀을 정한 뒤 링크를 열면, 로그인 없이 누구나 채점할 수 있습니다.
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                        {rounds.map((r) => (
                            <RoundCard
                                key={r.id}
                                round={r}
                                onOpen={() => navigate(`/scoring/${r.id}`)}
                                onDelete={() => {
                                    if (confirm(`'${r.name}' 심사를 삭제할까요? 제출된 점수도 함께 사라집니다.`)) {
                                        deleteMut.mutate(r.id, {
                                            onSuccess: () => toast.success("삭제됨"),
                                            onError: () => toast.error("삭제 실패"),
                                        });
                                    }
                                }}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function RoundCard({ round, onOpen, onDelete }: { round: RoundListItem; onOpen: () => void; onDelete: () => void }) {
    return (
        <div
            className="group flex items-center gap-3 p-4 rounded-xl border border-[var(--color-border-subtle)] bg-white shadow-sm hover:border-[var(--color-accent)]/40 cursor-pointer transition-colors"
            onClick={onOpen}
        >
            <div className="w-11 h-11 shrink-0 rounded-lg bg-[var(--color-accent-dim)] flex items-center justify-center">
                <Gavel className="w-5 h-5 text-[var(--color-accent)]" />
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="font-bold text-[var(--color-text-primary)] truncate">{round.name}</span>
                    <span
                        className={
                            round.is_open
                                ? "shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600"
                                : "shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-500"
                        }
                    >
                        {round.is_open ? "열림" : "마감"}
                    </span>
                </div>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                    {round.session_label ? `${round.session_label} · ` : ""}
                    대상 {round.target_count}팀 · 제출 {round.submitted_count}명
                </p>
            </div>
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <ShareLinkDialog token={round.public_token} name={round.name} compact />
                <Button size="sm" variant="ghost" className="text-rose-500 opacity-0 group-hover:opacity-100" onClick={onDelete}>
                    <Trash2 className="w-4 h-4" />
                </Button>
            </div>
            <ChevronRight className="w-4 h-4 text-[var(--color-text-muted)]" />
        </div>
    );
}

/**
 * 공개 링크 복사 + QR — 참가자에게 배포하는 유일한 경로.
 * compact=true면 아이콘만(목록 카드용), 아니면 라벨 달린 버튼(상세 헤더용).
 */
export function ShareLinkDialog({
    token, name, compact = false,
}: { token: string; name: string; compact?: boolean }) {
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const qrRef = useRef<HTMLDivElement>(null);
    const url = publicScoringUrl(token);

    /**
     * 링크 복사.
     * navigator.clipboard 는 **보안 컨텍스트(https 또는 localhost)에서만** 존재한다.
     * 이 앱은 Tailscale IP(http://100.x.x.x:5173) 같은 평문 주소로도 접속하므로,
     * 그때는 clipboard API 자체가 undefined → 예전 execCommand 방식으로 폴백한다.
     */
    const copy = async () => {
        const done = () => {
            setCopied(true);
            toast.success("링크를 복사했습니다");
            setTimeout(() => setCopied(false), 2000);
        };

        if (navigator.clipboard && window.isSecureContext) {
            try {
                await navigator.clipboard.writeText(url);
                done();
                return;
            } catch {
                /* 권한 거부 등 — 아래 폴백으로 */
            }
        }

        try {
            const ta = document.createElement("textarea");
            ta.value = url;
            ta.setAttribute("readonly", "");
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            ta.setSelectionRange(0, ta.value.length); // iOS 대응
            const ok = document.execCommand("copy");
            ta.remove();
            if (!ok) throw new Error("execCommand 실패");
            done();
        } catch {
            toast.error("복사에 실패했습니다 — 아래 주소를 직접 선택해 복사해 주세요");
        }
    };

    /**
     * 화면의 QR(SVG)을 PNG로 저장. 인쇄물·슬라이드에 붙일 수 있게 넉넉한 해상도로 다시 그린다.
     * SVG를 그대로 캔버스에 그리면 브라우저가 크기를 못 잡는 경우가 있어 width/height를 박아 직렬화한다.
     */
    const downloadQr = async (size = 1024) => {
        const svg = qrRef.current?.querySelector("svg");
        if (!svg) return;

        const clone = svg.cloneNode(true) as SVGElement;
        clone.setAttribute("width", String(size));
        clone.setAttribute("height", String(size));
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        const src = new XMLSerializer().serializeToString(clone);
        const blob = new Blob([src], { type: "image/svg+xml;charset=utf-8" });
        const objUrl = URL.createObjectURL(blob);

        try {
            const img = new Image();
            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error("QR 이미지를 만들지 못했습니다"));
                img.src = objUrl;
            });

            const pad = Math.round(size * 0.06); // 여백 없이 인쇄하면 인식률이 떨어진다
            const canvas = document.createElement("canvas");
            canvas.width = size + pad * 2;
            canvas.height = size + pad * 2;
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("canvas 컨텍스트 없음");
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, pad, pad, size, size);

            const png = canvas.toDataURL("image/png");
            const a = document.createElement("a");
            a.href = png;
            a.download = `${name}_채점QR.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            toast.success("QR 이미지를 저장했습니다");
        } catch {
            toast.error("QR 저장에 실패했습니다");
        } finally {
            URL.revokeObjectURL(objUrl);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {compact ? (
                    <Button size="sm" variant="ghost" title="채점 링크">
                        <Link2 className="w-4 h-4" />
                    </Button>
                ) : (
                    <Button size="sm" variant="outline">
                        <Link2 className="w-4 h-4 mr-1" />
                        채점 링크 · QR
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{name} — 채점 링크</DialogTitle>
                    <DialogDescription>
                        이 링크를 받은 사람은 <b>로그인 없이</b> 이름만 입력하고 채점할 수 있습니다.
                        링크가 <b>열림</b> 상태일 때만 제출됩니다.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex justify-center py-2">
                    <div
                        ref={qrRef}
                        className="p-3 bg-white rounded-xl border border-[var(--color-border-subtle)]"
                    >
                        <QRCodeSVG value={url} size={180} />
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="text-xs" />
                    <Button size="sm" onClick={copy}>
                        {copied ? <Check className="w-4 h-4" /> : <QrCode className="w-4 h-4" />}
                        <span className="ml-1">{copied ? "복사됨" : "복사"}</span>
                    </Button>
                </div>

                <Button size="sm" variant="outline" className="w-full" onClick={() => downloadQr()}>
                    <Download className="w-4 h-4 mr-1" />
                    QR 이미지 저장 (PNG)
                </Button>
            </DialogContent>
        </Dialog>
    );
}

function CreateRoundDialog({ onCreate, pending }: { onCreate: (name: string) => void; pending: boolean }) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");

    const submit = () => {
        if (!name.trim()) return;
        onCreate(name.trim());
        setOpen(false);
        setName("");
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button size="sm">
                    <Plus className="w-4 h-4 mr-1" /> 새 심사
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>새 심사 라운드</DialogTitle>
                    <DialogDescription>
                        만든 뒤 심사 기준·대상 팀·명단을 설정하고 링크를 엽니다.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                    <Label>심사 이름</Label>
                    <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="예: 33기 파이널 PT 심사"
                        autoFocus
                        onKeyDown={(e) => e.key === "Enter" && submit()}
                    />
                </div>
                <DialogFooter>
                    <Button disabled={!name.trim() || pending} onClick={submit}>
                        {pending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                        만들기
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
