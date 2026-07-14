import {
    createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";

/**
 * 설정 탭 자동 저장.
 *
 * 왜 이렇게 만들었나:
 * - 매번 저장 버튼을 누르는 걸 없애되, **타이핑 도중의 반쪽짜리 값이 저장되면 안 된다**
 *   → 각 패널이 canSave()로 "지금 저장해도 되는 상태인지"를 스스로 판단한다.
 *   (예: 기준명이 빈 칸이면 저장하지 않는다. 지웠다가 다시 치는 중일 수 있으므로)
 * - 계속 타이핑하면 디바운스가 영원히 안 터지므로, 첫 변경 후 최대 10초가 지나면 강제로 한 번 저장한다.
 * - 저장하면 쿼리가 무효화되어 서버 값이 다시 내려오는데, 그때 사용자가 계속 편집 중이면
 *   그 값으로 덮어쓰면 안 된다 → 패널은 dirty 상태에서 서버 값 리셋을 건너뛴다(useServerSync).
 */

const IDLE_MS = 1500;   // 마지막 입력 후 이만큼 조용하면 저장
const MAX_WAIT_MS = 10_000; // 계속 입력해도 이 시간이 지나면 한 번은 저장

export type PanelStatus = {
    dirty: boolean;
    saving: boolean;
    savedAt: number | null;
    error: boolean;
};

type Ctx = {
    report: (id: string, s: PanelStatus) => void;
    register: (id: string, flush: () => Promise<void>) => void;
    unregister: (id: string) => void;
};

const AutosaveCtx = createContext<Ctx | null>(null);

export function AutosaveProvider({
    children,
}: {
    children: (v: {
        statuses: Record<string, PanelStatus>;
        saveAll: () => Promise<void>;
    }) => React.ReactNode;
}) {
    const [statuses, setStatuses] = useState<Record<string, PanelStatus>>({});
    const flushers = useRef<Map<string, () => Promise<void>>>(new Map());

    const report = useCallback((id: string, s: PanelStatus) => {
        setStatuses((prev) => {
            const cur = prev[id];
            if (
                cur && cur.dirty === s.dirty && cur.saving === s.saving
                && cur.savedAt === s.savedAt && cur.error === s.error
            ) {
                return prev; // 동일 상태면 리렌더 안 함
            }
            return { ...prev, [id]: s };
        });
    }, []);

    const register = useCallback((id: string, flush: () => Promise<void>) => {
        flushers.current.set(id, flush);
    }, []);

    const unregister = useCallback((id: string) => {
        flushers.current.delete(id);
        setStatuses((prev) => {
            if (!(id in prev)) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
        });
    }, []);

    const saveAll = useCallback(async () => {
        await Promise.all([...flushers.current.values()].map((f) => f()));
    }, []);

    const ctx = useMemo(() => ({ report, register, unregister }), [report, register, unregister]);

    return (
        <AutosaveCtx.Provider value={ctx}>
            {children({ statuses, saveAll })}
        </AutosaveCtx.Provider>
    );
}

/**
 * 패널 하나의 자동 저장.
 * @returns flush — 저장 버튼이 즉시 저장할 때 호출
 */
export function useAutosave<T>(opts: {
    id: string;
    value: T;
    /** 지금 저장해도 되는 값인가 (입력 중 반쪽짜리 값 차단) */
    canSave: (v: T) => boolean;
    save: (v: T) => Promise<unknown>;
    /** 서버에서 막 내려온 값 — 이걸로 baseline을 잡는다 */
    serverValue: T;
}) {
    const { id, value, canSave, save, serverValue } = opts;
    const ctx = useContext(AutosaveCtx);

    const ser = (v: T) => JSON.stringify(v);
    // 서버에 반영된 것으로 아는 마지막 스냅샷
    const savedRef = useRef<string>(ser(serverValue));
    const valueRef = useRef(value);
    valueRef.current = value;
    const savingRef = useRef(false);

    const idleTimer = useRef<number | null>(null);
    const maxTimer = useRef<number | null>(null);

    const clearTimers = () => {
        if (idleTimer.current) { clearTimeout(idleTimer.current); idleTimer.current = null; }
        if (maxTimer.current) { clearTimeout(maxTimer.current); maxTimer.current = null; }
    };

    const flush = useCallback(async () => {
        const v = valueRef.current;
        const s = ser(v);
        if (savingRef.current) return;
        if (s === savedRef.current) return;   // 바뀐 게 없음
        if (!canSave(v)) return;              // 아직 저장하면 안 되는 상태

        clearTimers();
        savingRef.current = true;
        ctx?.report(id, { dirty: true, saving: true, savedAt: null, error: false });
        try {
            await save(v);
            savedRef.current = s;
            ctx?.report(id, { dirty: false, saving: false, savedAt: Date.now(), error: false });
        } catch {
            ctx?.report(id, { dirty: true, saving: false, savedAt: null, error: true });
        } finally {
            savingRef.current = false;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ctx, id, canSave, save]);

    // 값이 바뀌면 타이머를 건다
    useEffect(() => {
        const s = ser(value);
        if (s === savedRef.current) {
            clearTimers();
            ctx?.report(id, { dirty: false, saving: savingRef.current, savedAt: null, error: false });
            return;
        }
        ctx?.report(id, { dirty: true, saving: savingRef.current, savedAt: null, error: false });

        if (idleTimer.current) clearTimeout(idleTimer.current);
        idleTimer.current = window.setTimeout(() => void flush(), IDLE_MS);
        // 계속 타이핑해도 최대 10초 뒤엔 한 번 저장
        if (!maxTimer.current) {
            maxTimer.current = window.setTimeout(() => void flush(), MAX_WAIT_MS);
        }
        return () => {
            if (idleTimer.current) clearTimeout(idleTimer.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ser(value)]);

    // 저장 버튼용 flush 등록 + 언마운트(탭 이동) 시 미저장분 flush
    useEffect(() => {
        ctx?.register(id, flush);
        return () => {
            void flush();          // 탭을 옮겨도 놓치지 않게
            clearTimers();
            ctx?.unregister(id);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, flush]);

    /** 서버 값이 바뀌었을 때 로컬 상태를 리셋해도 되는지 (편집 중이면 덮어쓰지 않는다) */
    const isDirty = ser(valueRef.current) !== savedRef.current;
    const acceptServer = (next: T) => {
        savedRef.current = ser(next);
    };

    return { flush, isDirty, acceptServer };
}
