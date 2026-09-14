import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMemberAuth, type CohortChoice } from "@/context/MemberAuthContext";
import { motion } from "framer-motion";
import { LogIn, ArrowLeft } from "lucide-react";

export default function MemberLoginPage() {
    const { login } = useMemberAuth();
    const navigate = useNavigate();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [cohortChoices, setCohortChoices] = useState<CohortChoice[] | null>(null);

    const doLogin = async (cohortId?: number) => {
        setError(null);
        setLoading(true);
        try {
            const choices = await login(username, password, true, cohortId);
            if (choices) {
                // 같은 아이디가 여러 기수에 있음 — 어느 기수인지 고르면 바로 로그인.
                setCohortChoices(choices);
                return;
            }
            navigate("/member", { replace: true });
        } catch {
            setError("이름 또는 비밀번호가 올바르지 않습니다.");
        } finally {
            setLoading(false);
        }
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        await doLogin();
    };

    return (
        <div className="member-page flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="w-full max-w-sm"
            >
                <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
                    <div className="mb-8 text-center">
                        <p className="text-[11px] font-bold tracking-widest text-gray-400 uppercase mb-1">
                            UnivPT
                        </p>
                        <h1 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-gray-900 via-gray-900 to-gray-400">
                            발표 성장 리포트
                        </h1>
                    </div>

                    {cohortChoices ? (
                        /* 같은 아이디가 여러 기수에 있음 — 고르면 바로 로그인(추가 확인 버튼 없음) */
                        <div className="space-y-3">
                            <p className="text-sm text-gray-600 text-center">
                                같은 아이디가 여러 기수에 있어요.<br />어느 기수인가요?
                            </p>
                            <div className="space-y-2">
                                {cohortChoices.map((c) => (
                                    <button
                                        key={c.id}
                                        type="button"
                                        disabled={loading}
                                        onClick={() => doLogin(c.id)}
                                        className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 text-sm font-semibold hover:border-rose-400 hover:bg-rose-50 transition-all disabled:opacity-50"
                                    >
                                        {c.name}
                                    </button>
                                ))}
                            </div>
                            {error && (
                                <p className="text-xs text-rose-500 text-center">{error}</p>
                            )}
                            <button
                                type="button"
                                onClick={() => { setCohortChoices(null); setError(null); }}
                                className="w-full flex items-center justify-center gap-2 text-xs text-gray-400 hover:text-gray-600 transition-colors py-2"
                            >
                                <ArrowLeft className="w-3 h-3" />
                                돌아가기
                            </button>
                        </div>
                    ) : (
                    <form onSubmit={handleLogin} className="space-y-4">
                        <div className="space-y-1">
                            <label className="block text-xs font-medium text-gray-500">
                                이름
                            </label>
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                required
                                autoComplete="username"
                                placeholder="이름"
                                className="w-full px-4 py-2.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-300 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-500/10 transition-all"
                            />
                        </div>

                        <div className="space-y-1">
                            <label className="block text-xs font-medium text-gray-500">
                                비밀번호
                            </label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                autoComplete="current-password"
                                className="w-full px-4 py-2.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-500/10 transition-all"
                            />
                        </div>

                        {error && (
                            <p className="text-xs text-rose-500 text-center">{error}</p>
                        )}

                        <motion.button
                            type="submit"
                            disabled={loading}
                            whileTap={{ scale: 0.97 }}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-rose-500 to-rose-600 text-white text-sm font-bold hover:from-rose-600 hover:to-rose-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-rose-500/20"
                        >
                            {loading ? (
                                <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <LogIn className="w-4 h-4" />
                            )}
                            {loading ? "로그인 중..." : "로그인"}
                        </motion.button>
                    </form>
                    )}
                </div>
            </motion.div>
        </div>
    );
}
