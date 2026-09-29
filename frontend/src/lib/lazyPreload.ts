import { createElement, lazy, type ComponentType } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = ComponentType<any>;
type Loader = () => Promise<{ default: AnyComponent }>;

/**
 * React.lazy + 미리 받기.
 *
 * React 19 는 Suspense 대체 화면이 한 번 뜨면 진짜 화면을 최소 300ms 뒤에 보여준다
 * (FALLBACK_THROTTLE_MS). 화면이 늦게 붙으면 그 화면이 쏘는 데이터 요청도 그만큼 늦게
 * 출발해서, 탭을 누를 때마다 0.3초씩 로딩이 깜빡였다.
 * preload() 로 조각을 미리 받아두면, 받은 뒤에는 lazy 를 거치지 않고 바로 그린다.
 */
export function lazyPreload(load: Loader) {
    let Loaded: AnyComponent | undefined;
    let pending: Promise<void> | undefined;
    const preload = () =>
        (pending ??= load().then(
            (m) => { Loaded = m.default; },
            (e) => { pending = undefined; throw e; },  // 실패하면 다음에 다시 시도
        ));
    const Lazy = lazy(() => preload().then(() => ({ default: Loaded as AnyComponent })));
    const Component = (props: Record<string, unknown>) => createElement(Loaded ?? Lazy, props);
    Component.preload = preload;
    return Component;
}

/** 여러 화면 조각을 한꺼번에 미리 받는다(실패는 무시 — 실제로 열 때 다시 받는다). */
export function preloadAll(components: { preload: () => Promise<void> }[]) {
    for (const c of components) c.preload().catch(() => {});
}

/** 브라우저가 한가할 때 실행 (없으면 1초 뒤). */
export function whenIdle(fn: () => void) {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 3000 });
    else window.setTimeout(fn, 1000);
}
