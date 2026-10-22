import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  cleanupFailure,
  cleanupFixtureDependencies,
  cleanupPrivacyFixtureBuild,
  fixtureServerInvocation,
  parseFixtureArguments,
  prepareFixtureDependencies,
  prepareRuntimeOutput,
  resolveFixtureDependencies,
  resolveFixtureRun,
  sanitizeFixtureOutput,
  validateFixtureDependencies,
} from '../performance/admin-route-consistency-20261012/privacy-fixture-runtime.mjs';

function nextDependencies(root: string) {
  const dependencies = path.join(root, 'dependencies');
  mkdirSync(path.join(dependencies, 'next'), { recursive: true });
  writeFileSync(path.join(dependencies, 'next', 'package.json'), '{"version":"16.3.8"}\n');
  return dependencies;
}

function lockedDependencies(webRoot: string, dependencies: string) {
  const packages = {
    'node_modules/next': { version: '16.3.8', resolved: 'https://registry.npmjs.org/next/-/next-16.3.8.tgz', integrity: 'sha512-next' },
    'node_modules/react': { version: '19.3.0', resolved: 'https://registry.npmjs.org/react/-/react-19.3.0.tgz', integrity: 'sha512-react' },
    'node_modules/optional-platform': { version: '1.0.0', optional: true },
  };
  writeFileSync(path.join(webRoot, 'package-lock.json'), `${JSON.stringify({
    name: 'fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    packages: { '': { name: 'fixture', version: '1.0.0' }, ...packages },
  })}\n`);
  writeFileSync(path.join(dependencies, '.package-lock.json'), `${JSON.stringify({
    name: 'fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    packages: {
      'node_modules/next': packages['node_modules/next'],
      'node_modules/react': packages['node_modules/react'],
    },
  })}\n`);
  for (const [name, version] of [['next', '16.3.8'], ['react', '19.3.0']]) {
    mkdirSync(path.join(dependencies, name), { recursive: true });
    writeFileSync(path.join(dependencies, name, 'package.json'), `${JSON.stringify({ name, version })}\n`);
    writeFileSync(path.join(dependencies, name, 'index.js'), `export const packageName = ${JSON.stringify(name)};\n`);
  }
}

function fixtureRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tzudong-privacy-fixture-'));
  const webRoot = path.join(root, 'apps', 'web');
  mkdirSync(webRoot, { recursive: true });
  return { root, webRoot };
}

function node24Binary() {
  const candidates = [...new Set([process.env.TZUDONG_NODE24_BIN, 'node'].filter(Boolean))] as string[];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-p', 'process.versions.node'], { encoding: 'utf8' });
    if (probe.status === 0 && probe.stdout.trim().startsWith('24.')) return candidate;
  }
  throw new Error('NODE_24_REQUIRED_FOR_PRIVACY_FIXTURE_LAUNCHER_TEST');
}

describe('privacy fixture runtime ownership', () => {
  test('both build and loopback generations share the portable dependency contract', () => {
    const webRoot = path.resolve(import.meta.dir, '..');
    for (const relative of [
      'performance/admin-route-consistency-20261012/build-privacy-fixture.mjs',
      'performance/admin-route-consistency-20261012/start-loopback.mjs',
      'performance/admin-route-consistency-20261012/v2/build-privacy-fixture.mjs',
      'performance/admin-route-consistency-20261012/v2/start-loopback.mjs',
    ]) {
      const source = readFileSync(path.join(webRoot, relative), 'utf8');
      expect(source).toContain('resolveFixtureDependencies');
      expect(source).toContain('resolveFixtureRun');
      expect(source).toContain('validateFixtureDependencies');
      expect(source).toContain("process.versions.node.split('.')[0]");
      expect(source).toContain('process.execPath');
      expect(source).not.toContain('/Users/');
      expect(source).not.toContain('/opt/homebrew');
      expect(source).not.toContain("const DEPENDENCIES = '");
      if (relative.endsWith('start-loopback.mjs')) {
        expect(source).toContain('allowRuntimeAttempt: true');
        expect(source).toContain('prepareRuntimeOutput');
        expect(source).toContain("join(BUILD_OUT, 'privacy-build-receipt.json')");
        expect(source).toContain('writeFileSync(join(RUNTIME_OUT, name)');
        expect(source).toContain("join(RUNTIME_OUT, 'privacy-runtime-start.json')");
        expect(source).toContain("join(RUNTIME_OUT, 'privacy-runtime.log')");
        expect(source).toContain("openSync(startPath, 'wx', 0o600)");
        expect(source).toContain("openSync(logPath, 'wx', 0o600)");
        const reserveIndex = source.indexOf('const runtimeEvidence = reserveRuntimeEvidence()');
        const dependenciesIndex = source.indexOf('prepareFixtureDependencies(dependencyPlan)', reserveIndex);
        const spawnIndex = source.indexOf('const next = spawn(', reserveIndex);
        expect(reserveIndex).toBeGreaterThan(-1);
        expect(dependenciesIndex).toBeGreaterThan(reserveIndex);
        expect(spawnIndex).toBeGreaterThan(dependenciesIndex);
        expect(source).not.toContain("save('privacy-runtime-start.json'");
      } else {
        expect(source).not.toContain('allowRuntimeAttempt: true');
        expect(source).toContain("const excludedBuildInputRoots = new Set([");
        expect(source).toContain("const excludedBuildInputPaths = new Set(['supabase/.temp'])");
        expect(source).toContain("entry.name === '.next'");
        expect(source).toContain("entry.name.startsWith('.next-')");
        expect(source).toContain("function walk(path = '')");
        expect(source).not.toContain("const roots = ['app/admin'");
        expect(source).not.toContain("const extra = ['app/layout.tsx'");
      }
    }
  });

  test('derives isolated run output, dist, and three loopback ports without changing defaults', () => {
    const defaults = resolveFixtureRun({
      argv: [],
      defaultOut: '/evidence/v2',
      defaultDist: '.next-privacy-v2',
      defaultBasePort: 18950,
    });
    expect(defaults).toMatchObject({
      dependencyPath: null,
      runId: null,
      runtimeAttempt: null,
      basePort: 18950,
      out: '/evidence/v2',
      runtimeOut: '/evidence/v2',
      dist: '.next-privacy-v2',
      ports: { next: 18950, supabase: 18951, gateway: 18952 },
    });
    const isolated = resolveFixtureRun({
      argv: ['--base-port', '18960', '--run-id', 'reviewed-20261013', '--dependencies', '/private/dependencies'],
      defaultOut: '/evidence/v2',
      defaultDist: '.next-privacy-v2',
      defaultBasePort: 18950,
    });
    expect(isolated).toMatchObject({
      dependencyPath: '/private/dependencies',
      runId: 'reviewed-20261013',
      runtimeAttempt: null,
      basePort: 18960,
      out: '/evidence/v2/runs/reviewed-20261013',
      runtimeOut: '/evidence/v2/runs/reviewed-20261013',
      dist: '.next-privacy-v2-reviewed-20261013',
      ports: { next: 18960, supabase: 18961, gateway: 18962 },
    });
  });

  test('rejects duplicate, unknown, traversing, uppercase, and out-of-range run arguments', () => {
    const parse = (argv: string[]) => parseFixtureArguments(argv, { defaultBasePort: 18940 });
    for (const argv of [
      ['--run-id', 'valid', '--run-id', 'again'],
      ['--unknown', 'value'],
      ['--run-id'],
      ['--run-id', '../escape'],
      ['--run-id', 'Uppercase'],
      ['--run-id', '-leading'],
      ['--base-port', '1023'],
      ['--base-port', '65534'],
      ['--base-port', '18960.5'],
      ['--dependencies', 'relative/path'],
      ['--runtime-attempt', 'resume-20261013'],
    ]) expect(() => parse(argv)).toThrow();
    expect(parse(['--run-id', 'a', '--base-port', '65533'])).toMatchObject({
      runId: 'a', basePort: 65533,
    });
  });

  test('isolates launcher runtime attempts without changing their validated build output or dist', () => {
    const run = resolveFixtureRun({
      argv: [
        '--run-id', 'reviewed-20261013',
        '--base-port', '18960',
        '--runtime-attempt', 'resume-20261013',
      ],
      defaultOut: '/evidence/v2',
      defaultDist: '.next-privacy-v2',
      defaultBasePort: 18950,
      allowRuntimeAttempt: true,
    });
    expect(run).toMatchObject({
      runId: 'reviewed-20261013',
      runtimeAttempt: 'resume-20261013',
      out: '/evidence/v2/runs/reviewed-20261013',
      runtimeOut: '/evidence/v2/runs/reviewed-20261013/runtime-attempts/resume-20261013',
      dist: '.next-privacy-v2-reviewed-20261013',
      ports: { next: 18960, supabase: 18961, gateway: 18962 },
    });
    const parse = (argv: string[]) => parseFixtureArguments(argv, {
      defaultBasePort: 18950,
      allowRuntimeAttempt: true,
    });
    for (const argv of [
      ['--runtime-attempt', 'first', '--runtime-attempt', 'second'],
      ['--runtime-attempt', '../escape'],
      ['--runtime-attempt', 'Uppercase'],
      ['--runtime-attempt', '-leading'],
    ]) expect(() => parse(argv)).toThrow();
  });

  test('creates each runtime attempt output exactly once under the build output', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'tzudong-privacy-runtime-output-'));
    try {
      const buildOut = path.join(root, 'runs', 'reviewed-20261013');
      const runtimeAttempt = 'resume-20261013';
      const runtimeOut = path.join(buildOut, 'runtime-attempts', runtimeAttempt);
      expect(prepareRuntimeOutput({ buildOut, runtimeOut, runtimeAttempt })).toEqual({ created: true });
      expect(lstatSync(runtimeOut).isDirectory()).toBe(true);
      expect(() => prepareRuntimeOutput({ buildOut, runtimeOut, runtimeAttempt })).toThrow(
        'RUNTIME_ATTEMPT_ALREADY_EXISTS',
      );
      expect(() => prepareRuntimeOutput({
        buildOut,
        runtimeOut: path.join(root, 'outside'),
        runtimeAttempt: 'outside',
      })).toThrow('RUNTIME_ATTEMPT_OUTPUT_INVALID');
      expect(() => prepareRuntimeOutput({
        buildOut,
        runtimeOut: path.join(buildOut, 'outside'),
        runtimeAttempt: '../outside',
      })).toThrow('RUNTIME_ATTEMPT_INVALID');
      expect(prepareRuntimeOutput({
        buildOut,
        runtimeOut: buildOut,
        runtimeAttempt: null,
      })).toEqual({ created: false });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('reserves an existing start receipt before borrowing dependencies or spawning either server', () => {
    const { root, webRoot } = fixtureRoot();
    try {
      const webSource = path.resolve(import.meta.dir, '..');
      const evidenceRoot = path.join(webRoot, 'performance', 'admin-route-consistency-20261012');
      const launcherDirectory = path.join(evidenceRoot, 'v2');
      const runOut = path.join(launcherDirectory, 'runs', 'collision');
      const dist = '.next-privacy-incidents-v2-20261012-collision';
      const dependencies = path.join(root, 'dependencies');
      const nextMarker = path.join(root, 'next-spawned');
      const gatewayMarker = path.join(root, 'gateway-spawned');
      mkdirSync(path.join(dependencies, 'next', 'dist', 'bin'), { recursive: true });
      mkdirSync(runOut, { recursive: true });
      mkdirSync(path.join(webRoot, dist), { recursive: true });
      mkdirSync(path.join(webRoot, 'performance', 'admin-header-consistency-20261011'), { recursive: true });
      writeFileSync(
        path.join(evidenceRoot, 'privacy-fixture-runtime.mjs'),
        readFileSync(path.join(webSource, 'performance/admin-route-consistency-20261012/privacy-fixture-runtime.mjs')),
      );
      // This ownership fixture needs a coherent lock, not the mutable checkout's
      // installed package manager state. Rebind only the temporary launcher copy;
      // the historical launcher and its evidence hash remain unchanged.
      lockedDependencies(webRoot, dependencies);
      const fixtureLock = readFileSync(path.join(webRoot, 'package-lock.json'));
      const launcher = readFileSync(path.join(webSource, 'performance/admin-route-consistency-20261012/v2/start-loopback.mjs'), 'utf8');
      const lockBinding = /const EXPECTED_LOCK_SHA256 = '[0-9a-f]{64}';/g;
      expect(launcher.match(lockBinding)).toHaveLength(1);
      writeFileSync(
        path.join(launcherDirectory, 'start-loopback.mjs'),
        launcher.replace(lockBinding, `const EXPECTED_LOCK_SHA256 = '${createHash('sha256').update(fixtureLock).digest('hex')}';`),
      );
      writeFileSync(path.join(webRoot, dist, 'BUILD_ID'), 'fixture-build-id\n');
      writeFileSync(path.join(dependencies, 'next', 'package.json'), '{"version":"16.3.8"}\n');
      writeFileSync(
        path.join(dependencies, 'next', 'dist', 'bin', 'next'),
        `require('node:fs').writeFileSync(${JSON.stringify(nextMarker)}, 'spawned');\n`,
      );
      writeFileSync(
        path.join(launcherDirectory, 'fixture-server.mjs'),
        [
          "import { writeFileSync } from 'node:fs';",
          "import {} from '../../admin-header-consistency-20261011/fixture-data.mjs';",
          'const NEXT_PORT = 18950;',
          'const SUPABASE_PORT = 18951;',
          'const GATEWAY_PORT = 18952;',
          `writeFileSync(${JSON.stringify(gatewayMarker)}, 'spawned');`,
          '',
        ].join('\n'),
      );
      writeFileSync(
        path.join(webRoot, 'performance', 'admin-header-consistency-20261011', 'fixture-data.mjs'),
        'export {};\n',
      );
      writeFileSync(path.join(runOut, 'privacy-build-receipt.json'), `${JSON.stringify({
        status: 0,
        distDir: dist,
        buildId: 'fixture-build-id',
        sourceUnchanged: true,
        tsconfigRestored: true,
        runId: 'collision',
        basePort: 31900,
      })}\n`);
      const existingStart = Buffer.from('{"owned":"existing-start"}\n');
      const existingLog = Buffer.from('existing log bytes\n');
      writeFileSync(path.join(runOut, 'privacy-runtime-start.json'), existingStart);
      writeFileSync(path.join(runOut, 'privacy-runtime.log'), existingLog);

      const result = spawnSync(node24Binary(), [
        path.join(launcherDirectory, 'start-loopback.mjs'),
        '--run-id', 'collision',
        '--base-port', '31900',
        '--dependencies', dependencies,
      ], { cwd: webRoot, encoding: 'utf8' });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('EEXIST');
      expect(readFileSync(path.join(runOut, 'privacy-runtime-start.json'))).toEqual(existingStart);
      expect(readFileSync(path.join(runOut, 'privacy-runtime.log'))).toEqual(existingLog);
      expect(existsSync(path.join(webRoot, 'node_modules'))).toBe(false);
      expect(existsSync(nextMarker)).toBe(false);
      expect(existsSync(gatewayMarker)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('creates a source-bound dynamic-port fixture invocation without checkout paths', () => {
    const webRoot = path.resolve(import.meta.dir, '..');
    const sourcePath = path.join(webRoot, 'performance/admin-route-consistency-20261012/v2/fixture-server.mjs');
    const original = fixtureServerInvocation({
      sourcePath, evaluationRoot: webRoot, defaultBasePort: 18950, basePort: 18950,
    });
    expect(original.args).toEqual([sourcePath]);
    expect(original.runtimeSha256).toBe(original.sourceSha256);
    expect(original.portsPatched).toBe(false);

    const isolated = fixtureServerInvocation({
      sourcePath, evaluationRoot: webRoot, defaultBasePort: 18950, basePort: 18960,
    });
    expect(isolated.args.slice(0, 2)).toEqual(['--input-type=module', '--eval']);
    expect(isolated.args[2]).toContain('const NEXT_PORT = 18960;');
    expect(isolated.args[2]).toContain('const SUPABASE_PORT = 18961;');
    expect(isolated.args[2]).toContain('const GATEWAY_PORT = 18962;');
    expect(isolated.args[2]).toContain("from './performance/admin-header-consistency-20261011/fixture-data.mjs';");
    expect(isolated.args[2]).not.toContain(webRoot);
    expect(isolated.runtimeSha256).not.toBe(isolated.sourceSha256);
    expect(isolated.portsPatched).toBe(true);
  });

  test('uses this checkout dependencies without exposing an absolute receipt path', () => {
    const { root, webRoot } = fixtureRoot();
    try {
      const dependencies = path.join(webRoot, 'node_modules');
      mkdirSync(dependencies, { recursive: true });
      lockedDependencies(webRoot, dependencies);
      const plan = resolveFixtureDependencies({ webRoot });
      expect(plan.mode).toBe('workspace');
      expect(plan.receiptPath).toBe('node_modules');
      expect(plan.receiptPath).not.toContain(root);
      expect(validateFixtureDependencies(plan, { expectedNextVersion: '16.3.8' })).toBe('16.3.8');
      expect(plan.receiptPath).toMatch(/^node_modules@sha256:[a-f0-9]{64}$/);
      expect(plan.dependencyFileCount).toBe(5);
      expect(plan.dependencyBytes).toBeGreaterThan(0);
      expect(() => validateFixtureDependencies(plan, { expectedNextVersion: '16.3.7' })).toThrow(
        'PINNED_DEPENDENCIES_INVALID',
      );
      const reactManifest = path.join(dependencies, 'react', 'package.json');
      const reactBefore = readFileSync(reactManifest);
      writeFileSync(reactManifest, '{"name":"react","version":"18.0.0"}\n');
      expect(() => validateFixtureDependencies(plan, { expectedNextVersion: '16.3.8' })).toThrow(
        'PINNED_DEPENDENCIES_INVALID',
      );
      writeFileSync(reactManifest, reactBefore);
      const reactSource = path.join(dependencies, 'react', 'index.js');
      const reactSourceBefore = readFileSync(reactSource);
      writeFileSync(reactSource, 'export const packageName = "changed";\n');
      expect(() => validateFixtureDependencies(plan, { expectedNextVersion: '16.3.8' })).toThrow(
        'PINNED_DEPENDENCIES_CHANGED',
      );
      writeFileSync(reactSource, reactSourceBefore);
      prepareFixtureDependencies(plan);
      expect(cleanupFixtureDependencies(plan)).toEqual({ complete: true, code: null });
      expect(existsSync(dependencies)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('requires an explicit absolute dependency directory only when the checkout has none', () => {
    const { root, webRoot } = fixtureRoot();
    try {
      const dependencies = nextDependencies(root);
      expect(() => resolveFixtureDependencies({ webRoot })).toThrow('EXPLICIT_DEPENDENCIES_REQUIRED');
      expect(() => resolveFixtureDependencies({ webRoot, argv: ['--dependencies', 'relative'] })).toThrow(
        'DEPENDENCIES_ARGUMENT_INVALID',
      );
      const plan = resolveFixtureDependencies({ webRoot, argv: ['--dependencies', dependencies] });
      expect(plan.receiptPath).toBe('explicit-node_modules');
      expect(plan.receiptPath).not.toContain(root);
      prepareFixtureDependencies(plan);
      expect(lstatSync(path.join(webRoot, 'node_modules')).isSymbolicLink()).toBe(true);
      expect(cleanupFixtureDependencies(plan)).toEqual({ complete: true, code: null });
      expect(existsSync(path.join(webRoot, 'node_modules'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('binds complete installed bytes and reports dependency drift without removing the edit', () => {
    const { root, webRoot } = fixtureRoot();
    try {
      const dependencies = path.join(webRoot, 'node_modules');
      mkdirSync(dependencies, { recursive: true });
      lockedDependencies(webRoot, dependencies);
      const originalTsconfig = Buffer.from('{"compilerOptions":{},"include":["source/**/*.ts"]}\n');
      writeFileSync(path.join(webRoot, 'tsconfig.json'), originalTsconfig);
      const plan = resolveFixtureDependencies({ webRoot });
      validateFixtureDependencies(plan, { expectedNextVersion: '16.3.8' });
      const reactSource = path.join(dependencies, 'react', 'index.js');
      writeFileSync(reactSource, 'export const packageName = "live-user-edit";\n');

      expect(cleanupPrivacyFixtureBuild({
        webRoot,
        dist: '.next-fixture',
        tsconfigBefore: originalTsconfig,
        nextEnvBefore: null,
        dependencyPlan: plan,
      })).toEqual({ failures: ['PINNED_DEPENDENCIES_CHANGED'], recoveryReceiptPath: null });
      expect(readFileSync(reactSource, 'utf8')).toContain('live-user-edit');
      expect(existsSync(dependencies)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('finishes every cleanup step and preserves unrelated tsconfig drift', () => {
    const { root, webRoot } = fixtureRoot();
    try {
      const dependencies = nextDependencies(root);
      const originalTsconfig = Buffer.from('{\n  "compilerOptions": {},\n  "include": ["source/**/*.ts"]\n}\n');
      const originalNextEnv = Buffer.from([
        '/// <reference types="next" />',
        '/// <reference types="next/image-types/global" />',
        'import "./.next-old/types/routes.d.ts";',
        '',
        '// NOTE: This file should not be edited',
        '// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.',
        '',
      ].join('\n'));
      writeFileSync(path.join(webRoot, 'tsconfig.json'), originalTsconfig);
      writeFileSync(path.join(webRoot, 'next-env.d.ts'), originalNextEnv);
      const plan = resolveFixtureDependencies({ webRoot, argv: ['--dependencies', dependencies] });
      prepareFixtureDependencies(plan);
      writeFileSync(path.join(webRoot, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {},
        include: ['source/**/*.ts', '.next-fixture/types/**/*.ts'],
        userEdit: 'preserved',
      }, null, 2));
      writeFileSync(path.join(webRoot, 'next-env.d.ts'), originalNextEnv.toString('utf8').replace('.next-old', '.next-fixture'));

      const cleanup = cleanupPrivacyFixtureBuild({
        webRoot,
        dist: '.next-fixture',
        tsconfigBefore: originalTsconfig,
        nextEnvBefore: originalNextEnv,
        dependencyPlan: plan,
        recoveryRoot: path.join(root, 'recovery'),
      });
      expect(cleanup.failures).toEqual(['UNEXPECTED_TSCONFIG_CHANGE']);
      expect(cleanup.recoveryReceiptPath).toBeNull();
      const liveTsconfig = JSON.parse(readFileSync(path.join(webRoot, 'tsconfig.json'), 'utf8'));
      expect(liveTsconfig.userEdit).toBe('preserved');
      expect(liveTsconfig.include).toContain('.next-fixture/types/**/*.ts');
      expect(readFileSync(path.join(webRoot, 'next-env.d.ts'))).toEqual(originalNextEnv);
      expect(existsSync(path.join(root, 'recovery'))).toBe(false);
      expect(existsSync(path.join(webRoot, 'node_modules'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('restores exact bytes after expected generated changes only', () => {
    const { root, webRoot } = fixtureRoot();
    try {
      const dependencies = nextDependencies(root);
      const originalTsconfig = Buffer.from('{"compilerOptions":{},"include":["source/**/*.ts"]}\n');
      writeFileSync(path.join(webRoot, 'tsconfig.json'), originalTsconfig);
      const plan = resolveFixtureDependencies({ webRoot, argv: ['--dependencies', dependencies] });
      prepareFixtureDependencies(plan);
      writeFileSync(path.join(webRoot, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {}, include: ['source/**/*.ts', '.next-fixture/dev/types/**/*.ts'],
      }));
      writeFileSync(path.join(webRoot, 'next-env.d.ts'), [
        '/// <reference types="next" />',
        '/// <reference types="next/image-types/global" />',
      ].join('\n'));
      expect(cleanupPrivacyFixtureBuild({
        webRoot,
        dist: '.next-fixture',
        tsconfigBefore: originalTsconfig,
        nextEnvBefore: null,
        dependencyPlan: plan,
        recoveryRoot: path.join(root, 'recovery'),
      })).toEqual({ failures: [], recoveryReceiptPath: null });
      expect(readFileSync(path.join(webRoot, 'tsconfig.json'))).toEqual(originalTsconfig);
      expect(existsSync(path.join(webRoot, 'next-env.d.ts'))).toBe(false);
      expect(existsSync(path.join(webRoot, 'node_modules'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('preserves an unexpected next-env edit while still removing its owned dependency link', () => {
    const { root, webRoot } = fixtureRoot();
    try {
      const dependencies = nextDependencies(root);
      const originalTsconfig = Buffer.from('{"compilerOptions":{},"include":["source/**/*.ts"]}\n');
      const originalNextEnv = Buffer.from([
        '/// <reference types="next" />',
        '/// <reference types="next/image-types/global" />',
        '',
      ].join('\n'));
      writeFileSync(path.join(webRoot, 'tsconfig.json'), originalTsconfig);
      writeFileSync(path.join(webRoot, 'next-env.d.ts'), `${originalNextEnv.toString('utf8')}// user edit\n`);
      const plan = resolveFixtureDependencies({ webRoot, argv: ['--dependencies', dependencies] });
      prepareFixtureDependencies(plan);
      const cleanup = cleanupPrivacyFixtureBuild({
        webRoot,
        dist: '.next-fixture',
        tsconfigBefore: originalTsconfig,
        nextEnvBefore: originalNextEnv,
        dependencyPlan: plan,
        recoveryRoot: path.join(root, 'recovery'),
      });
      expect(cleanup.failures).toEqual(['UNEXPECTED_NEXT_ENV_CHANGE']);
      expect(cleanup.recoveryReceiptPath).toBeNull();
      expect(readFileSync(path.join(webRoot, 'next-env.d.ts'), 'utf8')).toContain('// user edit');
      expect(existsSync(path.join(root, 'recovery'))).toBe(false);
      expect(existsSync(path.join(webRoot, 'node_modules'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('does not recreate tracked or generated files deleted during the build', () => {
    const { root, webRoot } = fixtureRoot();
    try {
      const dependencies = nextDependencies(root);
      const originalTsconfig = Buffer.from('{"compilerOptions":{},"include":["source/**/*.ts"]}\n');
      const originalNextEnv = Buffer.from('/// <reference types="next" />\n');
      writeFileSync(path.join(webRoot, 'tsconfig.json'), originalTsconfig);
      writeFileSync(path.join(webRoot, 'next-env.d.ts'), originalNextEnv);
      const plan = resolveFixtureDependencies({ webRoot, argv: ['--dependencies', dependencies] });
      prepareFixtureDependencies(plan);
      rmSync(path.join(webRoot, 'tsconfig.json'));
      rmSync(path.join(webRoot, 'next-env.d.ts'));

      expect(cleanupPrivacyFixtureBuild({
        webRoot,
        dist: '.next-fixture',
        tsconfigBefore: originalTsconfig,
        nextEnvBefore: originalNextEnv,
        dependencyPlan: plan,
      })).toEqual({ failures: ['NEXT_ENV_MISSING', 'TSCONFIG_MISSING'], recoveryReceiptPath: null });
      expect(existsSync(path.join(webRoot, 'tsconfig.json'))).toBe(false);
      expect(existsSync(path.join(webRoot, 'next-env.d.ts'))).toBe(false);
      expect(existsSync(path.join(webRoot, 'node_modules'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('does not delete a replaced dependency link and reports bounded failures', () => {
    const { root, webRoot } = fixtureRoot();
    try {
      const dependencies = nextDependencies(root);
      const replacement = path.join(root, 'replacement');
      mkdirSync(replacement);
      const plan = resolveFixtureDependencies({ webRoot, argv: ['--dependencies', dependencies] });
      prepareFixtureDependencies(plan);
      rmSync(path.join(webRoot, 'node_modules'));
      symlinkSync(replacement, path.join(webRoot, 'node_modules'), 'dir');
      expect(cleanupFixtureDependencies(plan)).toEqual({
        complete: false,
        code: 'OWNED_DEPENDENCY_LINK_CHANGED',
      });
      expect(lstatSync(path.join(webRoot, 'node_modules')).isSymbolicLink()).toBe(true);
      const failure = cleanupFailure(
        { failures: ['UNEXPECTED_TSCONFIG_CHANGE'], recoveryReceiptPath: '/private/local-recovery/receipt.json' },
        new Error('private path and diagnostics'),
      );
      expect(failure.message).toBe('PRIVACY_FIXTURE_CLEANUP_FAILED:BUILD_EXECUTION_FAILED,UNEXPECTED_TSCONFIG_CHANGE');
      expect(failure.message).not.toContain('private path');
      expect(failure.recoveryReceiptPath).toBe('/private/local-recovery/receipt.json');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('redacts checkout, dependency, and user-home paths from future evidence output', () => {
    const representativeLinuxHome = '/home/runner';
    const output = sanitizeFixtureOutput(
      'failed at /private/worktree/apps/web and /Users/example/.cache plus /home/runner/project and /home/ci-user/cache',
      ['/private/worktree/apps/web', representativeLinuxHome],
    );
    const normalized = output.replace(/<(?:LOCAL_PATH|USER_HOME)>/g, '<REDACTED_PATH>');
    expect(normalized).toBe(
      'failed at <REDACTED_PATH> and <REDACTED_PATH>/.cache plus <REDACTED_PATH>/project and <REDACTED_PATH>/cache',
    );
    for (const sensitiveFragment of ['/private/worktree', '/Users/', '/home/', 'example', 'runner', 'ci-user']) {
      expect(output).not.toContain(sensitiveFragment);
    }
  });
});
