import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  applySuccessorPlanOnce,
  createFixtureMembership,
  createOwnedDatabase,
  dropFixtureMembership,
  dropOwnedDatabase,
  inspectRetainedProof,
  waitForAdvisoryContention,
} from '../performance/review-db-successor-20261012/verify-review-media-sql-successor.mjs';

const retainedProofRepositoryPath = 'apps/web/performance/review-db-successor-20261012/pg17-local-replay.json';
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

test('fixture observes delayed advisory contention before expiry without the old 700ms cutoff', async () => {
  let time = 0;
  const observed = await waitForAdvisoryContention(1500, {
    nowMs: () => time,
    readWaiting: () => time >= 950 ? '1' : '0',
    delayImpl: async ms => { time += ms; },
  });
  expect(observed).toBe(960);
  expect(observed).toBeLessThan(1500);
});

test('fixture rejects contention returned by a slow observation after expiry', async () => {
  let time = 0;
  await expect(waitForAdvisoryContention(1500, {
    nowMs: () => time,
    readWaiting: () => { time = 1600; return '1'; },
    delayImpl: async () => {},
  })).rejects.toThrow('LOCAL_REHEARSAL_CONTENTION_OBSERVED_AFTER_EXPIRY');
});
const fixtureParentRole = 'review_successor_fixture_parent_20261012';
const fixtureMemberRole = 'review_successor_fixture_member_20261012';
const fixtureOwnerPrefix = 'tzudong-review-successor-fixture';

type FixtureRoleState = {
  roles: Record<string, unknown>[];
  memberships: Record<string, unknown>[];
};

const emptyFixtureRoleState = (): FixtureRoleState => ({ roles: [], memberships: [] });

function ownedFixtureRoleState(token: string): FixtureRoleState {
  const common = {
    rolcanlogin: false,
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolreplication: false,
    rolbypassrls: false,
    rolconnlimit: -1,
    rolvaliduntil: null,
    rolconfig: null,
  };
  return {
    roles: [
      {
        ...common,
        rolname: fixtureMemberRole,
        rolinherit: true,
        owner_marker: `${fixtureOwnerPrefix}:${token}:member`,
      },
      {
        ...common,
        rolname: fixtureParentRole,
        rolinherit: false,
        owner_marker: `${fixtureOwnerPrefix}:${token}:parent`,
      },
    ],
    memberships: [{
      parent: fixtureParentRole,
      member: fixtureMemberRole,
      grantor: 'supabase_admin',
      admin_option: false,
      inherit_option: true,
      set_option: true,
    }],
  };
}

function fixtureOwnership() {
  return {
    database: false,
    fixtureMembership: false,
    fixtureMembershipAttempted: false,
    fixtureMembershipToken: null,
    fixtureMembershipBaseline: null,
  };
}

type DatabaseMetadata = {
  name: string;
  owner: string;
  encoding: string;
  collate: string;
  ctype: string;
  localeProvider: string;
  allowConnections: boolean;
  isTemplate: boolean;
};

type DatabaseState = {
  target: DatabaseMetadata | null;
  template: DatabaseMetadata;
};

const templateDatabaseMetadata: DatabaseMetadata = {
  name: 'ranking_clone',
  owner: 'postgres',
  encoding: 'UTF8',
  collate: 'C',
  ctype: 'C',
  localeProvider: 'c',
  allowConnections: true,
  isTemplate: false,
};

function databaseNameFromSql(sql: string) {
  const queryMatch = sql.match(/target_database\.datname='([^']+)'/);
  const commandMatch = sql.match(/(?:CREATE|DROP) DATABASE ([a-z0-9_]+)/);
  const databaseName = queryMatch?.[1] || commandMatch?.[1];
  if (!databaseName) throw new Error(`database name missing from SQL: ${sql.slice(0, 80)}`);
  return databaseName;
}

function databaseState(databaseName: string, targetOwner = 'postgres'): DatabaseState {
  return {
    target: {
      ...templateDatabaseMetadata,
      name: databaseName,
      owner: targetOwner,
      isTemplate: false,
    },
    template: { ...templateDatabaseMetadata },
  };
}

function emptyDatabaseState(): DatabaseState {
  return { target: null, template: { ...templateDatabaseMetadata } };
}

function databaseOwnership() {
  return {
    database: false,
    databaseAttempted: false,
    databaseName: null,
    databaseBaseline: null,
  };
}

test('successor acknowledgement loss reconciles a committed terminal state without SQL replay', () => {
  const baselineState = { bundle: { targetCount: 0 }, state: { terminalContractReady: false } };
  const terminalState = { bundle: { targetCount: 11 }, state: { terminalContractReady: true } };
  let state = baselineState;
  const sqlCalls: string[] = [];
  let readbacks = 0;

  const application = applySuccessorPlanOnce({
    database: 'fixture_database',
    sql: 'BEGIN; SELECT successor_mutation(); COMMIT;',
    stateQuery: 'SELECT successor_state();',
    baselineState,
    terminalState,
    psqlImpl: (_database: string, sql: string) => {
      sqlCalls.push(sql);
      state = terminalState;
      throw new Error('response lost after commit');
    },
    readStateImpl: (_database: string, query: string) => {
      expect(query).toBe('SELECT successor_state();');
      readbacks += 1;
      return state;
    },
  });

  expect(application.outcome).toBe('committed-after-acknowledgement-loss');
  expect(JSON.parse(application.result.stdout.trim())).toEqual(terminalState);
  expect(sqlCalls).toEqual(['BEGIN; SELECT successor_mutation(); COMMIT;']);
  expect(readbacks).toBe(1);
});

test('successor failure at the baseline is classified without diagnostic SQL replay', () => {
  const baselineState = { bundle: { targetCount: 0 }, state: { terminalContractReady: false } };
  const terminalState = { bundle: { targetCount: 11 }, state: { terminalContractReady: true } };
  const sqlCalls: string[] = [];
  let readbacks = 0;

  expect(() => applySuccessorPlanOnce({
    database: 'fixture_database',
    sql: 'BEGIN; SELECT successor_mutation(); COMMIT;',
    stateQuery: 'SELECT successor_state();',
    baselineState,
    terminalState,
    psqlImpl: (_database: string, sql: string) => {
      sqlCalls.push(sql);
      throw new Error('transaction rolled back before acknowledgement');
    },
    readStateImpl: () => {
      readbacks += 1;
      return baselineState;
    },
  })).toThrow('LOCAL_REHEARSAL_APPLICATION_ROLLED_BACK');

  expect(sqlCalls).toEqual(['BEGIN; SELECT successor_mutation(); COMMIT;']);
  expect(readbacks).toBe(1);
});

test('retained proof is checksum-verified and distinguished from the current harness source', () => {
  const manifestBytes = readFileSync(new URL('../../../.github/review-media-sql-successor.v1.json', import.meta.url));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const harnessBytes = readFileSync(new URL(
    '../performance/review-db-successor-20261012/verify-review-media-sql-successor.mjs',
    import.meta.url,
  ));
  const retained = inspectRetainedProof({
    currentBindings: {
      manifestSha256: sha256(manifestBytes),
      rehearsalHarnessSha256: sha256(harnessBytes),
      sourceRoot: manifest.sourceRoot,
    },
  });

  expect(retained).toMatchObject({
    present: true,
    classification: 'retained-historical-evidence',
    repositoryPath: retainedProofRepositoryPath,
    expectedSha256: '6f5dc5c5603c8a4d8b601d3edb28009e454e955292a65707747e66f274557b3f',
    actualSha256: '6f5dc5c5603c8a4d8b601d3edb28009e454e955292a65707747e66f274557b3f',
    currentSourceMatch: false,
    usedAsCurrentProof: false,
  });
  expect(retained.bindingDifferences.some(({ field }: { field: string }) => (
    field === 'rehearsalHarnessSha256'
  ))).toBe(true);
});

test('retained proof with bytes not authorized by SHA256SUMS is rejected', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tzudong-retained-proof-'));
  try {
    const outputPath = join(directory, 'pg17-local-replay.json');
    const checksumsPath = join(directory, 'SHA256SUMS');
    const proof = Buffer.from(`${JSON.stringify({
      status: 'passed',
      temporaryDatabaseDropped: true,
      hostedWrites: false,
      operatingWrites: false,
      manifestSha256: '1'.repeat(64),
      rehearsalHarnessSha256: '2'.repeat(64),
      sourceRoot: '3'.repeat(64),
    })}\n`);
    writeFileSync(outputPath, proof);
    const checksumBytes = `${sha256(proof)}  ${retainedProofRepositoryPath}\n`;
    writeFileSync(checksumsPath, checksumBytes);
    writeFileSync(`${checksumsPath}.sha256`, `${sha256(checksumBytes)}\n`);
    writeFileSync(outputPath, Buffer.concat([proof, Buffer.from(' ')]));

    expect(() => inspectRetainedProof({
      outputPath,
      checksumsPath,
      currentBindings: {
        manifestSha256: '1'.repeat(64),
        rehearsalHarnessSha256: '2'.repeat(64),
        sourceRoot: '3'.repeat(64),
      },
    })).toThrow('LOCAL_REHEARSAL_RETAINED_SHA256_MISMATCH');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('jointly altered retained proof and checksum map are rejected by the independent digest', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tzudong-retained-map-tamper-'));
  try {
    const outputPath = join(directory, 'pg17-local-replay.json');
    const checksumsPath = join(directory, 'SHA256SUMS');
    const proof = { status: 'passed', temporaryDatabaseDropped: true, hostedWrites: false,
      operatingWrites: false, manifestSha256: '1'.repeat(64),
      rehearsalHarnessSha256: '2'.repeat(64), sourceRoot: '3'.repeat(64) };
    const original = Buffer.from(`${JSON.stringify(proof)}\n`);
    const originalMap = `${sha256(original)}  ${retainedProofRepositoryPath}\n`;
    writeFileSync(`${checksumsPath}.sha256`, `${sha256(originalMap)}\n`);
    const tampered = Buffer.from(`${JSON.stringify({ ...proof, sourceRoot: '4'.repeat(64) })}\n`);
    writeFileSync(outputPath, tampered);
    writeFileSync(checksumsPath, `${sha256(tampered)}  ${retainedProofRepositoryPath}\n`);
    expect(() => inspectRetainedProof({ outputPath, checksumsPath, currentBindings: {
      manifestSha256: '1'.repeat(64), rehearsalHarnessSha256: '2'.repeat(64), sourceRoot: '4'.repeat(64),
    } })).toThrow('LOCAL_REHEARSAL_CHECKSUMS_SHA256_MISMATCH');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const [label, failingDatabaseCall, expectedCode] of [
  ['predecessor', 1, 'LOCAL_REHEARSAL_PREDECESSOR_FAILED'],
  ['fixture', 7, 'fixture failed'],
] as const) {
  test(`owned database is cleaned after ${label} SQL fails`, () => {
    const ownership = databaseOwnership();
    let databaseExists = false;
    let databaseName = '';
    let databaseCalls = 0;
    let drops = 0;
    const dependencies = {
      scalarImpl: (_database: string, sql: string) => {
        const requestedName = databaseNameFromSql(sql);
        return JSON.stringify(databaseExists ? databaseState(requestedName) : emptyDatabaseState());
      },
      readFileImpl: () => Buffer.from('-- predecessor fixture'),
      psqlImpl: (database: string, sql: string | Buffer) => {
        const statement = sql.toString();
        if (database === 'postgres' && statement.startsWith('CREATE DATABASE ')) {
          databaseName = databaseNameFromSql(statement);
          databaseExists = true;
          return {};
        }
        if (database === 'postgres' && statement.startsWith('DROP DATABASE ')) {
          databaseExists = false;
          drops += 1;
          return {};
        }
        databaseCalls += 1;
        if (databaseCalls === failingDatabaseCall) throw new Error(`${label} failed`);
        return {};
      },
    };

    try {
      createOwnedDatabase(ownership, dependencies);
      throw new Error('expected fixture construction to fail');
    } catch (error) {
      expect((error as Error).message).toContain(expectedCode);
      expect(ownership.database).toBe(true);
    } finally {
      dropOwnedDatabase(ownership, dependencies);
    }

    expect(databaseExists).toBe(false);
    expect(ownership.database).toBe(false);
    expect(drops).toBe(1);
  });
}

test('pre-existing database is never acquired or dropped', () => {
  const ownership = databaseOwnership();
  let databaseExists = true;
  let scalarCalls = 0;
  let psqlCalls = 0;
  const dependencies = {
    scalarImpl: (_database: string, sql: string) => {
      scalarCalls += 1;
      const databaseName = databaseNameFromSql(sql);
      return JSON.stringify(databaseExists ? databaseState(databaseName) : emptyDatabaseState());
    },
    readFileImpl: () => Buffer.from(''),
    psqlImpl: () => {
      psqlCalls += 1;
      databaseExists = false;
      return {};
    },
  };

  expect(() => createOwnedDatabase(ownership, dependencies)).toThrow('LOCAL_REHEARSAL_TARGET_ALREADY_EXISTS');
  expect(dropOwnedDatabase(ownership, dependencies)).toBe(false);
  expect(databaseExists).toBe(true);
  expect(ownership.database).toBe(false);
  expect(scalarCalls).toBe(1);
  expect(psqlCalls).toBe(0);
});

test('database CREATE acknowledgement loss is reconciled without replay and cleaned by exact ownership', () => {
  const ownership = databaseOwnership();
  let state = emptyDatabaseState();
  let createCalls = 0;
  let dropCalls = 0;
  const dependencies = {
    scalarImpl: () => JSON.stringify(state),
    readFileImpl: () => Buffer.from('-- predecessor fixture'),
    psqlImpl: (database: string, sql: string | Buffer) => {
      const statement = sql.toString();
      if (database === 'postgres' && statement.startsWith('CREATE DATABASE ')) {
        createCalls += 1;
        state = databaseState(databaseNameFromSql(statement));
        throw new Error('response lost after CREATE commit');
      }
      if (database === 'postgres' && statement.startsWith('DROP DATABASE ')) {
        dropCalls += 1;
        state = emptyDatabaseState();
        return {};
      }
      return {};
    },
  };

  expect(createOwnedDatabase(ownership, dependencies)).toBe(true);
  expect(ownership).toMatchObject({
    database: true,
    databaseAttempted: true,
    databaseCreationAcknowledged: false,
    databaseCreationReconciled: true,
  });
  expect(ownership.databaseName).toMatch(/^review_successor_local_[0-9a-f]{32}$/);
  expect(createCalls).toBe(1);
  expect(dropOwnedDatabase(ownership, dependencies)).toBe(true);
  expect(createCalls).toBe(1);
  expect(dropCalls).toBe(1);
  expect(state).toEqual(emptyDatabaseState());
  expect(ownership.database).toBe(false);
  expect(ownership.databaseAttempted).toBe(false);
});

test('cleanup re-reads and removes the exact owned database after the first CREATE readback fails', () => {
  const ownership = databaseOwnership();
  let state = emptyDatabaseState();
  let readbacks = 0;
  let createCalls = 0;
  let dropCalls = 0;
  const dependencies = {
    scalarImpl: () => {
      readbacks += 1;
      if (readbacks === 2) throw new Error('readback transport failed');
      return JSON.stringify(state);
    },
    readFileImpl: () => Buffer.from('-- predecessor fixture'),
    psqlImpl: (database: string, sql: string | Buffer) => {
      const statement = sql.toString();
      if (database === 'postgres' && statement.startsWith('CREATE DATABASE ')) {
        createCalls += 1;
        state = databaseState(databaseNameFromSql(statement));
        throw new Error('response lost after CREATE commit');
      }
      if (database === 'postgres' && statement.startsWith('DROP DATABASE ')) {
        dropCalls += 1;
        state = emptyDatabaseState();
        return {};
      }
      throw new Error('unexpected SQL');
    },
  };

  expect(() => createOwnedDatabase(ownership, dependencies))
    .toThrow('LOCAL_REHEARSAL_DATABASE_READBACK_FAILED');
  expect(ownership).toMatchObject({ database: false, databaseAttempted: true });
  expect(dropOwnedDatabase(ownership, dependencies)).toBe(true);
  expect(createCalls).toBe(1);
  expect(dropCalls).toBe(1);
  expect(readbacks).toBe(4);
  expect(state).toEqual(emptyDatabaseState());
});

test('cleanup refuses a database whose exact owner metadata does not match', () => {
  const ownership = databaseOwnership();
  let state = emptyDatabaseState();
  let dropCalls = 0;
  const dependencies = {
    scalarImpl: () => JSON.stringify(state),
    readFileImpl: () => Buffer.from('-- predecessor fixture'),
    psqlImpl: (database: string, sql: string | Buffer) => {
      const statement = sql.toString();
      if (database === 'postgres' && statement.startsWith('CREATE DATABASE ')) {
        state = databaseState(databaseNameFromSql(statement));
        return {};
      }
      if (database === 'postgres' && statement.startsWith('DROP DATABASE ')) {
        dropCalls += 1;
        state = emptyDatabaseState();
        return {};
      }
      return {};
    },
  };

  createOwnedDatabase(ownership, dependencies);
  state = databaseState(String(ownership.databaseName), 'foreign_owner');
  expect(() => dropOwnedDatabase(ownership, dependencies))
    .toThrow('LOCAL_REHEARSAL_DATABASE_OWNERSHIP_UNPROVEN');
  expect(dropCalls).toBe(0);
  expect(state.target?.owner).toBe('foreign_owner');
});

test('fixture role creation acknowledgement loss is reconciled and exact owned roles are cleaned', () => {
  const token = 'a'.repeat(32);
  const ownership = fixtureOwnership();
  let state = emptyFixtureRoleState();
  const statements: string[] = [];
  const dependencies = {
    scalarImpl: () => JSON.stringify(state),
    psqlImpl: (_database: string, sql: string) => {
      statements.push(sql);
      if (sql.includes(`CREATE ROLE ${fixtureParentRole}`)) {
        state = ownedFixtureRoleState(token);
        throw new Error('response lost after commit');
      }
      if (sql.includes(`DROP ROLE ${fixtureMemberRole}`)) {
        state = emptyFixtureRoleState();
        throw new Error('response lost after drop commit');
      }
      throw new Error('unexpected SQL');
    },
    generateToken: () => token,
  };

  expect(createFixtureMembership(ownership, dependencies)).toBe(true);
  expect(ownership).toMatchObject({
    fixtureMembership: true,
    fixtureMembershipToken: token,
    fixtureMembershipCreationAcknowledged: false,
    fixtureMembershipCreationReconciled: true,
  });
  expect(dropFixtureMembership(ownership, dependencies)).toBe(true);
  expect(ownership).toMatchObject({
    fixtureMembership: false,
    fixtureMembershipDropped: true,
    fixtureMembershipRemovalAcknowledged: false,
  });
  expect(state).toEqual(emptyFixtureRoleState());
  expect(statements).toHaveLength(2);
  expect(statements[0]).toContain(
    `COMMENT ON ROLE ${fixtureParentRole} IS '${fixtureOwnerPrefix}:${token}:parent'`,
  );
  expect(statements[0]).toContain(
    `COMMENT ON ROLE ${fixtureMemberRole} IS '${fixtureOwnerPrefix}:${token}:member'`,
  );
  expect(statements[1]).toContain(`DROP ROLE ${fixtureMemberRole}`);
  expect(statements[1]).toContain(`DROP ROLE ${fixtureParentRole}`);
});

test('cleanup re-reads exact owned roles when the first post-create readback fails', () => {
  const token = '4'.repeat(32);
  const ownership = fixtureOwnership();
  let state = emptyFixtureRoleState();
  let readbacks = 0;
  const statements: string[] = [];
  const dependencies = {
    scalarImpl: () => {
      readbacks += 1;
      if (readbacks === 2) throw new Error('readback transport failed');
      return JSON.stringify(state);
    },
    psqlImpl: (_database: string, sql: string) => {
      statements.push(sql);
      if (sql.includes(`CREATE ROLE ${fixtureParentRole}`)) {
        state = ownedFixtureRoleState(token);
        throw new Error('response lost after create commit');
      }
      if (sql.includes(`DROP ROLE ${fixtureMemberRole}`)) {
        state = emptyFixtureRoleState();
        return {};
      }
      throw new Error('unexpected SQL');
    },
    generateToken: () => token,
  };

  expect(() => createFixtureMembership(ownership, dependencies))
    .toThrow('LOCAL_REHEARSAL_FIXTURE_ROLE_READBACK_FAILED');
  expect(ownership).toMatchObject({
    fixtureMembership: false,
    fixtureMembershipAttempted: true,
    fixtureMembershipToken: token,
    fixtureMembershipBaseline: emptyFixtureRoleState(),
  });
  expect(dropFixtureMembership(ownership, dependencies)).toBe(true);
  expect(ownership).toMatchObject({
    fixtureMembership: false,
    fixtureMembershipAttempted: false,
    fixtureMembershipDropped: true,
  });
  expect(state).toEqual(emptyFixtureRoleState());
  expect(readbacks).toBe(4);
  expect(statements).toHaveLength(2);
});

test('fixture role creation failure without owned readback never authorizes cleanup', () => {
  const ownership = fixtureOwnership();
  let state = emptyFixtureRoleState();
  const statements: string[] = [];
  const dependencies = {
    scalarImpl: () => JSON.stringify(state),
    psqlImpl: (_database: string, sql: string) => {
      statements.push(sql);
      throw new Error('transaction failed before commit');
    },
    generateToken: () => 'b'.repeat(32),
  };

  expect(() => createFixtureMembership(ownership, dependencies))
    .toThrow('LOCAL_REHEARSAL_FIXTURE_ROLE_CREATION_UNCONFIRMED');
  expect(ownership.fixtureMembership).toBe(false);
  expect(ownership.fixtureMembershipAttempted).toBe(false);
  expect(ownership.fixtureMembershipToken).toBe('b'.repeat(32));
  expect(dropFixtureMembership(ownership, dependencies)).toBe(false);
  expect(statements).toHaveLength(1);
  expect(statements.some(statement => statement.includes('DROP ROLE'))).toBe(false);
  expect(state).toEqual(emptyFixtureRoleState());
});

test('pre-existing fixture role collision is preserved and never acquired for cleanup', () => {
  const ownership = fixtureOwnership();
  const state: FixtureRoleState = {
    roles: [{
      ...ownedFixtureRoleState('c'.repeat(32)).roles[0],
      owner_marker: 'foreign-owner',
    }],
    memberships: [],
  };
  let psqlCalls = 0;
  const dependencies = {
    scalarImpl: () => JSON.stringify(state),
    psqlImpl: () => {
      psqlCalls += 1;
      return {};
    },
    generateToken: () => 'd'.repeat(32),
  };

  expect(() => createFixtureMembership(ownership, dependencies))
    .toThrow('LOCAL_REHEARSAL_FIXTURE_ROLE_EXISTS');
  expect(dropFixtureMembership(ownership, dependencies)).toBe(false);
  expect(psqlCalls).toBe(0);
  expect(state.roles[0].owner_marker).toBe('foreign-owner');
});

test('uncertain create collision with another owner is not guessed or removed', () => {
  const ownership = fixtureOwnership();
  let state = emptyFixtureRoleState();
  const statements: string[] = [];
  const dependencies = {
    scalarImpl: () => JSON.stringify(state),
    psqlImpl: (_database: string, sql: string) => {
      statements.push(sql);
      state = ownedFixtureRoleState('e'.repeat(32));
      throw new Error('ambiguous create response');
    },
    generateToken: () => 'f'.repeat(32),
  };

  expect(() => createFixtureMembership(ownership, dependencies))
    .toThrow('LOCAL_REHEARSAL_FIXTURE_ROLE_OWNERSHIP_UNPROVEN');
  expect(ownership.fixtureMembership).toBe(false);
  expect(ownership.fixtureMembershipAttempted).toBe(false);
  expect(ownership.fixtureMembershipToken).toBe('f'.repeat(32));
  expect(dropFixtureMembership(ownership, dependencies)).toBe(false);
  expect(statements).toHaveLength(1);
  expect(statements.some(statement => statement.includes('DROP ROLE'))).toBe(false);
  expect(state).toEqual(ownedFixtureRoleState('e'.repeat(32)));
});

test('cleanup refuses roles whose ownership marker changed after creation', () => {
  const token = '1'.repeat(32);
  const ownership = fixtureOwnership();
  let state = emptyFixtureRoleState();
  const statements: string[] = [];
  const dependencies = {
    scalarImpl: () => JSON.stringify(state),
    psqlImpl: (_database: string, sql: string) => {
      statements.push(sql);
      state = ownedFixtureRoleState(token);
      return {};
    },
    generateToken: () => token,
  };

  createFixtureMembership(ownership, dependencies);
  state = ownedFixtureRoleState('2'.repeat(32));
  expect(() => dropFixtureMembership(ownership, dependencies))
    .toThrow('LOCAL_REHEARSAL_FIXTURE_ROLE_OWNERSHIP_UNPROVEN');
  expect(ownership.fixtureMembership).toBe(true);
  expect(statements).toHaveLength(1);
  expect(statements.some(statement => statement.includes('DROP ROLE'))).toBe(false);
  expect(state).toEqual(ownedFixtureRoleState('2'.repeat(32)));
});

test('cleanup refuses to remove owned roles after an out-of-scope membership is added', () => {
  const token = '3'.repeat(32);
  const ownership = fixtureOwnership();
  let state = emptyFixtureRoleState();
  const statements: string[] = [];
  const dependencies = {
    scalarImpl: () => JSON.stringify(state),
    psqlImpl: (_database: string, sql: string) => {
      statements.push(sql);
      state = ownedFixtureRoleState(token);
      return {};
    },
    generateToken: () => token,
  };

  createFixtureMembership(ownership, dependencies);
  state = ownedFixtureRoleState(token);
  state.memberships.push({
    parent: 'foreign_parent_role',
    member: fixtureMemberRole,
    grantor: 'postgres',
    admin_option: false,
    inherit_option: true,
    set_option: true,
  });
  expect(() => dropFixtureMembership(ownership, dependencies))
    .toThrow('LOCAL_REHEARSAL_FIXTURE_ROLE_OWNERSHIP_UNPROVEN');
  expect(ownership.fixtureMembership).toBe(true);
  expect(statements).toHaveLength(1);
  expect(statements.some(statement => statement.includes('DROP ROLE'))).toBe(false);
  expect(state.memberships).toHaveLength(2);
});
