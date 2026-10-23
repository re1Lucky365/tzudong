import { z } from 'zod';

export const thumbnailUuid = z.uuid().transform((value) => value.toLowerCase());
export const thumbnailHash = z.string().regex(/^[a-f0-9]{64}$/);
export const thumbnailModel = z.enum(['gemini-3.1-flash-image', 'gemini-3-pro-image']);
export const thumbnailMime = z.enum(['image/png', 'image/jpeg', 'image/webp']);
export const thumbnailRole = z.enum(['host', 'food', 'object', 'person', 'other']);
export const THUMBNAIL_PRIVATE_BUCKET = 'youtube-thumbnail-jobs';
export const THUMBNAIL_IMAGE_BYTES = 12 * 1024 * 1024;
export const THUMBNAIL_REFERENCE_BYTES = 8 * 1024 * 1024;
export const thumbnailBrief = z.object({
  topic: z.string().trim().min(1).max(400), headline: z.string().trim().min(1).max(80),
  subHeadline: z.string().trim().max(120).optional(), acknowledgedSafety: z.literal(true),
  stylePreset: z.enum(['tzuyang-food-travel-collage', 'night-market-reaction', 'convenience-store-haul',
    'grilled-meat-feast', 'sushi-seafood-table']),
}).strict();
export const thumbnailEnqueue = z.object({ requestId: thumbnailUuid, model: thumbnailModel,
  brief: thumbnailBrief, roles: z.array(thumbnailRole).max(8) }).strict();
const dimensions = { width: z.number().int().min(1).max(16_000_000), height: z.number().int().min(1).max(16_000_000) };
export const thumbnailAsset = z.object({ path: z.string().max(256), sha256: thumbnailHash,
  mimeType: thumbnailMime, bytes: z.number().int().min(16).max(THUMBNAIL_IMAGE_BYTES), ...dimensions }).strict()
  .refine((asset) => asset.width * asset.height <= 16_000_000);
export const thumbnailProvenance = z.object({ providerId: z.literal('gemini-api'), model: thumbnailModel,
  responseModel: z.string().max(100), responseId: z.string().min(1).max(256).nullable(),
  verification: z.literal('official-api'), modelEvidence: z.literal('response'),
  generatedAt: z.iso.datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/), attemptId: thumbnailUuid, inputSha256: thumbnailHash,
}).strict().refine((proof) => proof.responseModel === proof.model
  || new RegExp(`^${proof.model.replaceAll('.', '\\.')}-(?:[0-9]{3}|[0-9]{2}-[0-9]{2})$`).test(proof.responseModel));
export const thumbnailResult = z.object({ original: thumbnailAsset, normalized: thumbnailAsset,
  provenance: thumbnailProvenance }).strict().refine((result) => result.normalized.mimeType === 'image/png'
    && result.normalized.width === 1280 && result.normalized.height === 720);
const reference = z.object({ path: z.string().max(256), sha256: thumbnailHash, mimeType: thumbnailMime,
  bytes: z.number().int().min(16).max(THUMBNAIL_REFERENCE_BYTES), role: thumbnailRole }).strict();
export const thumbnailInput = z.object({ contract: z.literal('thumbnail-gemini-image-v1'), model: thumbnailModel,
  prompt: z.string().min(1).refine((value) => Boolean(value.trim()) && new TextEncoder().encode(value).length <= 65_536),
  references: z.array(reference).max(8) }).strict()
  .refine((input) => input.references.reduce((total, ref) => total + ref.bytes, 0) <= 16 * 1024 * 1024);
export const thumbnailState = z.enum(['queued', 'claimed', 'provider_started', 'unknown', 'succeeded', 'cancelled']);
const time = z.iso.datetime({ offset: true });
export const thumbnailJob = z.object({ id: thumbnailUuid, ownerId: thumbnailUuid, requestId: thumbnailUuid,
  inputSha256: thumbnailHash, model: thumbnailModel, input: thumbnailInput, state: thumbnailState,
  workerId: thumbnailUuid.nullable(), attemptId: thumbnailUuid.nullable(), fence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  leaseExpiresAt: time.nullable(), providerStartedAt: time.nullable(), cancelRequested: z.boolean(),
  result: thumbnailResult.nullable(), createdAt: time, updatedAt: time }).strict().superRefine((job, ctx) => {
  const leased = ['claimed', 'provider_started'].includes(job.state);
  const assigned = ['claimed', 'provider_started', 'unknown', 'succeeded'].includes(job.state);
  const started = ['provider_started', 'unknown', 'succeeded'].includes(job.state);
  const valid = job.model === job.input.model && leased === Boolean(job.leaseExpiresAt)
    && assigned === Boolean(job.workerId) && assigned === Boolean(job.attemptId)
    && started === Boolean(job.providerStartedAt) && (job.state === 'succeeded') === Boolean(job.result)
    && (!assigned || job.fence > 0)
    && job.input.references.every((ref, index) => ref.path === inputPath(job.ownerId, job.requestId, index, ref.sha256, ref.mimeType))
    && (!job.result || validResultIdentity(job, job.result));
  if (!valid) ctx.addIssue({ code: 'custom', message: 'invalid_job' });
});
export const thumbnailSummary = z.object({ id: thumbnailUuid, requestId: thumbnailUuid, model: thumbnailModel,
  state: thumbnailState, cancelRequested: z.boolean(), createdAt: time, updatedAt: time }).strict();
export const thumbnailWorker = z.object({ id: thumbnailUuid, ownerId: thumbnailUuid,
  models: z.array(thumbnailModel).max(2).refine((models) => new Set(models).size === models.length) }).strict();
export const thumbnailAttempt = z.object({ jobId: thumbnailUuid, attemptId: thumbnailUuid,
  fence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), inputSha256: thumbnailHash }).strict();
export const thumbnailStartReceipt = thumbnailAttempt.extend({ ownerId: thumbnailUuid, providerId: z.literal('gemini-api'),
  model: thumbnailModel, state: z.literal('provider_started'), permission: z.literal('fresh-commit') }).strict();
export type ThumbnailJob = z.infer<typeof thumbnailJob>;
export type ThumbnailResult = z.infer<typeof thumbnailResult>;
export type ThumbnailWorker = z.infer<typeof thumbnailWorker>;
export type ThumbnailAttempt = z.infer<typeof thumbnailAttempt>;
export type ThumbnailInput = z.infer<typeof thumbnailInput>;
export const THUMBNAIL_FAILURES = {
  invalid_request: 400, request_too_large: 413, origin_forbidden: 403, owner_forbidden: 403,
  worker_unauthorized: 401, job_not_found: 404, request_conflict: 409, input_already_active: 409,
  attempt_conflict: 409, lease_lost: 409, cancelled: 409, result_conflict: 409, object_conflict: 409,
  invalid_result: 400, model_not_available: 409, invalid_models: 400, invalid_action: 400,
  start_not_confirmed: 409, worker_lease_lost: 409,
  unsupported_isolation: 503, persistence_unavailable: 503, storage_unavailable: 503, write_unconfirmed: 503,
} as const;
export class ThumbnailQueueError extends Error {
  constructor(readonly code: keyof typeof THUMBNAIL_FAILURES) { super(code); this.name = 'ThumbnailQueueError'; }
}
export function parseThumbnail<T>(schema: z.ZodType<T>, value: unknown, code: keyof typeof THUMBNAIL_FAILURES = 'invalid_request'): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ThumbnailQueueError(code);
  return parsed.data;
}
export function extension(mime: z.infer<typeof thumbnailMime>) { return mime === 'image/jpeg' ? 'jpeg' : mime.split('/')[1]; }
export function inputPath(owner: string, request: string, index: number, hash: string, mime: z.infer<typeof thumbnailMime>) {
  return `${owner}/${request}/input/${index}-${hash}.${extension(mime)}`;
}
export function resultPrefix(job: Pick<ThumbnailJob, 'ownerId' | 'id' | 'attemptId'>) {
  return `${job.ownerId}/${job.id}/${job.attemptId}/`;
}
export function validResultIdentity(job: Pick<ThumbnailJob, 'ownerId' | 'id' | 'attemptId' | 'model' | 'inputSha256'>, result: ThumbnailResult) {
  return result.original.path === `${resultPrefix(job)}original.${extension(result.original.mimeType)}`
    && result.normalized.path === `${resultPrefix(job)}normalized.png`
    && result.provenance.attemptId === job.attemptId && result.provenance.inputSha256 === job.inputSha256
    && result.provenance.model === job.model;
}
