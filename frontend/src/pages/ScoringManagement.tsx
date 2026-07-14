import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import {
    Check, ChevronRight, Download, Gavel, Link2, Loader2, Plus, QrCode, Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
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
                subtitle="공개 링크를 뿌려 심사위원·참관위원 점수를 모으고 실시간으로 집계합니다"
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
