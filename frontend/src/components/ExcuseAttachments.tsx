import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import api from "@/lib/api";
import memberApi from "@/lib/memberApi";
import type { Excuse, ExcuseAttachment } from "@/hooks/useExcuses";

// 증빙자료는 인증이 필요한 경로라 <img src> 로 직접 못 건다 — blob 으로 받아 object URL 로 띄운다.
function useBlobUrl(path: string, owner: "member" | "staff") {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        let revoked = false;
        let objectUrl: string | null = null;
        (owner === "member" ? memberApi : api).get(path, { responseType: "blob" })
            .then(({ data }) => {
                if (revoked) return;
                objectUrl = URL.createObjectURL(data);
                setUrl(objectUrl);
            })
            .catch(() => {});
        return () => {
            revoked = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [path, owner]);
    return url;
}

function Thumb({ excuseId, att, owner, onOpen, onRemove }: {
    excuseId: number; att: ExcuseAttachment; owner: "member" | "staff";
    onOpen: (url: string) => void; onRemove?: () => void;
}) {
    const path = owner === "member"
        ? `/portal/excuses/${excuseId}/attachments/${att.id}`
        : `/excuses/${excuseId}/attachments/${att.id}`;
    const url = useBlobUrl(path, owner);
    return (
        <div className="relative w-16 h-16 shrink-0">
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); if (url) onOpen(url); }}
                className="w-full h-full rounded-lg overflow-hidden border border-gray-200 bg-gray-100"
                title={att.name}
            >
                {url && <img src={url} alt={att.name} className="w-full h-full object-cover" />}
            </button>
            {onRemove && (
                <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onRemove(); }}
                    aria-label="증빙자료 삭제"
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-900/80 text-white flex items-center justify-center"
                >
                    <X className="w-3 h-3" />
                </button>
            )}
        </div>
    );
}

export function ExcuseAttachments({ excuse, owner, onRemove }: {
    excuse: Excuse; owner: "member" | "staff"; onRemove?: (attId: number) => void;
}) {
    const [viewing, setViewing] = useState<string | null>(null);
    if (!excuse.attachments.length) return null;
    return (
        <>
            <div className="flex flex-wrap gap-2">
                {excuse.attachments.map(att => (
                    <Thumb key={att.id} excuseId={excuse.id} att={att} owner={owner} onOpen={setViewing}
                        onRemove={onRemove ? () => onRemove(att.id) : undefined} />
                ))}
            </div>
            {viewing && createPortal(
                <div
                    className="fixed inset-0 z-[100] bg-black/85 flex items-center justify-center p-4"
                    onClick={(e) => { e.stopPropagation(); setViewing(null); }}
                >
                    <img src={viewing} alt="증빙자료" className="max-w-full max-h-full object-contain" />
                    <button type="button" aria-label="닫기" className="absolute top-4 right-4 text-white">
                        <X className="w-6 h-6" />
                    </button>
                </div>,
                document.body,
            )}
        </>
    );
}
