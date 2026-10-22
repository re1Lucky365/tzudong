import { extractCanonicalYouTubeVideoId } from "../youtube-url";
import {
  CALENDAR_DATE_PATTERN,
  CANONICAL_KEY_PATTERN,
  CONFIDENCE_LEVELS,
  CONTENT_SHA256_PATTERN,
  DETECTED_NAME_MAX_LENGTH,
  EVIDENCE_FRAME_TYPES,
  EVIDENCE_LEVELS,
  FORBIDDEN_PAYLOAD_KEYS,
  FRAME_ID_PATTERN,
  ISO_TIMESTAMP_PATTERN,
  MODERATION_STATUSES,
  POPULARITY_TIERS,
  VERSION_TOKEN_PATTERN,
} from "./constants";
import { EvidenceContractCodes, EvidenceContractError } from "./errors";
import type {
  ConfidenceLevel,
  EvidenceFrameType,
  EvidenceLevel,
  ModerationStatus,
  PopularityTier,
} from "./types";

const PHONE_LIKE_PATTERN = /\d{2,4}-\d{3,4}-\d{4}/;

export function requireYouTubeVideoId(value: string): string {
  const videoId = extractCanonicalYouTubeVideoId(value);
  if (!videoId || videoId !== value) {
    throw new EvidenceContractError(EvidenceContractCodes.invalidVideoId);
  }
  return videoId;
}

export function requireTimestampMs(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new EvidenceContractError(EvidenceContractCodes.invalidTimestampMs);
  }
  return value;
}

export function requireContentSha256(value: string): string {
  if (!CONTENT_SHA256_PATTERN.test(value)) {
    throw new EvidenceContractError(EvidenceContractCodes.invalidContentSha256);
  }
  return value;
}

export function requireFrameId(value: string): string {
  if (!FRAME_ID_PATTERN.test(value)) {
    throw new EvidenceContractError(EvidenceContractCodes.invalidFrameId);
  }
  return value;
}

export function requireVersionToken(value: string, code: "invalid_scoring_version" | "invalid_cohort_version"): string {
  if (!VERSION_TOKEN_PATTERN.test(value)) {
    throw new EvidenceContractError(code);
  }
  return value;
}

export function requireIsoTimestamp(value: string): string {
  if (!ISO_TIMESTAMP_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new EvidenceContractError(EvidenceContractCodes.invalidComputedAt);
  }
  return value;
}

export function requireCalendarDate(value: string): string {
  if (!CALENDAR_DATE_PATTERN.test(value)) {
    throw new EvidenceContractError(EvidenceContractCodes.invalidCalendarDate);
  }
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new EvidenceContractError(EvidenceContractCodes.invalidCalendarDate);
  }
  return value;
}

export function requireCanonicalKey(value: string): string {
  if (!CANONICAL_KEY_PATTERN.test(value)) {
    throw new EvidenceContractError(EvidenceContractCodes.invalidCanonicalKey);
  }
  return value;
}

export function requireBoundedText(value: string, maxLength: number, code: "invalid_detected_name" | "invalid_closure_record"): string {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > maxLength ||
    /[\u0000-\u001F\u007F]/.test(trimmed) ||
    trimmed.includes("@") ||
    PHONE_LIKE_PATTERN.test(trimmed)
  ) {
    throw new EvidenceContractError(code);
  }
  return trimmed;
}

export function requireDetectedName(value: string | null): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new EvidenceContractError(EvidenceContractCodes.invalidDetectedName);
  }
  if (value.trim() === "") return null;
  return requireBoundedText(value, DETECTED_NAME_MAX_LENGTH, EvidenceContractCodes.invalidDetectedName);
}

export function requireImageUrl(value: string | null): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    throw new EvidenceContractError(EvidenceContractCodes.invalidImageUrl);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new EvidenceContractError(EvidenceContractCodes.invalidImageUrl);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new EvidenceContractError(EvidenceContractCodes.invalidImageUrl);
  }
  return value;
}

export function assertNoForbiddenPayloadKeys(value: object): void {
  for (const key of Object.keys(value)) {
    if ((FORBIDDEN_PAYLOAD_KEYS as readonly string[]).includes(key)) {
      throw new EvidenceContractError(EvidenceContractCodes.personalDataForbidden);
    }
  }
}

export function isEvidenceLevel(value: unknown): value is EvidenceLevel {
  return typeof value === "string" && (EVIDENCE_LEVELS as readonly string[]).includes(value);
}

export function isEvidenceFrameType(value: unknown): value is EvidenceFrameType {
  return typeof value === "string" && (EVIDENCE_FRAME_TYPES as readonly string[]).includes(value);
}

export function isConfidenceLevel(value: unknown): value is ConfidenceLevel {
  return typeof value === "string" && (CONFIDENCE_LEVELS as readonly string[]).includes(value);
}

export function isModerationStatus(value: unknown): value is ModerationStatus {
  return typeof value === "string" && (MODERATION_STATUSES as readonly string[]).includes(value);
}

export function isPopularityTier(value: unknown): value is PopularityTier {
  return typeof value === "string" && (POPULARITY_TIERS as readonly string[]).includes(value);
}

export function parseMember<T extends string>(
  value: unknown,
  guard: (value: unknown) => value is T,
  code: EvidenceContractError["code"],
): T {
  if (!guard(value)) throw new EvidenceContractError(code);
  return value;
}

/**
 * Parses a count the way the synthesis `safe_count` does.
 * Null means missing. Zero means a real zero. Booleans are missing.
 * Integral JavaScript numbers are accepted. Decimal strings are missing.
 * Underscores follow Python `int` digit rules. Values above the maximum clamp.
 */
export function safeCount(value: unknown, maximum: number): number | null {
  if (!Number.isSafeInteger(maximum) || maximum < 0) {
    throw new EvidenceContractError(EvidenceContractCodes.invalidMaximum);
  }
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return null;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return Math.min(value, maximum);
  }
  if (typeof value !== "string") return null;
  const parsed = parsePythonInteger(value);
  if (parsed === null || parsed < 0) return null;
  return Math.min(parsed, maximum);
}

function parsePythonInteger(value: string): number | null {
  const stripped = value.replaceAll(",", "").trim();
  if (!/^[+-]?\d(?:_?\d)*$/.test(stripped)) return null;
  const digits = stripped.replaceAll("_", "");
  const negative = digits.startsWith("-");
  const magnitude = negative ? digits.slice(1) : digits.replace(/^\+/, "");
  if (!/^\d+$/.test(magnitude)) return null;
  const numeric = Number(magnitude);
  if (!Number.isSafeInteger(numeric)) return null;
  return negative ? -numeric : numeric;
}
