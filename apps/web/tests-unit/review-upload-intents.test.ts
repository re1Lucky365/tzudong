import { describe, expect, test } from 'bun:test';
import { createReviewUploadIntentStore } from '@/lib/reviews/review-upload-intents';
import { reviewIntentStorage } from './helpers/review-intent-storage';

const ownerId = '11111111-1111-4111-8111-111111111111', reviewId = '33333333-3333-4333-8333-333333333333';
const operationId = '55555555-5555-4555-8555-555555555555';
const intent = { ownerId, reviewId, operationId, paths: [`${ownerId}/reviews/${reviewId}/food/${operationId}_0.webp`] };
describe('bounded review-upload reconciliation intent', () => {
    test('reload restores identifiers without form text or media bytes', () => {
        const storage = reviewIntentStorage();
        createReviewUploadIntentStore(() => storage).save(intent);
        const restored = createReviewUploadIntentStore(() => storage);
        expect(restored.list(ownerId, reviewId)).toEqual([intent]);
        expect(Object.keys(JSON.parse(storage.getItem(storage.key(0)!)!)).sort()).toEqual(['operationId', 'ownerId', 'paths', 'reviewId']);
        expect(restored.list('22222222-2222-4222-8222-222222222222')).toEqual([]);
    });
    test('concurrent operation keys preserve both intents without replacing an index', () => {
        const storage = reviewIntentStorage(), first = createReviewUploadIntentStore(() => storage), second = createReviewUploadIntentStore(() => storage);
        first.save(intent);
        const next = { ...intent, operationId: '66666666-6666-4666-8666-666666666666', paths: [intent.paths[0].replace(operationId, '66666666-6666-4666-8666-666666666666')] };
        second.save(next);
        expect(first.list(ownerId)).toHaveLength(2);
        first.forget(intent);
        expect(second.list(ownerId)).toEqual([next]);
    });
    test('foreign owners, operation filenames and unbounded media cannot be staged', () => {
        const storage = reviewIntentStorage(), store = createReviewUploadIntentStore(() => storage);
        for (const value of [{ ...intent, content: 'private draft' }, { ...intent, paths: [intent.paths[0].replace(ownerId, reviewId)] },
            { ...intent, paths: [intent.paths[0].replace(operationId, reviewId)] }, { ...intent, paths: Array(11).fill(intent.paths[0]) }]) {
            expect(() => store.save(value)).toThrow();
        }
        expect(storage.length).toBe(0);
    });
    test('storage failure and lost persistence acknowledgement are visible before upload', () => {
        const storage = reviewIntentStorage(); storage.setItem = () => { throw Error('quota'); };
        expect(() => createReviewUploadIntentStore(() => storage).save(intent)).toThrow();
        storage.setItem = () => undefined;
        expect(() => createReviewUploadIntentStore(() => storage).save(intent)).toThrow('UNCONFIRMED');
    });
    test('the twentieth intent prevents further upload rather than discarding old work', () => {
        const storage = reviewIntentStorage(), store = createReviewUploadIntentStore(() => storage);
        for (let i = 0; i < 20; i++) {
            const id = `55555555-5555-4555-8555-${String(i).padStart(12, '0')}`;
            store.save({ ...intent, operationId: id, paths: [intent.paths[0].replace(operationId, id)] });
        }
        expect(() => store.save(intent)).toThrow('LIMIT');
        expect(store.list(ownerId)).toHaveLength(20);
    });
});
