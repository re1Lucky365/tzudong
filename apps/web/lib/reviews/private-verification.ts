import type { SupabaseClient } from '@supabase/supabase-js';
import { StorageApiError } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

export const REVIEW_VERIFICATION_BUCKET = 'review-verifications';
export const LEGACY_REVIEW_VERIFICATION_BUCKET = 'review-photos';
export type ReviewVerificationBucket = typeof REVIEW_VERIFICATION_BUCKET | typeof LEGACY_REVIEW_VERIFICATION_BUCKET;
type ReviewVerificationDownload = Awaited<ReturnType<ReturnType<SupabaseClient<Database>['storage']['from']>['download']>>
    & { bucket: ReviewVerificationBucket };

/** Server-side transition support for pre-migration verification keys. The
 * caller must authorize the review and validate its authoritative object key.
 * New verification uploads always target the private bucket. */
export async function downloadReviewVerification(storage: SupabaseClient<Database>['storage'], path: string): Promise<ReviewVerificationDownload> {
    if (typeof window !== 'undefined') throw new Error('REVIEW_VERIFICATION_SERVER_ONLY');
    const privateReply = await storage.from(REVIEW_VERIFICATION_BUCKET).download(path);
    const error = privateReply.error;
    const missingObject = error instanceof StorageApiError
        && (error.status === 404 || (error.status === 400 && error.statusCode === '404'))
        && (error.code === 'NoSuchKey'
            || (error.code === undefined && error.statusCode === '404' && error.message === 'Object not found'));
    if (!missingObject) return { ...privateReply, bucket: REVIEW_VERIFICATION_BUCKET };
    const publicReply = await storage.from(LEGACY_REVIEW_VERIFICATION_BUCKET).download(path);
    return { ...publicReply, bucket: LEGACY_REVIEW_VERIFICATION_BUCKET };
}
