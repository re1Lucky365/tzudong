import type { Restaurant } from '@/types/restaurant';
import { publicPopularityTier } from '@/lib/evidence-engineering/popularity-marker';

export const USER_SUBMITTED_RESTAURANT_SOURCE_TYPE = 'user_submission_new';
export const RESTAURANT_MARKER_ASSET_VERSION = 'restaurant-marker-assets-gpt-image-2-20260707';

export type RestaurantMarkerKind = 'category' | 'user-submitted' | 'trend' | 'seasonal';
export type RestaurantOverlayMarkerKind = Extract<RestaurantMarkerKind, 'trend' | 'seasonal'>;

type MarkerKindRestaurant = Partial<Pick<Restaurant, 'id' | 'source_type' | 'mergedRestaurants'>>;
type MarkerKindSignatureRestaurant = MarkerKindRestaurant & { id: string; popularity_tier?: Restaurant['popularity_tier'] };

export function isUserSubmittedRestaurant(restaurant: MarkerKindRestaurant | null | undefined): boolean {
    if (!restaurant) return false;

    if (restaurant.source_type === USER_SUBMITTED_RESTAURANT_SOURCE_TYPE) return true;

    return restaurant.mergedRestaurants?.some(
        (mergedRestaurant) => mergedRestaurant.source_type === USER_SUBMITTED_RESTAURANT_SOURCE_TYPE,
    ) ?? false;
}

export function resolveRestaurantMarkerKind(
    restaurant: MarkerKindRestaurant | null | undefined,
    overlayKinds: readonly RestaurantOverlayMarkerKind[] = [],
): RestaurantMarkerKind {
    if (overlayKinds.includes('trend')) return 'trend';
    if (overlayKinds.includes('seasonal')) return 'seasonal';
    return isUserSubmittedRestaurant(restaurant) ? 'user-submitted' : 'category';
}

export function buildRestaurantMarkerKindSignature(
    restaurants: readonly MarkerKindSignatureRestaurant[],
    overlayKindByRestaurantId: ReadonlyMap<string, readonly RestaurantOverlayMarkerKind[]> = new Map(),
    retainedTiers?: { selected?: unknown; searched?: unknown },
): string {
    const signature = restaurants
        .map((restaurant) => [
            restaurant.id,
            resolveRestaurantMarkerKind(restaurant, overlayKindByRestaurantId.get(restaurant.id) ?? []),
            restaurant.source_type ?? 'source:null',
            publicPopularityTier(restaurant.popularity_tier),
        ].join(':'))
        .sort()
        .join('|');
    // Selection/search markers can be retained outside the current query result.
    return retainedTiers
        ? `${signature}|selected-tier:${publicPopularityTier(retainedTiers.selected)}|searched-tier:${publicPopularityTier(retainedTiers.searched)}`
        : signature;
}
