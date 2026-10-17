const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export const EVIDENCE_EXTRACTOR_VERSION = 'w001-decode-after-keyframe';
export const EVIDENCE_SAMPLE_FPS = 2;
export const EVIDENCE_WINDOW_MS = 5_000;
export const KEYFRAME_LOOKBACK_SEC = 10;

function fail(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

export function planEvidenceSamplingWindow(videoId, targetTimestampMs) {
    if (typeof videoId !== 'string' || !VIDEO_ID_RE.test(videoId)) {
        throw fail('FRAME_INVALID_VIDEO_ID');
    }
    if (!Number.isSafeInteger(targetTimestampMs) || targetTimestampMs < 0) {
        throw fail('FRAME_INVALID_TIMESTAMP');
    }
    return {
        video_id: videoId,
        target_timestamp_ms: targetTimestampMs,
        window_start_ms: Math.max(0, targetTimestampMs - EVIDENCE_WINDOW_MS),
        window_end_ms: targetTimestampMs + EVIDENCE_WINDOW_MS,
        sample_fps: EVIDENCE_SAMPLE_FPS,
        keyframe_role: 'decode_start_only',
        loads_full_video_in_node: false,
        i_frame_only_fps_guaranteed: false,
    };
}

export function parseKeyframeProbeCsv(text) {
    if (typeof text !== 'string' || text.length === 0) return [];
    const times = [];
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const [timeText, keyText] = trimmed.split(',');
        const time = Number(timeText);
        if (!Number.isFinite(time) || time < 0) continue;
        if (keyText !== undefined && keyText.trim() !== '' && keyText.trim() !== '1') continue;
        times.push(time);
    }
    return times;
}

export function selectDecodeStartSec(keyframeTimesSec, windowStartSec) {
    if (!Number.isFinite(windowStartSec) || windowStartSec < 0) {
        throw fail('FRAME_INVALID_TIMESTAMP');
    }
    if (!Array.isArray(keyframeTimesSec)) return windowStartSec;
    let decodeStart = windowStartSec;
    let found = false;
    for (const time of keyframeTimesSec) {
        if (!Number.isFinite(time) || time < 0 || time > windowStartSec) continue;
        if (!found || time > decodeStart) {
            decodeStart = time;
            found = true;
        }
    }
    return found ? decodeStart : windowStartSec;
}

export function buildKeyframeProbeArgs(videoPath, startSec, endSec) {
    if (typeof videoPath !== 'string' || videoPath.length === 0) {
        throw fail('FRAME_INVALID_VIDEO_PATH');
    }
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec < startSec) {
        throw fail('FRAME_INVALID_TIMESTAMP');
    }
    return [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-skip_frame', 'nokey',
        '-read_intervals', `${startSec}%${endSec}`,
        '-show_frames',
        '-show_entries', 'frame=best_effort_timestamp_time,key_frame',
        '-of', 'csv=p=0',
        videoPath,
    ];
}

export function buildDecodeSampleArgs({
    videoPath,
    decodeStartSec,
    durationSec,
    fps,
    outputPattern,
    encodingArgs = [],
}) {
    if (typeof videoPath !== 'string' || videoPath.length === 0 || typeof outputPattern !== 'string' || outputPattern.length === 0) {
        throw fail('FRAME_INVALID_VIDEO_PATH');
    }
    if (!Number.isFinite(decodeStartSec) || decodeStartSec < 0 || !Number.isFinite(durationSec) || durationSec <= 0) {
        throw fail('FRAME_INVALID_TIMESTAMP');
    }
    if (!Number.isFinite(fps) || fps !== EVIDENCE_SAMPLE_FPS) {
        throw fail('FRAME_INVALID_SAMPLE_FPS');
    }
    if (!Array.isArray(encodingArgs) || encodingArgs.some((arg) => arg === '-skip_frame' || arg === 'nokey')) {
        throw fail('FRAME_SKIP_FRAME_OUTPUT_FORBIDDEN');
    }
    const args = [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-ss', decodeStartSec.toFixed(3),
        '-t', durationSec.toFixed(3),
        '-i', videoPath,
        '-vf', `fps=${EVIDENCE_SAMPLE_FPS}`,
        ...encodingArgs,
        '-frame_pts', '1',
        outputPattern,
    ];
    if (args.includes('-skip_frame') || args.includes('--cookies') || args.includes('-cookies')) {
        throw fail('FRAME_SKIP_FRAME_OUTPUT_FORBIDDEN');
    }
    return args;
}

export function buildHeatmapDecodeArgs({
    videoPath,
    decodeStartSec,
    durationSec,
    fps,
    outputPattern,
    encodingArgs = [],
}) {
    if (!Number.isFinite(fps) || fps <= 0 || fps > 120) {
        throw fail('FRAME_INVALID_EXTRACTION_OPTIONS');
    }
    const evidenceShaped = buildDecodeSampleArgs({
        videoPath,
        decodeStartSec,
        durationSec,
        fps: EVIDENCE_SAMPLE_FPS,
        outputPattern,
        encodingArgs,
    });
    return evidenceShaped.map((arg) => (arg === `fps=${EVIDENCE_SAMPLE_FPS}` ? `fps=${fps}` : arg));
}

export function classifyProviderFetch(status, challenge) {
    if (challenge || status === 401 || status === 403) return 'stop_source';
    if (status === 429 || (Number.isInteger(status) && status >= 500 && status <= 599)) return 'retry_later';
    if (Number.isInteger(status) && status >= 200 && status < 300) return 'accept';
    return 'stop_source';
}

export function readProviderSignal(text) {
    if (typeof text !== 'string' || text.length === 0) return null;
    const challenge = /sign in to confirm|login_required|botguard/i.test(text);
    const explicit = text.match(/\bHTTP(?:\/\d(?:\.\d)?)?\s+(401|403|429|5\d\d)\b/i);
    if (!challenge && !explicit) return null;
    return {
        status: explicit ? Number(explicit[1]) : 0,
        challenge,
    };
}

export function decideDownloadRetry(error) {
    if (!error?.providerChallenge && typeof error?.providerStatus !== 'number') {
        return 'retry_later';
    }
    return classifyProviderFetch(error.providerStatus ?? 0, Boolean(error.providerChallenge));
}

export function mayRetryProviderFetch(decision, budget) {
    if (decision !== 'retry_later') return false;
    if (!budget || budget.circuitOpen) return false;
    if (!Number.isSafeInteger(budget.attemptsUsed) || budget.attemptsUsed < 0) return false;
    if (!Number.isSafeInteger(budget.maxAttempts) || budget.maxAttempts < 0) return false;
    if (budget.attemptsUsed >= budget.maxAttempts) return false;
    if (budget.retryAfterSeconds !== null) {
        if (!Number.isFinite(budget.retryAfterSeconds) || budget.retryAfterSeconds < 0) return false;
    }
    if (!Number.isSafeInteger(budget.dailyRemaining) || budget.dailyRemaining < 1) return false;
    return true;
}

export function buildEvidenceSamplingManifest({
    videoId,
    recollectId,
    rank,
    plan,
    decodeStartSec,
    fileNames,
    framePts,
}) {
    if (!Array.isArray(fileNames) || !Array.isArray(framePts) || fileNames.length !== framePts.length) {
        throw fail('FRAME_MANIFEST_MISMATCH');
    }
    return {
        video_id: videoId,
        recollect_id: recollectId,
        start_sec: plan.window_start_ms / 1000,
        end_sec: plan.window_end_ms / 1000,
        rank,
        file_names: fileNames,
        frame_count: fileNames.length,
        extractor_version: EVIDENCE_EXTRACTOR_VERSION,
        sample_fps: plan.sample_fps,
        keyframe_role: plan.keyframe_role,
        decode_start_sec: decodeStartSec,
        frame_pts: framePts,
        loads_full_video_in_node: false,
        i_frame_only_fps_guaranteed: false,
        output_uses_skip_frame: false,
        extraction_settings: {
            window_ms: EVIDENCE_WINDOW_MS,
            keyframe_lookback_sec: KEYFRAME_LOOKBACK_SEC,
            video_filter: `fps=${EVIDENCE_SAMPLE_FPS}`,
        },
    };
}
