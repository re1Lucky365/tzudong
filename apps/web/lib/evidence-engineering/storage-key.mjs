export const STORAGE_HASH_PREFIX_LENGTH = 12;

export function formatStorageObjectKey(videoId, timestampMs, contentSha256) {
    return `${videoId}/${timestampMs}_${contentSha256.slice(0, STORAGE_HASH_PREFIX_LENGTH)}.webp`;
}
