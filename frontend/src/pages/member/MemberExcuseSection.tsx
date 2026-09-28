import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, ImagePlus, Plus, X } from "lucide-react";
import { ExcuseAttachments } from "@/components/ExcuseAttachments";
import memberApi from "@/lib/memberApi";
import {
    CATEGORY_LABEL, REVIEW_LABEL, errMsg, useExcusePreview, useMyExcuses, type Excuse,
} from "@/hooks/useExcuses";

type Category = Excuse["category"];
type ReasonKind = Excuse["reason_kind"];

const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;

// 사후 마감(대상 날짜 다음날 21:59:59 KST)이 아직 안 지난 가장 이른 날짜
function minExcuseDate(): string {
    const kst = new Date(Date.now() + 9 * 3600_000); // UTC 필드가 곧 KST 시각
    const closed = kst.getUTCHours() * 60 + kst.getUTCMinutes() >= 22 * 60;
    kst.setUTCDate(kst.getUTCDate() - (closed ? 0 : 1));
    return kst.toISOString().slice(0, 10);
}

function fmtDay(iso: string) {
    const d = new Date(`${iso}T00:00:00`);
    return `${d.getMonth() + 1}/${d.getDate()} (${"일월화수목금토"[d.getDay()]})`;
}

function Toggle<T extends string>({ value, options, onChange }: {
    value: T; options: [T, string][]; onChange: (v: T) => void;
}) {
    return (
        <div className="flex gap-1.5">
            {options.map(([v, label]) => (
                <button
                    key={v}
                    type="button"
                    onClick={() => onChange(v)}
                    className={`flex-1 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                        value === v
                            ? "border-rose-500 bg-rose-50 text-rose-600"
                            : "border-gray-200 bg-white text-gray-500"
                    }`}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}

function ExcuseForm({ editing, onDone }: { editing: Excuse | null; onDone: () => void }) {
    const qc = useQueryClient();
    const [date, setDate] = useState(editing?.target_date ?? "");
    const [category, setCategory] = useState<Category>(editing?.category ?? "ABSENT");
    const [reasonKind, setReasonKind] = useState<ReasonKind>(editing?.reason_kind ?? "NORMAL");
    const [reason, setReason] = useState(editing?.reason ?? "");
    const [saving, setSaving] = useState(false);
    const [files, setFiles] = useState<File[]>([]);
    const [kept, setKept] = useState(editing?.attachments ?? []);
    const existing = kept.length;
    const previews = useMemo(() => files.map(f => URL.createObjectURL(f)), [files]);
    useEffect(() => () => previews.forEach(URL.revokeObjectURL), [previews]);

    const pick = (list: FileList | null) => {
        const picked = Array.from(list ?? []);
        if (picked.some(f => !f.type.startsWith("image/"))) return toast.error("사진 파일만 올릴 수 있어요");
        if (picked.some(f => f.size > MAX_BYTES)) return toast.error("사진은 한 장에 10MB 이하만 가능해요");
        if (existing + files.length + picked.length > MAX_FILES) return toast.error(`증빙자료는 ${MAX_FILES}장까지 올릴 수 있어요`);
        setFiles(prev => [...prev, ...picked]);
    };

    const removeExisting = async (attId: number) => {
        if (!editing) return;
        try {
            await memberApi.delete(`/portal/excuses/${editing.id}/attachments/${attId}`);
            qc.invalidateQueries({ queryKey: ["member", "excuses"] });
            setKept(prev => prev.filter(a => a.id !== attId));
        } catch (error: any) {
            toast.error(errMsg(error, "삭제 실패"));
        }
    };
    const { data: preview } = useExcusePreview(editing ? "" : date);

    const closed = !editing && preview?.excuse_type === null;
    const canSubmit = !!date && reason.trim().length > 0 && !closed && !saving;

    const submit = async () => {
        setSaving(true);
        try {
            const body = { category, reason_kind: reasonKind, reason };
            const id = editing
                ? (await memberApi.put<Excuse>(`/portal/excuses/${editing.id}`, body)).data.id
                : (await memberApi.post<Excuse>("/portal/excuses", { ...body, target_date: date })).data.id;
            const failed: string[] = [];
            for (const f of files) {
                const form = new FormData();
                form.append("file", f);
                try {
                    await memberApi.post(`/portal/excuses/${id}/attachments`, form, { headers: { "Content-Type": undefined } });
                } catch (error: any) {
                    failed.push(`${f.name}: ${errMsg(error, "업로드 실패")}`);
                }
            }
            if (failed.length) {
                toast.warning(`사유서는 저장됐지만 사진 ${failed.length}장을 올리지 못했습니다.`, { description: failed.join("\n") });
            } else {
                toast.success(editing ? "사유서를 수정했습니다." : "사유서를 제출했습니다.");
            }
            qc.invalidateQueries({ queryKey: ["member", "excuses"] });
            qc.invalidateQueries({ queryKey: ["member", "attendance"] });
            onDone();
        } catch (error: any) {
            toast.error(errMsg(error, "사유서 제출 실패"));
            qc.invalidateQueries({ queryKey: ["member", "excuses"] });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="rounded-2xl border border-rose-200 bg-white p-4 space-y-3.5">
            <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-gray-900">{editing ? "사유서 수정" : "사유서 제출"}</p>
                <button type="button" onClick={onDone} aria-label="닫기" className="p-1 text-gray-400">
                    <X className="w-4 h-4" />
                </button>
            </div>

            <label className="block">
                <span className="text-xs font-semibold text-gray-500">세션 날짜</span>
                <input
                    type="date"
                    value={date}
                    min={minExcuseDate()}
                    disabled={!!editing}
                    onChange={(e) => setDate(e.target.value)}
                    className="mt-1 block w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 disabled:bg-gray-50"
                />
            </label>
            {!editing && date && preview && (
                <p className={`text-xs ${closed ? "text-rose-600" : "text-gray-500"}`}>
                    {preview.excuse_type === "PRE" && <>지금 내면 <b className="text-gray-900">사전사유서</b>로 접수됩니다.</>}
                    {preview.excuse_type === "POST" && <>사전 마감이 지나 <b className="text-gray-900">사후사유서</b>로 접수됩니다.</>}
                    {closed && "사후사유서 마감이 지난 날짜입니다."}
                </p>
            )}

            <div>
                <span className="text-xs font-semibold text-gray-500">유형</span>
                <div className="mt-1">
                    <Toggle value={category} onChange={setCategory}
                        options={[["ABSENT", "결석"], ["LATE", "지각"], ["EARLY_LEAVE", "조퇴"]]} />
                </div>
            </div>

            <div>
                <span className="text-xs font-semibold text-gray-500">사유 구분</span>
                <div className="mt-1">
                    <Toggle value={reasonKind} onChange={setReasonKind}
                        options={[["NORMAL", "일반사유"], ["RECOGNIZED", "인정사유"]]} />
                </div>
                {reasonKind === "RECOGNIZED" && (
                    <p className="mt-1.5 text-xs text-gray-500">인정사유는 운영진 승인 후 공결 처리됩니다.</p>
                )}
            </div>

            <label className="block">
                <span className="text-xs font-semibold text-gray-500">사유</span>
                <textarea
                    value={reason}
                    maxLength={2000}
                    rows={4}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="빠지는 이유를 적어주세요"
                    className="mt-1 block w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900"
                />
            </label>

            <div>
                <span className="text-xs font-semibold text-gray-500">증빙자료 (선택, 사진 {MAX_FILES}장까지)</span>
                <div className="mt-1 flex flex-wrap gap-2">
                    {editing && <ExcuseAttachments excuse={{ ...editing, attachments: kept }} owner="member" onRemove={removeExisting} />}
                    {files.map((f, i) => (
                        <div key={i} className="relative w-16 h-16">
                            <img src={previews[i]} alt={f.name} className="w-full h-full rounded-lg object-cover border border-gray-200" />
                            <button type="button" aria-label="사진 빼기"
                                onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-900/80 text-white flex items-center justify-center">
                                <X className="w-3 h-3" />
                            </button>
                        </div>
                    ))}
                    {existing + files.length < MAX_FILES && (
                        <label className="w-16 h-16 rounded-lg border border-dashed border-gray-300 flex items-center justify-center text-gray-400 cursor-pointer">
                            <ImagePlus className="w-5 h-5" />
                            <input type="file" accept="image/*" multiple className="hidden"
                                onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
                        </label>
                    )}
                </div>
            </div>

            <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                className="w-full rounded-xl bg-rose-500 py-2.5 text-sm font-bold text-white disabled:bg-gray-200 disabled:text-gray-400"
            >
                {saving ? "저장 중…" : editing ? "수정하기" : "제출하기"}
            </button>
        </div>
    );
}

function statusBadge(e: Excuse) {
    if (e.reason_kind === "RECOGNIZED" && e.review) {
        const cls = e.review === "APPROVED" ? "bg-emerald-50 text-emerald-600 border-emerald-200"
            : e.review === "REJECTED" ? "bg-rose-50 text-rose-600 border-rose-200"
            : "bg-amber-50 text-amber-600 border-amber-200";
        return { label: REVIEW_LABEL[e.review], cls };
    }
    return e.session_id
        ? { label: "반영됨", cls: "bg-slate-100 text-slate-600 border-slate-200" }
        : { label: "접수됨", cls: "bg-gray-100 text-gray-500 border-gray-200" };
}

export default function MemberExcuseSection() {
    const qc = useQueryClient();
    const { data: excuses } = useMyExcuses();
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<Excuse | null>(null);

    const cancel = async (e: Excuse) => {
        if (!confirm("이 사유서를 취소할까요?")) return;
        try {
            await memberApi.delete(`/portal/excuses/${e.id}`);
            toast.success("사유서를 취소했습니다.");
            qc.invalidateQueries({ queryKey: ["member", "excuses"] });
            qc.invalidateQueries({ queryKey: ["member", "attendance"] });
        } catch (error: any) {
            toast.error(errMsg(error, "사유서 취소 실패"));
        }
    };

    const close = () => { setOpen(false); setEditing(null); };

    return (
        <section className="mb-5 space-y-2.5">
            <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-sm font-bold text-gray-900">
                    <FileText className="w-4 h-4 text-rose-500" />
                    내 사유서
                </h3>
                {!open && (
                    <button
                        type="button"
                        onClick={() => { setEditing(null); setOpen(true); }}
                        className="inline-flex items-center gap-1 rounded-full bg-rose-500 px-3 py-1.5 text-xs font-bold text-white"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        사유서 제출
                    </button>
                )}
            </div>

            {open && <ExcuseForm key={editing?.id ?? "new"} editing={editing} onDone={close} />}

            {excuses && excuses.length > 0 ? excuses.map((e) => {
                const badge = statusBadge(e);
                return (
                    <div key={e.id} className="rounded-2xl border border-gray-200 bg-white p-3.5">
                        <div className="flex items-center gap-2">
                            <p className="flex-1 min-w-0 text-sm font-semibold text-gray-900 truncate">
                                {fmtDay(e.target_date)} · {CATEGORY_LABEL[e.category]}
                                <span className="font-normal text-gray-400">
                                    {" "}· {e.excuse_type === "PRE" ? "사전" : "사후"} · {e.reason_kind === "RECOGNIZED" ? "인정사유" : "일반사유"}
                                </span>
                            </p>
                            <span className={`shrink-0 px-2.5 py-1 rounded-full border text-xs font-bold ${badge.cls}`}>
                                {badge.label}
                            </span>
                        </div>
                        <p className="mt-1.5 text-xs text-gray-500 line-clamp-2 whitespace-pre-line">{e.reason}</p>
                        {e.attachments.length > 0 && (
                            <div className="mt-2"><ExcuseAttachments excuse={e} owner="member" /></div>
                        )}
                        {e.editable && (
                            <div className="mt-2 flex gap-3 text-xs font-semibold">
                                <button type="button" className="text-gray-500"
                                    onClick={() => { setEditing(e); setOpen(true); }}>수정</button>
                                <button type="button" className="text-rose-500" onClick={() => cancel(e)}>취소</button>
                            </div>
                        )}
                    </div>
                );
            }) : !open && (
                <p className="rounded-2xl border border-dashed border-gray-200 py-6 text-center text-xs text-gray-400">
                    낸 사유서가 없어요
                </p>
            )}
        </section>
    );
}
