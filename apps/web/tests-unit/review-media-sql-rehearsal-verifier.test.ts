import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import {
  createOwnedContainer,
  DEFAULT_RETAINED_PROOF_SELECTOR_PATH,
  injectFinalApplyExpiryFault,
  inspectRetainedProof,
  parseArguments,
  publishCurrentProof,
  removeOwnedContainer,
} from '../performance/review-db-rehearsal-20261012/verify-review-media-sql-rehearsal.mjs';

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

type Ownership = {
  attempted?: boolean;
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
  transientInspectFailures?: number;
};

function dockerFixture(options: DockerOptions = {}) {
  const containers = new Map<string, { id: string; name: string; token: string }>();
  const calls: string[][] = [];
  const id = 'a'.repeat(64);
  let transientInspectFailures = options.transientInspectFailures ?? 0;
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
      if (transientInspectFailures > 0) {
        transientInspectFailures -= 1;
        return { status: 1, stdout: '', stderr: 'temporary daemon read failure' };
      }
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

test('default retained proof uses a stable current-proof selector', () => {
  expect(basename(DEFAULT_RETAINED_PROOF_SELECTOR_PATH)).toBe('retained-current-proof.json');
  const selector = JSON.parse(readFileSync(DEFAULT_RETAINED_PROOF_SELECTOR_PATH, 'utf8'));
  expect(selector).toMatchObject({
    schemaVersion: 1,
    kind: 'review-media-sql-retained-current-proof',
  });
  const retained = inspectRetainedProof();
  expect(basename(retained.repositoryPath)).toBe(selector.proofPath);
  expect(retained.actualSha256).toBe(selector.proofSha256);
  expect(retained.usedAsCurrentProof).toBe(false);
  expect(parseArguments([])).toEqual({ outputPath: null });
});

test('selector rejects unauthenticated bytes, path escape, and proof-SHA relabelling', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tzudong-proof-selector-'));
  try {
    const proofPath = join(directory, 'proof.json');
    const selectorPath = join(directory, 'retained-current-proof.json');
    const checksumsPath = join(directory, 'SHA256SUMS');
    const checksumsDigestPath = join(directory, 'SHA256SUMS.sha256');
    const proof = Buffer.from('{}\n');
    writeFileSync(proofPath, proof);
    const writeAuthenticatedMap = (selector: Buffer) => {
      writeFileSync(selectorPath, selector);
      const checksums = Buffer.from([
        `${sha256(proof)}  proof.json`,
        `${sha256(selector)}  retained-current-proof.json`,
        '',
      ].join('\n'));
      writeFileSync(checksumsPath, checksums);
      writeFileSync(checksumsDigestPath, `${sha256(checksums)}\n`);
    };

    const escaped = Buffer.from(`${JSON.stringify({
      schemaVersion: 1,
      kind: 'review-media-sql-retained-current-proof',
      proofPath: '../proof.json',
      proofSha256: sha256(proof),
    })}\n`);
    writeAuthenticatedMap(escaped);
    expect(() => inspectRetainedProof({
      selectorPath,
      checksumsPath,
      checksumsDigestPath,
      repositoryRoot: directory,
    })).toThrow('LOCAL_REHEARSAL_SELECTOR_INVALID');

    const relabelled = Buffer.from(`${JSON.stringify({
      schemaVersion: 1,
      kind: 'review-media-sql-retained-current-proof',
      proofPath: 'proof.json',
      proofSha256: '0'.repeat(64),
    })}\n`);
    writeAuthenticatedMap(relabelled);
    expect(() => inspectRetainedProof({
      selectorPath,
      checksumsPath,
      checksumsDigestPath,
      repositoryRoot: directory,
    })).toThrow('LOCAL_REHEARSAL_SELECTOR_PROOF_SHA256_MISMATCH');

    const valid = Buffer.from(`${JSON.stringify({
      schemaVersion: 1,
      kind: 'review-media-sql-retained-current-proof',
      proofPath: 'proof.json',
      proofSha256: sha256(proof),
    })}\n`);
    writeAuthenticatedMap(valid);
    writeFileSync(selectorPath, Buffer.concat([valid, Buffer.from(' ')]));
    expect(() => inspectRetainedProof({
      selectorPath,
      checksumsPath,
      checksumsDigestPath,
      repositoryRoot: directory,
    })).toThrow('LOCAL_REHEARSAL_SELECTOR_SHA256_MISMATCH');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('retained proof verifies the complete non-circular artifact map from one byte snapshot', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tzudong-current-proof-map-'));
  try {
    const outputPath = join(directory, 'pg17-terminal-boundaries-20261013.json');
    const selectorPath = join(directory, 'retained-current-proof.json');
    const dependencyPath = join(directory, 'source.mjs');
    const checksumsPath = join(directory, 'SHA256SUMS');
    const checksumsDigestPath = join(directory, 'SHA256SUMS.sha256');
    const proof = Buffer.from(`${JSON.stringify({
      manifestSha256: '1'.repeat(64),
      rehearsalHarnessSha256: '2'.repeat(64),
      sourceRoot: '3'.repeat(64),
    })}\n`);
    const dependency = Buffer.from('export const current = true;\n');
    const selector = Buffer.from(`${JSON.stringify({
      schemaVersion: 1,
      kind: 'review-media-sql-retained-current-proof',
      proofPath: 'pg17-terminal-boundaries-20261013.json',
      proofSha256: sha256(proof),
    })}\n`);
    writeFileSync(outputPath, proof);
    writeFileSync(selectorPath, selector);
    writeFileSync(dependencyPath, dependency);
    const checksums = Buffer.from([
      `${sha256(proof)}  pg17-terminal-boundaries-20261013.json`,
      `${sha256(selector)}  retained-current-proof.json`,
      `${sha256(dependency)}  source.mjs`,
      '',
    ].join('\n'));
    writeFileSync(checksumsPath, checksums);
    writeFileSync(checksumsDigestPath, `${sha256(checksums)}\n`);

    const retained = inspectRetainedProof({
      selectorPath,
      checksumsPath,
      checksumsDigestPath,
      repositoryRoot: directory,
      bindings: {
        manifestSha256: '1'.repeat(64),
        rehearsalHarnessSha256: '2'.repeat(64),
        sourceRoot: '3'.repeat(64),
      },
    });
    expect(retained).toMatchObject({
      present: true,
      classification: 'retained-current-source-evidence',
      repositoryPath: 'pg17-terminal-boundaries-20261013.json',
      selector: {
        repositoryPath: 'retained-current-proof.json',
        sha256: sha256(selector),
        proofPath: 'pg17-terminal-boundaries-20261013.json',
        proofSha256: sha256(proof),
      },
      expectedSha256: sha256(proof),
      actualSha256: sha256(proof),
      currentSourceMatch: true,
      usedAsCurrentProof: false,
    });

    writeFileSync(dependencyPath, 'tampered\n');
    expect(() => inspectRetainedProof({
      selectorPath,
      checksumsPath,
      checksumsDigestPath,
      repositoryRoot: directory,
    })).toThrow('LOCAL_REHEARSAL_ARTIFACT_SHA256_MISMATCH');

    rmSync(dependencyPath);
    expect(() => inspectRetainedProof({
      selectorPath,
      checksumsPath,
      checksumsDigestPath,
      repositoryRoot: directory,
    })).toThrow('LOCAL_REHEARSAL_ARTIFACT_MISSING');

    rmSync(outputPath);
    expect(() => inspectRetainedProof({
      selectorPath,
      checksumsPath,
      checksumsDigestPath,
      repositoryRoot: directory,
      required: true,
    })).toThrow('LOCAL_REHEARSAL_CURRENT_PROOF_MISSING');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
      checksumsDigestPath: null,
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

test('apply expiry fault changes only the final wrapper guard after the exported marker', () => {
  const expiresAt = '9999-12-31T23:59:59.999Z';
  const marker = '-- successor-pre-commit-expiry-guard';
  const before = `DO $stage$ BEGIN IF clock_timestamp() >= '${expiresAt}'::timestamptz THEN NULL; END IF; END $stage$;\n`;
  const final = `DO $final$ BEGIN IF clock_timestamp() >= '${expiresAt}'::timestamptz THEN RAISE EXCEPTION 'SUCCESSOR_ADMISSION_EXPIRED'; END IF; END $final$;\n`;
  const source = `${before}${marker}\n${final}`;
  const fault = injectFinalApplyExpiryFault(source, expiresAt);
  expect(fault).toMatchObject({
    marker,
    originalDeadline: expiresAt,
    injectedDeadline: '1970-01-01T00:00:00.000Z',
    wrapperOnlyFaultInjection: true,
  });
  expect(fault.sql.slice(0, fault.sql.indexOf(marker))).toBe(before);
  expect(fault.sql.slice(fault.sql.indexOf(marker))).toContain("'1970-01-01T00:00:00.000Z'::timestamptz");
  expect(fault.sql.match(new RegExp(expiresAt.replaceAll('.', '\\.'), 'g'))).toHaveLength(1);
  expect(() => injectFinalApplyExpiryFault(before, expiresAt))
    .toThrow('LOCAL_REHEARSAL_APPLY_EXPIRY_MARKER_INVALID');
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

test('first inspect failure after uncertain create is reconciled and cleaned by exact owned ID', () => {
  const fixture = dockerFixture({ ackLostOnCreate: true, transientInspectFailures: 1 });
  const ownership = freshOwnership();
  expect(() => createOwnedContainer(ownership, {
    dockerImpl: fixture.dockerImpl,
    generateToken: () => '9'.repeat(32),
    processId: 4248,
  })).toThrow('LOCAL_REHEARSAL_CONTAINER_INSPECTION_FAILED');
  expect(ownership).toMatchObject({
    attempted: true,
    created: false,
    id: null,
    name: 'tzudong-review-rollback-rehearsal-4248-999999999999',
    token: '9'.repeat(32),
  });

  expect(removeOwnedContainer(ownership, { dockerImpl: fixture.dockerImpl })).toBe(true);
  expect(ownership).toMatchObject({ created: false, removed: true, id: fixture.id });
  expect(fixture.calls.filter(args => args[0] === 'run')).toHaveLength(1);
  expect(fixture.calls.find(args => args[0] === 'container' && args[1] === 'rm'))
    .toEqual(['container', 'rm', '--force', fixture.id]);
  expect(fixture.containers.size).toBe(0);
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

test('create failure reconciles proven absence without issuing a removal', () => {
  const fixture = dockerFixture({ failBeforeCreate: true });
  const ownership = freshOwnership();
  expect(() => createOwnedContainer(ownership, {
    dockerImpl: fixture.dockerImpl,
    generateToken: () => '2'.repeat(32),
    processId: 4243,
  })).toThrow('LOCAL_REHEARSAL_CONTAINER_CREATION_UNCONFIRMED');
  expect(removeOwnedContainer(ownership, { dockerImpl: fixture.dockerImpl })).toBe(true);
  expect(ownership).toMatchObject({ created: false, removed: true });
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
