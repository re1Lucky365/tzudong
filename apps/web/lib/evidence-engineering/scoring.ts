import { THESIS_HYPERBOLIC_LAMBDA } from "./constants";
import { EvidenceContractCodes, EvidenceContractError } from "./errors";
import { requireYouTubeVideoId, safeCount } from "./guards";
import type { PopularitySignals, UniqueCountAggregate } from "./types";

export function decay(days: number, floor: number, halfChangeDays: number): number {
  if (![days, floor, halfChangeDays].every(Number.isFinite)) {
    throw new EvidenceContractError(EvidenceContractCodes.nonFinite);
  }
  if (days < 0 || floor < 0 || floor >= 1 || halfChangeDays <= 0) {
    throw new EvidenceContractError(EvidenceContractCodes.invalidDecayParameters);
  }
  return floor + (1 - floor) / (1 + days / halfChangeDays);
}

export function hyperbolicDecay(days: number, lambda: number = THESIS_HYPERBOLIC_LAMBDA): number {
  if (!Number.isFinite(days) || !Number.isFinite(lambda)) {
    throw new EvidenceContractError(EvidenceContractCodes.nonFinite);
  }
  if (days < 0 || lambda <= 0) {
    throw new EvidenceContractError(EvidenceContractCodes.invalidDecayParameters);
  }
  return 1 / (1 + lambda * days);
}

export function hyperbolicHalfLifeDays(lambda: number): number {
  if (!Number.isFinite(lambda)) {
    throw new EvidenceContractError(EvidenceContractCodes.nonFinite);
  }
  if (lambda <= 0) {
    throw new EvidenceContractError(EvidenceContractCodes.invalidDecayParameters);
  }
  return 1 / lambda;
}

export function thesisHalfLifeClaimIsExact(): boolean {
  return hyperbolicHalfLifeDays(THESIS_HYPERBOLIC_LAMBDA) === 460;
}

export function visitsMultiplier(videoIds: readonly string[], gamma: number): number {
  if (!Number.isFinite(gamma) || gamma < 0) {
    throw new EvidenceContractError(EvidenceContractCodes.invalidGamma);
  }
  const uniqueIds = new Set<string>();
  for (const videoId of videoIds) {
    uniqueIds.add(requireYouTubeVideoId(videoId));
  }
  return 1 + gamma * Math.log1p(Math.max(0, uniqueIds.size - 1));
}

export function platformReviewSignal(reviewCount: unknown, maximum: number): number | null {
  return safeCount(reviewCount, maximum);
}

export function assemblePopularitySignals(input: {
  videoEngagement: number;
  daysSincePublish: number;
  floor: number;
  halfChangeDays: number;
  uniqueVideoIds: readonly string[];
  gamma: number;
  platformReviewSignal: number | null;
}): PopularitySignals {
  if (!Number.isFinite(input.videoEngagement) || input.videoEngagement < 0) {
    throw new EvidenceContractError(EvidenceContractCodes.nonFinite);
  }
  if (
    input.platformReviewSignal !== null &&
    (!Number.isFinite(input.platformReviewSignal) || input.platformReviewSignal < 0)
  ) {
    throw new EvidenceContractError(EvidenceContractCodes.nonFinite);
  }
  return {
    video_engagement: input.videoEngagement,
    freshness: decay(input.daysSincePublish, input.floor, input.halfChangeDays),
    visit_multiplier: visitsMultiplier(input.uniqueVideoIds, input.gamma),
    platform_review_signal: input.platformReviewSignal,
  };
}

export function aggregateUniqueCounts(
  rows: readonly { videoId: string; count: unknown }[],
  maximum: number,
): UniqueCountAggregate {
  const grouped = new Map<string, { count: number | null; seen: boolean }>();
  const order: string[] = [];

  for (const row of rows) {
    const videoId = requireYouTubeVideoId(row.videoId);
    const parsed = safeCount(row.count, maximum);
    const existing = grouped.get(videoId);
    if (!existing) {
      grouped.set(videoId, { count: parsed, seen: true });
      order.push(videoId);
      continue;
    }
    if (existing.count !== parsed) {
      throw new EvidenceContractError(EvidenceContractCodes.duplicateVideoConflict);
    }
  }

  let knownSum = 0;
  const missingVideoIds: string[] = [];
  for (const videoId of order) {
    const groupedCount = grouped.get(videoId);
    if (!groupedCount) continue;
    if (groupedCount.count === null) {
      missingVideoIds.push(videoId);
      continue;
    }
    knownSum += groupedCount.count;
    if (!Number.isSafeInteger(knownSum)) {
      throw new EvidenceContractError(EvidenceContractCodes.nonFinite);
    }
  }

  return {
    videoCount: order.length,
    knownSum,
    missingVideoIds,
  };
}
