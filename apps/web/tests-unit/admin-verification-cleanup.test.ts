import { describe, expect, test } from 'bun:test';
import { createAdminVerificationCleanupDependencies, drainAdminVerificationCleanup, uploadStagedAdminVerificationImage, type AdminVerificationCleanupDependencies } from '../lib/reviews/admin-verification-cleanup';

const owner = '11111111-1111-4111-8111-111111111111';
const review = '22222222-2222-4222-8222-222222222222';
const path = `${owner}/1700000000000_verification_original.webp`;
const item = { path, owner_id: owner, review_id: review, purpose: 'verification' };
function fixture(items: unknown[] = [item]) {
    const calls: string[] = [];
    const deps: AdminVerificationCleanupDependencies = {
        rpc: async args => { calls.push(args.p_phase); return { error: null, data: args.p_phase === 'prepare' ? { status: 'READY', items } : { remaining: 0 } }; },
        remove: async (_, bucket) => { calls.push(bucket); },
        publicAbsent: async () => { calls.push('public-denial'); return true; },
    };
    return { deps, calls };
}

describe('durable admin verification upload transport', () => {
    const staged = `${owner}/reviews/${review}/verification/ocr-33333333-3333-4333-8333-333333333333.jpg`;
    test('never contacts Storage when staging is missing, lost, malformed or unauthorized', async () => {
        for (const reply of [{ error: 'unavailable', data: null }, { error: null, data: null },
            { error: null, data: { status: 'STAGED', extra: true } }, { error: null, data: { status: 'READY' } }]) {
            const { deps } = fixture(); let uploads = 0;
            deps.rpc = async () => reply;
            expect(await uploadStagedAdminVerificationImage(deps, review, owner, staged, async () => { uploads++; return { data: { path: staged }, error: null }; })).toBe(false);
            expect(uploads).toBe(0);
        }
        const { deps } = fixture(); deps.rpc = async () => { throw Error('lost stage ACK'); };
        let uploads = 0;
        expect(await uploadStagedAdminVerificationImage(deps, review, owner, staged, async () => { uploads++; return { data: {}, error: null }; })).toBe(false);
        expect(uploads).toBe(0);
    });
    test('a committed Storage write with a lost or malformed ACK retains its durable key', async () => {
        for (const loss of ['throw', 'error', 'wrong-path'] as const) {
            const { deps } = fixture(), queue = new Set<string>(), objects = new Set<string>(), calls: string[] = [];
            deps.rpc = async args => {
                expect(args).toEqual({ p_review_id: review, p_phase: 'stage', p_paths: [staged] });
                queue.add(staged); calls.push('stage'); return { data: { status: 'STAGED' }, error: null };
            };
            const accepted = await uploadStagedAdminVerificationImage(deps, review, owner, staged, async () => {
                expect(queue.has(staged)).toBe(true); objects.add(staged); calls.push('upload');
                if (loss === 'throw') throw Error('lost upload ACK');
                return { data: { path: loss === 'wrong-path' ? 'unrelated' : staged }, error: loss === 'error' ? 'transport' : null };
            });
            expect(accepted).toBe(false); expect(calls).toEqual(['stage', 'upload']);
            expect(queue.has(staged)).toBe(true); expect(objects.has(staged)).toBe(true);
        }
    });
    test('foreign owner, review, legacy key or food key is rejected before RPC or upload', async () => {
        for (const bad of [path, staged.replace(owner, review), staged.replace(`/reviews/${review}/`, `/reviews/${owner}/`), staged.replace('/verification/', '/food/')]) {
            const { deps, calls } = fixture(); let uploads = 0;
            expect(await uploadStagedAdminVerificationImage(deps, review, owner, bad, async () => { uploads++; return { data: { path: bad }, error: null }; })).toBe(false);
            expect(calls).toEqual([]); expect(uploads).toBe(0);
        }
    });
});

describe('server drain of retired verification objects', () => {
    test('drains both buckets and confirms public denial before exact DB finish', async () => {
        const { deps, calls } = fixture();
        const rpc = deps.rpc;
        deps.rpc = async args => {
            if (args.p_phase === 'finish') expect(args.p_paths).toEqual([path]);
            else expect(args.p_paths).toBeUndefined();
            return rpc(args);
        };
        expect(await drainAdminVerificationCleanup(deps, review, owner)).toBe(true);
        expect(calls).toEqual(['prepare', 'review-photos', 'review-verifications', 'public-denial', 'finish']);
    });
    test('unknown remove replies reconcile; public success or unknown denial keeps the durable queue pending', async () => {
        const { deps, calls } = fixture(); deps.remove = async () => { throw Error('unknown response'); };
        expect(await drainAdminVerificationCleanup(deps, review, owner)).toBe(true);
        calls.length = 0; deps.publicAbsent = async () => false;
        expect(await drainAdminVerificationCleanup(deps, review, owner)).toBe(false);
        expect(calls).toEqual(['prepare']);
    });
    test('a surviving private object or failed finish is not cleanup success', async () => {
        const { deps } = fixture();
        for (const final of [{ error: null, data: { remaining: 1 } }, { error: 'unavailable', data: null }, { error: null, data: { remaining: 0, unknown: true } }]) {
            const rpc = fixture().deps.rpc;
            deps.rpc = args => args.p_phase === 'prepare' ? rpc(args) : Promise.resolve(final);
            expect(await drainAdminVerificationCleanup(deps, review, owner)).toBe(false);
        }
    });
    test('owner, review, purpose, duplicate, grammar and capacity failures make no Storage call', async () => {
        for (const items of [[{ ...item, owner_id: review }], [{ ...item, review_id: owner }], [{ ...item, purpose: 'food' }],
            [{ ...item, path: `${owner}/../proof.webp` }], [item, item], Array(21).fill(item)]) {
            const { deps, calls } = fixture(items);
            expect(await drainAdminVerificationCleanup(deps, review, owner)).toBe(false);
            expect(calls).toEqual(['prepare']);
        }
    });
    test('unreferenced absence is idempotent and a missing migration fails before removal', async () => {
        const { deps, calls } = fixture([]);
        expect(await drainAdminVerificationCleanup(deps, review, owner)).toBe(true);
        expect(calls).toEqual(['prepare', 'finish']);
        deps.rpc = async () => ({ data: null, error: 'missing capability' }); calls.length = 0;
        expect(await drainAdminVerificationCleanup(deps, review, owner)).toBe(false);
        expect(calls).toEqual([]);
    });
    test('real public-denial adapter rejects HTTP200, auth/bucket/5xx and oversized replies', async () => {
        const original = globalThis.fetch;
        const client = { rpc: async () => ({ data: null, error: null }) };
        const storage = { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: 'https://fixture.supabase.co/storage/v1/object/public/review-photos/proof.webp' } }) }) };
        const check = createAdminVerificationCleanupDependencies(client as never, storage as never).publicAbsent;
        try {
            for (const [status, body, expected] of [
                [404, { code: 'NoSuchKey' }, true], [400, { statusCode: '404', message: 'Object not found' }, true],
                [200, { code: 'NoSuchKey' }, false], [401, { code: 'NoSuchKey' }, false], [403, { code: 'AccessDenied' }, false],
                [404, { code: 'NoSuchBucket' }, false], [500, { code: 'NoSuchKey' }, false], [503, {}, false],
                [400, { code: 'NoSuchKey' }, false], [404, { code: 'NoSuchKey', padding: 'x'.repeat(5000) }, false],
            ] as const) {
                globalThis.fetch = (async (_url, options) => {
                    expect(options?.redirect).toBe('error'); expect(options?.cache).toBe('no-store');
                    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
                }) as typeof fetch;
                expect(await check(path)).toBe(expected);
            }
        } finally { globalThis.fetch = original; }
    });
});
