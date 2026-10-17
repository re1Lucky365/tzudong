import { isLevel1SourceObserved, parseEvidenceFrame, unionApprovedEvidenceFrames } from "@/lib/evidence-engineering/frames";
import type { RestaurantEvidenceFrame } from "@/lib/evidence-engineering/types";

export function evidenceFrameEmbedRow(item: unknown): unknown {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  const record = item as Record<string, unknown>;
  const timestamp = record.timestamp_ms;
  const timestampMs = typeof timestamp === "string" && /^[0-9]+$/.test(timestamp)
    ? Number(timestamp)
    : timestamp;
  return {
    frame_id: record.frame_id,
    content_sha256: record.content_sha256,
    video_id: record.video_id,
    timestamp_ms: timestampMs,
    storage_object_key: record.storage_object_key,
    youtube_seek_url: record.youtube_seek_url,
    frame_type: record.frame_type,
    evidence_level: record.evidence_level,
    confidence_level: record.confidence_level,
    moderation_status: record.moderation_status,
    detected_shop_name: record.detected_shop_name ?? null,
    detected_branch_name: record.detected_branch_name ?? null,
    image_url: record.image_url ?? null,
  };
}

export function publicEvidenceFrames(groups: readonly unknown[][]): RestaurantEvidenceFrame[] {
  const parsed = groups.map((group) => group.flatMap((item) => {
    try {
      return [parseEvidenceFrame(evidenceFrameEmbedRow(item))];
    } catch {
      return [];
    }
  }));
  return unionApprovedEvidenceFrames(parsed).filter(
    (frame) => frame.evidence_level !== "SYNTHETIC_MOCK_TESTED" && isLevel1SourceObserved(frame),
  );
}

export function publicFramePresentation(frame: RestaurantEvidenceFrame): {
  href: string;
  loading: "lazy";
  bulkHighResolutionFetch: false;
  enlargement: "separate_request";
} {
  return {
    href: frame.youtube_seek_url,
    loading: "lazy",
    bulkHighResolutionFetch: false,
    enlargement: "separate_request",
  };
}

export function RestaurantEvidenceCarousel({ frames }: { frames: readonly RestaurantEvidenceFrame[][] }) {
  const visible = publicEvidenceFrames(frames);
  if (visible.length === 0) return null;
  return (
    <section className="px-4 pb-[env(safe-area-inset-bottom)]" aria-label="쯔양 방문 확정 근거">
      <h3 className="mb-2 text-sm font-semibold">이 맛집이 등록된 이유 (영상 속 실제 간판·장면)</h3>
      <div className="flex gap-2 overflow-x-auto">
        {visible.map((frame) => {
          const presentation = publicFramePresentation(frame);
          return (
          <a
            key={frame.frame_id}
            href={presentation.href}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-40 shrink-0"
          >
            {frame.image_url ? (
              <img
                src={frame.image_url}
                alt={frame.detected_shop_name ?? "방문 근거 프레임"}
                width={160}
                height={90}
                loading={presentation.loading}
                className="aspect-video w-full rounded-md object-cover"
              />
            ) : (
              <span className="flex aspect-video w-full items-center justify-center rounded-md bg-muted text-xs">장면</span>
            )}
          </a>
          );
        })}
      </div>
    </section>
  );
}
