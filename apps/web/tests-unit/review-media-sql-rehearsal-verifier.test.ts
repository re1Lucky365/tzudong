import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  createOwnedContainer,
  inspectRetainedProof,
  parseArguments,
  publishCurrentProof,
  removeOwnedContainer,
} from '../performance/review-db-rehearsal-20261012/verify-review-media-sql-rehearsal.mjs';

const retainedProofRepositoryPath = 'apps/web/performance/review-db-rehearsal-20261012/pg17-rollback-rehearsal.json';
const retainedProofSha256 = 'cb766e279baad0315e9d7055bc326b41b78a7d50a4972dac3214bc071aee0e49';
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

type Ownership = {
  created: boolean;
  id: string | null;
  name: string | null;
  token: string | null;
  removed?: boolean;
  creationAcknowledged?: boolean;
  creationReconciled?: boolean;
  removalAcknowledged?: boolean;
};

type DockerOptions = {
  ackLostOnCreate?: boolean;
  ackMismatchOnCreate?: boolean;
  failBeforeCreate?: boolean;
  wrongOwnerLabel?: boolean;
  keepAfterRemoveFailure?: boolean;
  ackLostOnRemove?: boolean;
};

function dockerFixture(options: DockerOptions = {}) {
  const containers = new Map<string, { id: string; name: string; token: string }>();
  const calls: string[][] = [];
  const id = 'a'.repeat(64);
  const dockerImpl = (args: string[]) => {
    calls.push([...args]);
    if (args[0] === 'run') {
      if (options.failBeforeCreate) {
        return { status: 1, stdout: '', stderr: 'daemon unavailable' };
      }
      const name = args[args.indexOf('--name') + 1];
      const label = args[args.indexOf('--label') + 1];
      const token = label.slice(label.indexOf('=') + 1);
      containers.set(id, {
        id,
        name,
        token: options.wrongOwnerLabel ? '0'.repeat(32) : token,
      });
      if (options.ackLostOnCreate) {
        return { status: 1, stdout: '', stderr: 'response lost after create' };
      }
      return {
        status: 0,
        stdout: `${options.ackMismatchOnCreate ? 'b'.repeat(64) : id}\n`,
        stderr: '',
      };
    }
    if (args[0] === 'container' && args[1] === 'inspect') {
      const target = args[2];
      const value = [...containers.values()].find(container => (
        container.id === target || container.name === target
      ));
      if (!value) return { status: 1, stdout: '', stderr: `No such container: ${target}` };
      return {
        status: 0,
        stdout: JSON.stringify([{
          Id: value.id,
          Name: `/${value.name}`,
          Config: { Labels: { 'tzudong.review-rehearsal.owner': value.token } },
        }]),
        stderr: '',
      };
    }
    if (args[0] === 'container' && args[1] === 'rm' && args[2] === '--force') {
      const target = args[3];
      if (options.keepAfterRemoveFailure) {
        return { status: 1, stdout: '', stderr: 'response failed before remove' };
      }
      containers.delete(target);
      if (options.ackLostOnRemove) {
        return { status: 1, stdout: '', stderr: 'response lost after remove' };
      }
      return { status: 0, stdout: `${target}\n`, stderr: '' };
    }
    throw new Error(`unexpected docker call: ${args.join(' ')}`);
  };
  return { calls, containers, dockerImpl, id };
}

function freshOwnership(): Ownership {
  return { created: false, id: null, name: null, token: null };
}

test('checked-in rollback proof is checksum-verified but never reused as current-run output', () => {
  const manifestBytes = readFileSync(new URL('../../../.github/review-media-sql-successor.v1.json', import.meta.url));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const harnessBytes = readFileSync(new URL(
    '../performance/review-db-rehearsal-20261012/verify-review-media-sql-rehearsal.mjs',
    import.meta.url,
  ));
  const retained = inspectRetainedProof({
    bindings: {
      manifestSha256: sha256(manifestBytes),
      rehearsalHarnessSha256: sha256(harnessBytes),
      sourceRoot: manifest.sourceRoot,
    },
  });

  expect(parseArguments([])).toEqual({ outputPath: null });
  expect(retained).toMatchObject({
    present: true,
    classification: 'retained-historical-evidence',
    repositoryPath: retainedProofRepositoryPath,
    expectedSha256: retainedProofSha256,
    actualSha256: retainedProofSha256,
    currentSourceMatch: false,
    usedAsCurrentProof: false,
  });

  const stdout: string[] = [];
  const writes: unknown[][] = [];
  const proof = { status: 'passed', sourceRoot: manifest.sourceRoot };
  const envelope = publishCurrentProof(
    { retainedProof: retained, proof, outputPath: null },
    {
      writeFileImpl: (...args: unknown[]) => { writes.push(args); },
      writeStdoutImpl: (value: string) => { stdout.push(value); },
    },
  );
  expect(writes).toHaveLength(0);
  expect(stdout).toHaveLength(1);
  expect(JSON.parse(stdout[0])).toEqual(envelope);
  expect(envelope).toMatchObject({
    kind: 'review-media-sql-local-rehearsal',
    currentProof: proof,
    currentOutputPath: null,
  });
});

test('retained rollback proof rejects bytes not authorized by SHA256SUMS', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tzudong-rollback-proof-'));
  try {
    const outputPath = join(directory, 'pg17-rollback-rehearsal.json');
    const checksumsPath = join(directory, 'SHA256SUMS');
    const proof = Buffer.from(`${JSON.stringify({
      manifestSha256: '1'.repeat(64),
      rehearsalHarnessSha256: '2'.repeat(64),
      sourceRoot: '3'.repeat(64),
    })}\n`);
    writeFileSync(outputPath, proof);
    writeFileSync(checksumsPath, `${sha256(proof)}  pg17-rollback-rehearsal.json\n`);
    writeFileSync(outputPath, Buffer.concat([proof, Buffer.from(' ')]));

    expect(() => inspectRetainedProof({
      outputPath,
      checksumsPath,
      repositoryRoot: directory,
      bindings: {
        manifestSha256: '1'.repeat(64),
        rehearsalHarnessSha256: '2'.repeat(64),
        sourceRoot: '3'.repeat(64),
      },
    })).toThrow('LOCAL_REHEARSAL_RETAINED_SHA256_MISMATCH');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('explicit current output is exclusive and separate from retained proof', () => {
  const outputPath = resolve('/tmp/tzudong-current-rehearsal-proof.json');
  const writes: unknown[][] = [];
  const stdout: string[] = [];
  publishCurrentProof(
    { retainedProof: { present: true }, proof: { status: 'passed' }, outputPath },
    {
      writeFileImpl: (...args: unknown[]) => { writes.push(args); },
      writeStdoutImpl: (value: string) => { stdout.push(value); },
    },
  );
  expect(writes).toHaveLength(1);
  expect(writes[0][0]).toBe(outputPath);
  expect(writes[0][2]).toEqual({ flag: 'wx', mode: 0o600 });
  expect(JSON.parse(stdout[0]).currentOutputPath).toBe(outputPath);
});

test('container create acknowledgement loss is reconciled by unique name and owner label', () => {
  const fixture = dockerFixture({ ackLostOnCreate: true });
  const ownership = freshOwnership();
  const createdId = createOwnedContainer(ownership, {
    dockerImpl: fixture.dockerImpl,
    generateToken: () => '1'.repeat(32),
    processId: 4242,
  });

  expect(createdId).toBe(fixture.id);
  expect(ownership).toMatchObject({
    created: true,
    id: fixture.id,
    name: 'tzudong-review-rollback-rehearsal-4242-111111111111',
    token: '1'.repeat(32),
    creationAcknowledged: false,
    creationReconciled: true,
  });
  const run = fixture.calls.find(args => args[0] === 'run');
  expect(run).toContain(`tzudong.review-rehearsal.owner=${'1'.repeat(32)}`);
});

test('same-process rehearsal runs derive distinct container names from their owner tokens', () => {
  const firstFixture = dockerFixture();
  const secondFixture = dockerFixture();
  const first = freshOwnership();
  const second = freshOwnership();
  createOwnedContainer(first, {
    dockerImpl: firstFixture.dockerImpl,
    generateToken: () => '7'.repeat(32),
    processId: 4242,
  });
  createOwnedContainer(second, {
    dockerImpl: secondFixture.dockerImpl,
    generateToken: () => '8'.repeat(32),
    processId: 4242,
  });
  expect(first.name).not.toBe(second.name);
  expect(first.token).not.toBe(second.token);
});

test('create failure without an owned readback never authorizes cleanup', () => {
  const fixture = dockerFixture({ failBeforeCreate: true });
  const ownership = freshOwnership();
  expect(() => createOwnedContainer(ownership, {
    dockerImpl: fixture.dockerImpl,
    generateToken: () => '2'.repeat(32),
    processId: 4243,
  })).toThrow('LOCAL_REHEARSAL_CONTAINER_CREATION_UNCONFIRMED');
  expect(removeOwnedContainer(ownership, { dockerImpl: fixture.dockerImpl })).toBe(false);
  expect(fixture.calls.some(args => args[0] === 'container' && args[1] === 'rm')).toBe(false);
});

test('owner-label mismatch is rejected and the unowned container is not removed', () => {
  const fixture = dockerFixture({ wrongOwnerLabel: true });
  const ownership = freshOwnership();
  expect(() => createOwnedContainer(ownership, {
    dockerImpl: fixture.dockerImpl,
    generateToken: () => '3'.repeat(32),
    processId: 4244,
  })).toThrow('LOCAL_REHEARSAL_CONTAINER_OWNERSHIP_UNPROVEN');
  expect(removeOwnedContainer(ownership, { dockerImpl: fixture.dockerImpl })).toBe(false);
  expect(fixture.containers.size).toBe(1);
  expect(fixture.calls.some(args => args[0] === 'container' && args[1] === 'rm')).toBe(false);
});

test('acknowledgement mismatch retains exact owned ID for safe finally cleanup', () => {
  const fixture = dockerFixture({ ackMismatchOnCreate: true });
  const ownership = freshOwnership();
  expect(() => createOwnedContainer(ownership, {
    dockerImpl: fixture.dockerImpl,
    generateToken: () => '4'.repeat(32),
    processId: 4245,
  })).toThrow('LOCAL_REHEARSAL_CONTAINER_ACK_MISMATCH');
  expect(ownership).toMatchObject({ created: true, id: fixture.id, token: '4'.repeat(32) });
  expect(removeOwnedContainer(ownership, { dockerImpl: fixture.dockerImpl })).toBe(true);
  const removal = fixture.calls.find(args => args[0] === 'container' && args[1] === 'rm');
  expect(removal).toEqual(['container', 'rm', '--force', fixture.id]);
  expect(fixture.containers.size).toBe(0);
});

test('cleanup failure leaves ownership live and cannot be misreported as removed', () => {
  const fixture = dockerFixture({ keepAfterRemoveFailure: true });
  const ownership = freshOwnership();
  createOwnedContainer(ownership, {
    dockerImpl: fixture.dockerImpl,
    generateToken: () => '5'.repeat(32),
    processId: 4246,
  });
  expect(() => removeOwnedContainer(ownership, { dockerImpl: fixture.dockerImpl }))
    .toThrow('LOCAL_REHEARSAL_CONTAINER_REMOVAL_UNCONFIRMED');
  expect(ownership.created).toBe(true);
  expect(ownership.removed).not.toBe(true);
  expect(fixture.containers.size).toBe(1);
});

test('cleanup acknowledgement loss succeeds only after exact-ID absence readback', () => {
  const fixture = dockerFixture({ ackLostOnRemove: true });
  const ownership = freshOwnership();
  createOwnedContainer(ownership, {
    dockerImpl: fixture.dockerImpl,
    generateToken: () => '6'.repeat(32),
    processId: 4247,
  });
  expect(removeOwnedContainer(ownership, { dockerImpl: fixture.dockerImpl })).toBe(true);
  expect(ownership).toMatchObject({
    created: false,
    removed: true,
    removalAcknowledged: false,
  });
  expect(fixture.containers.size).toBe(0);
});
