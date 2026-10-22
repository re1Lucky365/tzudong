import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { extractCanonicalYouTubeVideoId } from "../lib/youtube-url";
import {
  ADJUDICATION_RECORDS,
  ARCHITECTURE_INVARIANTS,
  DECLARED_NAVER_QUERY_STAGE_COUNT,
  DETAIL_BADGE_CONTRACT,
  EVIDENCE_FRAME_PERSISTENCE,
  EVIDENCE_LEVEL_LABELS,
  FETCH_DECISIONS,
  FRAME_SAMPLING,
  MARKER_EFFECT_CONTRACT,
  POPULARITY_PERSISTENCE,
  PROPOSED_DECAY_DEFAULTS,
  REVIEW_SIGNAL,
  SCORING_GATES,
  SPECIFIED_NAVER_QUERY_STAGE_COUNT,
  THESIS_CLAIMED_HALF_LIFE_DAYS,
  THESIS_HYPERBOLIC_LAMBDA,
  THESIS_SCORE_WEIGHTS,
  EvidenceContractError,
  aggregateUniqueCounts,
  applyReviewedOperationalStatus,
  assertSameScoringCohort,
  assemblePopularitySignals,
  buildEvidenceFrame,
  buildEvidenceSeekUrl,
  buildStorageObjectKey,
  classifyFetch,
  decay,
  hyperbolicDecay,
  hyperbolicHalfLifeDays,
  isInsideThesisProximityRadius,
  isLevel1SourceObserved,
  levenshteinDistance,
  levenshteinSimilarity,
  mayRetryFetch,
  parseEvidenceFrame,
  parsePopularityMetric,
  planFrameSamplingWindow,
  platformReviewSignal,
  resolveAutomaticIdentityState,
  safeCount,
  thesisHalfLifeClaimIsExact,
  unionApprovedEvidenceFrames,
  visitsMultiplier,
} from "../lib/evidence-engineering";
import type { ClosureIdentityRecord, RestaurantEvidenceFrame } from "../lib/evidence-engineering";

const VIDEO_A = "abc123DEF45";
const VIDEO_B = "abc123DEF46";
const SHA_A = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const SHA_B = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b854";
const COMPUTED_AT = "2026-10-17T04:00:00.000Z";

const closureRecord = (): ClosureIdentityRecord => ({
  ledgerId: "license-100",
  businessAddress: "서울특별시 중구 세종대로 1",
  effectiveOn: "2024-03-01",
  branchDistinction: "본점",
  sourceUpdatedOn: "2026-10-01",
});

const frameDraft = (overrides: Partial<Parameters<typeof buildEvidenceFrame>[0]> = {}) => buildEvidenceFrame({
  frame_id: "frame-sign-1",
  content_sha256: SHA_A,
  video_id: VIDEO_A,
  timestamp_ms: 125_500,
  frame_type: "storefront_sign",
  evidence_level: "SOURCE_OBSERVED",
  confidence_level: "certain",
  moderation_status: "approved",
  detected_shop_name: "1300원 회전초밥",
  detected_branch_name: "용전점",
  image_url: null,
  ...overrides,
});

function codeOf(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(EvidenceContractError);
    return (error as EvidenceContractError).code;
  }
  throw new Error("expected throw");
}

describe("evidence engineering foundation", () => {
  test("locks the hyperbolic half-life correction and rejects the 460-day claim", () => {
    expect(thesisHalfLifeClaimIsExact()).toBe(false);
    expect(hyperbolicHalfLifeDays(THESIS_HYPERBOLIC_LAMBDA)).toBeCloseTo(2000 / 3, 9);
    expect(THESIS_CLAIMED_HALF_LIFE_DAYS).toBe(460);
    expect(hyperbolicDecay(460, THESIS_HYPERBOLIC_LAMBDA)).toBeCloseTo(100 / 169, 9);
    expect(hyperbolicDecay(460)).toBeCloseTo(100 / 169, 9);
    expect(hyperbolicDecay(0)).toBe(1);
    expect(codeOf(() => hyperbolicDecay(10, 0))).toBe("invalid_decay_parameters");
    expect(codeOf(() => hyperbolicHalfLifeDays(-1))).toBe("invalid_decay_parameters");
  });

  test("floor decay uses the decayable half-life, with unlocked coefficients", () => {
    expect(decay(460, 0.5, 460)).toBe(0.75);
    expect(decay(0, 0.5, 460)).toBe(1);
    expect(decay(1825, 0.5, 460)).toBeCloseTo(549 / 914, 9);
    expect(PROPOSED_DECAY_DEFAULTS.locked).toBe(false);
    expect(codeOf(() => decay(-1, 0.5, 460))).toBe("invalid_decay_parameters");
    expect(codeOf(() => decay(Number.NaN, 0.5, 460))).toBe("non_finite");
    expect(codeOf(() => decay(1, 1, 460))).toBe("invalid_decay_parameters");
    expect(codeOf(() => decay(1, 0.5, 0))).toBe("invalid_decay_parameters");
    expect(codeOf(() => decay(1, -0.1, 460))).toBe("invalid_decay_parameters");
    expect(codeOf(() => decay(1, 0.5, -5))).toBe("invalid_decay_parameters");
    expect(codeOf(() => decay(Number.POSITIVE_INFINITY, 0.5, 460))).toBe("non_finite");
  });

  test("visit multiplier ignores duplicate video ids and rejects a negative gamma", () => {
    expect(visitsMultiplier([], 0.25)).toBe(1);
    expect(visitsMultiplier([VIDEO_A, VIDEO_A], 0.25)).toBe(1);
    expect(visitsMultiplier([VIDEO_A, VIDEO_B, VIDEO_A], 0.25)).toBeCloseTo(1 + 0.25 * Math.log1p(1), 12);
    expect(codeOf(() => visitsMultiplier([VIDEO_A], -0.01))).toBe("invalid_gamma");
    expect(codeOf(() => visitsMultiplier([VIDEO_A], Number.NaN))).toBe("invalid_gamma");
    expect(codeOf(() => visitsMultiplier(["bad id"], 0.25))).toBe("invalid_video_id");
    expect(codeOf(() => visitsMultiplier([`https://www.youtube.com/watch?v=${VIDEO_A}`], 0.25))).toBe("invalid_video_id");
  });

  test("counts keep null distinct from zero and clamp only real non-negative integers", () => {
    expect(safeCount(null, 100)).toBeNull();
    expect(safeCount(undefined, 100)).toBeNull();
    expect(safeCount(true, 100)).toBeNull();
    expect(safeCount(false, 100)).toBeNull();
    expect(safeCount(0, 100)).toBe(0);
    expect(safeCount("0", 100)).toBe(0);
    expect(safeCount("1,234", 10_000)).toBe(1234);
    expect(safeCount(" 12 ", 100)).toBe(12);
    expect(safeCount("+7", 100)).toBe(7);
    expect(safeCount("1_000", 10_000)).toBe(1000);
    expect(safeCount("007", 100)).toBe(7);
    expect(safeCount(-1, 100)).toBeNull();
    expect(safeCount("1.5", 100)).toBeNull();
    expect(safeCount(1.5, 100)).toBeNull();
    expect(safeCount("9007199254740993", 100)).toBeNull();
    expect(safeCount(8, 5)).toBe(5);
    expect(platformReviewSignal(null, 10)).toBeNull();
    expect(platformReviewSignal(0, 10)).toBe(0);
    expect(REVIEW_SIGNAL.bayesianPosterior).toBe(false);
    expect(codeOf(() => safeCount(1, -1))).toBe("invalid_maximum");
    expect(codeOf(() => safeCount(1, 1.5))).toBe("invalid_maximum");
  });

  test("the same video contributes its counts once, and conflicting duplicates fail closed", () => {
    const once = aggregateUniqueCounts([
      { videoId: VIDEO_A, count: "1,000" },
      { videoId: VIDEO_A, count: 1000 },
      { videoId: VIDEO_B, count: 0 },
    ], 1_000_000);
    expect(once).toEqual({ videoCount: 2, knownSum: 1000, missingVideoIds: [] });

    const missing = aggregateUniqueCounts([{ videoId: VIDEO_A, count: null }], 10);
    expect(missing.knownSum).toBe(0);
    expect(missing.missingVideoIds).toEqual([VIDEO_A]);

    expect(codeOf(() => aggregateUniqueCounts([
      { videoId: VIDEO_A, count: null },
      { videoId: VIDEO_A, count: 0 },
    ], 10))).toBe("duplicate_video_conflict");
    expect(SCORING_GATES.viewCountSplitAdopted).toBe(false);
    expect(SCORING_GATES.multipliedScoreAdopted).toBe(false);
    expect(THESIS_SCORE_WEIGHTS.adopted).toBe(false);
  });

  test("assembled signals are deterministic and do not collapse into one multiplied score", () => {
    const input = {
      videoEngagement: 10,
      daysSincePublish: 460,
      floor: PROPOSED_DECAY_DEFAULTS.classicFloor,
      halfChangeDays: PROPOSED_DECAY_DEFAULTS.decayableHalfLifeDays,
      uniqueVideoIds: [VIDEO_A, VIDEO_A],
      gamma: PROPOSED_DECAY_DEFAULTS.visitGamma,
      platformReviewSignal: null as number | null,
    };
    const first = assemblePopularitySignals(input);
    const second = assemblePopularitySignals(input);
    expect(first).toEqual(second);
    expect(first.freshness).toBe(0.75);
    expect(first.visit_multiplier).toBe(1);
    expect(first.platform_review_signal).toBeNull();
    expect(Object.keys(first).sort()).toEqual([
      "freshness",
      "platform_review_signal",
      "video_engagement",
      "visit_multiplier",
    ]);
    expect(codeOf(() => assemblePopularitySignals({ ...input, daysSincePublish: -1 }))).toBe("invalid_decay_parameters");
  });

  test("broad Naver stages and search misses never become closed_store", () => {
    const market = resolveAutomaticIdentityState({
      queryStage: 4,
      searchMiss: false,
      evidenceFamilies: ["lexical_name_match", "bounded_spatial_proximity"],
      evidenceConflicts: false,
      closureRecord: null,
    });
    expect(isInsideThesisProximityRadius(40)).toBe(true);
    expect(isInsideThesisProximityRadius(150)).toBe(true);
    expect(isInsideThesisProximityRadius(150.1)).toBe(false);
    expect(market).toEqual({ state: "needs_review", autoClosedStore: false, autoRelocated: false });

    const missed = resolveAutomaticIdentityState({
      queryStage: 1,
      searchMiss: true,
      evidenceFamilies: ["mois_public_license_closed"],
      evidenceConflicts: false,
      closureRecord: null,
    });
    expect(missed.state).toBe("needs_review");
    expect(missed.autoClosedStore).toBe(false);

    for (const stage of [6, 7, 8, 9, 10]) {
      expect(resolveAutomaticIdentityState({
        queryStage: stage,
        searchMiss: false,
        evidenceFamilies: ["lexical_name_match", "exact_parcel_coordinate_match"],
        evidenceConflicts: false,
        closureRecord: null,
      }).state).toBe("needs_review");
    }
    expect(SPECIFIED_NAVER_QUERY_STAGE_COUNT).toBe(5);
    expect(DECLARED_NAVER_QUERY_STAGE_COUNT).toBe(10);
  });

  test("exact stages need two families, and a complete closure record stays a candidate", () => {
    expect(resolveAutomaticIdentityState({
      queryStage: 3,
      searchMiss: false,
      evidenceFamilies: ["lexical_name_match", "exact_parcel_coordinate_match", "lexical_name_match"],
      evidenceConflicts: false,
      closureRecord: null,
    }).state).toBe("supported");

    expect(resolveAutomaticIdentityState({
      queryStage: 2,
      searchMiss: false,
      evidenceFamilies: ["bounded_spatial_proximity"],
      evidenceConflicts: false,
      closureRecord: null,
    }).state).toBe("needs_review");

    expect(resolveAutomaticIdentityState({
      queryStage: 1,
      searchMiss: false,
      evidenceFamilies: [],
      evidenceConflicts: false,
      closureRecord: closureRecord(),
    })).toEqual({ state: "closure_candidate", autoClosedStore: false, autoRelocated: false });

    expect(resolveAutomaticIdentityState({
      queryStage: 1,
      searchMiss: false,
      evidenceFamilies: ["lexical_name_match", "telecom_identifier_match"],
      evidenceConflicts: false,
      closureRecord: closureRecord(),
    }).state).toBe("conflict");

    expect(codeOf(() => resolveAutomaticIdentityState({
      queryStage: 1,
      searchMiss: false,
      evidenceFamilies: [],
      evidenceConflicts: false,
      closureRecord: { ...closureRecord(), ledgerId: "" },
    }))).toBe("invalid_closure_record");
    expect(codeOf(() => resolveAutomaticIdentityState({
      queryStage: 1,
      searchMiss: false,
      evidenceFamilies: [],
      evidenceConflicts: false,
      closureRecord: { ...closureRecord(), effectiveOn: "2024-02-31" },
    }))).toBe("invalid_calendar_date");

    expect(codeOf(() => resolveAutomaticIdentityState({
      queryStage: 0,
      searchMiss: true,
      evidenceFamilies: [],
      evidenceConflicts: false,
      closureRecord: null,
    }))).toBe("invalid_query_stage");
    expect(codeOf(() => resolveAutomaticIdentityState({
      queryStage: 1,
      searchMiss: false,
      evidenceFamilies: ["provider_debug_dump"],
      evidenceConflicts: false,
      closureRecord: null,
    }))).toBe("unknown_evidence_family");
    expect(applyReviewedOperationalStatus({ moderation: "approved", status: "closed_store" })).toBe("closed_store");
    expect(applyReviewedOperationalStatus({ moderation: "pending" })).toBe("needs_review");
  });

  test("Levenshtein is available and is not an automatic identity cutoff", () => {
    expect(levenshteinDistance("kitten", "sitting")).toBe(3);
    expect(levenshteinDistance("가나다", "가나라")).toBe(1);
    expect(levenshteinDistance("원조할머니칼국수", "할머니손칼국수")).toBe(3);
    expect(levenshteinSimilarity("kitten", "sitting")).toBeCloseTo(1 - 3 / 7, 12);
    expect(levenshteinDistance("", "")).toBe(0);
    expect(levenshteinSimilarity("", "")).toBe(1);
    expect(codeOf(() => levenshteinDistance("a".repeat(201), "b"))).toBe("invalid_name_length");
    expect(codeOf(() => isInsideThesisProximityRadius(Number.NaN))).toBe("invalid_distance");
  });

  test("seek URLs keep the canonical watch form and storage keys keep milliseconds", () => {
    const early = buildEvidenceSeekUrl(VIDEO_A, 125_000);
    const late = buildEvidenceSeekUrl(VIDEO_A, 125_500);
    expect(early).toBe(`https://www.youtube.com/watch?v=${VIDEO_A}&t=125`);
    expect(late).toBe(early);
    expect(extractCanonicalYouTubeVideoId(early)).toBe(VIDEO_A);
    expect(buildStorageObjectKey(VIDEO_A, 125_000, SHA_A)).toBe(`${VIDEO_A}/125000_${SHA_A.slice(0, 12)}.webp`);
    expect(buildStorageObjectKey(VIDEO_A, 125_500, SHA_A)).not.toBe(buildStorageObjectKey(VIDEO_A, 125_000, SHA_A));
    expect(codeOf(() => buildEvidenceSeekUrl(`https://youtu.be/${VIDEO_A}`, 0))).toBe("invalid_video_id");
    expect(codeOf(() => buildStorageObjectKey(VIDEO_A, 1.5, SHA_A))).toBe("invalid_timestamp_ms");
    expect(codeOf(() => buildStorageObjectKey(VIDEO_A, -1, SHA_A))).toBe("invalid_timestamp_ms");
  });

  test("frame parsing separates collection from review and rejects raw OCR", () => {
    const frame = frameDraft();
    expect(frame.youtube_seek_url).toContain("&t=125");
    expect(frame.storage_object_key.endsWith(".webp")).toBe(true);
    expect(parseEvidenceFrame(frame)).toEqual(frame);
    expect(isLevel1SourceObserved(frame)).toBe(true);
    expect(isLevel1SourceObserved(frameDraft({
      frame_type: "on_site_scene",
      evidence_level: "UNVERIFIED",
    }))).toBe(false);
    expect(isLevel1SourceObserved(frameDraft({ moderation_status: "pending" }))).toBe(false);
    expect(codeOf(() => parseEvidenceFrame({ ...frame, raw_ocr: "간판 전체 문장" }))).toBe("personal_data_forbidden");
    expect(codeOf(() => parseEvidenceFrame({
      ...frame,
      youtube_seek_url: `https://youtu.be/${VIDEO_A}?t=125`,
    }))).toBe("seek_integrity_mismatch");
    expect(codeOf(() => frameDraft({ detected_shop_name: "02-123-4567" }))).toBe("invalid_detected_name");
    expect(codeOf(() => frameDraft({ content_sha256: SHA_A.toUpperCase() }))).toBe("invalid_content_sha256");
    expect(EVIDENCE_LEVEL_LABELS.SOURCE_OBSERVED).toBe("L1");
    expect(EVIDENCE_LEVEL_LABELS.CONTRADICTED).toBe("L7");
  });

  test("approved frames union by id and refuse mixed moderation or colliding keys", () => {
    const approved = frameDraft();
    const pending = frameDraft({ frame_id: "frame-pending", moderation_status: "pending", timestamp_ms: 10_000 });
    const later = frameDraft({
      frame_id: "frame-caption",
      frame_type: "publisher_location_caption",
      timestamp_ms: 200_000,
      content_sha256: SHA_B,
    });
    expect(unionApprovedEvidenceFrames([[approved, pending], [approved, later]]).map((frame) => frame.frame_id))
      .toEqual(["frame-sign-1", "frame-caption"]);

    expect(codeOf(() => unionApprovedEvidenceFrames([[
      approved,
      frameDraft({ content_sha256: SHA_B }),
    ]]))).toBe("duplicate_frame_conflict");
    expect(codeOf(() => unionApprovedEvidenceFrames([[
      approved,
      frameDraft({ moderation_status: "rejected" }),
    ]]))).toBe("moderation_conflict");

    const staleUrl = frameDraft({ image_url: "https://cdn.example/a.webp" });
    const freshUrl = frameDraft({ image_url: "https://cdn.example/b.webp" });
    expect(unionApprovedEvidenceFrames([[staleUrl, freshUrl]])[0]?.image_url).toBeNull();
    expect(EVIDENCE_FRAME_PERSISTENCE.embedsInEvaluationResults).toBe(false);
    expect(EVIDENCE_FRAME_PERSISTENCE.deleteCascadeDecided).toBe(false);
  });

  test("sampling plans decode a bounded window and do not promise I-frame 2fps", () => {
    expect(planFrameSamplingWindow(VIDEO_A, 1_000)).toEqual({
      video_id: VIDEO_A,
      target_timestamp_ms: 1_000,
      window_start_ms: 0,
      window_end_ms: 6_000,
      sample_fps: 2,
      keyframe_role: "decode_start_only",
      loads_full_video_in_node: false,
    });
    expect(planFrameSamplingWindow(VIDEO_A, 120_000).window_start_ms).toBe(115_000);
    expect(FRAME_SAMPLING.iFrameOnlyFpsGuaranteed).toBe(false);
    expect(FRAME_SAMPLING.thesisSceneChangeThreshold).toBe(0.35);
    expect(ARCHITECTURE_INVARIANTS.I01).toBe("node_must_not_load_full_video");
    expect(ARCHITECTURE_INVARIANTS.I05).toBe("youtube_seek_timestamp_integrity");
  });

  test("tier records keep cohort identity and do not select the highest tier", () => {
    const fire = {
      scoring_version: "score-v1",
      cohort_version: "cohort-a",
      computed_at: COMPUTED_AT,
      popularity_tier: "fire" as const,
      popularity_score: 10,
    };
    const rainbow = { ...fire, popularity_tier: "rainbow" as const, popularity_score: 4 };
    const identity = assertSameScoringCohort([fire, rainbow]);
    expect(identity).toEqual({
      scoring_version: "score-v1",
      cohort_version: "cohort-a",
      computed_at: COMPUTED_AT,
    });
    expect("popularity_tier" in identity).toBe(false);
    expect(codeOf(() => assertSameScoringCohort([]))).toBe("empty_cohort");
    expect(codeOf(() => assertSameScoringCohort([
      fire,
      { ...rainbow, computed_at: "2026-10-16T04:00:00.000Z" },
    ]))).toBe("mixed_scoring_cohort");
    expect(parsePopularityMetric({
      canonical_key: "shop:video",
      source_revision: 3,
      ...fire,
    }).source_revision).toBe(3);
    expect(POPULARITY_PERSISTENCE.mutatesRestaurantUpdatedAt).toBe(false);
    expect(POPULARITY_PERSISTENCE.publicSelect).toBe(false);
    expect(codeOf(() => parsePopularityMetric({
      canonical_key: "shop:video",
      source_revision: -1,
      ...fire,
    }))).toBe("invalid_source_revision");
  });

  test("fetch classification separates challenges from temporary limits", () => {
    expect(FETCH_DECISIONS).toEqual(["accept", "retry_later", "stop_source"]);
    expect(classifyFetch(200, false)).toBe("accept");
    expect(classifyFetch(204, false)).toBe("accept");
    expect(classifyFetch(429, false)).toBe("retry_later");
    expect(classifyFetch(503, false)).toBe("retry_later");
    expect(classifyFetch(599, false)).toBe("retry_later");
    expect(classifyFetch(401, false)).toBe("stop_source");
    expect(classifyFetch(403, false)).toBe("stop_source");
    expect(classifyFetch(404, false)).toBe("stop_source");
    expect(classifyFetch(200, true)).toBe("stop_source");
    expect(classifyFetch(429, true)).toBe("stop_source");
    expect(classifyFetch(200.5, false)).toBe("stop_source");
    expect(mayRetryFetch("retry_later", {
      retryAfterSeconds: 2,
      attemptsUsed: 0,
      maxAttempts: 2,
      circuitOpen: false,
      dailyRemaining: 1,
    })).toBe(true);
    expect(mayRetryFetch("retry_later", {
      retryAfterSeconds: null,
      attemptsUsed: 2,
      maxAttempts: 2,
      circuitOpen: false,
      dailyRemaining: 1,
    })).toBe(false);
    expect(mayRetryFetch("stop_source", {
      retryAfterSeconds: null,
      attemptsUsed: 0,
      maxAttempts: 2,
      circuitOpen: false,
      dailyRemaining: 1,
    })).toBe(false);
    expect(mayRetryFetch("retry_later", {
      retryAfterSeconds: null,
      attemptsUsed: 0,
      maxAttempts: 2,
      circuitOpen: true,
      dailyRemaining: 1,
    })).toBe(false);
    expect(mayRetryFetch("retry_later", {
      retryAfterSeconds: null,
      attemptsUsed: 0,
      maxAttempts: 2,
      circuitOpen: false,
      dailyRemaining: 0,
    })).toBe(false);
    expect(mayRetryFetch("retry_later", {
      retryAfterSeconds: null,
      attemptsUsed: 0,
      maxAttempts: 2,
      circuitOpen: false,
      dailyRemaining: 1.5,
    })).toBe(false);
  });

  test("marker and badge contracts stay on the compositor path", () => {
    expect(MARKER_EFFECT_CONTRACT).toEqual({
      renderer: "css_transform_opacity",
      webglContextsPerMarker: 0,
      animatedDropShadow: false,
      unconditionalWillChange: false,
      pauseWhileMapInteracting: true,
      prefersReducedMotion: true,
      threeJsOnMarkers: false,
    });
    expect(DETAIL_BADGE_CONTRACT.defaultRenderer).toBe("static_webp");
    expect(DETAIL_BADGE_CONTRACT.threeJsOnInitialRender).toBe(false);
    expect(ADJUDICATION_RECORDS).toHaveLength(20);
    expect(ADJUDICATION_RECORDS.map((record) => record.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `A${String(index + 1).padStart(2, "0")}`),
    );
  });

  test("foundation source has no deferred stubs or unadopted cutoffs", () => {
    const directory = resolve(import.meta.dir, "../lib/evidence-engineering");
    const sources = readdirSync(directory)
      .filter((file) => file.endsWith(".ts"))
      .map((file) => readFileSync(resolve(directory, file), "utf8"))
      .join("\n");
    expect(sources.includes("TODO")).toBe(false);
    expect(sources.includes("추후 구현")).toBe(false);
    expect(sources.includes("not implemented")).toBe(false);
    expect(sources.includes("0.82")).toBe(false);
    expect(sources.includes("disable_source")).toBe(false);
    const published: RestaurantEvidenceFrame = frameDraft();
    expect(published.frame_id).not.toBe(published.content_sha256);
  });
});
