import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { getCanonicalReviewPhotoObjectPath, getLegacyReviewPhotoObjectPath } from '@/lib/review-photo-url';

type Reply = { data: unknown; error: unknown };
type Bucket = 'review-photos' | 'review-verifications';
export type AdminVerificationCleanupDependencies = {
    rpc: (args: { p_review_id: string; p_phase: 'prepare' | 'finish'; p_paths?: string[] }) => Promise<Reply>;
    remove: (paths: string[], bucket: Bucket) => Promise<unknown>;
    publicAbsent: (path: string) => Promise<boolean>;
};

/** Only the DB queue may supply retired keys. Unknown remove replies are
 * reconciled through exact public-object denial and both-bucket DB readback.
 * A pending queue survives the response and needs no owner MY-page visit. */
export async function drainAdminVerificationCleanup(
    deps: AdminVerificationCleanupDependencies, reviewId: string, ownerId: string,
): Promise<boolean> {
    try {
        const prepared = await deps.rpc({ p_review_id: reviewId, p_phase: 'prepare' });
        if (prepared.error || !prepared.data || typeof prepared.data !== 'object') return false;
        const reply = prepared.data as Record<string, unknown>;
        if (Object.keys(reply).sort().join(',') !== 'items,status' || reply.status !== 'READY'
            || !Array.isArray(reply.items) || reply.items.length > 20) return false;
        const paths: string[] = [];
        for (const value of reply.items) {
            if (!value || typeof value !== 'object') return false;
            const item = value as Record<string, unknown>;
            if (Object.keys(item).sort().join(',') !== 'owner_id,path,purpose,review_id'
                || item.owner_id !== ownerId || item.review_id !== reviewId || item.purpose !== 'verification'
                || typeof item.path !== 'string' || paths.includes(item.path)
                || !(getCanonicalReviewPhotoObjectPath(item.path, { ownerId, reviewId, purpose: 'verification' })
                    || getLegacyReviewPhotoObjectPath(item.path, { ownerId, reviewId, purpose: 'verification' }))) return false;
            paths.push(item.path);
        }
        if (paths.length) {
            await Promise.all((['review-photos', 'review-verifications'] as const).map(async bucket => {
                try { await deps.remove(paths, bucket); } catch { /* authoritative readback below */ }
            }));
            const denied = await Promise.all(paths.map(path => deps.publicAbsent(path).catch(() => false)));
            if (denied.some(absent => !absent)) return false;
        }
        const finished = await deps.rpc({ p_review_id: reviewId, p_phase: 'finish', p_paths: paths });
        if (finished.error || !finished.data || typeof finished.data !== 'object') return false;
        const final = finished.data as Record<string, unknown>;
        return Object.keys(final).join(',') === 'remaining' && final.remaining === 0;
    } catch { return false; }
}

async function exactPublicObjectAbsent(url: string): Promise<boolean> {
    let response: Response | undefined;
    try {
        response = await fetch(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(3000) });
        if (![400, 404].includes(response.status) || !response.headers.get('content-type')?.includes('application/json')) return false;
        const reader = response.body?.getReader();
        if (!reader) return false;
        const chunks: Uint8Array[] = []; let bytes = 0;
        try {
            while (true) {
                const part = await reader.read();
                if (part.done) break;
                bytes += part.value.byteLength;
                if (bytes > 4096) return false;
                chunks.push(part.value);
            }
        } finally { await reader.cancel(); }
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object') return false;
        const error = value as Record<string, unknown>;
        return (response.status === 404 && error.code === 'NoSuchKey') || (error.code === undefined
            && String(error.statusCode) === '404' && error.message === 'Object not found');
    } catch { return false; }
    finally { if (response?.body && !response.body.locked) await response.body.cancel().catch(() => undefined); }
}

export function createAdminVerificationCleanupDependencies(
    client: SupabaseClient<Database>, storage: Pick<SupabaseClient<Database>['storage'], 'from'>,
): AdminVerificationCleanupDependencies {
    if (typeof window !== 'undefined') throw new Error('REVIEW_VERIFICATION_SERVER_ONLY');
    const rpc = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) => Promise<Reply>;
    return {
        rpc: args => rpc('admin_review_verification_cleanup', args),
        remove: (paths, bucket) => storage.from(bucket).remove(paths),
        publicAbsent: path => exactPublicObjectAbsent(storage.from('review-photos').getPublicUrl(path).data.publicUrl),
    };
}
