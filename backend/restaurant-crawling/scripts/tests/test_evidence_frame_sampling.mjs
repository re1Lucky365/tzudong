import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    assignFrameIdentity,
    reconcileFrameIdentities,
    sha256Hex,
} from '../evidence-frame-identity.mjs';
import {
    buildDecodeSampleArgs,
    buildEvidenceSamplingManifest,
    buildKeyframeProbeArgs,
    classifyProviderFetch,
    decideDownloadRetry,
    mayRetryProviderFetch,
    parseKeyframeProbeCsv,
    planEvidenceSamplingWindow,
    readProviderSignal,
    selectDecodeStartSec,
} from '../evidence-frame-sampling.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MODULE_PATH = path.resolve(__dirname, '../04-extract-frames-with-heatmap.js');
const DATA_ROOT = path.resolve(__dirname, '../../data');
const VIDEO_ID = 'abc123DEF45';

async function loadModule(envOverrides = {}) {
    const previousEnv = new Map();
    for (const [key, value] of Object.entries(envOverrides)) {
        previousEnv.set(key, process.env[key]);
        if (value === undefined || value === null) delete process.env[key];
        else process.env[key] = value;
    }
    try {
        return await import(`${pathToFileURL(MODULE_PATH).href}?evidence=${Date.now()}-${Math.random()}`);
    } finally {
        for (const [key, value] of previousEnv.entries()) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

function makeTempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('content hash and frame id stay separate and the same hash keeps one key prefix', () => {
    const bytes = Buffer.from('frame-bytes');
    const hash = sha256Hex(bytes);
    assert.equal(hash, '312455d41516810c40298ddafbfef41a18033eb058ac85e7348ed259d91ff832');
    const first = assignFrameIdentity({ videoId: VIDEO_ID, timestampMs: 7500, bytes });
    const second = assignFrameIdentity({ videoId: VIDEO_ID, timestampMs: 8000, bytes });
    assert.notEqual(first.frame_id, first.content_sha256);
    assert.equal(first.content_sha256, second.content_sha256);
    assert.equal(first.storage_object_key.endsWith(`_${hash.slice(0, 12)}.webp`), true);
    assert.equal(second.storage_object_key.endsWith(`_${hash.slice(0, 12)}.webp`), true);
    assert.notEqual(first.storage_object_key, second.storage_object_key);
    const sameText = assignFrameIdentity({
        videoId: VIDEO_ID,
        timestampMs: 7500,
        bytes,
        frameId: hash,
    });
    assert.equal(sameText.frame_id, hash);
    assert.equal(sameText.content_sha256, hash);
    assert.notEqual(Object.keys(sameText).filter((key) => key === 'frame_id' || key === 'content_sha256').length, 1);
    const reconciled = reconcileFrameIdentities([first, second]);
    assert.equal(reconciled.population.used_as_success_gate, false);
    assert.notEqual(reconciled.population.reconciled_count, 609);
    assert.throws(() => reconcileFrameIdentities([
        first,
        { ...first, content_sha256: 'a'.repeat(64) },
    ]), /FRAME_ID_HASH_CONFLICT/);
    assert.throws(() => reconcileFrameIdentities([first], { requirePopulationGate: true }), /FRAME_POPULATION_GATE_FORBIDDEN/);
});

test('evidence window is five seconds around the target and is not an I-frame rate', () => {
    assert.deepEqual(planEvidenceSamplingWindow(VIDEO_ID, 1_000), {
        video_id: VIDEO_ID,
        target_timestamp_ms: 1_000,
        window_start_ms: 0,
        window_end_ms: 6_000,
        sample_fps: 2,
        keyframe_role: 'decode_start_only',
        loads_full_video_in_node: false,
        i_frame_only_fps_guaranteed: false,
    });
    assert.equal(planEvidenceSamplingWindow(VIDEO_ID, 120_000).window_start_ms, 115_000);
    assert.throws(() => planEvidenceSamplingWindow(VIDEO_ID, -1), /FRAME_INVALID_TIMESTAMP/);
    assert.throws(() => planEvidenceSamplingWindow('short', 0), /FRAME_INVALID_VIDEO_ID/);
});

test('decode start is the latest keyframe at or before the window, and output sampling is fps=2', () => {
    assert.equal(selectDecodeStartSec([0, 4, 8.5, 12], 6), 4);
    assert.equal(selectDecodeStartSec([9, 11], 6), 6);
    assert.equal(selectDecodeStartSec([], 6), 6);
    assert.deepEqual(parseKeyframeProbeCsv('1.500000,1\n2.000000,0\n\nnot-a-time,1\n'), [1.5]);

    const probeArgs = buildKeyframeProbeArgs('/tmp/video.mp4', 1, 6);
    assert.equal(probeArgs.includes('-skip_frame'), true);
    assert.equal(probeArgs.at(-1), '/tmp/video.mp4');
    assert.equal(probeArgs.includes('-vf'), false);

    const sampleArgs = buildDecodeSampleArgs({
        videoPath: '/tmp/video.mp4',
        decodeStartSec: 4,
        durationSec: 6,
        fps: 2,
        outputPattern: '/tmp/out/frame_%d.webp',
        encodingArgs: ['-c:v', 'libwebp'],
    });
    assert.equal(sampleArgs.includes('-skip_frame'), false);
    assert.equal(sampleArgs.includes('--cookies'), false);
    assert.equal(sampleArgs[sampleArgs.indexOf('-vf') + 1], 'fps=2');
    assert.equal(sampleArgs[sampleArgs.indexOf('-ss') + 1], '4.000');
    assert.equal(sampleArgs.at(-1), '/tmp/out/frame_%d.webp');
    assert.throws(() => buildDecodeSampleArgs({
        videoPath: '/tmp/video.mp4',
        decodeStartSec: 0,
        durationSec: 1,
        fps: 2,
        outputPattern: '/tmp/out/frame_%d.webp',
        encodingArgs: ['-skip_frame', 'nokey'],
    }), /FRAME_SKIP_FRAME_OUTPUT_FORBIDDEN/);
});

test('provider auth blocks stop and temporary limits retry without reading a cookie', () => {
    assert.equal(classifyProviderFetch(200, false), 'accept');
    assert.equal(classifyProviderFetch(429, false), 'retry_later');
    assert.equal(classifyProviderFetch(503, false), 'retry_later');
    assert.equal(classifyProviderFetch(401, false), 'stop_source');
    assert.equal(classifyProviderFetch(403, false), 'stop_source');
    assert.equal(classifyProviderFetch(200, true), 'stop_source');
    assert.equal(classifyProviderFetch(429, true), 'stop_source');
    assert.deepEqual(readProviderSignal('ERROR: HTTP 403 Forbidden'), { status: 403, challenge: false });
    assert.equal(readProviderSignal('Sign in to confirm you’re not a bot').challenge, true);
    assert.equal(decideDownloadRetry(new Error('FRAME_PROCESS_TIMEOUT')), 'retry_later');
    const blocked = new Error('FRAME_PROCESS_EXIT_FAILED');
    blocked.providerStatus = 403;
    assert.equal(decideDownloadRetry(blocked), 'stop_source');
    const budget = {
        retryAfterSeconds: null,
        attemptsUsed: 0,
        maxAttempts: 2,
        circuitOpen: false,
        dailyRemaining: 1,
    };
    assert.equal(mayRetryProviderFetch('retry_later', budget), true);
    assert.equal(mayRetryProviderFetch('retry_later', { ...budget, dailyRemaining: 0 }), false);
    assert.equal(mayRetryProviderFetch('retry_later', { ...budget, dailyRemaining: 1.5 }), false);
    assert.equal(mayRetryProviderFetch('stop_source', budget), false);
});

test('download does not retry a temporary failure without a whole daily remaining count', async () => {
    const cacheDir = makeTempDir('evidence-cache-');
    const framesDir = makeTempDir('evidence-frames-');
    const outputDir = makeTempDir('evidence-output-');
    const { downloadVideo } = await loadModule({
        VIDEO_CACHE_DIR: cacheDir,
        FRAMES_ROOT_DIR: framesDir,
        GDRIVE_REMOTE_PATH: undefined,
        YT_DLP_MAX_RETRIES: '3',
    });
    const failLimited = async () => {
        const error = new Error('FRAME_PROCESS_EXIT_FAILED');
        error.code = 'FRAME_PROCESS_EXIT_FAILED';
        error.providerStatus = 429;
        error.providerChallenge = false;
        throw error;
    };
    let blockedCalls = 0;
    const blocked = await downloadVideo(VIDEO_ID, outputDir, '360p', {
        validateMediaPath: async () => true,
        runProcess: async () => {
            blockedCalls += 1;
            await failLimited();
        },
    });
    assert.equal(blocked, null);
    assert.equal(blockedCalls, 1);
    let allowedCalls = 0;
    const allowed = await downloadVideo(VIDEO_ID, outputDir, '360p', {
        validateMediaPath: async () => true,
        dailyRemaining: 1,
        runProcess: async () => {
            allowedCalls += 1;
            await failLimited();
        },
    });
    assert.equal(allowed, null);
    assert.equal(allowedCalls, 2);
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
});

test('manifest keeps the frame caption contract and records PTS separately from I-frame output', () => {
    const plan = planEvidenceSamplingWindow(VIDEO_ID, 125_500);
    const manifest = buildEvidenceSamplingManifest({
        videoId: VIDEO_ID,
        recollectId: 3,
        rank: 1,
        plan,
        decodeStartSec: 120.5,
        fileNames: ['120.50.webp', '121.00.webp'],
        framePts: [
            { file_name: '120.50.webp', pts_sec: 120.5 },
            { file_name: '121.00.webp', pts_sec: 121 },
        ],
    });
    assert.equal(manifest.frame_count, manifest.file_names.length);
    assert.equal(manifest.video_id, VIDEO_ID);
    assert.equal(manifest.recollect_id, 3);
    assert.equal(manifest.start_sec, 120.5);
    assert.equal(manifest.end_sec, 130.5);
    assert.equal(manifest.rank, 1);
    assert.equal(manifest.sample_fps, 2);
    assert.equal(manifest.output_uses_skip_frame, false);
    assert.equal(manifest.loads_full_video_in_node, false);
    assert.throws(() => buildEvidenceSamplingManifest({
        videoId: VIDEO_ID,
        recollectId: 3,
        rank: 1,
        plan,
        decodeStartSec: 1,
        fileNames: ['a.webp'],
        framePts: [],
    }), /FRAME_MANIFEST_MISMATCH/);
});

test('download stops on an auth status instead of retrying', async () => {
    const cacheDir = makeTempDir('evidence-cache-');
    const framesDir = makeTempDir('evidence-frames-');
    const outputDir = makeTempDir('evidence-output-');
    const { downloadVideo } = await loadModule({
        VIDEO_CACHE_DIR: cacheDir,
        FRAMES_ROOT_DIR: framesDir,
        GDRIVE_REMOTE_PATH: undefined,
        YT_DLP_MAX_RETRIES: '3',
    });
    let calls = 0;
    const selected = await downloadVideo(VIDEO_ID, outputDir, '360p', {
        validateMediaPath: async () => true,
        runProcess: async () => {
            calls += 1;
            const error = new Error('FRAME_PROCESS_EXIT_FAILED');
            error.code = 'FRAME_PROCESS_EXIT_FAILED';
            error.providerStatus = 403;
            error.providerChallenge = false;
            throw error;
        },
    });
    assert.equal(selected, null);
    assert.equal(calls, 1);
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
});

test('heatmap extraction seeks to the probed keyframe and then samples with the fps filter', async () => {
    const cacheDir = makeTempDir('evidence-cache-');
    const framesDir = makeTempDir('evidence-frames-');
    const outputDir = makeTempDir('evidence-output-');
    const videoPath = path.join(outputDir, `${VIDEO_ID}.mp4`);
    fs.writeFileSync(videoPath, 'not-a-real-video');
    const { extractFrames } = await loadModule({
        VIDEO_CACHE_DIR: cacheDir,
        FRAMES_ROOT_DIR: framesDir,
    });
    const commands = [];
    const summary = await extractFrames(
        videoPath,
        [{ startSec: 10, endSec: 12 }],
        outputDir,
        '360p',
        1,
        0,
        'webp',
        {
            ffmpegPath: 'ffmpeg',
            ffprobePath: 'ffprobe',
            probeKeyframes: async () => [8],
            runProcess: async (_file, args) => {
                commands.push(args);
                if (args.includes('format=duration')) return { stdout: '40\n', stderr: '' };
                const pattern = args.at(-1);
                fs.writeFileSync(String(pattern).replace('%d', '1'), 'frame');
                return { stdout: '', stderr: '' };
            },
        },
    );
    assert.equal(summary.failedSegments, 0);
    assert.equal(summary.totalFrames, 1);
    const ffmpegArgs = commands.find((args) => args.includes('-vf'));
    assert.equal(ffmpegArgs.includes('-skip_frame'), false);
    assert.equal(ffmpegArgs[ffmpegArgs.indexOf('-ss') + 1], '8.000');
    assert.equal(ffmpegArgs[ffmpegArgs.indexOf('-vf') + 1], 'fps=1');
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
});

test('processSingleVideo writes a 2fps evidence manifest from the local file without loading it', async () => {
    const cacheDir = makeTempDir('evidence-cache-');
    const framesDir = makeTempDir('evidence-frames-');
    const channel = `evidence-sample-${Date.now()}`;
    const channelDir = path.join(DATA_ROOT, channel);
    fs.mkdirSync(channelDir, { recursive: true });
    const videoPath = path.join(cacheDir, `${VIDEO_ID}.mp4`);
    fs.writeFileSync(videoPath, 'local-container');
    let videoBytesRead = 0;
    const originalReadFileSync = fs.readFileSync;
    fs.readFileSync = (...args) => {
        if (args[0] === videoPath) videoBytesRead += 1;
        return originalReadFileSync(...args);
    };

    const { processSingleVideo } = await loadModule({
        VIDEO_CACHE_DIR: cacheDir,
        FRAMES_ROOT_DIR: framesDir,
        GDRIVE_REMOTE_PATH: undefined,
    });
    const ffmpegArgs = [];
    try {
        await processSingleVideo(
            VIDEO_ID,
            {
                channel,
                fps: 1,
                buffer: 0,
                quality: ['360p'],
                ext: ['jpg'],
                url: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
            },
            {
                loadSegments: async () => [{ startSec: 10, endSec: 20, peakSec: 12.5 }],
                acquireVideo: async () => videoPath,
                extractFramesFn: async () => ({ totalSegments: 1, failedSegments: 0, totalFrames: 1 }),
                ffmpegPath: 'ffmpeg',
                ffprobePath: 'ffprobe',
                probeKeyframes: async () => [7],
                runProcess: async (_file, args) => {
                    ffmpegArgs.push(args);
                    const pattern = args.at(-1);
                    fs.writeFileSync(String(pattern).replace('%d', '1'), 'frame');
                    fs.writeFileSync(String(pattern).replace('%d', '2'), 'frame');
                    return { stdout: '', stderr: '' };
                },
            },
        );
        const manifestPath = path.join(framesDir, VIDEO_ID, '0', 'evidence-w001', '1', 'sampling-manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        assert.equal(manifest.video_id, VIDEO_ID);
        assert.equal(manifest.recollect_id, 0);
        assert.equal(manifest.rank, 1);
        assert.equal(manifest.start_sec, 7.5);
        assert.equal(manifest.end_sec, 17.5);
        assert.equal(manifest.sample_fps, 2);
        assert.equal(manifest.frame_count, manifest.file_names.length);
        assert.equal(manifest.frame_count, 2);
        assert.equal(manifest.decode_start_sec, 7);
        assert.equal(manifest.loads_full_video_in_node, false);
        assert.equal(manifest.output_uses_skip_frame, false);
        assert.notEqual(manifest.frame_identities[0].frame_id, manifest.frame_identities[0].content_sha256);
        assert.equal(
            manifest.frame_identities[0].storage_object_key.includes(manifest.frame_identities[0].content_sha256.slice(0, 12)),
            true,
        );
        assert.equal(ffmpegArgs[0].includes('-skip_frame'), false);
        assert.equal(ffmpegArgs[0][ffmpegArgs[0].indexOf('-vf') + 1], 'fps=2');
        assert.equal(videoBytesRead, 0);
    } finally {
        fs.readFileSync = originalReadFileSync;
        fs.rmSync(cacheDir, { recursive: true, force: true });
        fs.rmSync(framesDir, { recursive: true, force: true });
        fs.rmSync(channelDir, { recursive: true, force: true });
    }
});
