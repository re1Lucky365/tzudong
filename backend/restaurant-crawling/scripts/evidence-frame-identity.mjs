import { createHash } from 'node:crypto';

import { formatStorageObjectKey } from '../../../apps/web/lib/evidence-engineering/storage-key.mjs';

const FRAME_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function fail(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

export function sha256Hex(bytes) {
    if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
        throw fail('FRAME_INVALID_BYTES');
    }
    return createHash('sha256').update(bytes).digest('hex');
}

export function assignFrameIdentity({ videoId, timestampMs, bytes, frameId }) {
    if (typeof videoId !== 'string' || !VIDEO_ID_RE.test(videoId)) {
        throw fail('FRAME_INVALID_VIDEO_ID');
    }
    if (!Number.isSafeInteger(timestampMs) || timestampMs < 0) {
        throw fail('FRAME_INVALID_TIMESTAMP');
    }
    const contentSha256 = sha256Hex(bytes);
    if (!SHA256_RE.test(contentSha256)) {
        throw fail('FRAME_INVALID_CONTENT_SHA256');
    }
    const assignedId = frameId ?? `frm_${timestampMs}_${contentSha256.slice(0, 12)}`;
    if (typeof assignedId !== 'string' || !FRAME_ID_RE.test(assignedId)) {
        throw fail('FRAME_INVALID_FRAME_ID');
    }
    return {
        frame_id: assignedId,
        content_sha256: contentSha256,
        video_id: videoId,
        timestamp_ms: timestampMs,
        storage_object_key: formatStorageObjectKey(videoId, timestampMs, contentSha256),
    };
}

export function reconcileFrameIdentities(records, options = {}) {
    if (!Array.isArray(records)) throw fail('FRAME_INVALID_LEDGER');
    if (options.requirePopulationGate === true) throw fail('FRAME_POPULATION_GATE_FORBIDDEN');
    const byId = new Map();
    const byKey = new Map();
    for (const record of records) {
        if (!record || typeof record.frame_id !== 'string' || typeof record.content_sha256 !== 'string') {
            throw fail('FRAME_INVALID_LEDGER');
        }
        const previous = byId.get(record.frame_id);
        if (previous && previous.content_sha256 !== record.content_sha256) {
            throw fail('FRAME_ID_HASH_CONFLICT');
        }
        const keyOwner = byKey.get(record.storage_object_key);
        if (keyOwner && keyOwner.frame_id !== record.frame_id) {
            throw fail('FRAME_STORAGE_KEY_COLLISION');
        }
        if (!previous) byId.set(record.frame_id, record);
        if (!keyOwner) byKey.set(record.storage_object_key, record);
    }
    return {
        records: [...byId.values()],
        population: {
            reviewed_frame_claim: 609,
            restaurant_row_claim: 763,
            video_claim: 663,
            used_as_success_gate: false,
            reconciled_count: byId.size,
        },
    };
}
