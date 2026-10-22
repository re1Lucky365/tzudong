import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createPublishedPopularityLookup, projectPublishedPopularityTier } from '../lib/evidence-engineering/published-popularity';
import { buildRestaurantsForSwipe } from '../lib/mobile-home-search-selection';
import { getNaverIndividualMarkerVisual } from '../lib/naver-map-marker-visuals';
import { buildRestaurantMarkerKindSignature, isUserSubmittedRestaurant } from '../lib/restaurant-marker-kind';
import type { Restaurant } from '../types/restaurant';

// Execute the actual component's retained-row -> signature/swipe bindings.
// This also runs against the old source; it is not a component mount or SDK test.
const source = readFileSync(new URL('../components/map/NaverMapView.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('map.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const names = new Set(['publishedSelectedRestaurant', 'publishedSearchedRestaurant',
    'markerKindSignature', 'markerVisibleActiveSearchedRestaurant', 'markerVisibleSelectedRestaurant', 'restaurantsForSwipe']);
const declarations: string[] = [];
function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.has(node.name.text)) {
        declarations.push(`const ${node.getText(file)};`);
    }
    ts.forEachChild(node, visit);
}
visit(file);
const compiled = ts.transpileModule(`${declarations.join('\n')}
exports.result = { markerKindSignature, restaurantsForSwipe };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function run(selected: Restaurant | null, searched: Restaurant | null, tier: 'fire' | 'rainbow', showUserSubmittedMarkers = false) {
    const lookup = createPublishedPopularityLookup({ schemaVersion: 2, publicationVersion: 'test-retained',
        sourceRevision: 'a'.repeat(40), entries: [{ restaurantId: 'approved-a', memberRestaurantIds: ['approved-a'], tier }] });
    const exports = {} as { result: { markerKindSignature: string; restaurantsForSwipe: Restaurant[] } };
    vm.runInNewContext(compiled, { exports, selectedRestaurant: selected, activeSearchedRestaurant: searched,
        displayRestaurants: [], displayRestaurantIds: new Set(), showUserSubmittedMarkers,
        useMemo: (factory: () => unknown) => factory(), buildRestaurantsForSwipe, isUserSubmittedRestaurant,
        buildRestaurantMarkerKindSignature,
        projectPublishedPopularityTier: (r: Restaurant) => projectPublishedPopularityTier(r, lookup),
    });
    return exports.result;
}
const row = (id = 'approved-a', extra = {}) => ({ id, name: '공개 식당', lat: 37.5, lng: 127,
    categories: ['한식'], ...extra } as Restaurant);

describe('retained Naver rows use the same publication for invalidation and visual rendering', () => {
    test('history-restored search and raw selection outside the result keep the published tier without mutation', () => {
        for (const selected of [false, true]) {
            const raw = Object.freeze(row());
            const fire = run(selected ? raw : null, selected ? null : raw, 'fire');
            const rainbow = run(selected ? raw : null, selected ? null : raw, 'rainbow');
            expect(fire.restaurantsForSwipe).toHaveLength(1);
            expect(fire.restaurantsForSwipe[0].popularity_tier).toBe('fire');
            expect(rainbow.restaurantsForSwipe[0].popularity_tier).toBe('rainbow');
            expect(fire.markerKindSignature).not.toBe(rainbow.markerKindSignature);
            expect(getNaverIndividualMarkerVisual(fire.restaurantsForSwipe[0], selected).content)
                .toContain('<div class="tz-popularity-marker" data-popularity-tier="fire">');
            expect(raw.popularity_tier).toBeUndefined();
            expect(fire.restaurantsForSwipe[0].lat).toBe(raw.lat);
            expect(fire.restaurantsForSwipe[0].name).toBe(raw.name);
        }
    });
    test('unpublished raw and newly merged members cannot promote a retained marker', () => {
        for (const raw of [row('unpublished', { popularity_tier: 'rainbow' }),
            row('approved-a', { popularity_tier: 'rainbow', mergedRestaurants: [row('new-member')] })]) {
            const result = run(raw, raw, 'fire');
            expect(result.restaurantsForSwipe).toHaveLength(1);
            expect(result.restaurantsForSwipe[0].popularity_tier).toBe('standard');
            expect(getNaverIndividualMarkerVisual(result.restaurantsForSwipe[0], true).content)
                .toContain('<div class="tz-popularity-marker" data-popularity-tier="standard">');
            expect(raw.popularity_tier).toBe('rainbow');
        }
    });
    test('existing user-submission visibility and duplicate selection semantics remain intact', () => {
        const raw = row('approved-a', { source_type: 'user_submission_new' });
        expect(run(raw, raw, 'fire').restaurantsForSwipe).toEqual([]);
        expect(run(raw, raw, 'fire', true).restaurantsForSwipe).toHaveLength(1);
        expect(run(null, null, 'fire').restaurantsForSwipe).toEqual([]);
    });
});
