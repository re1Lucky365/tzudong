import publication from './public-popularity-publication.json';
import type { Restaurant } from '@/types/restaurant';

export type PublishedPopularityTier = 'fire' | 'rainbow' | 'standard';
export type PublishedPopularityLookup = (restaurantId: string) => PublishedPopularityTier;
export interface PublicPopularityPublication {
    readonly schemaVersion: 1;
    readonly publicationVersion: string;
    readonly sourceRevision: string | null;
    readonly entries: readonly Readonly<{ restaurantId: string; tier: PublishedPopularityTier }>[];
}

const MAX_PUBLICATIONS = 5000;
const MAX_PUBLICATION_BYTES = 512 * 1024;
const fail = (): never => { throw new Error('PUBLIC_POPULARITY_PUBLICATION_INVALID'); };

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const actual = Object.keys(value);
    return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

// Shape validation is not an operator approval receipt. The source is deliberately
// empty until an operator-reviewed cohort is published through protected Git.
// Never populate it automatically from the private metrics or shadow tables.
export function parsePublicPopularityPublication(value: unknown): PublicPopularityPublication {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
    const data = value as Record<string, unknown>;
    if (!exactKeys(data, ['schemaVersion', 'publicationVersion', 'sourceRevision', 'entries'])
        || data.schemaVersion !== 1
        || typeof data.publicationVersion !== 'string'
        || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(data.publicationVersion)
        || (data.sourceRevision !== null && (typeof data.sourceRevision !== 'string' || !/^[a-f0-9]{40}$/.test(data.sourceRevision)))
        || !Array.isArray(data.entries) || data.entries.length > MAX_PUBLICATIONS) return fail();
    if (data.entries.length > 0 && (data.publicationVersion === 'unpublished' || data.sourceRevision === null)) return fail();
    const seen = new Set<string>();
    const entries = data.entries.map((entry: unknown) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return fail();
        const row = entry as Record<string, unknown>;
        if (!exactKeys(row, ['restaurantId', 'tier'])
            || typeof row.restaurantId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(row.restaurantId)
            || typeof row.tier !== 'string' || !['fire', 'rainbow', 'standard'].includes(row.tier)
            || seen.has(row.restaurantId)) return fail();
        seen.add(row.restaurantId);
        return Object.freeze({ restaurantId: row.restaurantId, tier: row.tier as PublishedPopularityTier });
    });
    const result = { schemaVersion: 1 as const, publicationVersion: data.publicationVersion,
        sourceRevision: data.sourceRevision as string | null, entries: Object.freeze(entries) };
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_PUBLICATION_BYTES) return fail();
    return Object.freeze(result);
}

function lookupFor(publication: PublicPopularityPublication): PublishedPopularityLookup {
    const tiers = new Map(publication.entries.map((entry) => [entry.restaurantId, entry.tier]));
    return (restaurantId) => tiers.get(restaurantId) ?? 'standard';
}

export function createPublishedPopularityLookup(value: unknown): PublishedPopularityLookup {
    return lookupFor(parsePublicPopularityPublication(value));
}

export const publicPopularityPublication = parsePublicPopularityPublication(publication);
export const lookupPublishedPopularityTier = lookupFor(publicPopularityPublication);

export function projectPublishedPopularityTier(
    restaurant: Restaurant,
    lookup: PublishedPopularityLookup = lookupPublishedPopularityTier,
): Restaurant {
    const tier = lookup(restaurant.id);
    return restaurant.popularity_tier === tier ? restaurant : { ...restaurant, popularity_tier: tier };
}
