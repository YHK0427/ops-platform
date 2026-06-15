import { useEffect, useState } from "react";
import { Loader2, Layers } from "lucide-react";
import api, { getActiveCohort, setActiveCohort } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";

interface Cohort {
    id: number;
    number: number;
    name: string;
    is_current: boolean;
}

/**
 * 슈퍼관리자(전 기수 총괄)는 활성 기수를 선택해야 데이터에 접근할 수 있다.
 * (토큰에 cohort_id가 없어 X-Cohort-Id 헤더가 필요하기 때문)
 * 일반 운영진은 토큰 기수로 고정되므로 이 게이트를 그대로 통과한다.
 */
export function CohortGate({ children }: { children: React.ReactNode }) {
    const { user } = useAuth();
    const [cohorts, setCohorts] = useState<Cohort[] | null>(null);
    const [active, setActive] = useState<number | null>(getActiveCohort());

    const needSelect = !!user?.is_superadmin && active == null;

    useEffect(() => {
        // 일반 운영진은 잔여 활성기수 헤더가 헷갈리지 않게 정리
        if (user && !user.is_superadmin && getActiveCohort() != null) {
            setActiveCohort(null);
        }
        if (needSelect && cohorts == null) {
            api.get<Cohort[]>("/cohorts").then(({ data }) => setCohorts(data)).catch(() => setCohorts([]));
        }
    }, [user, needSelect, cohorts]);

    if (!needSelect) return <>{children}</>;

    const pick = (c: Cohort) => {
        setActiveCohort(c.id);
        setActive(c.id);
        window.location.href = "/dashboard"; // 헤더 적용된 상태로 전체 재조회
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen w-full gap-6 p-6">
            <div className="flex items-center gap-2 text-[var(--color-text-primary)]">
                <Layers className="w-6 h-6 text-[var(--color-accent)]" />
                <h1 className="text-xl font-bold">관리할 기수를 선택하세요</h1>
            </div>
            <p className="text-sm text-[var(--color-text-secondary)]">전체 관리자는 기수 공간을 골라 들어갑니다. 언제든 사이드바에서 전환할 수 있어요.</p>
            {cohorts == null ? (
                <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
                <div className="flex flex-col gap-2 w-full max-w-xs">
                    {cohorts.map((c) => (
                        <Button key={c.id} variant="outline" className="justify-between" onClick={() => pick(c)}>
                            <span>{c.name}</span>
                            {c.is_current && <span className="text-xs text-emerald-600">활성</span>}
                        </Button>
                    ))}
                    {cohorts.length === 0 && (
                        <p className="text-sm text-[var(--color-text-muted)] text-center">기수가 없습니다. DB를 확인하세요.</p>
                    )}
                </div>
            )}
        </div>
    );
}
