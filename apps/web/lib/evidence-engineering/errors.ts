export const EvidenceContractCodes = {
  nonFinite: "non_finite",
  invalidDecayParameters: "invalid_decay_parameters",
  invalidGamma: "invalid_gamma",
  invalidMaximum: "invalid_maximum",
  invalidVideoId: "invalid_video_id",
  invalidTimestampMs: "invalid_timestamp_ms",
  invalidContentSha256: "invalid_content_sha256",
  invalidFrame: "invalid_frame",
  invalidFrameId: "invalid_frame_id",
  invalidDetectedName: "invalid_detected_name",
  invalidImageUrl: "invalid_image_url",
  invalidEvidenceLevel: "invalid_evidence_level",
  invalidFrameType: "invalid_frame_type",
  invalidConfidence: "invalid_confidence",
  invalidModeration: "invalid_moderation",
  personalDataForbidden: "personal_data_forbidden",
  seekIntegrityMismatch: "seek_integrity_mismatch",
  storageKeyMismatch: "storage_key_mismatch",
  duplicateVideoConflict: "duplicate_video_conflict",
  duplicateFrameConflict: "duplicate_frame_conflict",
  moderationConflict: "moderation_conflict",
  invalidQueryStage: "invalid_query_stage",
  invalidDistance: "invalid_distance",
  invalidNameLength: "invalid_name_length",
  unknownEvidenceFamily: "unknown_evidence_family",
  invalidClosureRecord: "invalid_closure_record",
  mixedScoringCohort: "mixed_scoring_cohort",
  emptyCohort: "empty_cohort",
  invalidScoringVersion: "invalid_scoring_version",
  invalidCohortVersion: "invalid_cohort_version",
  invalidComputedAt: "invalid_computed_at",
  invalidPopularityTier: "invalid_popularity_tier",
  invalidPopularityScore: "invalid_popularity_score",
  invalidSourceRevision: "invalid_source_revision",
  invalidCanonicalKey: "invalid_canonical_key",
  invalidCalendarDate: "invalid_calendar_date",
} as const;

export type EvidenceContractCode = (typeof EvidenceContractCodes)[keyof typeof EvidenceContractCodes];

export class EvidenceContractError extends Error {
  readonly code: EvidenceContractCode;

  constructor(code: EvidenceContractCode) {
    super(code);
    this.name = "EvidenceContractError";
    this.code = code;
  }
}
