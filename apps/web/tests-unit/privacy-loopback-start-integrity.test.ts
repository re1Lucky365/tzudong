import { createHash } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'bun:test';
import { captureBuildRuntimeArtifactClosure } from '../performance/admin-route-consistency-20261012/privacy-fixture-runtime.mjs';

const BUILD_ARTIFACTS = [
  'BUILD_ID',
  'build-manifest.json',
  'app-build-manifest.json',
  'routes-manifest.json',
  'required-server-files.json',
] as const;

type Generation = {
  name: 'v1' | 'v2';
  launcherRelative: string;
  launcherDirectoryRelative: string;
  fixtureRelative: string;
  defaultDist: string;
  defaultBasePort: number;
};

const GENERATIONS: Generation[] = [
  {
    name: 'v1',
    launcherRelative: 'performance/admin-route-consistency-20261012/start-loopback.mjs',
    launcherDirectoryRelative: 'performance/admin-route-consistency-20261012',
    fixtureRelative: 'performance/admin-route-consistency-20261012/fixture-server.mjs',
    defaultDist: '.next-privacy-incidents-20261012',
    defaultBasePort: 18940,
  },
  {
    name: 'v2',
    launcherRelative: 'performance/admin-route-consistency-20261012/v2/start-loopback.mjs',
    launcherDirectoryRelative: 'performance/admin-route-consistency-20261012/v2',
    fixtureRelative: 'performance/admin-route-consistency-20261012/v2/fixture-server.mjs',
    defaultDist: '.next-privacy-incidents-v2-20261012',
    defaultBasePort: 18950,
  },
];

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

function node24Binary() {
  const candidates = [...new Set([process.env.TZUDONG_NODE24_BIN, '/opt/homebrew/opt/node@24/bin/node', 'node'].filter(Boolean))] as string[];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-p', 'process.versions.node'], { encoding: 'utf8' });
    if (probe.status === 0 && probe.stdout.trim().startsWith('24.')) return candidate;
  }
  throw new Error('NODE_24_REQUIRED_FOR_PRIVACY_LOOPBACK_INTEGRITY_TEST');
}

function processAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await Bun.sleep(20);
  }
  throw new Error('WAIT_TIMEOUT');
}

async function waitForExit(child: ChildProcess) {
  return await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

function childProgram(marker: string, exitCode: number | null) {
  const exit = exitCode === null
    ? "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1_000);"
    : `setTimeout(() => process.exit(${exitCode}), 350);`;
  return `require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid)); ${exit}\n`;
}

function fixtureProgram(marker: string, generation: Generation) {
  return [
    "import { writeFileSync } from 'node:fs';",
    `const NEXT_PORT = ${generation.defaultBasePort};`,
    `const SUPABASE_PORT = ${generation.defaultBasePort + 1};`,
    `const GATEWAY_PORT = ${generation.defaultBasePort + 2};`,
    `writeFileSync(${JSON.stringify(marker)}, String(process.pid));`,
    "process.on('SIGTERM', () => process.exit(0));",
    'setInterval(() => {}, 1_000);',
    '',
  ].join('\n');
}

type FixtureOptions = {
  runId: string;
  nextExitCode?: number | null;
  omitOptionalAppBuildManifest?: boolean;
  injectReceiptFailure?: boolean;
  mutateReceipt?: (receipt: Record<string, unknown>) => void;
  mutateArtifacts?: (distDirectory: string) => void;
};

function prepareFixture(generation: Generation, options: FixtureOptions) {
  const root = mkdtempSync(path.join(os.tmpdir(), `tzudong-loopback-${generation.name}-`));
  const sourceWeb = path.resolve(import.meta.dir, '..');
  const webRoot = path.join(root, 'apps', 'web');
  const launcherDirectory = path.join(webRoot, generation.launcherDirectoryRelative);
  const launcherPath = path.join(webRoot, generation.launcherRelative);
  const fixturePath = path.join(webRoot, generation.fixtureRelative);
  const runtimeHelperPath = path.join(webRoot, 'performance/admin-route-consistency-20261012/privacy-fixture-runtime.mjs');
  const dependencies = path.join(root, 'dependencies');
  const runOut = path.join(launcherDirectory, 'runs', options.runId);
  const dist = `${generation.defaultDist}-${options.runId}`;
  const distDirectory = path.join(webRoot, dist);
  const nextMarker = path.join(root, 'next.pid');
  const gatewayMarker = path.join(root, 'gateway.pid');
  const syntheticLock = `${JSON.stringify({
    name: 'loopback-integrity-fixture',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'loopback-integrity-fixture' },
      'node_modules/next': { version: '16.3.8' },
    },
  }, null, 2)}\n`;

  mkdirSync(path.dirname(runtimeHelperPath), { recursive: true });
  mkdirSync(launcherDirectory, { recursive: true });
  mkdirSync(path.dirname(fixturePath), { recursive: true });
  mkdirSync(path.join(dependencies, 'next', 'dist', 'bin'), { recursive: true });
  mkdirSync(runOut, { recursive: true });
  mkdirSync(distDirectory, { recursive: true });
  writeFileSync(runtimeHelperPath, readFileSync(path.join(sourceWeb, 'performance/admin-route-consistency-20261012/privacy-fixture-runtime.mjs')));

  let launcherSource = readFileSync(path.join(sourceWeb, generation.launcherRelative), 'utf8');
  launcherSource = launcherSource.replace(
    /const EXPECTED_LOCK_SHA256 = '[0-9a-f]{64}';/,
    `const EXPECTED_LOCK_SHA256 = '${sha256(syntheticLock)}';`,
  );
  if (options.injectReceiptFailure) {
    const original = [
      'function commitRuntimeStart(fd, value) {',
      "  writeFileSync(fd, `${JSON.stringify(value, null, 2)}\\n`);",
      '  closeSync(fd);',
      '}',
    ].join('\n');
    const injected = [
      'function commitRuntimeStart() {',
      '  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);',
      "  throw new Error('INJECTED_RUNTIME_START_FAILURE');",
      '}',
    ].join('\n');
    const replaced = launcherSource.replace(original, injected);
    if (replaced === launcherSource) throw new Error('RECEIPT_FAILURE_INJECTION_MISSED');
    launcherSource = replaced;
  }
  writeFileSync(launcherPath, launcherSource);
  writeFileSync(fixturePath, fixtureProgram(gatewayMarker, generation));
  writeFileSync(path.join(webRoot, 'package-lock.json'), syntheticLock);
  writeFileSync(path.join(dependencies, '.package-lock.json'), syntheticLock);
  writeFileSync(path.join(dependencies, 'next', 'package.json'), '{"version":"16.3.8"}\n');
  writeFileSync(
    path.join(dependencies, 'next', 'dist', 'bin', 'next'),
    childProgram(nextMarker, options.nextExitCode ?? null),
  );

  const artifactRows = BUILD_ARTIFACTS
    .filter((artifact) => artifact !== 'app-build-manifest.json' || !options.omitOptionalAppBuildManifest)
    .map((artifact, index) => {
      const bytes = artifact === 'BUILD_ID' ? 'fixture-build-id\n' : `${artifact}:${index}\n`;
      writeFileSync(path.join(distDirectory, artifact), bytes);
      return { path: artifact, sha256: sha256(bytes) };
    });
  const runtimeFiles = [
    ['server/app/page.js', 'export const page = "fixture";\n'],
    ['server/chunks/runtime.js', 'module.exports = "runtime";\n'],
    ['static/chunks/app.js', 'self.__fixture = true;\n'],
    ['diagnostics/build-diagnostics.json', '{"build":"fixture"}\n'],
  ] as const;
  for (const [relativePath, bytes] of runtimeFiles) {
    const absolutePath = path.join(distDirectory, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, bytes);
  }
  mkdirSync(path.join(distDirectory, 'cache'), { recursive: true });
  writeFileSync(path.join(distDirectory, 'cache/runtime-cache.json'), '{"mutable":true}\n');
  writeFileSync(path.join(distDirectory, 'trace'), 'runtime trace\n');
  writeFileSync(path.join(distDirectory, 'trace-build'), 'build trace\n');
  const runtimeArtifactClosure = captureBuildRuntimeArtifactClosure({ buildDirectory: distDirectory });
  const receipt: Record<string, unknown> = {
    status: 0,
    distDir: dist,
    buildId: 'fixture-build-id',
    sourceUnchanged: true,
    tsconfigRestored: true,
    runId: options.runId,
    artifacts: artifactRows,
    runtimeArtifactClosure,
  };
  options.mutateReceipt?.(receipt);
  writeFileSync(path.join(runOut, 'privacy-build-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  options.mutateArtifacts?.(distDirectory);

  return {
    root,
    webRoot,
    launcherPath,
    dependencies,
    runOut,
    nextMarker,
    gatewayMarker,
    args: [launcherPath, '--run-id', options.runId, '--dependencies', dependencies],
  };
}

function readPid(marker: string) {
  return Number.parseInt(readFileSync(marker, 'utf8'), 10);
}

async function assertStopped(pid: number) {
  await waitFor(() => !processAlive(pid));
  expect(processAlive(pid)).toBe(false);
}

describe('privacy loopback launch integrity', () => {
  for (const generation of GENERATIONS) {
    test(`${generation.name} cleans both children and the borrowed dependency link when start receipt commit throws`, async () => {
      const fixture = prepareFixture(generation, {
        runId: 'receipt-failure',
        injectReceiptFailure: true,
      });
      let launcher: ChildProcess | null = null;
      try {
        launcher = spawn(node24Binary(), fixture.args, {
          cwd: fixture.webRoot,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const exit = await waitForExit(launcher);
        expect(exit.code).toBe(1);
        expect(existsSync(fixture.nextMarker)).toBe(true);
        expect(existsSync(fixture.gatewayMarker)).toBe(true);
        await assertStopped(readPid(fixture.nextMarker));
        await assertStopped(readPid(fixture.gatewayMarker));
        expect(existsSync(path.join(fixture.webRoot, 'node_modules'))).toBe(false);
        expect(JSON.parse(readFileSync(path.join(fixture.runOut, 'privacy-runtime-stop.json'), 'utf8'))).toMatchObject({
          exitCode: 1,
          dependencyLinkRemoved: true,
          cleanupCode: null,
        });
      } finally {
        if (launcher?.exitCode === null && launcher?.signalCode === null) launcher.kill('SIGKILL');
        rmSync(fixture.root, { recursive: true, force: true });
      }
    }, 15_000);

    test(`${generation.name} cleans both children and the borrowed dependency link on SIGTERM`, async () => {
      const fixture = prepareFixture(generation, { runId: 'signal-cleanup' });
      let launcher: ChildProcess | null = null;
      try {
        launcher = spawn(node24Binary(), fixture.args, {
          cwd: fixture.webRoot,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        await waitFor(() => existsSync(fixture.nextMarker) && existsSync(fixture.gatewayMarker));
        launcher.kill('SIGTERM');
        const exit = await waitForExit(launcher);
        expect(exit.code).toBe(0);
        await assertStopped(readPid(fixture.nextMarker));
        await assertStopped(readPid(fixture.gatewayMarker));
        expect(existsSync(path.join(fixture.webRoot, 'node_modules'))).toBe(false);
        expect(JSON.parse(readFileSync(path.join(fixture.runOut, 'privacy-runtime-stop.json'), 'utf8'))).toMatchObject({
          exitCode: 0,
          dependencyLinkRemoved: true,
          cleanupCode: null,
        });
      } finally {
        if (launcher?.exitCode === null && launcher?.signalCode === null) launcher.kill('SIGKILL');
        rmSync(fixture.root, { recursive: true, force: true });
      }
    }, 15_000);

    test(`${generation.name} stops the surviving child and removes the borrowed dependency link on child failure`, async () => {
      const fixture = prepareFixture(generation, {
        runId: 'child-failure',
        nextExitCode: 7,
      });
      let launcher: ChildProcess | null = null;
      try {
        launcher = spawn(node24Binary(), fixture.args, {
          cwd: fixture.webRoot,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const exit = await waitForExit(launcher);
        expect(exit.code).toBe(7);
        expect(existsSync(fixture.nextMarker)).toBe(true);
        expect(existsSync(fixture.gatewayMarker)).toBe(true);
        await assertStopped(readPid(fixture.nextMarker));
        await assertStopped(readPid(fixture.gatewayMarker));
        expect(existsSync(path.join(fixture.webRoot, 'node_modules'))).toBe(false);
      } finally {
        if (launcher?.exitCode === null && launcher?.signalCode === null) launcher.kill('SIGKILL');
        rmSync(fixture.root, { recursive: true, force: true });
      }
    }, 15_000);

    test(`${generation.name} rejects changed bundle bytes before spawning either child`, () => {
      const fixture = prepareFixture(generation, {
        runId: 'artifact-changed',
        mutateArtifacts: (distDirectory) => writeFileSync(path.join(distDirectory, 'routes-manifest.json'), 'changed-after-receipt\n'),
      });
      try {
        const result = spawnSync(node24Binary(), fixture.args, {
          cwd: fixture.webRoot,
          encoding: 'utf8',
          timeout: 10_000,
        });
        expect(result.status).toBe(1);
        expect(existsSync(fixture.nextMarker)).toBe(false);
        expect(existsSync(fixture.gatewayMarker)).toBe(false);
        expect(existsSync(path.join(fixture.webRoot, 'node_modules'))).toBe(false);
        expect(readFileSync(path.join(fixture.runOut, 'privacy-runtime.log'), 'utf8')).toContain('[launcher:error] Error');
      } finally {
        rmSync(fixture.root, { recursive: true, force: true });
      }
    }, 15_000);

    test(`${generation.name} accepts the Next 16.3.8 artifact set without app-build-manifest`, () => {
      const fixture = prepareFixture(generation, {
        runId: 'next-16-artifact-set',
        nextExitCode: 7,
        omitOptionalAppBuildManifest: true,
      });
      try {
        const result = spawnSync(node24Binary(), fixture.args, {
          cwd: fixture.webRoot,
          encoding: 'utf8',
          timeout: 10_000,
        });
        expect(result.status).toBe(7);
        expect(existsSync(fixture.nextMarker)).toBe(true);
        expect(existsSync(fixture.gatewayMarker)).toBe(true);
        expect(existsSync(path.join(fixture.webRoot, 'node_modules'))).toBe(false);
      } finally {
        rmSync(fixture.root, { recursive: true, force: true });
      }
    }, 15_000);

    test(`${generation.name} rejects runtime artifact mutation, removal, addition, and symlink escape before spawning`, () => {
      const mutations: Array<[string, (distDirectory: string) => void]> = [
        ['compiled-js-changed', (distDirectory) => {
          writeFileSync(path.join(distDirectory, 'server/chunks/runtime.js'), 'module.exports = "mutated";\n');
        }],
        ['runtime-file-missing', (distDirectory) => {
          rmSync(path.join(distDirectory, 'static/chunks/app.js'));
        }],
        ['runtime-file-added', (distDirectory) => {
          writeFileSync(path.join(distDirectory, 'server/chunks/added.js'), 'module.exports = "added";\n');
        }],
        ['runtime-link-escape', (distDirectory) => {
          const outside = path.join(path.dirname(distDirectory), 'outside-runtime.js');
          writeFileSync(outside, 'module.exports = "outside";\n');
          symlinkSync(outside, path.join(distDirectory, 'server/chunks/escaped.js'));
        }],
      ];
      for (const [suffix, mutateArtifacts] of mutations) {
        const fixture = prepareFixture(generation, {
          runId: suffix,
          mutateArtifacts,
        });
        try {
          const result = spawnSync(node24Binary(), fixture.args, {
            cwd: fixture.webRoot,
            encoding: 'utf8',
            timeout: 10_000,
          });
          expect(result.status).toBe(1);
          expect(existsSync(fixture.nextMarker)).toBe(false);
          expect(existsSync(fixture.gatewayMarker)).toBe(false);
          expect(existsSync(path.join(fixture.webRoot, 'node_modules'))).toBe(false);
        } finally {
          rmSync(fixture.root, { recursive: true, force: true });
        }
      }
    }, 30_000);

    test(`${generation.name} explicitly excludes mutable cache and trace outputs from the frozen runtime closure`, () => {
      const fixture = prepareFixture(generation, {
        runId: 'mutable-runtime-exclusions',
        nextExitCode: 7,
        mutateArtifacts: (distDirectory) => {
          writeFileSync(path.join(distDirectory, 'cache/runtime-cache.json'), '{"mutable":"changed"}\n');
          writeFileSync(path.join(distDirectory, 'trace'), 'changed runtime trace\n');
          writeFileSync(path.join(distDirectory, 'trace-build'), 'changed build trace\n');
        },
      });
      try {
        const result = spawnSync(node24Binary(), fixture.args, {
          cwd: fixture.webRoot,
          encoding: 'utf8',
          timeout: 10_000,
        });
        expect(result.status).toBe(7);
        expect(existsSync(fixture.nextMarker)).toBe(true);
        expect(existsSync(fixture.gatewayMarker)).toBe(true);
        expect(existsSync(path.join(fixture.webRoot, 'node_modules'))).toBe(false);
        const startReceipt = JSON.parse(readFileSync(path.join(fixture.runOut, 'privacy-runtime-start.json'), 'utf8'));
        expect(startReceipt.source.buildRuntimeArtifactClosure).toMatchObject({
          schema: 'tzudong-next-runtime-artifact-closure/v1',
          fileCount: 9,
          mutableExclusions: [
            { path: 'cache', scope: 'subtree', reason: 'next-runtime-cache' },
            { path: 'trace', scope: 'file', reason: 'next-runtime-trace' },
            { path: 'trace-build', scope: 'file', reason: 'next-build-trace' },
          ],
        });
        expect(startReceipt.source.buildRuntimeArtifactClosure.files).toBeUndefined();
      } finally {
        rmSync(fixture.root, { recursive: true, force: true });
      }
    }, 15_000);

    test(`${generation.name} rejects incomplete and path-escaped frozen artifact lists before spawning`, () => {
      for (const [suffix, mutateReceipt] of [
        ['incomplete', (receipt: Record<string, unknown>) => {
          receipt.artifacts = (receipt.artifacts as unknown[]).slice(0, -1);
        }],
        ['escaped', (receipt: Record<string, unknown>) => {
          const artifacts = receipt.artifacts as Array<Record<string, unknown>>;
          artifacts[1] = { ...artifacts[1], path: '../build-manifest.json' };
        }],
        ['runtime-escaped', (receipt: Record<string, unknown>) => {
          const closure = receipt.runtimeArtifactClosure as { files: Array<Record<string, unknown>> };
          closure.files[0] = { ...closure.files[0], path: '../server-entry.js' };
        }],
      ] as const) {
        const fixture = prepareFixture(generation, {
          runId: `artifact-list-${suffix}`,
          mutateReceipt,
        });
        try {
          const result = spawnSync(node24Binary(), fixture.args, {
            cwd: fixture.webRoot,
            encoding: 'utf8',
            timeout: 10_000,
          });
          expect(result.status).toBe(1);
          expect(existsSync(fixture.nextMarker)).toBe(false);
          expect(existsSync(fixture.gatewayMarker)).toBe(false);
          expect(existsSync(path.join(fixture.webRoot, 'node_modules'))).toBe(false);
        } finally {
          rmSync(fixture.root, { recursive: true, force: true });
        }
      }
    }, 20_000);
  }
});
