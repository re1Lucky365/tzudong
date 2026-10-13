#!/usr/bin/env node
/** Exercise fixture ownership on a new, labelled PostgreSQL 17.6 container. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOwnedContainer, removeOwnedContainer } from '../review-db-rehearsal-20261012/verify-review-media-sql-rehearsal.mjs';
import { createFixtureMembership, dropFixtureMembership, createOwnedDatabase, dropOwnedDatabase } from './verify-review-media-sql-successor.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const context = process.env.TZUDONG_REHEARSAL_DOCKER_CONTEXT || 'colima-tzudong-catalog-20261007';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bindingPaths = Object.freeze({
  sourceSha256: resolve(here, 'verify-review-media-sql-successor.mjs'),
  containerHelperSha256: resolve(here, '../review-db-rehearsal-20261012/verify-review-media-sql-rehearsal.mjs'),
  verifierSha256: fileURLToPath(import.meta.url),
});

export function fixtureOwnershipBindings({ readFileImpl = readFileSync } = {}) {
  return Object.freeze(Object.fromEntries(Object.entries(bindingPaths)
    .map(([key, path]) => [key, hash(readFileImpl(path))])));
}

export function assertFixtureOwnershipBindings(expected, dependencies = {}) {
  const actual = fixtureOwnershipBindings(dependencies);
  if (Object.keys(bindingPaths).some(key => expected?.[key] !== actual[key])) {
    throw Object.assign(new Error('FIXTURE_OWNERSHIP_SOURCE_CHANGED'), {
      code: 'FIXTURE_OWNERSHIP_SOURCE_CHANGED',
    });
  }
  return actual;
}

let password;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const check = value => { if (!value) fail('FIXTURE_OWNERSHIP_ASSERTION_FAILED'); };

function docker(args, options = {}) {
  if (args[0] === 'run') password = args.find(value => value.startsWith('POSTGRES_PASSWORD='))?.slice(18);
  const result = spawnSync('docker', ['--context', context, ...args], {
    input: options.input, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  if (!options.allowFailure && (result.error || result.status !== 0)) fail('FIXTURE_OWNERSHIP_COMMAND_FAILED');
  return result;
}

const container = { created: false, id: null, name: null, token: null };
function sql(database, statement, actor = 'supabase_admin') {
  return docker(['exec', '-i', '-e', `PGPASSWORD=${password}`, container.id,
    'psql', '-XAtq', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', actor, '-d', database, '--file=-'],
  { input: String(statement) }).stdout.trim();
}

export function runFixtureOwnershipVerification(args = process.argv.slice(2)) {
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--output'
    || !args[1] || args[1].startsWith('--'))) fail('FIXTURE_OWNERSHIP_ARGUMENT_INVALID');
  const output = args.length === 0
    ? resolve(here, 'pg17-fixture-ownership-20261013.json') : resolve(args[1]);
  const sourceBindings = fixtureOwnershipBindings();
  const results = [];
  try {
    if (existsSync(output)) fail('FIXTURE_OWNERSHIP_OUTPUT_EXISTS');
    createOwnedContainer(container, { dockerImpl: docker });
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const result = docker(['exec', '-e', `PGPASSWORD=${password}`, container.id,
        'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres'], { allowFailure: true });
      if (result.status === 0) { ready = true; break; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
    check(ready && sql('postgres', 'SHOW server_version;').startsWith('17.6'));

    for (const mode of ['normal', 'lost-create-and-drop-ack', 'lost-create-ack-and-first-readback']) {
      let created = false;
      let lostReadback = false;
      let createAttempts = 0;
      let dropAttempts = 0;
      const ownership = { database: false, fixtureMembership: false, fixtureMembershipAttempted: false,
        fixtureMembershipToken: null, fixtureMembershipBaseline: null };
      const dependencies = {
        scalarImpl: (database, statement, actor) => {
          if (mode.endsWith('first-readback') && created && !lostReadback) {
            lostReadback = true; fail('FIXTURE_FAULT_READBACK_LOSS');
          }
          return sql(database, statement, actor);
        },
        psqlImpl: (database, statement, options) => {
          const text = String(statement);
          sql(database, text, options.actor);
          if (text.includes('CREATE ROLE')) {
            created = true; createAttempts += 1;
            if (mode !== 'normal') fail('FIXTURE_FAULT_CREATE_ACK_LOSS');
          } else if (text.includes('DROP ROLE')) {
            dropAttempts += 1;
            if (mode.includes('drop-ack')) fail('FIXTURE_FAULT_DROP_ACK_LOSS');
          }
        },
      };
      try { createFixtureMembership(ownership, dependencies); }
      catch (error) {
        if (!(mode.endsWith('first-readback') && lostReadback
          && error.message === 'LOCAL_REHEARSAL_FIXTURE_ROLE_READBACK_FAILED')) {
          const code = /^[A-Z][A-Z0-9_]{3,96}/.exec(String(error.message))?.[0] || 'UNKNOWN';
          const observed = JSON.parse(sql('postgres', `SELECT json_build_object(
            'actorSuperuser',(SELECT rolsuper FROM pg_roles WHERE rolname='supabase_admin'),
            'roles',(SELECT json_agg(json_build_object('name',rolname,'inherit',rolinherit,
              'connlimit',rolconnlimit,'validuntil',rolvaliduntil,'config',rolconfig,
              'markerPresent',shobj_description(oid,'pg_authid') IS NOT NULL)) FROM pg_roles
              WHERE rolname IN('review_successor_fixture_parent_20261012','review_successor_fixture_member_20261012')),
            'memberships',(SELECT json_agg(json_build_object('parent',p.rolname,'member',m.rolname,
              'grantor',g.rolname,'admin',a.admin_option,'inherit',a.inherit_option,'set',a.set_option))
              FROM pg_auth_members a JOIN pg_roles p ON p.oid=a.roleid
              JOIN pg_roles m ON m.oid=a.member JOIN pg_roles g ON g.oid=a.grantor
              WHERE p.rolname IN('review_successor_fixture_parent_20261012','review_successor_fixture_member_20261012'))
          )::text;`));
          writeFileSync(`${output}.failure.json`,
            `${JSON.stringify({ schemaVersion: 1, status: 'failed', code, observed }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
          fail('FIXTURE_OWNERSHIP_ROLE_PROTOCOL_FAILED');
        }
      }
      check(dropFixtureMembership(ownership, dependencies));
      check(!ownership.fixtureMembership && !ownership.fixtureMembershipAttempted && createAttempts === 1 && dropAttempts === 1);
      results.push({ kind: 'roles', mode, createAttempts, dropAttempts, cleaned: true });
    }

    sql('postgres', 'CREATE DATABASE ranking_clone OWNER postgres TEMPLATE template0;');
    for (const mode of ['normal', 'lost-create-ack', 'lost-create-ack-and-first-readback']) {
      let created = false;
      let lostReadback = false;
      let createAttempts = 0;
      let dropAttempts = 0;
      const ownership = { database: false };
      const dependencies = {
        readFileImpl: () => Buffer.from('-- ownership-only fixture: schema application excluded'),
        scalarImpl: (database, statement, actor) => {
          if (mode.endsWith('first-readback') && created && !lostReadback) {
            lostReadback = true; fail('FIXTURE_FAULT_READBACK_LOSS');
          }
          return sql(database, statement, actor);
        },
        psqlImpl: (database, statement, options = {}) => {
          // The ownership protocol is exercised against PG; predecessor/fixture SQL is outside this check.
          if (database !== 'postgres') return {};
          const text = String(statement);
          sql(database, text, options.actor);
          if (/CREATE DATABASE/.test(text)) {
            created = true; createAttempts += 1;
            if (mode !== 'normal') fail('FIXTURE_FAULT_CREATE_ACK_LOSS');
          } else if (/DROP DATABASE/.test(text)) dropAttempts += 1;
          return {};
        },
      };
      try { createOwnedDatabase(ownership, dependencies); }
      catch (error) { check(mode.endsWith('first-readback') && created && lostReadback
        && error.message === 'LOCAL_REHEARSAL_DATABASE_READBACK_FAILED'); }
      dropOwnedDatabase(ownership, dependencies);
      check(!ownership.database && !ownership.databaseAttempted && createAttempts === 1 && dropAttempts === 1);
      results.push({ kind: 'database', mode, createAttempts, dropAttempts, cleaned: true });
    }
    assertFixtureOwnershipBindings(sourceBindings);
  } finally {
    removeOwnedContainer(container, { dockerImpl: docker });
  }

  check(container.removed === true);
  assertFixtureOwnershipBindings(sourceBindings);
  const proof = { schemaVersion: 1, kind: 'isolated-fixture-ownership-verification', status: 'passed',
    recordedAtUTC: new Date().toISOString(), ...sourceBindings,
    environment: { engine: '17.6', image: 'supabase/postgres@sha256:fbe6c858a2ea9616aead3c39e132afcc0660decc5cb7dc656208ed145f5331ab' },
    results, temporaryContainerRemoved: true, sourceContainerMutation: false, hostedWrites: false,
    predecessorAndFixtureSqlExercised: false };
  writeFileSync(output, `${JSON.stringify(proof, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: proof.status, scenarios: results.length, output: output.slice(root.length + 1) }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runFixtureOwnershipVerification();
}
