/**
 * Module-level store for background task IDs.
 * Persists across tab navigation within the SPA (lost on page refresh — acceptable).
 */

const store = new Map<string, string>();

function key(sessionId: number, type: string) {
    return `session-${sessionId}-${type}`;
}

export function getTaskId(sessionId: number, type: string): string | null {
    return store.get(key(sessionId, type)) ?? null;
}

export function setTaskId(sessionId: number, type: string, taskId: string): void {
    store.set(key(sessionId, type), taskId);
}

export function clearTaskId(sessionId: number, type: string): void {
    store.delete(key(sessionId, type));
}
