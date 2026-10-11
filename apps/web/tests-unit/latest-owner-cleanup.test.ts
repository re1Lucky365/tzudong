import { describe, expect, test } from 'bun:test';
import { createLatestOwnerCleanup } from '../lib/reviews/latest-owner-cleanup';

function deferred() {
    let finish!: (value: boolean) => void;
    const promise = new Promise<boolean>(resolve => { finish = resolve; });
    return { promise, finish };
}

describe('latest-owner cleanup serialization', () => {
    test('scans B after A completes and never publishes A feedback to B', async () => {
        let owner: string | undefined = 'A';
        const a = deferred(), b = deferred(), calls: string[] = [], results: unknown[] = [], busy: boolean[] = [];
        const queue = createLatestOwnerCleanup({ owner: () => owner,
            run: id => { calls.push(id); return id === 'A' ? a.promise : b.promise; },
            result: (id, pending) => results.push([id, pending]), busy: value => busy.push(value) });
        const task = queue.request(); await Promise.resolve();
        owner = 'B'; const queued = queue.request();
        expect(calls).toEqual(['A']); a.finish(true); await Promise.resolve(); await Promise.resolve();
        expect(calls).toEqual(['A', 'B']); expect(results).toEqual([]);
        b.finish(false); await Promise.all([task, queued]);
        expect(results).toEqual([['B', true]]); expect(busy).toEqual([true, false]);
    });
    test('coalesces rapid A/B/C transitions to the latest owner without overlap', async () => {
        let owner: string | undefined = 'A';
        const gate = deferred(), calls: string[] = [], results: unknown[] = [];
        let active = 0, maxActive = 0;
        const queue = createLatestOwnerCleanup({ owner: () => owner, busy: () => undefined,
            run: async id => { calls.push(id); maxActive = Math.max(maxActive, ++active);
                const complete = id === 'A' ? await gate.promise : false; active--; return complete; },
            result: (id, pending) => results.push([id, pending]) });
        const task = queue.request(); await Promise.resolve(); owner = 'B'; void queue.request();
        owner = 'C'; void queue.request(); gate.finish(true); await task;
        expect(calls).toEqual(['A', 'C']); expect(maxActive).toBe(1); expect(results).toEqual([['C', true]]);
    });
    test('does not carry an explicit cancellation across owners', async () => {
        let owner: string | undefined = 'A'; const gate = deferred(), calls: unknown[] = [];
        const queue = createLatestOwnerCleanup({ owner: () => owner, busy: () => undefined, result: () => undefined,
            run: (id, cancel) => { calls.push([id, cancel]); return id === 'A' ? gate.promise : Promise.resolve(true); } });
        const task = queue.request(); await Promise.resolve(); void queue.request(true);
        owner = 'B'; void queue.request(false); gate.finish(true); await task;
        expect(calls).toEqual([['A', false], ['B', false]]);
    });
    test('coalesces duplicate automatic scans but retains same-owner explicit retry', async () => {
        const gate = deferred(), calls: boolean[] = [];
        const queue = createLatestOwnerCleanup({ owner: () => 'A', busy: () => undefined, result: () => undefined,
            run: (_id, cancel) => { calls.push(cancel); return calls.length === 1 ? gate.promise : Promise.resolve(true); } });
        const task = queue.request(); await Promise.resolve(); void queue.request(); void queue.request(true); void queue.request();
        gate.finish(true); await task; expect(calls).toEqual([false, true]);
    });
    test('sign-out drops queued work and failed scans retain bounded retry feedback', async () => {
        let owner: string | undefined = 'A'; const gate = deferred(), calls: string[] = [], results: unknown[] = [];
        const queue = createLatestOwnerCleanup({ owner: () => owner, busy: () => undefined,
            run: async id => { calls.push(id); if (id === 'A') return gate.promise; throw new Error('fixture transport failure'); },
            result: (id, pending) => results.push([id, pending]) });
        const task = queue.request(); await Promise.resolve(); owner = 'B'; void queue.request();
        owner = undefined; void queue.request(); gate.finish(true); await task;
        expect(calls).toEqual(['A']); expect(results).toEqual([]);
        owner = 'B'; await queue.request(); expect(results).toEqual([['B', true]]);
    });
});
