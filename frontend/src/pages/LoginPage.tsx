import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { useAuth } from "@/context/AuthContext";
import { setMemberToken } from "@/lib/memberApi";
import { motion } from "framer-motion";
import { LogIn, ArrowLeft, Shield } from "lucide-react";

export default function LoginPage() {
    const { login, verifyTotp, totpPending, cancelTotp } = useAuth();
    const navigate = useNavigate();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [totpCode, setTotpCode] = useState("");
    const [remember, setRemember] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            // 1) 기수(member) 로그인 먼저 시도 — 인터셉터 우회 위해 raw axios
            try {
                const { data } = await axios.post<{ access_token: string }>(
                    "/api/v1/auth/member-login",
                    { username, password },
                );
                setMemberToken(data.access_token);
                // 전체 네비게이션 → MemberAuthProvider가 토큰을 읽어 마운트
                window.location.href = "/member";
                return;
            } catch {
                // 기수 계정이 아니거나 비번 불일치 → 운영진 로그인 시도
            }

            // 2) 운영진(ops) 로그인 (TOTP 흐름 그대로 재사용)
            const needsTotp = await login(username, password, remember);
            if (!needsTotp) {
                navigate("/dashboard", { replace: true });
            }
            // needsTotp이면 AuthContext가 totpPending 설정 → TOTP 단계로 전환
        } catch {
            setError("아이디 또는 비밀번호가 올바르지 않습니다.");
        } finally {
            setLoading(false);
        }
    };

    const handleTotp = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            await verifyTotp(totpCode);
            navigate("/dashboard", { replace: true });
        } catch {
            setError("OTP 코드가 올바르지 않습니다.");
        } finally {
            setLoading(false);
        }
    };

    const handleCancelTotp = () => {
        cancelTotp();
        setTotpCode("");
        setError(null);
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="w-full max-w-sm"
            >
                <div className="relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white backdrop-blur-md p-8">
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-24 bg-[var(--color-accent)]/10 blur-3xl pointer-events-none rounded-full" />

                    <div className="relative">
                        <div className="mb-8 text-center">
                            <p className="text-xs font-bold tracking-widest text-[var(--color-text-muted)] uppercase mb-1">
                                UnivPT
                            </p>
                            <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">
                                로그인
                            </h1>
                        </div>

                        {totpPending ? (
                            /* TOTP Step */
                            <form onSubmit={handleTotp} className="space-y-4">
                                <div className="flex items-center justify-center gap-2 py-2">
                                    <Shield className="w-5 h-5 text-[var(--color-accent)]" />
                                    <span className="text-sm text-[var(--color-text-secondary)]">2단계 인증</span>
                                </div>

                                <div className="space-y-1">
                                    <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
                                        OTP 코드
                                    </label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={totpCode}
                                        onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                                        required
                                        autoFocus
                                        maxLength={6}
                                        placeholder="000000"
                                        className="w-full px-4 py-2.5 rounded-lg bg-white border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] text-center text-lg font-mono tracking-[0.3em] outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_2px_rgba(244,63,94,0.15)] transition-all"
                                    />
                                </div>

                                {error && (
                                    <p className="text-xs text-rose-500 text-center">{error}</p>
                                )}

                                <motion.button
                                    type="submit"
                                    disabled={loading || totpCode.length !== 6}
                                    whileTap={{ scale: 0.97 }}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--color-accent)] text-white text-sm font-semibold hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(244,63,94,0.2)]"
                                >
                                    {loading ? (
                                        <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    ) : (
                                        <Shield className="w-4 h-4" />
                                    )}
                                    {loading ? "확인 중..." : "확인"}
                                </motion.button>

                                <button
                                    type="button"
                                    onClick={handleCancelTotp}
                                    className="w-full flex items-center justify-center gap-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors py-2"
                                >
                                    <ArrowLeft className="w-3 h-3" />
                                    돌아가기
                                </button>
                            </form>
                        ) : (
                            /* Login Step */
                            <form onSubmit={handleLogin} className="space-y-4">
                                <div className="space-y-1">
                                    <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
                                        아이디
                                    </label>
                                    <input
                                        type="text"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        required
                                        autoComplete="username"
                                        placeholder="아이디"
                                        className="w-full px-4 py-2.5 rounded-lg bg-white border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] text-sm outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_2px_rgba(244,63,94,0.15)] transition-all"
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
                                        className="w-full px-4 py-2.5 rounded-lg bg-white border border-[var(--color-border)] text-[var(--color-text-primary)] text-sm outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_2px_rgba(244,63,94,0.15)] transition-all"
                                    />
                                </div>

                                <label className="flex items-center justify-between cursor-pointer select-none group">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)] transition-colors">
                                            로그인 유지
                                        </span>
                                        <span className="text-[10px] text-[var(--color-text-muted)]">
                                            {remember ? "로그아웃 전까지 계속 유지" : "브라우저 종료 시 로그아웃"}
                                        </span>
                                    </div>
                                    <div className="relative">
                                        <input
                                            type="checkbox"
                                            checked={remember}
                                            onChange={(e) => setRemember(e.target.checked)}
                                            className="sr-only peer"
                                        />
                                        <div className="w-9 h-5 rounded-full bg-gray-200 border border-[var(--color-border)] peer-checked:bg-[var(--color-accent)]/30 peer-checked:border-[var(--color-accent)]/50 transition-all" />
                                        <div className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-gray-400 peer-checked:bg-[var(--color-accent)] peer-checked:translate-x-4 transition-all shadow-sm" />
                                    </div>
                                </label>

                                {error && (
                                    <p className="text-xs text-rose-500 text-center">{error}</p>
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
                        )}
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
