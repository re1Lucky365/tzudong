import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// Bounded checks against actual TS/DOM behavior. No solver or provider service
// is installed, and mutations are confined to disposable copies of named files.
const root = resolve(import.meta.dir, '..');
const tests = ['tests-formal/marker-state-model.test.mjs', 'tests-unit/evidence-numeric-bounds.test.ts',
  'tests-unit/popularity-input-boundary.test.ts', 'tests-unit/evidence-cohort-shadow.test.ts'];
const copied = [
  'lib/marker-pool.ts', 'lib/retained-marker-accessibility.ts', 'lib/naver-map-event-cleanup.ts', 'lib/youtube-url.ts',
  ...['popularity-marker.ts', 'scoring.ts', 'frames.ts', 'constants.ts', 'guards.ts', 'errors.ts', 'types.ts', 'storage-key.mjs']
    .map(file => `lib/evidence-engineering/${file}`),
  ...tests.slice(0, 2),
];
function run(cwd, paths) {
  const result = Bun.spawnSync({ cmd: [process.execPath, 'test', ...paths], cwd, stdout: 'pipe', stderr: 'pipe' });
  return { exitCode: result.exitCode,
    output: (new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr))
      .replaceAll(cwd, '<web>').replaceAll(root, '<web>') };
}
function removeFiniteGuard(variable) {
  return `  if (!Number.isFinite(${variable})) {\n    throw new EvidenceContractError(EvidenceContractCodes.nonFinite);\n  }\n`;
}
const mutants = [
  { id: 'static-content-guard', file: 'lib/marker-pool.ts',
    before: '    if (!previous.content.isEqualNode(nextStatic)) return false;', after: '    void nextStatic;',
    test: tests[0], failure: 'all 2,048 active/reacquired visual transitions' },
  { id: 'released-callback', file: 'lib/marker-pool.ts',
    before: '        marker.__onClick = undefined;\n        syncRetainedMarkerAccessibility(marker, true);',
    after: '        syncRetainedMarkerAccessibility(marker, true);',
    test: tests[0], failure: 'every pool/click action sequence through depth four' },
  { id: 'half-life-overflow', file: 'lib/evidence-engineering/scoring.ts',
    before: removeFiniteGuard('halfLife'), after: '', test: tests[1], failure: 'finite inputs cannot leak infinity' },
  { id: 'visit-multiplier-overflow', file: 'lib/evidence-engineering/scoring.ts',
    before: removeFiniteGuard('multiplier'), after: '', test: tests[1], failure: 'finite inputs cannot leak infinity' },
  { id: 'sampling-window-overflow', file: 'lib/evidence-engineering/frames.ts',
    before: '  const end = requireTimestampMs(target + FRAME_SAMPLING.windowMs);',
    after: '  const end = target + FRAME_SAMPLING.windowMs;', test: tests[1], failure: 'sampling-window arithmetic cannot produce an unsafe timestamp' },
  { id: 'unscored-comparison', file: 'lib/evidence-engineering/scoring.ts',
    before: '      comparison_present: false,\n      differs: null,',
    after: '      comparison_present: true,\n      differs: null,', test: tests[1], failure: 'an unscored signal vector cannot establish a scalar difference' },
];
if (Bun.version !== '1.4.0') throw new Error(`Use verified Bun 1.4.0; observed ${Bun.version}`);
const startedAt = new Date().toISOString();
const originalHashes = new Map(await Promise.all(copied.map(async path => [path, Bun.SHA256.hash(await readFile(join(root, path)), 'hex')])));
const baseline = run(root, tests);
if (baseline.exitCode !== 0) {
  process.stderr.write(baseline.output);
  throw new Error('FORMAL_BASELINE_FAILED');
}
console.log('Bounded native baseline passed. Checking six isolated broken variants.');
const mutations = [];
for (const mutant of mutants) {
  const scratch = await mkdtemp(join(tmpdir(), 'tzudong-formal-mutation-'));
  try {
    await symlink(join(root, 'node_modules'), join(scratch, 'node_modules'), 'dir');
    for (const path of copied) {
      await mkdir(dirname(join(scratch, path)), { recursive: true });
      await copyFile(join(root, path), join(scratch, path));
    }
    const path = join(scratch, mutant.file);
    const source = await readFile(path, 'utf8');
    if (source.split(mutant.before).length !== 2) throw new Error(`MUTATION_ANCHOR_DRIFT:${mutant.id}`);
    await writeFile(path, source.replace(mutant.before, mutant.after));
    const result = run(scratch, [mutant.test]);
    // A missing browser/import or other harness failure is not mutation detection.
    const detected = result.exitCode !== 0 && result.output.includes(`(fail) ${mutant.failure}`)
      && !/FORMAL_BROWSER_REQUIRED|Cannot find module|BuildMessage/.test(result.output);
    mutations.push({ id: mutant.id, detected, ...result });
    console.log(`${mutant.id}: ${detected ? 'detected' : 'NOT DETECTED'}`);
    if (!detected) throw new Error(`MUTATION_NOT_DETECTED:${mutant.id}\n${result.output}`);
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
for (const [path, hash] of originalHashes) {
  if (Bun.SHA256.hash(await readFile(join(root, path)), 'hex') !== hash) throw new Error(`SOURCE_CHANGED_DURING_CHECK:${path}`);
}
const restored = run(root, tests.slice(0, 2));
if (restored.exitCode !== 0) throw new Error(`RESTORED_CHECK_FAILED\n${restored.output}`);
const report = { schemaVersion: 1, evidence: 'BOUNDED_NATIVE_AND_SYNTHETIC_PROVIDER_CHECKS',
  startedAt, completedAt: new Date().toISOString(), bun: Bun.version,
  bounds: { visualVariants: 32, visualTransitions: 2048, actionAlphabet: 8, maximumDepth: 4,
    ownershipTraces: 4681, ownershipSteps: 18056 },
  sourceHashes: Object.fromEntries(originalHashes), baseline, mutations, restored,
  exclusions: ['real Naver SDK', 'network', 'provider reentrancy within one synchronous call', 'fairness/liveness',
    'unbounded executions', 'physical devices', 'deployment', 'Nightly'],
};
const outIndex = process.argv.indexOf('--out');
if (outIndex >= 0) {
  const path = process.argv[outIndex + 1];
  if (!path) throw new Error('Missing --out JSON path');
  await writeFile(resolve(path), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ status: 'pass', bounded: report.bounds, mutationsDetected: mutations.length,
  originalSourcesUnchanged: true, restoredPass: true }));
/* global Bun */
