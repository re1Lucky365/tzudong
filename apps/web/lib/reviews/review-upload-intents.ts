import { getCanonicalReviewPhotoObjectPath } from '@/lib/review-photo-url';

export type ReviewUploadIntent = { operationId: string; ownerId: string; reviewId: string; paths: string[] };
export interface ReviewUploadIntentStore {
    list(ownerId: string, reviewId?: string): ReviewUploadIntent[];
    save(intent: ReviewUploadIntent): void;
    forget(intent: ReviewUploadIntent): void;
}
const prefix = 'tzudong:review-upload-intent:v1:';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parse(raw: string | null): ReviewUploadIntent {
    if (!raw || raw.length > 8192) throw Error('REVIEW_UPLOAD_INTENT_INVALID');
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('REVIEW_UPLOAD_INTENT_INVALID');
    const item = value as Record<string, unknown>;
    if (Object.keys(item).sort().join(',') !== 'operationId,ownerId,paths,reviewId'
        || ![item.operationId, item.ownerId, item.reviewId].every(id => typeof id === 'string' && uuid.test(id))
        || !Array.isArray(item.paths) || !item.paths.length || item.paths.length > 10
        || new Set(item.paths).size !== item.paths.length) throw Error('REVIEW_UPLOAD_INTENT_INVALID');
    const intent = item as ReviewUploadIntent;
    if (intent.paths.some((path, index) => typeof path !== 'string'
        || !getCanonicalReviewPhotoObjectPath(path, { ownerId: intent.ownerId, reviewId: intent.reviewId, purpose: 'food' })
        || !path.endsWith(`/${intent.operationId}_${index}.${path.split('.').pop()}`)
        || !/\.(jpg|png|avif|webp)$/.test(path))) throw Error('REVIEW_UPLOAD_INTENT_INVALID');
    return intent;
}

/** Each operation has its own atomic Storage key: concurrent tabs cannot
 * overwrite a shared index. Persist only bounded reconciliation identifiers,
 * never form contents, image bytes, cookies or authentication tokens. No TTL
 * discards uncertain work. User-requested recovery owns cancellation. */
export function createReviewUploadIntentStore(getStorage: () => Storage): ReviewUploadIntentStore {
    function key(intent: ReviewUploadIntent) { return `${prefix}${intent.ownerId}:${intent.operationId}`; }
    function list(ownerId: string, reviewId?: string) {
        if (!uuid.test(ownerId) || (reviewId !== undefined && !uuid.test(reviewId))) throw Error('REVIEW_UPLOAD_INTENT_INVALID');
        const storage = getStorage();
        const keys: string[] = [];
        for (let i = 0; i < storage.length; i++) {
            const name = storage.key(i);
            if (name?.startsWith(`${prefix}${ownerId}:`)) keys.push(name);
        }
        const items: ReviewUploadIntent[] = [];
        for (const name of keys.sort()) {
            const intent = parse(storage.getItem(name));
            if (key(intent) !== name || intent.ownerId !== ownerId) throw Error('REVIEW_UPLOAD_INTENT_INVALID');
            if (reviewId === undefined || intent.reviewId === reviewId) items.push(intent);
            if (items.length === 20) break;
        }
        return items;
    }
    return {
        list,
        save(intent) {
            const raw = JSON.stringify(intent);
            parse(raw);
            const storage = getStorage(), name = key(intent), existing = storage.getItem(name);
            if (existing !== null && existing !== raw) throw Error('REVIEW_UPLOAD_INTENT_CONFLICT');
            if (existing === null && list(intent.ownerId).length >= 20) throw Error('REVIEW_UPLOAD_INTENT_LIMIT');
            storage.setItem(name, raw);
            if (storage.getItem(name) !== raw) throw Error('REVIEW_UPLOAD_INTENT_UNCONFIRMED');
        },
        forget(intent) {
            const storage = getStorage(), name = key(intent), existing = storage.getItem(name);
            if (existing === null) return;
            if (JSON.stringify(parse(existing)) !== JSON.stringify(intent)) throw Error('REVIEW_UPLOAD_INTENT_CONFLICT');
            storage.removeItem(name);
            if (storage.getItem(name) !== null) throw Error('REVIEW_UPLOAD_INTENT_UNCONFIRMED');
        },
    };
}
