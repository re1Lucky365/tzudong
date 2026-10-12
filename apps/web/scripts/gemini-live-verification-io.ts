import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeSync,
} from 'node:fs';
import type { Stats } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_OPERATOR_ENV_BYTES = 128 * 1024;
const DEFAULT_DESCRIPTOR_HELPER = '/usr/bin/python3';
const DESCRIPTOR_HELPER_SOURCE = String.raw`
import errno
import os
import stat
import sys

ROOT_FD = 3

def fail(code):
    sys.stdout.write(code)
    raise SystemExit(2)

def valid_name(value):
    return value not in ('', '.', '..') and '/' not in value and chr(0) not in value

def validate_file(value, expected_dev=None, expected_ino=None, expected_size=None):
    if not stat.S_ISREG(value.st_mode) or value.st_nlink != 1:
        fail('identity')
    if expected_dev is not None and (value.st_dev != expected_dev or value.st_ino != expected_ino):
        fail('identity')
    if expected_size is not None and value.st_size != expected_size:
        fail('identity')
    if stat.S_IMODE(value.st_mode) != 0o600:
        fail('identity')

def write_all(fd, payload):
    offset = 0
    while offset < len(payload):
        written = os.pwrite(fd, payload[offset:], offset)
        if written <= 0:
            fail('failed')
        offset += written
    os.ftruncate(fd, len(payload))
    os.fsync(fd)

def emit(value):
    sys.stdout.write('ok:%d:%d:%d:%d:%d' % (
        value.st_dev,
        value.st_ino,
        value.st_size,
        stat.S_IMODE(value.st_mode),
        value.st_nlink,
    ))

try:
    operation = sys.argv[1]
    if operation == 'mkdirs':
        current = os.dup(ROOT_FD)
        try:
            for name in sys.argv[2:]:
                if not valid_name(name):
                    fail('invalid')
                try:
                    os.mkdir(name, 0o700, dir_fd=current)
                except FileExistsError:
                    pass
                following = os.open(
                    name,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                    dir_fd=current,
                )
                os.close(current)
                current = following
            final = os.fstat(current)
            if not stat.S_ISDIR(final.st_mode):
                fail('identity')
            emit(final)
        finally:
            os.close(current)
    else:
        name = sys.argv[2]
        if not valid_name(name):
            fail('invalid')
        if operation == 'create':
            try:
                fd = os.open(
                    name,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                    0o600,
                    dir_fd=ROOT_FD,
                )
            except FileExistsError:
                fail('exists')
            try:
                os.fchmod(fd, 0o600)
                payload = sys.stdin.buffer.read()
                write_all(fd, payload)
                final = os.fstat(fd)
                validate_file(final, expected_size=len(payload))
                emit(final)
            finally:
                os.close(fd)
        elif operation in ('update', 'verify'):
            expected_dev = int(sys.argv[3])
            expected_ino = int(sys.argv[4])
            fd = os.open(
                name,
                (os.O_WRONLY if operation == 'update' else os.O_RDONLY) | os.O_NOFOLLOW,
                dir_fd=ROOT_FD,
            )
            try:
                before = os.fstat(fd)
                validate_file(before, expected_dev, expected_ino)
                if operation == 'update':
                    payload = sys.stdin.buffer.read()
                    write_all(fd, payload)
                    final = os.fstat(fd)
                    validate_file(final, expected_dev, expected_ino, len(payload))
                else:
                    final = before
                emit(final)
            finally:
                os.close(fd)
        else:
            fail('invalid')
except OSError as error:
    if operation == 'create' and error.errno in (errno.EEXIST, errno.ELOOP):
        fail('exists')
    fail('identity' if error.errno in (errno.ENOENT, errno.ENOTDIR, errno.ELOOP) else 'failed')
except (IndexError, TypeError, ValueError):
    fail('invalid')
`;
export const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const PERFORMANCE_ROOT = resolve(WEB_ROOT, 'performance');

type DescriptorFileIdentity = {
  dev: number;
  ino: number;
  size: number;
  mode: number;
  nlink: number;
};

export type VerifiedDirectoryHandle = {
  path: string;
  fd: number;
  identity: Stats;
  close: () => void;
};

type ArgumentOptions = {
  allowCurrentCandidate?: boolean;
  allowProImage?: boolean;
  defaultOutputSubdirectory: string;
};

export type LiveVerificationArguments = {
  envFile: string;
  outputDirectory: string;
  currentCandidate: boolean;
  proImage: boolean;
};

function inside(candidate: string, root: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

export function resolveEvidenceDirectory(value: string | undefined, defaultSubdirectory: string): string {
  const candidate = resolve(WEB_ROOT, value ?? `performance/${defaultSubdirectory}`);
  if (candidate === PERFORMANCE_ROOT || !inside(candidate, PERFORMANCE_ROOT)) {
    throw new Error('verification_output_outside_performance');
  }
  return candidate;
}

export function parseLiveVerificationArguments(argv: string[], options: ArgumentOptions): LiveVerificationArguments {
  const [envFile, ...args] = argv;
  if (!envFile || !isAbsolute(envFile)) throw new Error('absolute_operator_env_required');

  let currentCandidate = false;
  let proImage = false;
  let outputDirectoryValue: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--current-candidate-defaults' && options.allowCurrentCandidate && !currentCandidate) {
      currentCandidate = true;
      continue;
    }
    if (arg === '--pro-image' && options.allowProImage && !proImage) {
      proImage = true;
      continue;
    }
    if (arg === '--output-dir' && outputDirectoryValue === undefined) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('verification_arguments_invalid');
      outputDirectoryValue = value;
      index += 1;
      continue;
    }
    throw new Error('verification_arguments_invalid');
  }

  return {
    envFile,
    outputDirectory: resolveEvidenceDirectory(outputDirectoryValue, options.defaultOutputSubdirectory),
    currentCandidate,
    proImage,
  };
}

function assertDirectory(path: string, code = 'verification_output_invalid'): Stats {
  let stat: Stats;
  try {
    stat = lstatSync(path);
  } catch {
    throw new Error(code);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(code);
  return stat;
}

function assertOpenDirectory(directory: VerifiedDirectoryHandle, code: string): void {
  const opened = fstatSync(directory.fd);
  if (!opened.isDirectory() || opened.dev !== directory.identity.dev || opened.ino !== directory.identity.ino) {
    throw new Error(code);
  }
}

export function openVerifiedDirectory(path: string, code = 'verification_output_invalid'): VerifiedDirectoryHandle {
  const identity = assertDirectory(path, code);
  const flags = fsConstants.O_RDONLY
    | (process.platform === 'win32' ? 0 : (fsConstants.O_DIRECTORY ?? 0) | (fsConstants.O_NOFOLLOW ?? 0));
  let fd: number;
  try {
    fd = openSync(path, flags);
  } catch {
    throw new Error(code);
  }
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    closeSync(fd);
  };
  try {
    const opened = fstatSync(fd);
    const current = assertDirectory(path, code);
    if (!opened.isDirectory() || opened.dev !== identity.dev || opened.ino !== identity.ino
      || current.dev !== opened.dev || current.ino !== opened.ino) {
      throw new Error(code);
    }
    return { path, fd, identity: opened, close };
  } catch (error) {
    close();
    throw error;
  }
}

function openStablePathDirectory(path: string, code = 'verification_output_invalid'): VerifiedDirectoryHandle {
  const expected = assertDirectory(path, code);
  try {
    if (realpathSync(path) !== resolve(path)) throw new Error(code);
  } catch {
    throw new Error(code);
  }
  const directory = openVerifiedDirectory(path, code);
  if (directory.identity.dev !== expected.dev || directory.identity.ino !== expected.ino) {
    directory.close();
    throw new Error(code);
  }
  return directory;
}

type DescriptorOperationCodes = {
  exists: string;
  identity: string;
  failed: string;
};

function descriptorHelperPath(): string {
  const configured = process.env.TZUDONG_PYTHON;
  const candidate = configured === undefined ? DEFAULT_DESCRIPTOR_HELPER : configured;
  if (!isAbsolute(candidate)) throw new Error('descriptor_helper_path_invalid');
  return candidate;
}

function runDescriptorOperation(
  directory: VerifiedDirectoryHandle,
  operation: 'mkdirs' | 'create' | 'update' | 'verify',
  args: string[],
  input: Buffer | undefined,
  codes: DescriptorOperationCodes,
): DescriptorFileIdentity {
  assertOpenDirectory(directory, codes.identity);
  const result = spawnSync(descriptorHelperPath(), ['-I', '-c', DESCRIPTOR_HELPER_SOURCE, operation, ...args], {
    cwd: '/',
    encoding: 'utf8',
    // Next's project-wide ProcessEnv requires NODE_ENV; this isolated Python
    // child intentionally receives no environment variables.
    env: {} as NodeJS.ProcessEnv,
    input,
    maxBuffer: 64 * 1024,
    stdio: ['pipe', 'pipe', 'pipe', directory.fd],
  });
  const output = typeof result.stdout === 'string' ? result.stdout.trim() : '';
  if (result.error || result.status !== 0) {
    if (output === 'exists') throw new Error(codes.exists);
    if (output === 'identity' || output === 'invalid') throw new Error(codes.identity);
    throw new Error(codes.failed);
  }
  const match = /^ok:(\d+):(\d+):(\d+):(\d+):(\d+)$/.exec(output);
  if (!match) throw new Error(codes.failed);
  const values = match.slice(1).map(Number);
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) throw new Error(codes.failed);
  const [dev, ino, size, mode, nlink] = values;
  assertOpenDirectory(directory, codes.identity);
  return { dev, ino, size, mode, nlink };
}

function fileNameFromPath(path: string, code: string): string {
  const name = basename(path);
  if (!name || name === '.' || name === '..' || resolve(dirname(path), name) !== resolve(path)) {
    throw new Error(code);
  }
  return name;
}

function assertSingleFileName(name: string, code: string): void {
  if (!name || name === '.' || name === '..' || basename(name) !== name || name.includes('\0')) {
    throw new Error(code);
  }
}

function sameIdentity(actual: DescriptorFileIdentity, expected: DescriptorFileIdentity): boolean {
  return actual.dev === expected.dev && actual.ino === expected.ino;
}

export function prepareEvidenceDirectory(directory: string): string {
  const target = resolve(directory);
  if (target === PERFORMANCE_ROOT || !inside(target, PERFORMANCE_ROOT)) {
    throw new Error('verification_output_outside_performance');
  }
  const root = assertDirectory(PERFORMANCE_ROOT);
  if (realpathSync(PERFORMANCE_ROOT) !== PERFORMANCE_ROOT) throw new Error('verification_output_invalid');

  if (process.platform !== 'win32') {
    const rootHandle = openVerifiedDirectory(PERFORMANCE_ROOT);
    try {
      if (rootHandle.identity.dev !== root.dev || rootHandle.identity.ino !== root.ino) {
        throw new Error('verification_output_identity_changed');
      }
      const parts = relative(PERFORMANCE_ROOT, target).split(sep).filter(Boolean);
      const created = runDescriptorOperation(rootHandle, 'mkdirs', parts, undefined, {
        exists: 'verification_output_invalid',
        identity: 'verification_output_invalid',
        failed: 'verification_output_invalid',
      });
      assertSameDirectory(PERFORMANCE_ROOT, rootHandle.identity);
      const targetHandle = openVerifiedDirectory(target);
      try {
        if (targetHandle.identity.dev !== created.dev || targetHandle.identity.ino !== created.ino) {
          throw new Error('verification_output_identity_changed');
        }
      } finally {
        targetHandle.close();
      }
      if (realpathSync(target) !== target) throw new Error('verification_output_invalid');
      const currentRoot = assertDirectory(PERFORMANCE_ROOT);
      if (currentRoot.dev !== root.dev || currentRoot.ino !== root.ino) {
        throw new Error('verification_output_identity_changed');
      }
      return target;
    } finally {
      rootHandle.close();
    }
  }

  const rel = relative(PERFORMANCE_ROOT, target);
  let cursor = PERFORMANCE_ROOT;
  for (const part of rel.split(sep).filter(Boolean)) {
    const next = resolve(cursor, part);
    const parentIdentity = assertDirectory(cursor);
    try {
      assertDirectory(next);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'verification_output_invalid') throw error;
      try {
        mkdirSync(next, { mode: 0o700 });
      } catch (mkdirError) {
        if (!(mkdirError && typeof mkdirError === 'object' && 'code' in mkdirError && mkdirError.code === 'EEXIST')) {
          throw new Error('verification_output_invalid');
        }
      }
      assertDirectory(next);
    }
    assertSameDirectory(cursor, parentIdentity);
    cursor = next;
  }
  if (realpathSync(target) !== target) throw new Error('verification_output_invalid');
  const currentRoot = assertDirectory(PERFORMANCE_ROOT);
  if (currentRoot.dev !== root.dev || currentRoot.ino !== root.ino) throw new Error('verification_output_identity_changed');
  return target;
}

export function assertNewArtifactPath(path: string, code = 'existing_receipt_requires_readback'): void {
  try {
    lstatSync(path);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(code);
}

export function readSecureOperatorEnv(path: string): string {
  if (!isAbsolute(path)) throw new Error('absolute_operator_env_required');
  let link: Stats;
  try {
    link = lstatSync(path);
  } catch {
    throw new Error('operator_env_file_invalid');
  }
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : link.uid;
  if (link.isSymbolicLink() || !link.isFile() || link.nlink !== 1 || link.uid !== currentUid) {
    throw new Error('operator_env_file_invalid');
  }
  if ((link.mode & 0o077) !== 0 || (link.mode & 0o400) === 0) {
    throw new Error('operator_env_file_permissions_invalid');
  }
  if (!Number.isSafeInteger(link.size) || link.size > MAX_OPERATOR_ENV_BYTES) {
    throw new Error('operator_env_file_invalid');
  }

  const flags = fsConstants.O_RDONLY | (process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW ?? 0));
  let fd: number;
  try {
    fd = openSync(path, flags);
  } catch {
    throw new Error('operator_env_file_invalid');
  }
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== link.dev || opened.ino !== link.ino
      || opened.uid !== currentUid || opened.size !== link.size || (opened.mode & 0o077) !== 0) {
      throw new Error('operator_env_file_invalid');
    }
    const content = readFileSync(fd, 'utf8');
    const after = fstatSync(fd);
    if (Buffer.byteLength(content) !== opened.size || after.dev !== opened.dev || after.ino !== opened.ino
      || after.nlink !== 1 || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
      throw new Error('operator_env_file_changed');
    }
    return content;
  } finally {
    closeSync(fd);
  }
}

function writeAll(fd: number, bytes: Buffer): void {
  let offset = 0;
  while (offset < bytes.length) {
    offset += writeSync(fd, bytes, offset, bytes.length - offset, offset);
  }
}

function assertSameDirectory(path: string, expected: Stats): void {
  const current = assertDirectory(path, 'verification_output_identity_changed');
  if (current.dev !== expected.dev || current.ino !== expected.ino) {
    throw new Error('verification_output_identity_changed');
  }
}

export function assertOpenFileMatchesPath(path: string, fd: number, code = 'file_path_identity_changed'): Stats {
  const opened = fstatSync(fd);
  let current: Stats;
  try {
    current = lstatSync(path);
  } catch {
    throw new Error(code);
  }
  if (!opened.isFile() || opened.nlink !== 1 || current.isSymbolicLink() || !current.isFile()
    || current.nlink !== 1 || current.dev !== opened.dev || current.ino !== opened.ino) {
    throw new Error(code);
  }
  return opened;
}

export type ExclusiveJsonReceipt = {
  path: string;
  write: (value: Record<string, unknown>) => void;
  close: () => void;
};

function createExclusiveFileInDirectory(
  directory: VerifiedDirectoryHandle,
  name: string,
  bytes: Buffer,
  codes: DescriptorOperationCodes,
): DescriptorFileIdentity {
  assertSingleFileName(name, codes.identity);
  const identity = runDescriptorOperation(directory, 'create', [name], bytes, codes);
  if (identity.nlink !== 1 || identity.size !== bytes.length || identity.mode !== 0o600) {
    throw new Error(codes.identity);
  }
  return identity;
}

function updateFileInDirectory(
  directory: VerifiedDirectoryHandle,
  name: string,
  expected: DescriptorFileIdentity,
  bytes: Buffer | undefined,
  codes: DescriptorOperationCodes,
): DescriptorFileIdentity {
  assertSingleFileName(name, codes.identity);
  const operation = bytes === undefined ? 'verify' : 'update';
  const identity = runDescriptorOperation(
    directory,
    operation,
    [name, String(expected.dev), String(expected.ino)],
    bytes,
    codes,
  );
  if (!sameIdentity(identity, expected) || identity.nlink !== 1 || identity.mode !== 0o600
    || (bytes !== undefined && identity.size !== bytes.length)) {
    throw new Error(codes.identity);
  }
  return identity;
}

export function writeExclusiveArtifactInVerifiedDirectory(
  directory: VerifiedDirectoryHandle,
  name: string,
  bytes: Buffer,
): void {
  createExclusiveFileInDirectory(directory, name, bytes, {
    exists: 'existing_artifact_requires_readback',
    identity: 'artifact_write_identity_changed',
    failed: 'artifact_write_failed',
  });
}

export function reserveJsonReceipt(path: string, initial: Record<string, unknown>): ExclusiveJsonReceipt {
  const parent = dirname(path);
  if (process.platform !== 'win32') {
    const name = fileNameFromPath(path, 'receipt_reservation_failed');
    const directory = openStablePathDirectory(parent);
    const codes: DescriptorOperationCodes = {
      exists: 'existing_receipt_requires_readback',
      identity: 'receipt_write_identity_changed',
      failed: 'receipt_reservation_failed',
    };
    let identity: DescriptorFileIdentity;
    try {
      assertSameDirectory(parent, directory.identity);
      const bytes = Buffer.from(`${JSON.stringify(initial, null, 2)}\n`);
      identity = createExclusiveFileInDirectory(directory, name, bytes, codes);
      assertSameDirectory(parent, directory.identity);
    } catch (error) {
      directory.close();
      throw error;
    }

    let closed = false;
    const write = (value: Record<string, unknown>) => {
      if (closed) throw new Error('receipt_writer_closed');
      assertSameDirectory(parent, directory.identity);
      const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
      identity = updateFileInDirectory(directory, name, identity, bytes, codes);
      assertSameDirectory(parent, directory.identity);
    };
    const close = () => {
      if (closed) return;
      closed = true;
      try {
        assertSameDirectory(parent, directory.identity);
        updateFileInDirectory(directory, name, identity, undefined, codes);
        assertSameDirectory(parent, directory.identity);
      } finally {
        directory.close();
      }
    };
    return { path, write, close };
  }

  const parentIdentity = assertDirectory(parent);
  const flags = process.platform === 'win32'
    ? 'wx'
    : fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0);
  let fd: number;
  try {
    fd = openSync(path, flags, 0o600);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error.code === 'EEXIST' || error.code === 'ELOOP')) {
      throw new Error('existing_receipt_requires_readback');
    }
    throw new Error('receipt_reservation_failed');
  }

  let closed = false;
  assertOpenFileMatchesPath(path, fd, 'receipt_write_identity_changed');
  const write = (value: Record<string, unknown>) => {
    if (closed) throw new Error('receipt_writer_closed');
    assertOpenFileMatchesPath(path, fd, 'receipt_write_identity_changed');
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    writeAll(fd, bytes);
    ftruncateSync(fd, bytes.length);
    fsyncSync(fd);
    const file = assertOpenFileMatchesPath(path, fd, 'receipt_write_identity_changed');
    if (!file.isFile() || file.nlink !== 1 || file.size !== bytes.length || (file.mode & 0o777) !== 0o600) {
      throw new Error('receipt_write_identity_changed');
    }
    assertSameDirectory(parent, parentIdentity);
  };
  const close = () => {
    if (closed) return;
    closed = true;
    try {
      assertOpenFileMatchesPath(path, fd, 'receipt_write_identity_changed');
    } finally {
      closeSync(fd);
    }
  };

  try {
    write(initial);
  } catch (error) {
    close();
    throw error;
  }
  return { path, write, close };
}

export function writeExclusiveArtifact(path: string, bytes: Buffer): void {
  const parent = dirname(path);
  if (process.platform !== 'win32') {
    const name = fileNameFromPath(path, 'artifact_write_failed');
    const directory = openStablePathDirectory(parent);
    try {
      assertSameDirectory(parent, directory.identity);
      writeExclusiveArtifactInVerifiedDirectory(directory, name, bytes);
      assertSameDirectory(parent, directory.identity);
    } finally {
      directory.close();
    }
    return;
  }

  const parentIdentity = assertDirectory(parent);
  const flags = process.platform === 'win32'
    ? 'wx'
    : fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0);
  let fd: number;
  try {
    fd = openSync(path, flags, 0o600);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error.code === 'EEXIST' || error.code === 'ELOOP')) {
      throw new Error('existing_artifact_requires_readback');
    }
    throw new Error('artifact_write_failed');
  }
  try {
    assertOpenFileMatchesPath(path, fd, 'artifact_write_identity_changed');
    writeAll(fd, bytes);
    fsyncSync(fd);
    const file = assertOpenFileMatchesPath(path, fd, 'artifact_write_identity_changed');
    if (!file.isFile() || file.nlink !== 1 || file.size !== bytes.length || (file.mode & 0o777) !== 0o600) {
      throw new Error('artifact_write_identity_changed');
    }
    assertSameDirectory(parent, parentIdentity);
  } finally {
    closeSync(fd);
  }
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashPublicConfiguration(value: Record<string, unknown>): string {
  return sha256(JSON.stringify(value));
}

export function createOneShotGate(code = 'attempt_bound_exceeded'): () => void {
  let entered = false;
  return () => {
    if (entered) throw new Error(code);
    entered = true;
  };
}

export function buildSourceBinding(relativePaths: string[]) {
  const uniquePaths = [...new Set(relativePaths)].sort();
  const sourceHashes = Object.fromEntries(uniquePaths.map((path) => [path, sha256(readFileSync(resolve(WEB_ROOT, path)))]));
  const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: WEB_ROOT,
    encoding: 'utf8',
  }).trim().split('\n').filter(Boolean);
  return {
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: WEB_ROOT, encoding: 'utf8' }).trim(),
    gitTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: WEB_ROOT, encoding: 'utf8' }).trim(),
    workingTreeDirty: status.length > 0,
    workingTreeStatus: status,
    sourceHashes,
  };
}

export function readPackageVersion(relativePath: string): string {
  const parsed = JSON.parse(readFileSync(resolve(WEB_ROOT, relativePath), 'utf8')) as { version?: unknown };
  if (typeof parsed.version !== 'string' || !parsed.version) throw new Error('sdk_version_unavailable');
  return parsed.version;
}
