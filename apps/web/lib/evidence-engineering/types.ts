import type {
  ADJUDICATION_RECORDS,
  ADJUDICATION_VERDICTS,
  CONFIDENCE_LEVELS,
  EVIDENCE_FAMILIES,
  EVIDENCE_FRAME_TYPES,
  EVIDENCE_LEVELS,
  FETCH_DECISIONS,
  IDENTITY_PIPELINE_STAGES,
  IDENTITY_TERMINAL_STATES,
  MODERATION_STATUSES,
  POPULARITY_TIERS,
  REVIEWED_OPERATIONAL_STATUSES,
} from "./constants";

export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];
export type EvidenceFrameType = (typeof EVIDENCE_FRAME_TYPES)[number];
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];
export type ModerationStatus = (typeof MODERATION_STATUSES)[number];
export type PopularityTier = (typeof POPULARITY_TIERS)[number];
export type IdentityPipelineStage = (typeof IDENTITY_PIPELINE_STAGES)[number];
export type IdentityTerminalState = (typeof IDENTITY_TERMINAL_STATES)[number];
export type ReviewedOperationalStatus = (typeof REVIEWED_OPERATIONAL_STATUSES)[number];
export type FetchDecision = (typeof FETCH_DECISIONS)[number];
export type EvidenceFamily = (typeof EVIDENCE_FAMILIES)[number];
export type AdjudicationVerdict = (typeof ADJUDICATION_VERDICTS)[number];
export type AdjudicationRecord = (typeof ADJUDICATION_RECORDS)[number];

export interface RestaurantEvidenceFrame {
  frame_id: string;
  content_sha256: string;
  video_id: string;
  timestamp_ms: number;
  storage_object_key: string;
  youtube_seek_url: string;
  frame_type: EvidenceFrameType;
  evidence_level: EvidenceLevel;
  confidence_level: ConfidenceLevel;
  moderation_status: ModerationStatus;
  detected_shop_name: string | null;
  detected_branch_name: string | null;
  image_url: string | null;
}

export interface EvidenceFrameDraft {
  frame_id: string;
  content_sha256: string;
  video_id: string;
  timestamp_ms: number;
  frame_type: EvidenceFrameType;
  evidence_level: EvidenceLevel;
  confidence_level: ConfidenceLevel;
  moderation_status: ModerationStatus;
  detected_shop_name: string | null;
  detected_branch_name: string | null;
  image_url: string | null;
}

export interface FrameSamplingPlan {
  video_id: string;
  target_timestamp_ms: number;
  window_start_ms: number;
  window_end_ms: number;
  sample_fps: 2;
  keyframe_role: "decode_start_only";
  loads_full_video_in_node: false;
}

export interface PopularitySignals {
  video_engagement: number;
  freshness: number;
  visit_multiplier: number;
  platform_review_signal: number | null;
}

export interface UniqueCountAggregate {
  videoCount: number;
  knownSum: number;
  missingVideoIds: readonly string[];
}

export interface PopularityTierAssignment {
  scoring_version: string;
  cohort_version: string;
  computed_at: string;
  popularity_tier: PopularityTier;
  popularity_score: number;
}

export interface PopularityMetricRecord {
  canonical_key: string;
  source_revision: number;
  scoring_version: string;
  cohort_version: string;
  popularity_score: number;
  popularity_tier: PopularityTier;
  computed_at: string;
}

export interface ClosureIdentityRecord {
  ledgerId: string;
  businessAddress: string;
  effectiveOn: string;
  branchDistinction: string;
  sourceUpdatedOn: string;
}

export interface IdentityDecisionInput {
  queryStage: number | null;
  searchMiss: boolean;
  evidenceFamilies: readonly string[];
  evidenceConflicts: boolean;
  closureRecord: ClosureIdentityRecord | null;
}

export interface IdentityMatchDecision {
  state: IdentityTerminalState;
  autoClosedStore: false;
  autoRelocated: false;
}

export interface FetchRetryBudget {
  retryAfterSeconds: number | null;
  attemptsUsed: number;
  maxAttempts: number;
  circuitOpen: boolean;
  dailyRemaining: number;
}

export interface ScoringCohortIdentity {
  scoring_version: string;
  cohort_version: string;
  computed_at: string;
}
