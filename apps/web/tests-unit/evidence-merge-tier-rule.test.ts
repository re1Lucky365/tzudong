import { describe, expect, test } from "bun:test";

import { EvidenceContractError } from "../lib/evidence-engineering/errors";
import { mergePopularityTierRecords } from "../lib/evidence-engineering/records";
import { collectRestaurantMergedMedia } from "../lib/restaurant-merged-media";
import type { Restaurant } from "../types/restaurant";

const cohort = {
  scoring_version: "score-v1",
  cohort_version: "cohort-a",
  computed_at: "2026-10-17T04:00:00.000Z",
  popularity_score: 1,
};

describe("merged popularity tiers", () => {
  test("keeps every tier from one cohort and does not promote a later higher tier", () => {
    const kept = mergePopularityTierRecords([
      { ...cohort, popularity_tier: "standard" },
      { ...cohort, popularity_tier: "fire", popularity_score: 9 },
    ]);
    expect(kept.tiers).toEqual(["standard", "fire"]);
    expect(kept.picksHighestTier).toBe(false);
    expect(kept.cohort).toEqual({
      scoring_version: "score-v1",
      cohort_version: "cohort-a",
      computed_at: "2026-10-17T04:00:00.000Z",
    });
    expect(() => mergePopularityTierRecords([
      { ...cohort, popularity_tier: "standard" },
      {
        ...cohort,
        computed_at: "2026-10-16T04:00:00.000Z",
        popularity_tier: "fire",
        popularity_score: 9,
      },
    ])).toThrow(EvidenceContractError);

    const media = collectRestaurantMergedMedia({
      id: "primary",
      youtube_link: "https://www.youtube.com/watch?v=primary0001",
      restaurant_popularity_metrics: { ...cohort, popularity_tier: "standard" },
      mergedRestaurants: [{
        id: "older",
        restaurant_popularity_metrics: { ...cohort, popularity_tier: "fire", popularity_score: 9 },
      }],
    } as unknown as Restaurant);
    expect(media.youtubeLinks).toEqual(["https://www.youtube.com/watch?v=primary0001"]);
    expect(media.popularityTiers).toHaveLength(2);
    expect(media.popularityTiers).toContain("standard");
    expect(media.popularityTiers).toContain("fire");
    expect(media.popularityTiers).not.toEqual(["fire"]);
    expect(media.picksHighestTier).toBe(false);
  });
});
