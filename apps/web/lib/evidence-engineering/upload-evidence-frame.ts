import { createHash } from "node:crypto";

import { buildStorageObjectKey } from "./frames";

const WEBP_KEY_PATTERN = /^[A-Za-z0-9_-]{11}\/\d+_[a-f0-9]{12}\.webp$/;

export interface EvidenceObjectStore {
  exists(key: string): Promise<boolean>;
  put(key: string, bytes: Uint8Array, contentType: "image/webp"): Promise<{ publicUrl: string | null }>;
}

export class EvidenceUploadError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "EvidenceUploadError";
    this.code = code;
  }
}

export function assertWebpBytes(bytes: Uint8Array): void {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 12) {
    throw new EvidenceUploadError("invalid_webp");
  }
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (riff !== "RIFF" || webp !== "WEBP") {
    throw new EvidenceUploadError("invalid_webp");
  }
}

export function uploadObjectKey(videoId: string, timestampMs: number, contentSha256: string): string {
  const key = buildStorageObjectKey(videoId, timestampMs, contentSha256);
  if (!WEBP_KEY_PATTERN.test(key) || key.endsWith(`/${timestampMs}.webp`)) {
    throw new EvidenceUploadError("invalid_storage_key");
  }
  return key;
}

export async function uploadEvidenceWebp(
  input: {
    videoId: string;
    timestampMs: number;
    contentSha256: string;
    bytes: Uint8Array;
  },
  store: EvidenceObjectStore,
): Promise<{ storageObjectKey: string; imageUrl: string | null }> {
  if (typeof window !== "undefined") {
    throw new EvidenceUploadError("storage_client_forbidden_in_browser");
  }
  assertWebpBytes(input.bytes);
  const actualHash = createHash("sha256").update(input.bytes).digest("hex");
  if (actualHash !== input.contentSha256) {
    throw new EvidenceUploadError("content_hash_mismatch");
  }
  const storageObjectKey = uploadObjectKey(input.videoId, input.timestampMs, input.contentSha256);
  if (await store.exists(storageObjectKey)) {
    throw new EvidenceUploadError("storage_key_collision");
  }
  const stored = await store.put(storageObjectKey, input.bytes, "image/webp");
  return {
    storageObjectKey,
    imageUrl: stored.publicUrl,
  };
}
