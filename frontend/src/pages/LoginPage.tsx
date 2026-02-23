import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { motion } from "framer-motion";
import { LogIn } from "lucide-react";

export default function LoginPage() {
    const { login } = useAuth();
    const navigate = useNavigate();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            await login(email, password);
            navigate("/dashboard", { replace: true });
        } catch {
            setError("이메일 또는 비밀번호가 올바르지 않습니다.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="w-full max-w-sm"
            >
                {/* Card */}
                <div className="relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-zinc-900/50 backdrop-blur-md p-8">
                    {/* Ambient glow */}
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-24 bg-[var(--color-accent)]/10 blur-3xl pointer-events-none rounded-full" />

                    <div className="relative">
                        {/* Logo */}
                        <div className="mb-8 text-center">
                            <p className="text-xs font-bold tracking-widest text-[var(--color-text-muted)] uppercase mb-1">
                                UnivPT
                            </p>
                            <h1 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white via-white to-white/60">
                                Ops Platform
                            </h1>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-1">
                                <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
                                    아이디
                                </label>
                                <input
                                    type="text"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    autoComplete="username"
                                    placeholder="admin"
                                    className="w-full px-4 py-2.5 rounded-lg bg-black/40 border border-[var(--color-border)] text-white placeholder:text-[var(--color-text-muted)] text-sm outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_2px_rgba(244,63,94,0.15)] transition-all"
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
                                    비밀번호
                                </label>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    autoComplete="current-password"
                                    className="w-full px-4 py-2.5 rounded-lg bg-black/40 border border-[var(--color-border)] text-white text-sm outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_2px_rgba(244,63,94,0.15)] transition-all"
                                />
                            </div>

                            {error && (
                                <p className="text-xs text-rose-400 text-center">{error}</p>
                            )}

                            <motion.button
                                type="submit"
                                disabled={loading}
                                whileTap={{ scale: 0.97 }}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--color-accent)] text-white text-sm font-semibold hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(244,63,94,0.2)]"
                            >
                                {loading ? (
                                    <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                ) : (
                                    <LogIn className="w-4 h-4" />
                                )}
                                {loading ? "로그인 중..." : "로그인"}
                            </motion.button>
                        </form>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
