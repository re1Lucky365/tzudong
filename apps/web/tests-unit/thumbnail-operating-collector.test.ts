import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, existsSync, fstatSync, fsyncSync, linkSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync, writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'bun:test';
import { main, operateThumbnailSuccessor, prepareThumbnailOperation } from '../scripts/thumbnail-operating-collector.mjs';
import {
  MANIFEST_PATH, MANIFEST_SHA256, PROJECT_REF, RELEASE_ADMISSION_SHA256, REPOSITORY_ROOT,
  REQUIRED_FENCES, loadThumbnailRecord, thumbnailReleaseContract,
  validateThumbnailAdmission, validateThumbnailRelease,
} from '../scripts/thumbnail-production-successor.mjs';

// Real pinned manifest/source/parser/compiler and private-file/admission validators.
// Only external observations, clock/UUID and task-owned custody paths are injected.
const record = loadThumbnailRecord();
const revision = 'b'.repeat(40);
const attemptId = '01234567-89ab-4cde-8fab-0123456789ab';
const instant = '2026-10-24T10:00:00.000Z';
const roots: string[] = [];
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const bytes = (value: any) => Buffer.from(JSON.stringify(canonical(value)) + '\n');
const sha = (raw: string | Buffer) => createHash('sha256').update(raw).digest('hex');
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function expectCode(run: () => unknown, code: string) {
  let caught: any;
  try { run(); } catch (error) { caught = error; }
  expect(caught?.code).toBe(code);
}
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'thumbnail-collector-test-')));
  chmodSync(root, 0o700); roots.push(root);
  const directory = join(root, 'custody');
  const calls: { sql: string; singleTransaction: boolean }[] = [];
  const syncs: string[] = [];
  const environment: any = {
    SUPABASE_DB_URL: `postgresql://postgres@db.${PROJECT_REF}.supabase.co:5432/postgres?sslmode=require`,
    GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REPOSITORY: 'twoimo/tzudong', GITHUB_REPOSITORY_OWNER: 'twoimo',
    GITHUB_ACTOR: 'twoimo', GITHUB_TRIGGERING_ACTOR: 'twoimo',
    GITHUB_ACTOR_ID: '123', GITHUB_REPOSITORY_OWNER_ID: '123',
    OPERATOR_ACTOR: 'twoimo', OPERATOR_ACTOR_ID: '123',
    GITHUB_REF: 'refs/heads/main', GITHUB_REF_PROTECTED: 'true', GITHUB_SHA: revision,
    GITHUB_RUN_ID: '123456', GITHUB_RUN_ATTEMPT: '1',
    GITHUB_WORKFLOW_REF: 'twoimo/tzudong/.github/workflows/thumbnail-production-successor.yml@refs/heads/main',
    THUMBNAIL_PRIVILEGED_CUSTODY: 'true', RUNNER_NAME: 'tzudong-sql-operator-twoimo-mac',
  };
  const dependencies: any = {
    loadRecordImpl: () => loadThumbnailRecord(),
    loadReleaseImpl: () => validateThumbnailRelease(bytes(thumbnailReleaseContract())),
    custodyDirectory: directory, now: () => new Date(instant), uuidImpl: () => attemptId,
    sourceImpl: () => ({ revision, clean: true, detached: true, origin: 'https://github.com/twoimo/tzudong.git' }),
    protectedRevisionImpl: () => revision,
    fsyncImpl: (fd: number) => { syncs.push(fstatSync(fd).isDirectory() ? 'directory' : 'file'); fsyncSync(fd); },
    runPsqlImpl: (_url: string, sql: string, singleTransaction: boolean) => {
      calls.push({ sql, singleTransaction });
      if (sql.includes('$thumbnail_serializer$')) return JSON.stringify(record.migration.terminalReadback.expected);
      if (sql.includes('\\gset')) return JSON.stringify({
        ledger_exists: true, ledger_equal: true, prior: null,
        terminal: record.migration.terminalReadback.expected,
      });
      return JSON.stringify(record.migration.expectedPriorState.expected);
    },
  };
  const confirmation = `apply:${revision}:${MANIFEST_SHA256}`;
  const prepare = () => prepareThumbnailOperation({ environment, confirmation }, dependencies);
  const run = (mode = 'apply') => operateThumbnailSuccessor({
    mode, environment, ...(mode === 'apply' ? { confirmation } : {}),
  }, dependencies);
  return { root, directory, calls, syncs, environment, dependencies, confirmation, prepare, run };
}
const sends = (f: ReturnType<typeof fixture>) => f.calls.filter(call => call.sql.includes('$thumbnail_serializer$'));
const snapshot = (directory: string) => Object.fromEntries(readdirSync(directory).sort()
  .map(name => [name, { sha: sha(readFileSync(join(directory, name))), mtime: statSync(join(directory, name)).mtimeMs }]));

test('missing fixed release holds before source, credentials, custody or database reads', () => {
  const f = fixture();
  f.dependencies.loadReleaseImpl = () => { throw Object.assign(new Error('held'), { code: 'THUMBNAIL_RELEASE_ADMISSION_REQUIRED' }); };
  for (const key of ['loadRecordImpl', 'sourceImpl', 'protectedRevisionImpl', 'attestationImpl', 'runPsqlImpl'])
    f.dependencies[key] = () => { throw new Error('must not be reached'); };
  expectCode(f.prepare, 'THUMBNAIL_RELEASE_ADMISSION_REQUIRED');
  expect(readdirSync(f.root)).toEqual([]);
  expect(f.syncs).toEqual([]);
  expect(f.calls).toEqual([]);
});

test('real release and source bytes remain fail closed before publication', () => {
  const f = fixture();
  f.dependencies.loadReleaseImpl = () => validateThumbnailRelease(bytes({ ...thumbnailReleaseContract(), executionEnabled: false }));
  expectCode(f.prepare, 'THUMBNAIL_RELEASE_ADMISSION_INVALID');
  f.dependencies.loadReleaseImpl = () => validateThumbnailRelease(bytes(thumbnailReleaseContract()));
  f.dependencies.loadRecordImpl = () => loadThumbnailRecord({ readBytesImpl: (path: string) => {
    const raw = readFileSync(path);
    return path === join(REPOSITORY_ROOT, MANIFEST_PATH) ? Buffer.concat([raw, Buffer.from(' ')]) : raw;
  } });
  expectCode(f.prepare, 'THUMBNAIL_MANIFEST_DRIFT');
  f.dependencies.loadRecordImpl = () => loadThumbnailRecord({ readVectorImpl: () => ['SELECT 1'] });
  expect(() => f.prepare()).toThrow();
  expect(f.calls).toEqual([]);
  expect(existsSync(f.directory)).toBe(false);
});

test('prepare observes actual pinned readonly prior once and publishes exact private custody with durable parent syncs', () => {
  const f = fixture();
  expect(f.prepare()).toEqual({ status: 'prepared', attemptId, sourceRevision: revision,
    manifestSha256: MANIFEST_SHA256, expiresAt: '2026-10-24T10:15:00.000Z' });
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0].singleTransaction).toBe(true);
  expect(f.calls[0].sql).toContain('REPEATABLE READ READ ONLY');
  expect(f.calls[0].sql).toContain("server_version_num')::integer<>170006");
  expect(f.calls[0].sql).toContain(record.migration.expectedPriorState.query);
  expect(sends(f)).toEqual([]);
  const admission = readJson(join(f.directory, 'admission.json'));
  const fence = readJson(join(f.directory, 'writer-fence.json'));
  expect(() => validateThumbnailAdmission(admission, fence, bytes(fence), record, new Date(instant))).not.toThrow();
  expect(admission.releaseAdmissionSha256).toBe(RELEASE_ADMISSION_SHA256);
  expect(fence.fences).toEqual({ privilegedCatalogWriters: 'controlled', workerProvisioning: 'withheld' });
  expect(Object.keys(fence.evidenceSha256).sort()).toEqual(Object.keys(REQUIRED_FENCES).sort());
  expect(statSync(f.directory).mode & 0o777).toBe(0o700);
  expect(readdirSync(f.directory)).toHaveLength(5);
  for (const name of readdirSync(f.directory)) {
    const path = join(f.directory, name), stat = statSync(path), raw = readFileSync(path);
    expect(stat.mode & 0o777).toBe(0o600);
    expect(stat.nlink).toBe(1);
    expect(stat.uid).toBe(process.getuid!());
    expect(raw).toEqual(bytes(JSON.parse(raw.toString())));
  }
  for (const name of Object.keys(REQUIRED_FENCES)) {
    const raw = readFileSync(join(f.directory, `writer-fence-${name}.json`));
    expect(sha(raw)).toBe(fence.evidenceSha256[name]);
    expect(JSON.parse(raw.toString()).basis).toBe('authenticated-owner-custody');
    expect(JSON.parse(raw.toString()).scope).toBe('privileged-custody-until-reconciled');
  }
  expect(readJson(join(f.directory, 'prior-readback.json')).prior).toEqual(record.migration.expectedPriorState.expected);
  expect(f.syncs).toEqual(['directory', 'directory', ...Array(5).fill(['file', 'directory']).flat()]);
});

test('apply uses real caller and sends exactly once after durable publication; repeat never reads or sends', () => {
  const f = fixture();
  const transport = f.dependencies.runPsqlImpl;
  f.dependencies.runPsqlImpl = (...args: any[]) => {
    if (args[1].includes('$thumbnail_serializer$')) {
      expect(readJson(join(f.directory, 'admission.json')).attemptId).toBe(attemptId);
      expect(readFileSync(join(f.directory, 'apply-journal.jsonl'), 'utf8')).toContain('"event":"started"');
      expect(f.syncs.slice(-2)).toEqual(['file', 'directory']);
    }
    return transport(...args);
  };
  expect(f.run().status).toBe('committed');
  expect(f.calls).toHaveLength(4);
  expect(sends(f)).toHaveLength(1);
  const before = snapshot(f.directory);
  expectCode(f.run, 'THUMBNAIL_CUSTODY_ALREADY_EXISTS');
  expect(f.calls).toHaveLength(4);
  expect(snapshot(f.directory)).toEqual(before);
});

test('failed publication keeps partial custody and never calls mutation transport or reissues', () => {
  const f = fixture();
  f.dependencies.fsyncImpl = (fd: number) => {
    fsyncSync(fd);
    if (fstatSync(fd).isFile()) throw new Error('private I/O diagnostic');
  };
  expectCode(f.run, 'THUMBNAIL_CUSTODY_PUBLICATION_UNCONFIRMED');
  expect(existsSync(f.directory)).toBe(true);
  expect(existsSync(join(f.directory, 'admission.json'))).toBe(false);
  const before = snapshot(f.directory);
  expectCode(f.run, 'THUMBNAIL_CUSTODY_ALREADY_EXISTS');
  expect(snapshot(f.directory)).toEqual(before);
  expect(f.calls).toHaveLength(1);
  expect(sends(f)).toEqual([]);
});

test('lost ACK plus prior observation is unconfirmed, second apply cannot send, later reconcile preserves custody bytes', () => {
  const f = fixture();
  const transport = f.dependencies.runPsqlImpl;
  let committed = false;
  f.dependencies.runPsqlImpl = (...args: any[]) => {
    const output = transport(...args);
    if (args[1].includes('$thumbnail_serializer$')) throw new Error('lost ACK secret');
    if (!committed && args[1].includes('\\gset')) return JSON.stringify({
      ledger_exists: false, ledger_equal: false, prior: record.migration.expectedPriorState.expected, terminal: null,
    });
    return output;
  };
  expectCode(f.run, 'THUMBNAIL_OUTCOME_UNCONFIRMED');
  expect(readFileSync(join(f.directory, 'apply-journal.jsonl'), 'utf8')).toContain('"disposition":"prior_observed"');
  expectCode(f.run, 'THUMBNAIL_CUSTODY_ALREADY_EXISTS');
  expect(sends(f)).toHaveLength(1);
  const before = snapshot(f.directory), syncCount = f.syncs.length;
  committed = true;
  // Recovery must not recollect owner/source/freshness, nor need confirmation.
  f.dependencies.sourceImpl = f.dependencies.protectedRevisionImpl = f.dependencies.attestationImpl = () => { throw new Error('collector forbidden'); };
  f.dependencies.now = () => new Date('2026-10-25T00:00:00.000Z');
  delete f.environment.THUMBNAIL_PRIVILEGED_CUSTODY;
  expect(f.run('reconcile')).toEqual({ status: 'reconciliation', disposition: 'committed', attemptId, replayAllowed: false });
  expect(snapshot(f.directory)).toEqual(before);
  expect(f.syncs).toHaveLength(syncCount);
  expect(sends(f)).toHaveLength(1);
});

test('journal publication failure preserves custody and journal without sending or refreshing the attempt', () => {
  const f = fixture(); let fileSyncs = 0;
  f.dependencies.fsyncImpl = (fd: number) => {
    fsyncSync(fd);
    if (fstatSync(fd).isFile() && ++fileSyncs === 6) throw new Error('journal durability uncertain');
  };
  expectCode(f.run, 'THUMBNAIL_JOURNAL_UNCONFIRMED');
  expect(existsSync(join(f.directory, 'apply-journal.jsonl'))).toBe(true);
  const before = snapshot(f.directory);
  expectCode(f.run, 'THUMBNAIL_CUSTODY_ALREADY_EXISTS');
  expect(snapshot(f.directory)).toEqual(before);
  expect(sends(f)).toEqual([]); expect(f.calls).toHaveLength(2);
});

test('partial terminal journal append is preserved and reconcile never republishes or resends', () => {
  const f = fixture();
  f.dependencies.appendJournalImpl = (fd: number) => {
    writeSync(fd, '{"event":"terminal",'); fsyncSync(fd);
    throw new Error('partial append secret');
  };
  expectCode(f.run, 'THUMBNAIL_JOURNAL_UNCONFIRMED');
  expect(sends(f)).toHaveLength(1);
  const before = snapshot(f.directory);
  expectCode(f.run, 'THUMBNAIL_CUSTODY_ALREADY_EXISTS');
  expect(f.run('reconcile').disposition).toBe('committed');
  expect(snapshot(f.directory)).toEqual(before);
  expect(sends(f)).toHaveLength(1);
});

test('wrong owner, workflow, runner, custody confirmation or source is rejected before any database read', () => {
  for (const [key, value, code] of [
    ['GITHUB_ACTOR', 'other', 'THUMBNAIL_OWNER_ATTESTATION_INVALID'],
    ['GITHUB_TRIGGERING_ACTOR', 'other', 'THUMBNAIL_OWNER_ATTESTATION_INVALID'],
    ['GITHUB_WORKFLOW_REF', 'twoimo/tzudong/.github/workflows/other.yml@refs/heads/main', 'THUMBNAIL_OWNER_ATTESTATION_INVALID'],
    ['RUNNER_NAME', 'other-host', 'THUMBNAIL_CUSTODY_RUNNER_INVALID'],
    ['THUMBNAIL_PRIVILEGED_CUSTODY', 'false', 'THUMBNAIL_PRIVILEGED_CUSTODY_REQUIRED'],
  ]) {
    const f = fixture(); f.environment[key] = value;
    expectCode(f.prepare, code);
    expect(f.calls).toEqual([]); expect(existsSync(f.directory)).toBe(false);
  }
  const f = fixture();
  expectCode(() => prepareThumbnailOperation({ environment: f.environment, confirmation: `apply:${'c'.repeat(40)}:${MANIFEST_SHA256}` }, f.dependencies), 'THUMBNAIL_CONFIRMATION_INVALID');
  f.dependencies.protectedRevisionImpl = () => 'c'.repeat(40);
  expectCode(f.prepare, 'THUMBNAIL_SOURCE_DRIFT');
  expect(f.calls).toEqual([]);
});

test('target mismatch and overlapping credentials fail before the pinned readonly transport', () => {
  const f = fixture();
  f.environment.SUPABASE_DB_URL = 'postgresql://postgres@db.other.supabase.co:5432/postgres';
  expectCode(f.prepare, 'THUMBNAIL_DATABASE_TARGET_INVALID');
  f.environment.SUPABASE_DB_URL = `postgresql://postgres@db.${PROJECT_REF}.supabase.co:5432/postgres`;
  f.environment.SUPABASE_ACCESS_TOKEN = 'PRIVATE_SECRET';
  expectCode(f.prepare, 'THUMBNAIL_DATABASE_TARGET_INVALID');
  expect(f.calls).toEqual([]); expect(existsSync(f.directory)).toBe(false);
});

test('prior drift or raw diagnostic is never persisted or exposed', () => {
  for (const output of [JSON.stringify({ ...record.migration.expectedPriorState.expected, unexpectedSecret: 'PRIVATE_SECRET' }), 'PRIVATE_SECRET']) {
    const f = fixture(); f.dependencies.runPsqlImpl = () => output;
    let caught: any;
    try { f.prepare(); } catch (error) { caught = error; }
    expect(caught?.message).toMatch(/^THUMBNAIL_(PRIOR_STATE_DRIFT|PRIOR_READBACK_UNCONFIRMED)$/);
    expect(JSON.stringify(caught)).not.toContain('PRIVATE_SECRET');
    expect(existsSync(f.directory)).toBe(false);
  }
});

test('expiry during prior observation and protected source drift after observation cannot publish', () => {
  const f = fixture();
  // The injected clock closure itself observes expiry during the transport.
  f.dependencies.now = () => new Date(f.calls.length ? '2026-10-24T10:16:00.000Z' : instant);
  expectCode(f.prepare, 'THUMBNAIL_ADMISSION_EXPIRED');
  expect(existsSync(f.directory)).toBe(false);
  const g = fixture();
  g.dependencies.protectedRevisionImpl = () => g.calls.length ? 'c'.repeat(40) : revision;
  expectCode(g.prepare, 'THUMBNAIL_SOURCE_DRIFT');
  expect(g.calls).toHaveLength(1); expect(existsSync(g.directory)).toBe(false);
});

test('a directory fsync failure after creating missing parents still consumes the final publication path', () => {
  const f = fixture();
  f.dependencies.custodyDirectory = join(f.root, 'new-parent', 'project', 'custody');
  f.dependencies.fsyncImpl = () => { throw new Error('fsync failure'); };
  expectCode(f.run, 'THUMBNAIL_CUSTODY_PUBLICATION_UNCONFIRMED');
  expect(existsSync(f.dependencies.custodyDirectory)).toBe(true);
  expect(statSync(join(f.root, 'new-parent')).mode & 0o777).toBe(0o700);
  expect(statSync(join(f.root, 'new-parent', 'project')).mode & 0o777).toBe(0o700);
  expectCode(f.run, 'THUMBNAIL_CUSTODY_ALREADY_EXISTS');
  expect(sends(f)).toEqual([]); expect(f.calls).toHaveLength(1);
});

test('the caller repeats prior after collection: drift aborts without journal or mutation and custody remains consumed', () => {
  const f = fixture(); const transport = f.dependencies.runPsqlImpl;
  f.dependencies.runPsqlImpl = (...args: any[]) => {
    const raw = transport(...args);
    if (f.calls.length === 2) return JSON.stringify({ ...record.migration.expectedPriorState.expected, ledgerCount: -1 });
    return raw;
  };
  expectCode(f.run, 'THUMBNAIL_PRIOR_STATE_DRIFT');
  expect(existsSync(join(f.directory, 'admission.json'))).toBe(true);
  expect(existsSync(join(f.directory, 'apply-journal.jsonl'))).toBe(false);
  expectCode(f.run, 'THUMBNAIL_CUSTODY_ALREADY_EXISTS');
  expect(sends(f)).toEqual([]); expect(f.calls).toHaveLength(2);
});

test('existing partial directory, symlink, hardlink or writable parent is never adopted', () => {
  for (const kind of ['empty', 'symlink', 'hardlink', 'parent-mode', 'parent-symlink']) {
    const f = fixture();
    if (kind === 'empty' || kind === 'hardlink') mkdirSync(f.directory, { mode: 0o700 });
    if (kind === 'hardlink') {
      writeFileSync(join(f.root, 'other'), 'original', { mode: 0o600 });
      linkSync(join(f.root, 'other'), join(f.directory, 'admission.json'));
    }
    if (kind === 'symlink') symlinkSync(join(f.root, 'missing'), f.directory);
    if (kind === 'parent-mode') chmodSync(f.root, 0o777);
    if (kind === 'parent-symlink') {
      symlinkSync(f.root, join(f.root, 'alias'));
      f.dependencies.custodyDirectory = join(f.root, 'alias', 'custody');
    }
    expectCode(f.prepare, kind.startsWith('parent-') ? 'THUMBNAIL_CUSTODY_INVALID' : 'THUMBNAIL_CUSTODY_ALREADY_EXISTS');
    expect(f.calls).toEqual([]); expect(f.syncs).toEqual([]);
  }
});

test('inspect needs no release/runner/credentials; reconcile checks fixed runner without publishing', () => {
  const unreachable = () => { throw new Error('external observation forbidden'); };
  expect(operateThumbnailSuccessor({ mode: 'inspect', environment: {} }, {
    loadReleaseImpl: unreachable, sourceImpl: unreachable, protectedRevisionImpl: unreachable, runPsqlImpl: unreachable,
  })).toMatchObject({ status: 'held', executionEnabled: false, statementCount: 43 });
  const f = fixture(); f.environment.RUNNER_NAME = 'ephemeral';
  expectCode(() => f.run('reconcile'), 'THUMBNAIL_CUSTODY_RUNNER_INVALID');
  expect(existsSync(f.directory)).toBe(false); expect(f.calls).toEqual([]);
});

test('CLI exposes only mode/confirmation and hides secret-bearing rejected inputs', () => {
  for (const argv of [['--ready', 'true'], ['--mode', 'apply', '--custody', '/tmp/other'], ['--mode', 'inspect', '--confirmation', 'secret'], ['--mode', 'apply', '--mode', 'inspect']])
    expectCode(() => main(argv), 'THUMBNAIL_ARGUMENT_INVALID');
  const result = spawnSync(process.execPath, [join(REPOSITORY_ROOT, 'apps/web/scripts/thumbnail-operating-collector.mjs'), '--database-url', 'PRIVATE_SECRET'], { encoding: 'utf8', env: {} });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(JSON.parse(result.stderr)).toEqual({ status: 'failed', code: 'THUMBNAIL_ARGUMENT_INVALID' });
  expect(result.stderr).not.toContain('PRIVATE_SECRET');
});
