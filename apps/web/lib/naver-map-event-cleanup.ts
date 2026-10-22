/** Provider teardown can fail after an SDK/auth failure; local cleanup must still finish. */
export function removeNaverMapListener<T>(
    events: { removeListener: (listener: T) => unknown } | null | undefined,
    listener: T | null | undefined,
): boolean {
    if (!events || listener == null) return false;
    try {
        events.removeListener(listener);
        return true;
    } catch {
        // Teardown only: do not let an invalid provider registry abort other cleanup.
        return false;
    }
}
