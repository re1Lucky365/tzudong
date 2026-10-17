import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/require-admin";
import {
  applyEvidenceModeration,
  confirmEvidenceModeration,
  EvidenceModerationError,
  persistEvidenceFrameModeration,
  previewEvidenceModeration,
  type EvidenceFrameModerationClient,
  type EvidenceModerationStatus,
} from "@/lib/evidence-engineering/evidence-moderation";
import { isTrustedSameOriginMutation } from "@/lib/security/same-origin-mutation";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set<EvidenceModerationStatus>(["pending", "approved", "rejected"]);

function noStore(body: { error: string }, status: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function readStatus(value: unknown): EvidenceModerationStatus | null {
  return typeof value === "string" && STATUSES.has(value as EvidenceModerationStatus)
    ? value as EvidenceModerationStatus
    : null;
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    admin.response.headers.set("Cache-Control", "no-store");
    return admin.response;
  }
  if (!isTrustedSameOriginMutation(request)) {
    return noStore({ error: "forbidden" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return noStore({ error: "invalid_request" }, 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return noStore({ error: "invalid_request" }, 400);
  }

  const frameId = typeof body.frameId === "string" ? body.frameId : "";
  const fromStatus = readStatus(body.fromStatus);
  const toStatus = readStatus(body.toStatus);
  const step = body.step;
  if (!fromStatus || !toStatus || (step !== "preview" && step !== "confirm" && step !== "apply")) {
    return noStore({ error: "invalid_request" }, 400);
  }

  try {
    if (step === "preview") {
      const preview = previewEvidenceModeration({
        frameId,
        fromStatus,
        toStatus,
        actorId: admin.userId,
      });
      return NextResponse.json(preview, { headers: { "Cache-Control": "no-store" } });
    }
    const previewHash = typeof body.previewHash === "string" ? body.previewHash : "";
    const confirmationText = typeof body.confirmationText === "string" ? body.confirmationText : "";
    if (step === "confirm") {
      const confirmed = confirmEvidenceModeration({
        frameId,
        fromStatus,
        toStatus,
        actorId: admin.userId,
        previewHash,
        confirmationText,
      });
      return NextResponse.json(confirmed, { headers: { "Cache-Control": "no-store" } });
    }
    const readbackStatus = readStatus(body.readbackStatus);
    if (!readbackStatus) return noStore({ error: "invalid_request" }, 400);
    const applied = applyEvidenceModeration({
      frameId,
      fromStatus,
      toStatus,
      actorId: admin.userId,
      previewHash,
      confirmationText,
      readbackStatus,
    });
    let persisted: Awaited<ReturnType<typeof persistEvidenceFrameModeration>>;
    try {
      persisted = await persistEvidenceFrameModeration(
        createSupabaseServiceRoleClient() as unknown as EvidenceFrameModerationClient,
        { frameId, fromStatus, toStatus },
      );
    } catch {
      return noStore({ error: "persistence_unavailable" }, 409);
    }
    if (persisted !== "updated") {
      return noStore({ error: persisted }, persisted === "persistence_unavailable" ? 409 : 400);
    }
    return NextResponse.json(
      { audit: applied.audit },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const code = error instanceof EvidenceModerationError ? error.code : "moderation_failed";
    return noStore({ error: code }, 400);
  }
}
