import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileSpreadsheet, Loader2, AlertTriangle } from "lucide-react";
import { checkExcelMerits, downloadExcel, useUpdateLedger } from "@/hooks";
import type { UnmatchedMerit } from "@/hooks";
import { toast } from "sonner";

const ALL_PRESETS = [
    { label: "친바 선정팀 포상", reason: "친바 선정팀 포상" },
    { label: "Listen Up 1등", reason: "Listen Up 1등" },
    { label: "Listen Up 2등", reason: "Listen Up 2등" },
    { label: "BP 1등", reason: "BP 1등" },
    { label: "BP 2등", reason: "BP 2등" },
    { label: "피날래 본선 진출", reason: "피날래 본선 진출" },
    { label: "발전왕 선발", reason: "발전왕 선발" },
    { label: "베스트 협력상", reason: "베스트 협력상" },
    { label: "오프/오피 선정", reason: "오프/오피 선정" },
    { label: "추억상자 글 작성", reason: "추억상자 글 작성" },
    { label: "번개 주최 완료", reason: "번개 주최 완료" },
    { label: "번개 참석 2회", reason: "번개 참석 2회" },
    { label: "카페 정보성 자료 공유", reason: "카페 정보성 자료 공유" },
];

interface ExcelExportButtonProps {
    weekNum?: number;
    variant?: "default" | "outline";
    className?: string;
}

export function ExcelExportButton({ weekNum, variant = "outline", className }: ExcelExportButtonProps) {
    const [isChecking, setIsChecking] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [unmatchedItems, setUnmatchedItems] = useState<UnmatchedMerit[]>([]);
    // id -> selected preset reason
    const [selections, setSelections] = useState<Record<number, string>>({});

    const { mutateAsync: updateLedger } = useUpdateLedger();

    const handleClick = async () => {
        setIsChecking(true);
        try {
            const unmatched = await checkExcelMerits();
            if (unmatched.length === 0) {
                await doDownload();
            } else {
                setUnmatchedItems(unmatched);
                setSelections({});
                setDialogOpen(true);
            }
        } catch {
            toast.error("Excel 체크 실패");
        } finally {
            setIsChecking(false);
        }
    };

    const doDownload = async () => {
        setIsDownloading(true);
        try {
            await downloadExcel(weekNum);
            toast.success("Excel 파일이 다운로드되었습니다.");
            setDialogOpen(false);
        } catch {
            toast.error("Excel 내보내기 실패");
        } finally {
            setIsDownloading(false);
        }
    };

    const handleFixAndDownload = async () => {
        setIsDownloading(true);
        try {
            // 선택된 항목들의 사유 수정
            const entries = Object.entries(selections);
            for (const [idStr, reason] of entries) {
                await updateLedger({ id: Number(idStr), data: { description: reason } });
            }

            if (entries.length > 0) {
                toast.success(`${entries.length}건의 사유가 수정되었습니다.`);
            }

            await downloadExcel(weekNum);
            toast.success("Excel 파일이 다운로드되었습니다.");
            setDialogOpen(false);
        } catch {
            toast.error("처리 실패");
        } finally {
            setIsDownloading(false);
        }
    };

    const allSelected = unmatchedItems.every(item => selections[item.id]);
    const someSelected = Object.keys(selections).length > 0;
    const isLoading = isChecking || isDownloading;

    return (
        <>
            <Button
                variant={variant}
                className={className ?? "text-green-600 border-green-500/20 hover:bg-green-500/10"}
                onClick={handleClick}
                disabled={isLoading}
            >
                {isLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                )}
                Excel 내보내기
            </Button>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-[560px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="w-5 h-5 text-yellow-500" />
                            엑셀에 매칭되지 않는 상점
                        </DialogTitle>
                        <DialogDescription>
                            아래 상점 사유가 엑셀 컬럼에 매칭되지 않아 누락됩니다.
                            프리셋을 선택하면 사유를 수정 후 다운로드합니다.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3 max-h-[400px] overflow-y-auto py-2">
                        {unmatchedItems.map(item => (
                            <div key={item.id} className="rounded-lg border border-[var(--color-border)] p-3 space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium">{item.member_name}</span>
                                    <span className="text-xs text-green-600">+{item.score_delta}</span>
                                </div>
                                <div className="text-xs text-[var(--color-text-muted)] bg-[var(--color-base)] rounded px-2 py-1">
                                    현재: {item.description}
                                </div>
                                <Select
                                    value={selections[item.id] ?? ""}
                                    onValueChange={(v) => setSelections(prev => ({ ...prev, [item.id]: v }))}
                                >
                                    <SelectTrigger className="h-8 text-xs">
                                        <SelectValue placeholder="프리셋 선택..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {ALL_PRESETS.map(p => (
                                            <SelectItem key={p.reason} value={p.reason}>
                                                {p.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        ))}
                    </div>

                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button
                            variant="outline"
                            onClick={doDownload}
                            disabled={isDownloading}
                            className="text-[var(--color-text-muted)]"
                        >
                            그대로 다운로드
                        </Button>
                        <Button
                            onClick={handleFixAndDownload}
                            disabled={isDownloading || !someSelected}
                            className="bg-green-600 hover:bg-green-700 text-white"
                        >
                            {isDownloading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {allSelected ? "수정 후 다운로드" : someSelected ? `${Object.keys(selections).length}건 수정 후 다운로드` : "프리셋을 선택해주세요"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
