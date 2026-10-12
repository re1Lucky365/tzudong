import { expect, test } from 'bun:test';
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  assertOpenFileMatchesPath,
  buildSourceBinding,
  createOneShotGate,
  hashPublicConfiguration,
  parseLiveVerificationArguments,
  prepareEvidenceDirectory,
  readSecureOperatorEnv,
  reserveJsonReceipt,
  sha256,
  openVerifiedDirectory,
  writeExclusiveArtifact,
  writeExclusiveArtifactInVerifiedDirectory,
} from '../scripts/gemini-live-verification-io';
import { resolveOcrAiRuntimeConfig } from '../lib/ocr/runtime-config';

const webRoot = resolve(import.meta.dir, '..');
const fixture = resolve(import.meta.dir, 'fixtures/gemini-live-reservation-contender.ts');

test('strict parsing accepts only the declared live verification options', () => {
  const envFile = '/tmp/operator.env';
  const parsed = parseLiveVerificationArguments(
    [envFile, '--pro-image', '--output-dir', 'performance/new-gemini-canary'],
    { allowProImage: true, defaultOutputSubdirectory: 'ui-renewal-20261003' },
  );
  expect(parsed.proImage).toBe(true);
  expect(parsed.outputDirectory).toBe(resolve(webRoot, 'performance/new-gemini-canary'));
  for (const argv of [
    [envFile, '--pro-image', '--pro-image'],
    [envFile, '--output-dir'],
    [envFile, '--output-dir', '--pro-image'],
    [envFile, '--current-candidate-defaults'],
    [envFile, 'extra'],
  ]) {
    expect(() => parseLiveVerificationArguments(argv, {
      allowProImage: true,
      defaultOutputSubdirectory: 'ui-renewal-20261003',
    })).toThrow('verification_arguments_invalid');
  }
});

test('secure env reader accepts an owner-only file and rejects mode and symlink variants without exposing content', () => {
  const root = mkdtempSync(resolve(webRoot, 'performance/gemini-env-boundary-'));
  try {
    const envFile = resolve(root, 'operator.env');
    const envLink = resolve(root, 'operator-link.env');
    writeFileSync(envFile, 'GEMINI_OCR_API_KEY=synthetic-secret\n', { mode: 0o600 });
    expect(readSecureOperatorEnv(envFile)).toContain('GEMINI_OCR_API_KEY');
    symlinkSync(envFile, envLink);
    expect(() => readSecureOperatorEnv(envLink)).toThrow('operator_env_file_invalid');
    chmodSync(envFile, 0o640);
    expect(() => readSecureOperatorEnv(envFile)).toThrow('operator_env_file_permissions_invalid');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('output preparation performs zero writes through an external symlink or direct outside path', () => {
  const root = mkdtempSync(resolve(webRoot, 'performance/gemini-output-boundary-'));
  const external = mkdtempSync(resolve(tmpdir(), 'gemini-output-external-'));
  try {
    const normalNested = resolve(root, 'normal/nested');
    expect(prepareEvidenceDirectory(normalNested)).toBe(normalNested);
    expect(lstatSync(normalNested).isDirectory()).toBe(true);

    const linked = resolve(root, 'linked');
    const externalNested = resolve(external, 'nested/missing');
    symlinkSync(external, linked);
    expect(() => prepareEvidenceDirectory(resolve(linked, 'nested/missing'))).toThrow('verification_output_invalid');
    expect(existsSync(externalNested)).toBe(false);

    const directOutside = resolve(external, 'direct/missing');
    expect(() => prepareEvidenceDirectory(directOutside)).toThrow('verification_output_outside_performance');
    expect(existsSync(directOutside)).toBe(false);
  } finally {
    rmSync(root, { recursive: true });
    rmSync(external, { recursive: true });
  }
});

test('descriptor helper selection rejects relative paths and fails closed on launch errors', () => {
  const root = mkdtempSync(resolve(webRoot, 'performance/gemini-helper-boundary-'));
  const original = process.env.TZUDONG_PYTHON;
  try {
    process.env.TZUDONG_PYTHON = 'relative/python3';
    const relativeTarget = resolve(root, 'relative-target');
    expect(() => prepareEvidenceDirectory(relativeTarget)).toThrow('descriptor_helper_path_invalid');
    expect(existsSync(relativeTarget)).toBe(false);

    process.env.TZUDONG_PYTHON = resolve(root, 'missing-python3');
    const missingTarget = resolve(root, 'missing-target');
    expect(() => prepareEvidenceDirectory(missingTarget)).toThrow('verification_output_invalid');
    expect(existsSync(missingTarget)).toBe(false);

    process.env.TZUDONG_PYTHON = '/usr/bin/false';
    const failedTarget = resolve(root, 'failed-target');
    expect(() => prepareEvidenceDirectory(failedTarget)).toThrow('verification_output_invalid');
    expect(existsSync(failedTarget)).toBe(false);
  } finally {
    if (original === undefined) delete process.env.TZUDONG_PYTHON;
    else process.env.TZUDONG_PYTHON = original;
    rmSync(root, { recursive: true });
  }
});

test('exclusive receipt reservation preserves an uncertain pending receipt on rerun', () => {
  const root = mkdtempSync(resolve(webRoot, 'performance/gemini-receipt-boundary-'));
  try {
    prepareEvidenceDirectory(root);
    const path = resolve(root, 'receipt.json');
    const receipt = reserveJsonReceipt(path, { pending: 'provider', generationCallsStarted: 1 });
    receipt.close();
    const original = readFileSync(path);
    expect(() => reserveJsonReceipt(path, { pending: 'reserved' })).toThrow('existing_receipt_requires_readback');
    expect(readFileSync(path)).toEqual(original);
    expect(lstatSync(path).mode & 0o777).toBe(0o600);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('two concurrent reservations have exactly one winner before any provider work', async () => {
  const root = mkdtempSync(resolve(webRoot, 'performance/gemini-reservation-race-'));
  try {
    prepareEvidenceDirectory(root);
    const receipt = resolve(root, 'receipt.json');
    const gate = resolve(root, 'start');
    const contenders = [0, 1].map(() => Bun.spawn({
      cmd: [process.execPath, 'run', fixture, receipt, gate],
      cwd: webRoot,
      stdout: 'pipe',
      stderr: 'pipe',
    }));
    writeFileSync(gate, 'go');
    const statuses = await Promise.all(contenders.map((child) => child.exited));
    expect(statuses.sort()).toEqual([0, 2]);
    expect(JSON.parse(readFileSync(receipt, 'utf8'))).toEqual({ pending: 'reserved', generationCallsStarted: 0 });
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('exclusive image writes never replace an earlier image', () => {
  const root = mkdtempSync(resolve(webRoot, 'performance/gemini-image-boundary-'));
  try {
    prepareEvidenceDirectory(root);
    const image = resolve(root, 'image.png');
    writeExclusiveArtifact(image, Buffer.from('first'));
    expect(() => writeExclusiveArtifact(image, Buffer.from('second'))).toThrow('existing_artifact_requires_readback');
    expect(readFileSync(image, 'utf8')).toBe('first');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('descriptor-relative writes cannot follow a replaced parent directory to an external target', () => {
  const root = mkdtempSync(resolve(webRoot, 'performance/gemini-parent-race-'));
  const external = mkdtempSync(resolve(tmpdir(), 'gemini-parent-race-external-'));
  const anchor = resolve(root, 'anchor');
  const parent = resolve(anchor, 'target');
  const movedAnchor = resolve(root, 'anchor-original');
  const externalParent = resolve(external, 'target');
  try {
    prepareEvidenceDirectory(parent);
    mkdirSync(externalParent);
    const directory = openVerifiedDirectory(parent);
    try {
      renameSync(anchor, movedAnchor);
      symlinkSync(external, anchor);
      writeExclusiveArtifactInVerifiedDirectory(directory, 'descriptor-bound.bin', Buffer.from('held-directory'));
    } finally {
      directory.close();
    }

    expect(readFileSync(resolve(movedAnchor, 'target/descriptor-bound.bin'), 'utf8')).toBe('held-directory');
    expect(existsSync(resolve(externalParent, 'descriptor-bound.bin'))).toBe(false);
    expect(() => writeExclusiveArtifact(resolve(parent, 'path-based.bin'), Buffer.from('must-not-write')))
      .toThrow('verification_output_invalid');
    expect(existsSync(resolve(externalParent, 'path-based.bin'))).toBe(false);
  } finally {
    rmSync(root, { recursive: true });
    rmSync(external, { recursive: true });
  }
});

test('receipt updates fail closed when the reserved parent path is replaced', () => {
  const root = mkdtempSync(resolve(webRoot, 'performance/gemini-receipt-parent-race-'));
  const external = mkdtempSync(resolve(tmpdir(), 'gemini-receipt-parent-race-external-'));
  const anchor = resolve(root, 'anchor');
  const parent = resolve(anchor, 'target');
  const movedAnchor = resolve(root, 'anchor-original');
  const externalParent = resolve(external, 'target');
  const receiptPath = resolve(parent, 'receipt.json');
  try {
    prepareEvidenceDirectory(parent);
    mkdirSync(externalParent);
    const receipt = reserveJsonReceipt(receiptPath, { pending: 'reserved', generationCallsStarted: 0 });
    renameSync(anchor, movedAnchor);
    symlinkSync(external, anchor);

    expect(() => receipt.write({ pending: 'provider', generationCallsStarted: 1 }))
      .toThrow('verification_output_identity_changed');
    expect(() => receipt.close()).toThrow('verification_output_identity_changed');
    expect(JSON.parse(readFileSync(resolve(movedAnchor, 'target/receipt.json'), 'utf8')))
      .toEqual({ pending: 'reserved', generationCallsStarted: 0 });
    expect(existsSync(resolve(externalParent, 'receipt.json'))).toBe(false);
  } finally {
    rmSync(root, { recursive: true });
    rmSync(external, { recursive: true });
  }
});

test('open file identity validation rejects a replaced receipt or artifact path', () => {
  const root = mkdtempSync(resolve(webRoot, 'performance/gemini-inode-boundary-'));
  try {
    prepareEvidenceDirectory(root);
    const path = resolve(root, 'artifact.bin');
    const moved = resolve(root, 'artifact-original.bin');
    writeFileSync(path, 'original', { mode: 0o600 });
    const fd = openSync(path, fsConstants.O_RDWR | (fsConstants.O_NOFOLLOW ?? 0));
    try {
      assertOpenFileMatchesPath(path, fd);
      renameSync(path, moved);
      writeFileSync(path, 'replacement', { mode: 0o600 });
      expect(() => assertOpenFileMatchesPath(path, fd)).toThrow('file_path_identity_changed');
      expect(readFileSync(path, 'utf8')).toBe('replacement');
      expect(readFileSync(moved, 'utf8')).toBe('original');
    } finally {
      closeSync(fd);
    }

    const receiptPath = resolve(root, 'receipt.json');
    const movedReceipt = resolve(root, 'receipt-original.json');
    const receipt = reserveJsonReceipt(receiptPath, { pending: 'reserved' });
    renameSync(receiptPath, movedReceipt);
    writeFileSync(receiptPath, 'replacement', { mode: 0o600 });
    expect(() => receipt.write({ pending: 'provider' })).toThrow('receipt_write_identity_changed');
    expect(() => receipt.close()).toThrow('receipt_write_identity_changed');
    expect(readFileSync(receiptPath, 'utf8')).toBe('replacement');
    expect(JSON.parse(readFileSync(movedReceipt, 'utf8'))).toEqual({ pending: 'reserved' });
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('OCR generation callback gate admits exactly one provider callback body', () => {
  const enter = createOneShotGate();
  expect(enter()).toBeUndefined();
  expect(() => enter()).toThrow('attempt_bound_exceeded');
});

test('source binding records Git identity and exact working-file hashes', () => {
  const path = 'scripts/verify-storyboard-gemini-live.ts';
  const source = readFileSync(resolve(webRoot, path));
  const binding = buildSourceBinding([path]);
  expect(binding.gitHead).toMatch(/^[0-9a-f]{40}$/);
  expect(binding.gitTree).toMatch(/^[0-9a-f]{40}$/);
  expect(binding.sourceHashes[path]).toBe(sha256(source));
  expect(typeof binding.workingTreeDirty).toBe('boolean');
  expect(hashPublicConfiguration({ model: 'a' })).not.toBe(hashPublicConfiguration({ model: 'b' }));
});

test('source binding cannot report a clean tree when an unlisted path is dirty', () => {
  const relativePath = `.gemini-source-binding-unlisted-${process.pid}`;
  const path = resolve(webRoot, relativePath);
  try {
    writeFileSync(path, 'unlisted execution dependency');
    const binding = buildSourceBinding(['scripts/verify-ocr-gemini-live.ts']);
    expect(binding.workingTreeDirty).toBe(true);
    expect(binding.workingTreeStatus).toContain(`?? apps/web/${relativePath}`);
    expect(binding.sourceHashes[relativePath]).toBeUndefined();
  } finally {
    rmSync(path, { force: true });
  }
});

test('OCR runtime resolver preserves funded exclusivity and OCR-specific key priority', async () => {
  const funded = await resolveOcrAiRuntimeConfig({
    GEMINI_CREDITS_API_KEY: 'funded',
    GEMINI_OCR_API_KEY: 'ocr',
    GEMINI_API_KEY: 'general',
  } as NodeJS.ProcessEnv);
  expect(funded.credentialCandidates).toEqual([
    { apiKey: 'funded', source: 'environment', sourceName: 'GEMINI_CREDITS_API_KEY' },
  ]);
  const ordinary = await resolveOcrAiRuntimeConfig({
    GEMINI_OCR_API_KEY: 'ocr',
    GEMINI_API_KEY: 'general',
  } as NodeJS.ProcessEnv);
  expect(ordinary.credentialCandidates.map((entry) => entry.sourceName)).toEqual(['GEMINI_OCR_API_KEY', 'GEMINI_API_KEY']);
  expect(ordinary.apiKey).toBe('ocr');
});
