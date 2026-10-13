import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertNewArtifactPath,
  buildSourceBinding,
  createOneShotGate,
  hashPublicConfiguration,
  parseLiveVerificationArguments,
  prepareEvidenceDirectory,
  readPackageVersion,
  readSecureOperatorEnv,
  reserveJsonReceipt,
  sha256,
} from './gemini-live-verification-io';
import {
  assertExpectedModelIdentity,
  createOcrGeminiLiveAttemptState,
  invokeAdmittedGeneration,
  isGenerationDeliveryUnknown,
  recordGenerationCallStarted,
  recordModelMetadataRequest,
} from './ocr-gemini-live-attempt';

// One provider generation attempt, synthetic text only, no raw OCR/image/credential output.
const cli = parseLiveVerificationArguments(process.argv.slice(2), {
  allowCurrentCandidate: true,
  defaultOutputSubdirectory: 'ui-renewal-20261003',
});
const receiptPath = resolve(cli.outputDirectory, 'ocr-live-readback.json');
// Preserve an earlier receipt even when the operator env is now unavailable.
assertNewArtifactPath(receiptPath);

const envText = readSecureOperatorEnv(cli.envFile);
const { parse } = await import('dotenv');
const source = parse(envText);
const production = '/Users/twoimo/.codex/runtime-cache/tzudong-release-20261003/production-after.env';
// A dated operating snapshot is historical evidence, not current configuration.
// The explicit candidate mode binds the existing vault copy and current defaults.
const config = cli.currentCandidate
  ? source
  : existsSync(production)
    ? parse(readSecureOperatorEnv(production))
    : {};

const credentialNames = [
  'GEMINI_CREDITS_API_KEY',
  'GEMINI_OCR_API_KEY',
  'GEMINI_API_KEY',
  'GEMINI_OCR_YEON',
  'STORYBOARD_AGENT_GEMINI_API_KEY',
  'GEMINI_API_KEY_BYEON',
  'GOOGLE_API_KEY',
] as const;
const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
for (const name of credentialNames) {
  if (source[name]) env[name] = source[name];
}
for (const name of ['GEMINI_OCR_MODEL', 'GEMINI_OCR_DEFAULT_MODEL', 'GEMINI_OCR_THINKING_LEVEL', 'GEMINI_THINKING_LEVEL'] as const) {
  if (config[name]) env[name] = config[name];
}

const [ocr, runtimeConfig, promptModule, sdk] = await Promise.all([
  import('../lib/ocr/gemini'),
  import('../lib/ocr/runtime-config'),
  import('../lib/ocr/receipt-prompt'),
  import('@google/genai'),
]);
const runtime = await runtimeConfig.resolveOcrAiRuntimeConfig(env);
const credential = runtime.credentialCandidates[0];
if (!credential) throw new Error('ocr_server_key_required');
if (runtime.provider !== 'gemini' || runtime.models.length !== 1) throw new Error('single_attempt_configuration_required');
const models = runtime.models;
const thinkingLevel = ocr.getGeminiOcrThinkingLevel(env);
const publicConfiguration = { models, thinkingLevel, sdkAttempts: 1, timeoutMs: 12_000 };

prepareEvidenceDirectory(cli.outputDirectory);
const sourceBinding = buildSourceBinding([
  'lib/ocr/gemini.ts',
  'lib/ocr/receipt-prompt.ts',
  'lib/ocr/runtime-config.ts',
  'package-lock.json',
  'scripts/gemini-live-verification-io.ts',
  'scripts/ocr-gemini-live-attempt.ts',
  'scripts/verify-ocr-gemini-live.ts',
]);
const report: Record<string, unknown> = {
  kind: 'live-synthetic-ocr-readback',
  measuredAt: new Date().toISOString(),
  models,
  syntheticInput: true,
  operationalDatabaseWrites: 0,
  maximumGenerationCalls: 1,
  generationCallsStarted: 0,
  generationRequestsAdmitted: 0,
  providerRequestsStarted: 0,
  sdkAttempts: 1,
  environment: { sdk: readPackageVersion('node_modules/@google/genai/package.json') },
  configurationSource: cli.currentCandidate ? 'current-candidate-and-existing-vault-copy' : 'historical-operating-snapshot',
  credentialSourceName: credential.sourceName ?? null,
  configuration: publicConfiguration,
  configurationSha256: hashPublicConfiguration(publicConfiguration),
  sourceBinding,
  sampleCount: 1,
  confidenceInterval95: null,
  pending: 'reserved',
  limits: [
    'Single synthetic receipt only; no general accuracy or speed comparison.',
    'Candidate helper call only; no Auth/quota/DB/browser operating flow.',
    'No deployment or billing receipt.',
  ],
};
const receipt = reserveJsonReceipt(receiptPath, report);
const save = () => receipt.write(report);
const attempt = createOcrGeminiLiveAttemptState();
const persistAttempt = (next: Readonly<typeof attempt>) => {
  report.generationCallsStarted = next.generationCallsStarted;
  report.generationRequestsAdmitted = next.generationRequestsAdmitted;
  report.providerRequestsStarted = next.providerRequestsStarted;
  save();
};

try {
  const provider = new sdk.GoogleGenAI({
    apiKey: credential.apiKey,
    httpOptions: { retryOptions: { attempts: 1 }, timeout: 12_000 },
  });
  report.pending = 'model-readiness';
  recordModelMetadataRequest(attempt, persistAttempt);
  // Metadata readiness is separate from the bounded generation call.
  const metadata = await provider.models.get({ model: models[0], config: { httpOptions: { timeout: 12_000 } } });
  assertExpectedModelIdentity(metadata.name, models[0]);

  const text = [
    'Synthetic Noodle Shop',
    '2026-10-03 12:34',
    'Noodles   10000 KRW',
    'Tea        2000 KRW',
    'TOTAL     12000 KRW',
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="620"><rect width="900" height="620" fill="white"/>${text.map((value, index) => `<text x="55" y="${90 + index * 95}" fill="black" font-family="sans-serif" font-size="42">${value}</text>`).join('')}</svg>`;
  const { default: sharp } = await import('sharp');
  const image = await sharp(Buffer.from(svg)).png().toBuffer();
  report.inputSha256 = sha256(image);
  report.pending = 'provider-generation';
  recordGenerationCallStarted(attempt, persistAttempt);

  const start = performance.now();
  const enterGenerationCallback = createOneShotGate();
  const result = await ocr.callGeminiReceiptOcr({
    apiKey: credential.apiKey,
    imageBase64: image.toString('base64'),
    mimeType: 'image/png',
    prompt: promptModule.RECEIPT_OCR_EXTRACTION_PROMPT,
    env,
    generateContentImpl: async (input) => {
      enterGenerationCallback();
      const response = await invokeAdmittedGeneration(attempt, persistAttempt, () => (
        provider.models.generateContent(ocr.buildGeminiReceiptOcrRequest({ ...input, timeoutMs: 12_000 }))
      ));
      report.responseModel = response.modelVersion ?? null;
      const usage = response.usageMetadata;
      report.usage = {
        promptTokens: usage?.promptTokenCount ?? null,
        outputTokens: usage?.candidatesTokenCount ?? null,
        thoughtTokens: usage?.thoughtsTokenCount ?? null,
        totalTokens: usage?.totalTokenCount ?? null,
      };
      return response.text ?? '';
    },
  });
  report.elapsedMs = performance.now() - start;
  const items = result.data.items ?? [];
  const responseModel = String(report.responseModel ?? '').replace(/^models\//, '');
  const revisionPrefix = `${models[0]}-`;
  report.matches = {
    model: responseModel === models[0]
      || (responseModel.startsWith(revisionPrefix) && /^(?:\d{3}|\d{2}-\d{2})$/.test(responseModel.slice(revisionPrefix.length))),
    store: result.data.store_name === 'Synthetic Noodle Shop',
    date: result.data.date === '2026-10-03',
    time: result.data.time === '12:34',
    total: result.data.total_amount === 12000,
    items: items.length === 2
      && items.some((item) => item.name === 'Noodles' && item.price === 10000)
      && items.some((item) => item.name === 'Tea' && item.price === 2000),
    arithmetic: items.every((item) => typeof item.price === 'number')
      && items.reduce((sum, item) => sum + (item.price ?? 0), 0) === result.data.total_amount,
  };
  report.outputSha256 = sha256(JSON.stringify(result.data));
  report.pending = null;
  report.passed = Object.values(report.matches as Record<string, boolean>).every(Boolean);
  save();
  console.log(JSON.stringify({
    passed: report.passed,
    model: report.responseModel,
    elapsedMs: report.elapsedMs,
    matches: report.matches,
    usage: report.usage,
    generationCallsStarted: attempt.generationCallsStarted,
    generationRequestsAdmitted: attempt.generationRequestsAdmitted,
    providerRequestsStarted: attempt.providerRequestsStarted,
  }));
  if (!report.passed) process.exitCode = 1;
} catch {
  report.passed = false;
  report.generationCallsStarted = attempt.generationCallsStarted;
  report.generationRequestsAdmitted = attempt.generationRequestsAdmitted;
  report.providerRequestsStarted = attempt.providerRequestsStarted;
  report.code = 'ocr_live_verification_failed';
  report.deliveryUnknown = isGenerationDeliveryUnknown(attempt);
  save();
  console.log(JSON.stringify({
    passed: false,
    code: report.code,
    generationCallsStarted: attempt.generationCallsStarted,
    generationRequestsAdmitted: attempt.generationRequestsAdmitted,
    providerRequestsStarted: attempt.providerRequestsStarted,
    deliveryUnknown: isGenerationDeliveryUnknown(attempt),
  }));
  process.exitCode = 1;
} finally {
  receipt.close();
}
