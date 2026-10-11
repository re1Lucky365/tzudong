type Request = { ownerId: string; cancelInterrupted: boolean };

/** Serialize MY cleanup and retain one request for the latest signed-in owner. */
export function createLatestOwnerCleanup(deps: {
    owner(): string | undefined;
    run(ownerId: string, cancelInterrupted: boolean): Promise<boolean>;
    result(ownerId: string, pending: boolean): void;
    busy(value: boolean): void;
}) {
    let active: Promise<void> | null = null;
    let activeOwner: string | null = null;
    let queued: Request | null = null;

    const drain = async (first: Request) => {
        let next: Request | null = first;
        while (next) {
            const scan: Request = next;
            activeOwner = scan.ownerId;
            let complete = false;
            try { complete = await deps.run(scan.ownerId, scan.cancelInterrupted); } catch { /* Retain retry feedback. */ }
            if (deps.owner() === scan.ownerId) deps.result(scan.ownerId, !complete);
            const pending = queued;
            queued = null;
            const ownerId = deps.owner();
            next = pending?.ownerId === ownerId ? pending
                : ownerId && ownerId !== scan.ownerId ? { ownerId, cancelInterrupted: false } : null;
        }
    };

    return {
        request(cancelInterrupted = false): Promise<void> {
            const ownerId = deps.owner();
            if (!ownerId) { queued = null; return active ?? Promise.resolve(); }
            if (active) {
                if (activeOwner !== ownerId || cancelInterrupted) {
                    queued = { ownerId, cancelInterrupted: cancelInterrupted
                        || Boolean(queued?.ownerId === ownerId && queued.cancelInterrupted) };
                }
                return active;
            }
            activeOwner = ownerId;
            active = Promise.resolve().then(() => drain({ ownerId, cancelInterrupted })).finally(() => {
                active = null;
                activeOwner = null;
                deps.busy(false);
            });
            deps.busy(true);
            return active;
        },
    };
}
