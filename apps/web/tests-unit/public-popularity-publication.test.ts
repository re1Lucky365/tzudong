import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { GET } from '../app/api/public-popularity/route';
import { mergeRestaurants } from '../hooks/use-restaurants';
import { buildRestaurantDetailFromMergeRows } from '../hooks/use-restaurant-detail';
import {
    createPublishedPopularityLookup, parsePublicPopularityPublication,
    projectPublishedPopularityTier, publicPopularityPublication,
} from '../lib/evidence-engineering/published-popularity';
import { buildRestaurantMarkerKindSignature } from '../lib/restaurant-marker-kind';
import { buildMarkerRenderSignature, shouldSkipMarkerUpdate } from '../lib/map-render-guard';
import type { Tables } from '../integrations/supabase/types';
import type { Restaurant } from '../types/restaurant';

const snapshot = () => ({ schemaVersion: 1, publicationVersion: 'test-cohort-1',
    sourceRevision: 'a'.repeat(40), entries: [{ restaurantId: 'public-a', tier: 'fire' }] });
const dbRow = (id: string, extra = {}) => ({ id, approved_name: '검증 식당', status: 'approved',
    road_address: '공개 주소', lat: 37.5, lng: 127, categories: ['한식'],
    created_at: '2026-10-17T00:00:00Z', ...extra } as unknown as Tables<'restaurants'>);

describe('operator-published public popularity', () => {
    test('rejects private fields, duplicate IDs, invalid grades and unreviewed nonempty cohorts', () => {
        const valid = snapshot();
        const invalid = [
            { ...valid, metrics: { score: 100 } },
            { ...valid, entries: [{ ...valid.entries[0], raw_score: 100 }] },
            { ...valid, entries: [...valid.entries, ...valid.entries] },
            { ...valid, entries: [{ restaurantId: 'public-a', tier: 'private-shadow' }] },
            { ...valid, entries: [{ restaurantId: 'public-a', tier: { toString() { throw new Error('coerced'); } } }] },
            { ...valid, publicationVersion: 'unpublished' },
            { ...valid, sourceRevision: null },
        ];
        for (const value of invalid) expect(() => parsePublicPopularityPublication(value)).toThrow('PUBLIC_POPULARITY_PUBLICATION_INVALID');
    });

    test('bounds entry count and serialized bytes and freezes independent copies', () => {
        const valid = snapshot();
        const parsed = parsePublicPopularityPublication(valid);
        valid.entries[0].tier = 'rainbow';
        expect(parsed.entries[0].tier).toBe('fire');
        expect(Object.isFrozen(parsed.entries[0])).toBe(true);
        expect(Object.isFrozen(parsed.entries)).toBe(true);
        expect(() => parsePublicPopularityPublication({ ...valid,
            entries: Array.from({ length: 5001 }, (_, i) => ({ restaurantId: `r-${i}`, tier: 'fire' })),
        })).toThrow('PUBLIC_POPULARITY_PUBLICATION_INVALID');
        expect(() => parsePublicPopularityPublication({ ...valid,
            entries: Array.from({ length: 4000 }, (_, i) => ({ restaurantId: `${i}-`.padEnd(128, 'a'), tier: 'fire' })),
        })).toThrow('PUBLIC_POPULARITY_PUBLICATION_INVALID');
    });

    test('list and detail derive the same tier without a database tier column; stale/raw tiers cannot promote it', () => {
        const lookup = createPublishedPopularityLookup(snapshot());
        const rows = [dbRow('public-a'), dbRow('private-b', { approved_name: '다른 식당', road_address: '다른 주소', lng: 128, popularity_tier: 'rainbow' })];
        const before = structuredClone(rows);
        const list = mergeRestaurants(rows, lookup);
        expect(list.find((r) => r.id === 'public-a')?.popularity_tier).toBe('fire');
        expect(list.find((r) => r.id === 'private-b')?.popularity_tier).toBe('standard');
        for (const item of list) {
            const stale = { ...item, popularity_tier: 'rainbow' as const };
            expect(buildRestaurantDetailFromMergeRows(stale, rows.filter((r) => r.id === item.id), lookup)?.popularity_tier)
                .toBe(item.popularity_tier);
            expect(buildRestaurantDetailFromMergeRows(stale, [], lookup)?.popularity_tier).toBe(item.popularity_tier);
        }
        expect(rows).toEqual(before);
        expect(projectPublishedPopularityTier(list[0], lookup)).toBe(list[0]);
    });

    test('merged representatives use their published identity and do not inherit a child grade', () => {
        const lookup = createPublishedPopularityLookup(snapshot());
        const rows = [dbRow('public-a', { created_at: '2026-10-16T00:00:00Z' }), dbRow('new-primary')];
        const [merged] = mergeRestaurants(rows, lookup);
        expect(merged.mergedRestaurants).toHaveLength(2);
        expect(merged.popularity_tier).toBe(lookup(merged.id));
        expect(buildRestaurantDetailFromMergeRows(merged, rows, lookup)?.popularity_tier).toBe(lookup(merged.id));
    });

    test('published endpoint returns only the bundled reviewed shape, stable ETag and no active cohort by default', async () => {
        const response = GET();
        const body = await response.text();
        expect(response.status).toBe(200);
        expect(JSON.parse(body)).toEqual(publicPopularityPublication);
        expect(response.headers.get('etag')).toBe(`"${createHash('sha256').update(body).digest('hex')}"`);
        expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
        expect(publicPopularityPublication.entries).toEqual([]);
        expect(publicPopularityPublication.publicationVersion).toBe('unpublished');
        expect(createPublishedPopularityLookup(publicPopularityPublication)('missing')).toBe('standard');
    });
});

describe('public tier reaches the outer Naver render guard', () => {
    const signature = (tier: unknown, retained: { selected?: unknown; searched?: unknown } = {}) => buildMarkerRenderSignature({
        zoom: 14, bounds: null, displayRestaurantIds: ['public-a'], selectedRestaurantId: 'retained', searchedRestaurantId: null,
        isClusterMode: false, isRegionalClusterMode: false, isSeoulDistrictMode: false,
        markerLayerVersion: buildRestaurantMarkerKindSignature([
            { id: 'public-a', popularity_tier: tier as Restaurant['popularity_tier'] },
        ], undefined, retained),
    });
    test('same IDs/viewport/selection refreshes fire → rainbow → standard, while normalized missing values skip', () => {
        expect(shouldSkipMarkerUpdate(signature('fire'), signature('rainbow'))).toBe(false);
        expect(shouldSkipMarkerUpdate(signature('rainbow'), signature('standard'))).toBe(false);
        expect(shouldSkipMarkerUpdate(signature(null), signature(undefined))).toBe(true);
        expect(shouldSkipMarkerUpdate(signature('unknown'), signature('standard'))).toBe(true);
    });
    test('retained selection/search grades also invalidate the unchanged-query guard', () => {
        expect(shouldSkipMarkerUpdate(signature('standard', { selected: 'fire' }), signature('standard', { selected: 'rainbow' }))).toBe(false);
        expect(shouldSkipMarkerUpdate(signature('standard', { searched: 'fire' }), signature('standard', { searched: 'standard' }))).toBe(false);
    });
});
