import { useState } from "react";
import { motion } from "framer-motion";
import { X, KeyRound } from "lucide-react";
import { toast } from "sonner";

interface Props {
    /** (현재 비밀번호, 새 비밀번호) → 성공 시 resolve, 실패 시 throw */
    onSubmit: (currentPassword: string, newPassword: string) => Promise<void>;
    onClose: () => void;
}

export default function ChangePasswordModal({ onSubmit, onClose }: Props) {
    const [current, setCurrent] = useState("");
    const [next, setNext] = useState("");
    const [confirm, setConfirm] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (next.length < 6) {
            setError("새 비밀번호는 6자 이상이어야 합니다.");
            return;
        }
        if (next !== confirm) {
            setError("새 비밀번호가 일치하지 않습니다.");
            return;
        }
        setLoading(true);
        try {
            await onSubmit(current, next);
            toast.success("비밀번호가 변경되었습니다.");
            onClose();
        } catch (err) {
            const status = (err as { response?: { status?: number } })?.response?.status;
            setError(status === 400 ? "현재 비밀번호가 올바르지 않습니다." : "변경에 실패했습니다. 다시 시도해 주세요.");
        } finally {
            setLoading(false);
        }
    };

    const inputCls =
        "w-full px-4 py-2.5 rounded-lg bg-white border border-gray-200 text-gray-900 text-sm outline-none focus:border-rose-400 focus:shadow-[0_0_0_2px_rgba(244,63,94,0.15)] transition-all";

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center">
                            <KeyRound className="w-4 h-4 text-rose-500" />
                        </div>
                        <h2 className="text-base font-bold text-gray-900">비밀번호 변경</h2>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-3">
                    <div className="space-y-1">
                        <label className="block text-xs font-medium text-gray-500">현재 비밀번호</label>
                        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" className={inputCls} />
                    </div>
                    <div className="space-y-1">
                        <label className="block text-xs font-medium text-gray-500">새 비밀번호 (6자 이상)</label>
                        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} required autoComplete="new-password" className={inputCls} />
                    </div>
                    <div className="space-y-1">
                        <label className="block text-xs font-medium text-gray-500">새 비밀번호 확인</label>
                        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" className={inputCls} />
                    </div>

                    {error && <p className="text-xs text-rose-500">{error}</p>}

                    <motion.button
                        type="submit"
                        disabled={loading}
                        whileTap={{ scale: 0.97 }}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-rose-500 text-white text-sm font-semibold hover:bg-rose-600 transition-colors disabled:opacity-50 mt-1"
                    >
                        {loading ? <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <KeyRound className="w-4 h-4" />}
                        {loading ? "변경 중..." : "변경하기"}
                    </motion.button>
                </form>
            </motion.div>
        </div>
    );
}
