import { createHash } from "node:crypto";

export type EvidenceModerationStatus = "pending" | "approved" | "rejected";
export type EvidenceModerationStep = "preview" | "confirm" | "apply" | "readback";

export class EvidenceModerationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "EvidenceModerationError";
    this.code = code;
  }
}

const FRAME_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const CONFIRMATION_TEXT = "프레임 검수를 적용한다";

export function previewEvidenceModeration(input: {
  frameId: string;
  fromStatus: EvidenceModerationStatus;
  toStatus: EvidenceModerationStatus;
  actorId: string;
}): { step: "preview"; previewHash: string } {
  assertTransition(input);
  return {
    step: "preview",
    previewHash: moderationHash(input),
  };
}

export function confirmEvidenceModeration(input: {
  frameId: string;
  fromStatus: EvidenceModerationStatus;
  toStatus: EvidenceModerationStatus;
  actorId: string;
  previewHash: string;
  confirmationText: string;
}): { step: "confirm"; previewHash: string } {
  const preview = previewEvidenceModeration(input);
  if (input.previewHash !== preview.previewHash || input.confirmationText !== CONFIRMATION_TEXT) {
    throw new EvidenceModerationError("confirmation_mismatch");
  }
  return { step: "confirm", previewHash: preview.previewHash };
}

type EvidenceFrameWriteResult = {
  data: Array<{ moderation_status?: string | null }> | null;
  error: { code?: string } | null;
};

export type EvidenceFrameModerationClient = {
  from(table: "restaurant_evidence_frames"): {
    update(values: { moderation_status: EvidenceModerationStatus }): {
      eq(column: "frame_id", value: string): {
        eq(column: "moderation_status", value: EvidenceModerationStatus): {
          select(columns: "moderation_status"): PromiseLike<EvidenceFrameWriteResult>;
        };
      };
    };
  };
};

export async function persistEvidenceFrameModeration(
  client: EvidenceFrameModerationClient,
  input: {
    frameId: string;
    fromStatus: EvidenceModerationStatus;
    toStatus: EvidenceModerationStatus;
  },
): Promise<"updated" | "readback_mismatch" | "persistence_unavailable"> {
  let result: EvidenceFrameWriteResult;
  try {
    result = await client
      .from("restaurant_evidence_frames")
      .update({ moderation_status: input.toStatus })
      .eq("frame_id", input.frameId)
      .eq("moderation_status", input.fromStatus)
      .select("moderation_status");
  } catch {
    return "persistence_unavailable";
  }
  if (result.error) return "persistence_unavailable";
  const row = result.data?.[0];
  if (!row || row.moderation_status !== input.toStatus) return "readback_mismatch";
  return "updated";
}

export function applyEvidenceModeration(input: {
  frameId: string;
  fromStatus: EvidenceModerationStatus;
  toStatus: EvidenceModerationStatus;
  actorId: string;
  previewHash: string;
  confirmationText: string;
  readbackStatus: EvidenceModerationStatus;
}): { step: "readback"; status: EvidenceModerationStatus; audit: { frameId: string; actorId: string; toStatus: EvidenceModerationStatus; previewHash: string } } {
  confirmEvidenceModeration(input);
  if (input.readbackStatus !== input.toStatus) {
    throw new EvidenceModerationError("readback_mismatch");
  }
  return {
    step: "readback",
    status: input.toStatus,
    audit: {
      frameId: input.frameId,
      actorId: input.actorId,
      toStatus: input.toStatus,
      previewHash: input.previewHash,
    },
  };
}

function assertTransition(input: {
  frameId: string;
  fromStatus: EvidenceModerationStatus;
  toStatus: EvidenceModerationStatus;
  actorId: string;
}): void {
  if (!FRAME_ID_PATTERN.test(input.frameId) || !FRAME_ID_PATTERN.test(input.actorId)) {
    throw new EvidenceModerationError("invalid_identifier");
  }
  if (input.fromStatus === input.toStatus) {
    throw new EvidenceModerationError("status_unchanged");
  }
  if (input.toStatus === "pending") {
    throw new EvidenceModerationError("status_not_reversible");
  }
}

function moderationHash(input: {
  frameId: string;
  fromStatus: string;
  toStatus: string;
  actorId: string;
}): string {
  return createHash("sha256")
    .update(`${input.frameId}|${input.fromStatus}|${input.toStatus}|${input.actorId}`)
    .digest("hex");
}

export const EVIDENCE_MODERATION_CONFIRMATION_TEXT = CONFIRMATION_TEXT;
