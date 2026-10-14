import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const GENERATED_NEXT_ENV_LINES = new Set([
  '',
  '/// <reference types="next" />',
  '/// <reference types="next/image-types/global" />',
  '/// <reference types="next/navigation-types/compat/navigation" />',
  '// NOTE: This file should not be edited',
  '// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.',
]);
const GENERATED_NEXT_ENV_IMPORT = /^import ["']\.\/\.next[^"']*\/types\/(?:routes|root-params)\.d\.ts["'];$/;

function boundedCode(error, fallback) {
  try {
    const code = error?.code;
    if (typeof code === 'string' && /^[A-Z0-9_]{1,80}$/.test(code)) return code;
  } catch {
    // Error access itself is untrusted; use the fixed fallback.
  }
  return fallback;
}

function lstatIfPresent(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (boundedCode(error, 'LSTAT_FAILED') === 'ENOENT') return null;
    throw error;
  }
}

export function dependencyOverride(argv) {
  if (argv.length === 0) return null;
  if (argv.length !== 2 || argv[0] !== '--dependencies' || !isAbsolute(argv[1])) {
    throw Object.assign(new Error('DEPENDENCIES_ARGUMENT_INVALID'), { code: 'DEPENDENCIES_ARGUMENT_INVALID' });
  }
  return resolve(argv[1]);
}

export function parseFixtureArguments(argv, { defaultBasePort, allowRuntimeAttempt = false }) {
  const seen = new Set();
  const values = { dependencyPath: null, runId: null, runtimeAttempt: null, basePort: defaultBasePort };
  const flags = ['--dependencies', '--run-id', '--base-port', ...(allowRuntimeAttempt ? ['--runtime-attempt'] : [])];
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flags.includes(flag) || value === undefined || seen.has(flag)) {
      throw Object.assign(new Error('FIXTURE_ARGUMENTS_INVALID'), { code: 'FIXTURE_ARGUMENTS_INVALID' });
    }
    seen.add(flag);
    if (flag === '--dependencies') {
      if (!isAbsolute(value)) throw Object.assign(new Error('DEPENDENCIES_ARGUMENT_INVALID'), { code: 'DEPENDENCIES_ARGUMENT_INVALID' });
      values.dependencyPath = resolve(value);
    } else if (flag === '--run-id') {
      if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(value)) {
        throw Object.assign(new Error('RUN_ID_INVALID'), { code: 'RUN_ID_INVALID' });
      }
      values.runId = value;
    } else if (flag === '--runtime-attempt') {
      if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(value)) {
        throw Object.assign(new Error('RUNTIME_ATTEMPT_INVALID'), { code: 'RUNTIME_ATTEMPT_INVALID' });
      }
      values.runtimeAttempt = value;
    } else {
      if (!/^[0-9]{4,5}$/.test(value)) throw Object.assign(new Error('BASE_PORT_INVALID'), { code: 'BASE_PORT_INVALID' });
      const basePort = Number(value);
      if (!Number.isSafeInteger(basePort) || basePort < 1024 || basePort > 65533) {
        throw Object.assign(new Error('BASE_PORT_INVALID'), { code: 'BASE_PORT_INVALID' });
      }
      values.basePort = basePort;
    }
  }
  return values;
}

export function resolveFixtureRun({ argv, defaultOut, defaultDist, defaultBasePort, allowRuntimeAttempt = false }) {
  const parsed = parseFixtureArguments(argv, { defaultBasePort, allowRuntimeAttempt });
  const out = parsed.runId === null ? defaultOut : join(defaultOut, 'runs', parsed.runId);
  const dist = parsed.runId === null ? defaultDist : `${defaultDist}-${parsed.runId}`;
  const runtimeOut = parsed.runtimeAttempt === null ? out : join(out, 'runtime-attempts', parsed.runtimeAttempt);
  return {
    ...parsed,
    out,
    runtimeOut,
    dist,
    ports: {
      next: parsed.basePort,
      supabase: parsed.basePort + 1,
      gateway: parsed.basePort + 2,
    },
  };
}

export function prepareRuntimeOutput({ buildOut, runtimeOut, runtimeAttempt }) {
  if (runtimeAttempt === null) return { created: false };
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(runtimeAttempt)) {
    throw Object.assign(new Error('RUNTIME_ATTEMPT_INVALID'), { code: 'RUNTIME_ATTEMPT_INVALID' });
  }
  const parent = join(buildOut, 'runtime-attempts');
  if (resolve(runtimeOut) !== resolve(parent, runtimeAttempt)) {
    throw Object.assign(new Error('RUNTIME_ATTEMPT_OUTPUT_INVALID'), { code: 'RUNTIME_ATTEMPT_OUTPUT_INVALID' });
  }
  try {
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    mkdirSync(runtimeOut, { mode: 0o700 });
  } catch (error) {
    if (boundedCode(error, 'RUNTIME_ATTEMPT_CREATE_FAILED') === 'EEXIST') {
      throw Object.assign(new Error('RUNTIME_ATTEMPT_ALREADY_EXISTS'), { code: 'RUNTIME_ATTEMPT_ALREADY_EXISTS' });
    }
    throw Object.assign(new Error('RUNTIME_ATTEMPT_CREATE_FAILED'), { code: 'RUNTIME_ATTEMPT_CREATE_FAILED' });
  }
  return { created: true };
}

export function resolveFixtureDependencies({ webRoot, argv = [], dependencyPath = undefined }) {
  const nodeModules = join(webRoot, 'node_modules');
  const override = dependencyPath === undefined ? dependencyOverride(argv) : dependencyPath;
  const workspaceEntry = lstatIfPresent(nodeModules);
  if (workspaceEntry !== null) {
    if (override !== null) {
      throw Object.assign(new Error('WORKSPACE_DEPENDENCIES_ALREADY_PRESENT'), { code: 'WORKSPACE_DEPENDENCIES_ALREADY_PRESENT' });
    }
    if (!statSync(nodeModules).isDirectory()) {
      throw Object.assign(new Error('WORKSPACE_DEPENDENCIES_INVALID'), { code: 'WORKSPACE_DEPENDENCIES_INVALID' });
    }
    return {
      mode: 'workspace',
      source: realpathSync(nodeModules),
      nodeModules,
      receiptPath: 'node_modules',
      linkCreated: false,
    };
  }
  if (override === null || !existsSync(override) || !statSync(override).isDirectory()) {
    throw Object.assign(new Error('EXPLICIT_DEPENDENCIES_REQUIRED'), { code: 'EXPLICIT_DEPENDENCIES_REQUIRED' });
  }
  const source = realpathSync(override);
  if (source === resolve(nodeModules)) {
    throw Object.assign(new Error('EXPLICIT_DEPENDENCIES_INVALID'), { code: 'EXPLICIT_DEPENDENCIES_INVALID' });
  }
  return {
    mode: 'explicit',
    source,
    nodeModules,
    receiptPath: 'explicit-node_modules',
    linkCreated: false,
  };
}

export function fixtureServerInvocation({ sourcePath, evaluationRoot, defaultBasePort, basePort }) {
  const source = readFileSync(sourcePath, 'utf8');
  const sourceSha256 = createHash('sha256').update(source).digest('hex');
  if (basePort === defaultBasePort) {
    return { args: [sourcePath], sourceSha256, runtimeSha256: sourceSha256, portsPatched: false };
  }
  let runtime = source;
  for (const [name, offset] of [['NEXT', 0], ['SUPABASE', 1], ['GATEWAY', 2]]) {
    const expected = `const ${name}_PORT = ${defaultBasePort + offset};`;
    if (runtime.split(expected).length !== 2) {
      throw Object.assign(new Error('FIXTURE_SERVER_PORT_CONTRACT_INVALID'), { code: 'FIXTURE_SERVER_PORT_CONTRACT_INVALID' });
    }
    runtime = runtime.replace(expected, `const ${name}_PORT = ${basePort + offset};`);
  }
  const importPattern = /from '([^']*fixture-data\.mjs)';/;
  const match = runtime.match(importPattern);
  if (!match || runtime.match(new RegExp(importPattern.source, 'g'))?.length !== 1) {
    throw Object.assign(new Error('FIXTURE_SERVER_IMPORT_CONTRACT_INVALID'), { code: 'FIXTURE_SERVER_IMPORT_CONTRACT_INVALID' });
  }
  const fixtureDataPath = resolve(dirname(sourcePath), match[1]);
  const fixtureDataRelative = relative(evaluationRoot, fixtureDataPath).replaceAll('\\', '/');
  if (fixtureDataRelative === '..' || fixtureDataRelative.startsWith('../') || isAbsolute(fixtureDataRelative)) {
    throw Object.assign(new Error('FIXTURE_SERVER_IMPORT_OUTSIDE_ROOT'), { code: 'FIXTURE_SERVER_IMPORT_OUTSIDE_ROOT' });
  }
  runtime = runtime.replace(importPattern, `from './${fixtureDataRelative}';`);
  return {
    args: ['--input-type=module', '--eval', runtime],
    sourceSha256,
    runtimeSha256: createHash('sha256').update(runtime).digest('hex'),
    portsPatched: true,
  };
}

function dependencyFailure(code) {
  return Object.assign(new Error(code), { code });
}

function dependencyPackageRows(document) {
  if (document?.lockfileVersion !== 3 || document?.packages === null || typeof document?.packages !== 'object') {
    throw dependencyFailure('PINNED_DEPENDENCY_LOCK_INVALID');
  }
  return Object.entries(document.packages)
    .filter(([path, row]) => path.startsWith('node_modules/') && row !== null && typeof row === 'object' && typeof row.version === 'string')
    .sort(([left], [right]) => left.localeCompare(right));
}

function packageLockIdentity(row) {
  return JSON.stringify({
    version: row.version,
    integrity: typeof row.integrity === 'string' ? row.integrity : null,
    resolved: typeof row.resolved === 'string' ? row.resolved : null,
    link: row.link === true,
  });
}

function installedDependencyIdentity(source) {
  const hash = createHash('sha256');
  let files = 0;
  let bytes = 0;
  function walk(directory, prefix = '') {
    for (const name of readdirSync(directory).sort()) {
      const absolute = join(directory, name);
      const path = prefix ? `${prefix}/${name}` : name;
      const entry = lstatSync(absolute);
      const mode = entry.mode & 0o777;
      if (entry.isDirectory()) {
        hash.update(`directory\0${path}\0${mode.toString(8)}\0`);
        walk(absolute, path);
      } else if (entry.isFile()) {
        const content = readFileSync(absolute);
        hash.update(`file\0${path}\0${mode.toString(8)}\0${content.byteLength}\0`);
        hash.update(content);
        files += 1;
        bytes += content.byteLength;
      } else if (entry.isSymbolicLink()) {
        const target = readlinkSync(absolute);
        const resolvedTarget = resolve(dirname(absolute), target);
        const relativeTarget = relative(source, resolvedTarget);
        if (relativeTarget === '..' || relativeTarget.startsWith('../') || isAbsolute(relativeTarget)) {
          throw dependencyFailure('PINNED_DEPENDENCY_LINK_OUTSIDE_ROOT');
        }
        hash.update(`symlink\0${path}\0${mode.toString(8)}\0${target}\0`);
      } else {
        throw dependencyFailure('PINNED_DEPENDENCY_ENTRY_INVALID');
      }
    }
  }
  walk(source);
  return { sha256: hash.digest('hex'), files, bytes };
}

function verifyDependencyIdentity(plan) {
  if (typeof plan.dependencyContentSha256 !== 'string') return { complete: true, code: null };
  try {
    const current = installedDependencyIdentity(plan.source);
    if (current.sha256 !== plan.dependencyContentSha256) {
      return { complete: false, code: 'PINNED_DEPENDENCIES_CHANGED' };
    }
    return { complete: true, code: null };
  } catch (error) {
    return { complete: false, code: boundedCode(error, 'PINNED_DEPENDENCY_IDENTITY_CHECK_FAILED') };
  }
}

export function validateFixtureDependencies(plan, { expectedNextVersion }) {
  const lockPath = join(dirname(plan.nodeModules), 'package-lock.json');
  const installedLockPath = join(plan.source, '.package-lock.json');
  if (!existsSync(lockPath) || !statSync(lockPath).isFile()
    || !existsSync(installedLockPath) || !statSync(installedLockPath).isFile()) {
    throw dependencyFailure('PINNED_DEPENDENCY_LOCK_MISSING');
  }

  let lock;
  let installedLock;
  try {
    lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    installedLock = JSON.parse(readFileSync(installedLockPath, 'utf8'));
  } catch {
    throw dependencyFailure('PINNED_DEPENDENCY_LOCK_INVALID');
  }
  const expectedRows = dependencyPackageRows(lock);
  const installedRows = dependencyPackageRows(installedLock);
  const expected = new Map(expectedRows);
  const installed = new Map(installedRows);
  const lockedNext = expected.get('node_modules/next');
  if (typeof expectedNextVersion !== 'string' || lockedNext?.version !== expectedNextVersion) {
    throw dependencyFailure('PINNED_DEPENDENCIES_INVALID');
  }

  for (const [path, row] of expectedRows) {
    if (!installed.has(path) && row.optional !== true) {
      throw dependencyFailure('PINNED_DEPENDENCIES_MISSING');
    }
  }
  for (const [path, installedRow] of installedRows) {
    const expectedRow = expected.get(path);
    if (!expectedRow || packageLockIdentity(installedRow) !== packageLockIdentity(expectedRow)) {
      throw dependencyFailure('PINNED_DEPENDENCIES_INVALID');
    }
    const manifestPath = join(plan.source, path.slice('node_modules/'.length), 'package.json');
    if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) {
      throw dependencyFailure('PINNED_DEPENDENCIES_MISSING');
    }
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      throw dependencyFailure('PINNED_DEPENDENCIES_INVALID');
    }
    if (manifest.version !== expectedRow.version) {
      throw dependencyFailure('PINNED_DEPENDENCIES_INVALID');
    }
  }

  let identity;
  try {
    identity = installedDependencyIdentity(plan.source);
  } catch (error) {
    if (typeof error?.code === 'string' && error.code.startsWith('PINNED_DEPENDENCY_')) throw error;
    throw dependencyFailure('PINNED_DEPENDENCY_IDENTITY_INVALID');
  }
  if (typeof plan.dependencyContentSha256 === 'string' && plan.dependencyContentSha256 !== identity.sha256) {
    throw dependencyFailure('PINNED_DEPENDENCIES_CHANGED');
  }
  const receiptLabel = typeof plan.dependencyReceiptLabel === 'string'
    ? plan.dependencyReceiptLabel
    : plan.receiptPath;
  plan.dependencyReceiptLabel = receiptLabel;
  plan.dependencyContentSha256 = identity.sha256;
  plan.dependencyFileCount = identity.files;
  plan.dependencyBytes = identity.bytes;
  plan.receiptPath = `${receiptLabel}@sha256:${identity.sha256}`;
  return expectedNextVersion;
}

export function prepareFixtureDependencies(plan) {
  if (plan.mode === 'workspace') return plan;
  if (lstatIfPresent(plan.nodeModules) !== null) {
    throw Object.assign(new Error('NODE_MODULES_ALREADY_EXISTS'), { code: 'NODE_MODULES_ALREADY_EXISTS' });
  }
  symlinkSync(plan.source, plan.nodeModules, 'dir');
  plan.linkCreated = true;
  return plan;
}

export function cleanupFixtureDependencies(plan) {
  if (!plan.linkCreated) return { complete: true, code: null };
  try {
    const entry = lstatIfPresent(plan.nodeModules);
    if (entry === null) return { complete: false, code: 'OWNED_DEPENDENCY_LINK_MISSING' };
    if (!entry.isSymbolicLink() || realpathSync(plan.nodeModules) !== plan.source) {
      return { complete: false, code: 'OWNED_DEPENDENCY_LINK_CHANGED' };
    }
    unlinkSync(plan.nodeModules);
    plan.linkCreated = false;
    return { complete: true, code: null };
  } catch (error) {
    return { complete: false, code: boundedCode(error, 'DEPENDENCY_LINK_CLEANUP_FAILED') };
  }
}

function restoreTsconfig({ path, before, generatedIncludes }) {
  let currentBytes;
  try {
    currentBytes = readFileSync(path);
  } catch {
    return 'TSCONFIG_MISSING';
  }
  try {
    const original = JSON.parse(before.toString('utf8'));
    const current = JSON.parse(currentBytes.toString('utf8'));
    if (!Array.isArray(current.include) || !Array.isArray(original.include)) {
      return 'TSCONFIG_SHAPE_CHANGED';
    }
    const generated = new Set(generatedIncludes);
    current.include = current.include.filter((entry) => !generated.has(entry));
    if (JSON.stringify(current) === JSON.stringify(original)) {
      writeFileSync(path, before);
      return null;
    }
    return 'UNEXPECTED_TSCONFIG_CHANGE';
  } catch {
    return 'TSCONFIG_PARSE_FAILED';
  }
}

function restoreNextEnv({ path, before }) {
  try {
    const normalizeGenerated = (bytes) => {
      const text = bytes.toString('utf8');
      const withoutWindowsNewlines = text.replaceAll('\r\n', '');
      if (withoutWindowsNewlines.includes('\r') || withoutWindowsNewlines.includes('\n')) {
        const hasWindowsNewlines = text.includes('\r\n');
        const hasUnixNewlines = withoutWindowsNewlines.includes('\n');
        if (hasWindowsNewlines && hasUnixNewlines) return null;
      }
      const newline = text.includes('\r\n') ? '\r\n' : '\n';
      const lines = text.split(newline);
      if (!lines.every((line) => GENERATED_NEXT_ENV_LINES.has(line) || GENERATED_NEXT_ENV_IMPORT.test(line))) return null;
      return lines.filter((line) => !GENERATED_NEXT_ENV_IMPORT.test(line)).join(newline);
    };
    if (before !== null) {
      if (!existsSync(path)) return 'NEXT_ENV_MISSING';
      const current = readFileSync(path);
      if (current.equals(before)) return null;
      const originalBase = normalizeGenerated(before);
      const currentBase = normalizeGenerated(current);
      if (originalBase === null || currentBase === null || originalBase !== currentBase) {
        return 'UNEXPECTED_NEXT_ENV_CHANGE';
      }
      writeFileSync(path, before);
      return null;
    }
    if (!existsSync(path)) return null;
    const current = readFileSync(path);
    if (normalizeGenerated(current) === null) return 'UNEXPECTED_NEXT_ENV_CHANGE';
    unlinkSync(path);
    return null;
  } catch (error) {
    return boundedCode(error, 'NEXT_ENV_RESTORE_FAILED');
  }
}

export function cleanupPrivacyFixtureBuild({
  webRoot,
  dist,
  tsconfigBefore,
  nextEnvBefore,
  dependencyPlan,
}) {
  const failures = [];
  const generatedIncludes = [`${dist}/types/**/*.ts`, `${dist}/dev/types/**/*.ts`];
  const tsconfigCode = restoreTsconfig({
    path: join(webRoot, 'tsconfig.json'),
    before: tsconfigBefore,
    generatedIncludes,
  });
  if (tsconfigCode) failures.push(tsconfigCode);

  const nextEnvCode = restoreNextEnv({ path: join(webRoot, 'next-env.d.ts'), before: nextEnvBefore });
  if (nextEnvCode) failures.push(nextEnvCode);

  const dependencyIdentity = verifyDependencyIdentity(dependencyPlan);
  if (!dependencyIdentity.complete) failures.push(dependencyIdentity.code);
  const dependency = cleanupFixtureDependencies(dependencyPlan);
  if (!dependency.complete) failures.push(dependency.code);
  return { failures: [...new Set(failures)].sort(), recoveryReceiptPath: null };
}

export function cleanupFailure(cleanup, primaryError = null) {
  const primary = primaryError ? boundedCode(primaryError, 'BUILD_EXECUTION_FAILED') : null;
  const codes = [...new Set([...(primary ? [primary] : []), ...cleanup.failures])].sort();
  return Object.assign(new Error(`PRIVACY_FIXTURE_CLEANUP_FAILED:${codes.join(',')}`), {
    code: 'PRIVACY_FIXTURE_CLEANUP_FAILED',
    failures: codes,
    recoveryReceiptPath: cleanup.recoveryReceiptPath,
  });
}

export function sanitizeFixtureOutput(value, paths = []) {
  let output = String(value);
  const replacements = [...new Set([
    ...paths,
    process.env.HOME,
  ].filter((entry) => typeof entry === 'string' && isAbsolute(entry)))]
    .sort((left, right) => right.length - left.length);
  for (const path of replacements) output = output.split(path).join('<LOCAL_PATH>');
  return output
    .replace(/\/Users\/[^/\s]+/g, '<USER_HOME>')
    .replace(/\/home\/[^/\s]+/g, '<USER_HOME>');
}
