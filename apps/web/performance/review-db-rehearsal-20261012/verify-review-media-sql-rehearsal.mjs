#!/usr/bin/env node

/**
 * Isolated PostgreSQL 17.6 replay for the rollback-only successor controller.
 *
 * A disposable container is populated from the empty-row ranking_clone
 * schema fixture and its non-personal contract seed rows. No hosted endpoint
 * is contacted. Every scenario verifies the same restored state 0 in a
 * database named `postgres`, matching the operating database contract.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

import {
  buildSuccessorStateQuery,
  compileSuccessorRehearsalPlan,
  loadSuccessorManifest,
  validateSuccessorStageStates,
} from '../../scripts/review-media-sql-successor.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(HERE, '../../../..');
const OUTPUT_PATH = resolve(HERE, 'pg17-rollback-rehearsal.json');
const CHECKSUMS_PATH = resolve(HERE, 'SHA256SUMS');
const DOCKER_CONTEXT = process.env.TZUDONG_REHEARSAL_DOCKER_CONTEXT || 'colima-tzudong-catalog-20261007';
const SOURCE_CONTAINER = process.env.TZUDONG_REHEARSAL_SOURCE_CONTAINER || 'tzudong-ranking-clone-20261008';
const CONTAINER_PREFIX = 'tzudong-review-rollback-rehearsal';
const OWNER_LABEL = 'tzudong.review-rehearsal.owner';
const IMAGE = 'supabase/postgres@sha256:fbe6c858a2ea9616aead3c39e132afcc0660decc5cb7dc656208ed145f5331ab';
const BOOTSTRAP_PASSWORD = randomBytes(24).toString('hex');
const ADVISORY_LOCK_KEY = '7311754282260211';
const PREDECESSOR_PATHS = Object.freeze([
  'backend/supabase/migrations/20261004190259_admin_record_guarded_actions.sql',
  'backend/supabase/migrations/20261004192657_admin_evaluation_raw_warning_groups.sql',
  'backend/supabase/migrations/20261004194715_admin_evaluation_raw_warning_invoker_contract.sql',
  'backend/supabase/migrations/20261009022915_restaurant_review_manual_preview_eligibility.sql',
  'backend/supabase/migrations/20261009091342_admin_record_private_verification_cleanup.sql',
  'backend/supabase/migrations/20261009101645_admin_user_management_rpc_forward.sql',
]);
const REQUIRED_ROLES = Object.freeze([
  'cli_login_postgres',
  'privacy_auth_bridge',
  'privacy_retention_activation_operator',
  'privacy_retention_legal_approver',
  'privacy_retention_operator_approver',
  'privacy_workflow_owner',
  'supabase_privileged_role',
  'supabase_realtime_admin',
  'tzudong_g037_readonly',
]);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const canonical = value => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function currentBindings(record, manifestBytes, harnessBytes) {
  return Object.freeze({
    manifestSha256: sha256(manifestBytes),
    rehearsalHarnessSha256: sha256(harnessBytes),
    sourceRoot: record.manifest.sourceRoot,
  });
}

function checksumEntry(checksumsBytes, repositoryPath) {
  const entries = checksumsBytes.toString('utf8').split(/\r?\n/).filter(Boolean).map(line => {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (!match) fail('LOCAL_REHEARSAL_CHECKSUMS_INVALID');
    return { sha256: match[1], path: match[2] };
  });
  const matches = entries.filter(entry => entry.path === repositoryPath);
  if (matches.length !== 1) fail('LOCAL_REHEARSAL_RETAINED_CHECKSUM_MISSING');
  return matches[0];
}

export function inspectRetainedProof({
  outputPath = OUTPUT_PATH,
  checksumsPath = CHECKSUMS_PATH,
  bindings,
  repositoryRoot = REPOSITORY_ROOT,
} = {}) {
  if (!existsSync(outputPath)) return Object.freeze({ present: false, classification: 'missing' });
  if (!existsSync(checksumsPath)) fail('LOCAL_REHEARSAL_CHECKSUMS_MISSING');
  const proofBytes = readFileSync(outputPath);
  const repositoryPath = relative(repositoryRoot, outputPath).replaceAll('\\', '/');
  if (!repositoryPath || repositoryPath.startsWith('../')) fail('LOCAL_REHEARSAL_RETAINED_PATH_INVALID');
  const expected = checksumEntry(readFileSync(checksumsPath), repositoryPath);
  const actualSha256 = sha256(proofBytes);
  if (actualSha256 !== expected.sha256) fail('LOCAL_REHEARSAL_RETAINED_SHA256_MISMATCH');
  let proof;
  try { proof = JSON.parse(proofBytes.toString('utf8')); } catch { fail('LOCAL_REHEARSAL_RETAINED_JSON_INVALID'); }
  const fields = ['manifestSha256', 'rehearsalHarnessSha256', 'sourceRoot'];
  const bindingDifferences = bindings
    ? fields.filter(field => proof[field] !== bindings[field]).map(field => ({
      field,
      current: bindings[field],
      retained: proof[field] ?? null,
    }))
    : [];
  return Object.freeze({
    present: true,
    classification: bindingDifferences.length === 0
      ? 'retained-current-source-evidence'
      : 'retained-historical-evidence',
    repositoryPath,
    expectedSha256: expected.sha256,
    actualSha256,
    currentSourceMatch: bindingDifferences.length === 0,
    usedAsCurrentProof: false,
    bindingDifferences,
  });
}

function docker(args, { allowFailure = false, input, maxBuffer = 64 * 1024 * 1024 } = {}) {
  const result = spawnSync('docker', ['--context', DOCKER_CONTEXT, ...args], {
    encoding: 'utf8',
    input,
    maxBuffer,
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    const marker = /ERROR:\s+([A-Z][A-Z0-9_]{3,96})\b/.exec(result.stderr)?.[1]
      || /FATAL:\s+([A-Z][A-Z0-9_]{3,96})\b/.exec(result.stderr)?.[1]
      || 'UNKNOWN';
    fail(`LOCAL_REHEARSAL_COMMAND_FAILED_${marker}`);
  }
  return result;
}

function psql(container, database, sql, { actor = 'postgres', allowFailure = false } = {}) {
  return docker([
    'exec', '-i', '-e', `PGPASSWORD=${BOOTSTRAP_PASSWORD}`, container,
    'psql', '-XAtq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse',
    '-h', '127.0.0.1', '-U', actor, '-d', database, '--file=-',
  ], { allowFailure, input: sql });
}

function scalar(container, database, sql, actor = 'postgres') {
  return psql(container, database, `${sql}\n`, { actor }).stdout.trim();
}

function state(container, database, stateQuery) {
  const lines = scalar(container, database, `${stateQuery};`).split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) fail('LOCAL_REHEARSAL_STATE_SHAPE_INVALID');
  try { return JSON.parse(lines[0]); } catch { fail('LOCAL_REHEARSAL_STATE_JSON_INVALID'); }
}

function waitForReady(container) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = docker([
      'exec', '-e', `PGPASSWORD=${BOOTSTRAP_PASSWORD}`, container,
      'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres',
    ], { allowFailure: true });
    if (ready.status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  fail('LOCAL_REHEARSAL_CONTAINER_NOT_READY');
}

function createRequiredRoles(container) {
  const roleArray = `ARRAY[${REQUIRED_ROLES.map(quote).join(',')}]`;
  psql(container, 'postgres', `DO $roles$
DECLARE role_name text;
BEGIN
 FOREACH role_name IN ARRAY ${roleArray} LOOP
  IF to_regrole(role_name) IS NULL THEN
   EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',role_name);
  END IF;
 END LOOP;
 ALTER ROLE privacy_auth_bridge INHERIT;
 ALTER ROLE privacy_retention_activation_operator NOINHERIT;
 ALTER ROLE privacy_retention_legal_approver NOINHERIT;
 ALTER ROLE privacy_retention_operator_approver NOINHERIT;
 ALTER ROLE privacy_workflow_owner NOINHERIT;
END $roles$;`);
  psql(container, 'postgres', `GRANT privacy_auth_bridge TO postgres WITH ADMIN TRUE,INHERIT FALSE,SET FALSE GRANTED BY supabase_admin;
GRANT privacy_retention_activation_operator TO postgres WITH ADMIN TRUE,INHERIT FALSE,SET FALSE GRANTED BY supabase_admin;
GRANT privacy_retention_legal_approver TO postgres WITH ADMIN TRUE,INHERIT FALSE,SET FALSE GRANTED BY supabase_admin;
GRANT privacy_retention_operator_approver TO postgres WITH ADMIN TRUE,INHERIT FALSE,SET FALSE GRANTED BY supabase_admin;
GRANT privacy_workflow_owner TO postgres WITH ADMIN TRUE,INHERIT FALSE,SET FALSE GRANTED BY supabase_admin;`, { actor: 'supabase_admin' });
  psql(container, 'postgres', 'GRANT privacy_workflow_owner TO privacy_auth_bridge WITH ADMIN FALSE,INHERIT TRUE,SET TRUE GRANTED BY postgres;');
}

function fixtureSql() {
  return `DO $fixture$
BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>0
  OR (SELECT count(*) FROM public.profiles)<>0
  OR (SELECT count(*) FROM public.reviews)<>0
 THEN RAISE EXCEPTION 'LOCAL_REHEARSAL_FIXTURE_INVALID'; END IF;
END $fixture$;
INSERT INTO supabase_migrations.schema_migrations(version,statements,name)
SELECT lpad(value::text,14,'0'),ARRAY['local schema-only predecessor fixture'],format('local_predecessor_%s',value)
FROM generate_series(1,86) value;
INSERT INTO pipeline_control.restaurant_review_policy(singleton,enabled)
VALUES(true,false)
ON CONFLICT(singleton) DO UPDATE SET enabled=false,operator_id=NULL,last_run_at=NULL;
INSERT INTO pipeline_control.admin_evaluation_catalog_revision(singleton,revision)
VALUES(true,1)
ON CONFLICT(singleton) DO NOTHING;`;
}

function inspectContainer(target, expected, dockerImpl) {
  const result = dockerImpl(['container', 'inspect', target], { allowFailure: true });
  if (result.error || result.status !== 0) {
    if (/No such (?:object|container)/i.test(result.stderr || '')) return null;
    fail('LOCAL_REHEARSAL_CONTAINER_INSPECTION_FAILED');
  }
  let values;
  try { values = JSON.parse(result.stdout); } catch { fail('LOCAL_REHEARSAL_CONTAINER_INSPECTION_INVALID'); }
  if (!Array.isArray(values) || values.length !== 1) fail('LOCAL_REHEARSAL_CONTAINER_INSPECTION_INVALID');
  const value = values[0];
  const id = typeof value?.Id === 'string' ? value.Id : '';
  const name = typeof value?.Name === 'string' ? value.Name.replace(/^\//, '') : '';
  const owner = value?.Config?.Labels?.[OWNER_LABEL];
  if (!/^[0-9a-f]{12,64}$/.test(id)
    || (expected.id && id !== expected.id)
    || name !== expected.name
    || owner !== expected.token) {
    fail('LOCAL_REHEARSAL_CONTAINER_OWNERSHIP_UNPROVEN');
  }
  return Object.freeze({ id, name, token: owner });
}

export function createOwnedContainer(ownership, {
  dockerImpl = docker,
  generateToken = () => randomBytes(16).toString('hex'),
  processId = process.pid,
} = {}) {
  if (ownership.created || ownership.id || ownership.name || ownership.token) {
    fail('LOCAL_REHEARSAL_CONTAINER_OWNERSHIP_STATE_INVALID');
  }
  const token = generateToken();
  if (!/^[0-9a-f]{32}$/.test(token)) fail('LOCAL_REHEARSAL_CONTAINER_TOKEN_INVALID');
  const name = `${CONTAINER_PREFIX}-${processId}-${token.slice(0, 12)}`;
  ownership.name = name;
  ownership.token = token;
  const creation = dockerImpl([
    'run', '-d', '--rm', '--name', name, '--label', `${OWNER_LABEL}=${token}`,
    '-e', `POSTGRES_PASSWORD=${BOOTSTRAP_PASSWORD}`, IMAGE,
  ], { allowFailure: true });
  const observed = inspectContainer(name, ownership, dockerImpl);
  if (!observed) fail('LOCAL_REHEARSAL_CONTAINER_CREATION_UNCONFIRMED');
  // The name and per-run label are the ownership authority. Record the exact
  // inspected ID before reconciling the run acknowledgement so any later
  // mismatch is still cleaned up by the caller's finally block.
  ownership.id = observed.id;
  ownership.created = true;
  const acknowledgedId = creation.status === 0 ? creation.stdout.trim() : '';
  if (acknowledgedId && acknowledgedId !== observed.id) fail('LOCAL_REHEARSAL_CONTAINER_ACK_MISMATCH');
  ownership.creationAcknowledged = !creation.error && creation.status === 0 && Boolean(acknowledgedId);
  ownership.creationReconciled = !ownership.creationAcknowledged;
  return observed.id;
}

export function removeOwnedContainer(ownership, { dockerImpl = docker } = {}) {
  if (!ownership.created || !ownership.id || !ownership.name || !ownership.token) return false;
  const observed = inspectContainer(ownership.id, ownership, dockerImpl);
  if (!observed) {
    ownership.created = false;
    ownership.removed = true;
    return true;
  }
  const removal = dockerImpl(['container', 'rm', '--force', ownership.id], { allowFailure: true });
  const after = inspectContainer(ownership.id, ownership, dockerImpl);
  if (after) fail('LOCAL_REHEARSAL_CONTAINER_REMOVAL_UNCONFIRMED');
  ownership.created = false;
  ownership.removed = true;
  ownership.removalAcknowledged = removal.status === 0;
  return true;
}

function initializeFixture(ownership) {
  const container = createOwnedContainer(ownership);
  waitForReady(container);
  psql(container, 'template1', 'ALTER ROLE postgres SUPERUSER;\nDROP DATABASE postgres WITH (FORCE);\nCREATE DATABASE postgres OWNER postgres TEMPLATE template0;', { actor: 'supabase_admin' });
  createRequiredRoles(container);
  const dump = docker([
    'exec', SOURCE_CONTAINER,
    'pg_dump', '-U', 'postgres', '-d', 'ranking_clone',
  ]).stdout;
  const deterministicDump = dump.replace(/^\\(?:un)?restrict [^\n]*\n/gm, '');
  psql(container, 'postgres', dump);
  // pg_dump recreates enum/type OIDs. Rebind only the fixture's derived OID
  // projection to each unchanged source signature before replaying migrations.
  psql(container, 'postgres', `UPDATE privacy_retention.g014_public_rpc_allowlist allowed
SET identity_arguments=procedure.proargtypes::text
FROM pg_proc procedure
WHERE procedure.oid=to_regprocedure(allowed.source_signature)
  AND allowed.identity_arguments IS DISTINCT FROM procedure.proargtypes::text;`);
  psql(container, 'postgres', 'ALTER ROLE postgres NOSUPERUSER;', { actor: 'supabase_admin' });
  PREDECESSOR_PATHS.forEach((path, index) => {
    const result = psql(container, 'postgres', readFileSync(resolve(REPOSITORY_ROOT, path)), { allowFailure: true });
    if (result.status !== 0) {
      const marker = /ERROR:\s+([A-Z][A-Z0-9_]{3,96})\b/.exec(result.stderr)?.[1] || 'UNKNOWN';
      fail(`LOCAL_REHEARSAL_PREDECESSOR_FAILED_${index + 1}_${marker}`);
    }
  });
  psql(container, 'postgres', fixtureSql());
  return Object.freeze({
    container,
    dumpSha256: sha256(deterministicDump),
    engine: scalar(container, 'postgres', 'SHOW server_version;'),
  });
}

function parseStages(output, manifest) {
  const lines = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length !== 12) fail('LOCAL_REHEARSAL_STAGE_COUNT_INVALID');
  let stages;
  try {
    stages = lines.map((line, index) => {
      const value = JSON.parse(line);
      if (value.kind !== 'successor-rehearsal-stage'
        || value.index !== index
        || value.serverVersionNum !== 170006) fail('LOCAL_REHEARSAL_STAGE_SHAPE_INVALID');
      return value.state;
    });
  } catch { fail('LOCAL_REHEARSAL_STAGE_JSON_INVALID'); }
  validateSuccessorStageStates(stages, manifest);
  return stages;
}

function startLockHolder(container) {
  const args = [
    '--context', DOCKER_CONTEXT,
    'exec', '-i', '-e', `PGPASSWORD=${BOOTSTRAP_PASSWORD}`, container,
    'psql', '-XAtq', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres',
  ];
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let readySettled = false;
  const ready = new Promise((resolveReady, rejectReady) => {
    child.on('error', rejectReady);
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      if (!readySettled && stdout.includes('LOCK_HELD')) {
        readySettled = true;
        resolveReady();
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('exit', code => {
      if (!readySettled) rejectReady(new Error(code === 0 ? 'LOCAL_LOCK_OUTPUT_MISSING' : 'LOCAL_LOCK_FAILED'));
    });
  });
  const completion = new Promise((resolveCompletion, rejectCompletion) => {
    child.on('error', rejectCompletion);
    child.on('close', code => code === 0 ? resolveCompletion() : rejectCompletion(new Error('LOCAL_LOCK_FAILED')));
  });
  child.stdin.end(`BEGIN;\nSELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY}::bigint);\nSELECT 'LOCK_HELD';\nSELECT pg_sleep(1.6);\nCOMMIT;\n`);
  return { child, completion, ready, stderr: () => stderr };
}

export function parseArguments(argv) {
  if (argv.length === 0) return Object.freeze({ outputPath: null });
  if (argv.length !== 2 || argv[0] !== '--output' || !argv[1]) fail('LOCAL_REHEARSAL_ARGUMENTS_INVALID');
  return Object.freeze({ outputPath: resolve(argv[1]) });
}

export function publishCurrentProof({ retainedProof, proof, outputPath }, {
  writeFileImpl = writeFileSync,
  writeStdoutImpl = value => process.stdout.write(value),
} = {}) {
  if (outputPath) {
    writeFileImpl(outputPath, `${JSON.stringify(proof, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  }
  const envelope = Object.freeze({
    kind: 'review-media-sql-local-rehearsal',
    retainedProof,
    currentProof: proof,
    currentOutputPath: outputPath,
  });
  writeStdoutImpl(`${JSON.stringify(envelope)}\n`);
  return envelope;
}

export async function run(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.outputPath && existsSync(options.outputPath)) fail('LOCAL_REHEARSAL_CURRENT_OUTPUT_EXISTS');
  const record = loadSuccessorManifest();
  const manifestBytes = readFileSync(resolve(REPOSITORY_ROOT, '.github/review-media-sql-successor.v1.json'));
  const harnessBytes = readFileSync(fileURLToPath(import.meta.url));
  const bindings = currentBindings(record, manifestBytes, harnessBytes);
  const retainedProof = inspectRetainedProof({ bindings });
  const ownership = { created: false, id: null, name: null, token: null };
  let proof;
  try {
    const environment = initializeFixture(ownership);
    const container = environment.container;
    if (!environment.engine.startsWith('17.6')) fail('LOCAL_REHEARSAL_ENGINE_INVALID');
    const stateQuery = buildSuccessorStateQuery(record.manifest);

    const baseline = state(container, 'postgres', stateQuery);
    const plan = compileSuccessorRehearsalPlan(record, { expiresAt: '9999-12-31T23:59:59.999Z' }, baseline);
    const replay = psql(container, 'postgres', plan.sql);
    const stages = parseStages(replay.stdout, record.manifest);
    const restored = state(container, 'postgres', stateQuery);
    if (!equal(restored, baseline) || !equal(stages[0], baseline)) fail('LOCAL_REHEARSAL_ROLLBACK_DRIFT');

    const errorBaseline = state(container, 'postgres', stateQuery);
    const errorPlan = compileSuccessorRehearsalPlan(record, { expiresAt: '9999-12-31T23:59:59.999Z' }, errorBaseline);
    const forcedErrorSql = errorPlan.sql.replace(
      /\nROLLBACK;\s*$/,
      "\nDO $forced$ BEGIN RAISE EXCEPTION 'LOCAL_FORCED_REHEARSAL_ERROR'; END $forced$;\nROLLBACK;",
    );
    const forcedError = psql(container, 'postgres', forcedErrorSql, { allowFailure: true });
    if (forcedError.status === 0 || !/LOCAL_FORCED_REHEARSAL_ERROR/.test(forcedError.stderr)) {
      fail('LOCAL_REHEARSAL_FORCED_ERROR_MISSING');
    }
    if (!equal(state(container, 'postgres', stateQuery), errorBaseline)) fail('LOCAL_REHEARSAL_ERROR_ROLLBACK_DRIFT');

    const lostBaseline = state(container, 'postgres', stateQuery);
    const lostPlan = compileSuccessorRehearsalPlan(record, { expiresAt: '9999-12-31T23:59:59.999Z' }, lostBaseline);
    psql(container, 'postgres', lostPlan.sql); // Deliberately discard the complete response once.
    if (!equal(state(container, 'postgres', stateQuery), lostBaseline)) fail('LOCAL_REHEARSAL_LOST_RESPONSE_DRIFT');

    const expiryBaseline = state(container, 'postgres', stateQuery);
    const holder = startLockHolder(container);
    await holder.ready;
    const expiresAt = new Date(Date.now() + 1_000).toISOString();
    const expiryPlan = compileSuccessorRehearsalPlan(record, { expiresAt }, expiryBaseline);
    const expiryResult = psql(container, 'postgres', expiryPlan.sql, { allowFailure: true });
    await holder.completion;
    if (expiryResult.status === 0
      || !/SUCCESSOR_ADMISSION_EXPIRED/.test(expiryResult.stderr)
      || /lock timeout/i.test(expiryResult.stderr)) {
      fail('LOCAL_REHEARSAL_CONTENDED_EXPIRY_NOT_REJECTED');
    }
    if (!equal(state(container, 'postgres', stateQuery), expiryBaseline)) fail('LOCAL_REHEARSAL_EXPIRY_DRIFT');

    const toolchain = record.manifest.toolchain.map(entry => ({ ...entry }));
    proof = {
      schemaVersion: 1,
      status: 'passed',
      environment: {
        engine: environment.engine,
        image: IMAGE,
        emptyRowChecks: ['public.profiles', 'public.reviews'],
      },
      manifestSha256: sha256(manifestBytes),
      manifestToolchainRoot: sha256(JSON.stringify(canonical(toolchain))),
      rehearsalHarnessSha256: sha256(harnessBytes),
      sourceRoot: record.manifest.sourceRoot,
      fixtureDumpSha256: environment.dumpSha256,
      predecessorSources: PREDECESSOR_PATHS.map(path => ({
        path,
        sha256: sha256(readFileSync(resolve(REPOSITORY_ROOT, path))),
      })),
      migrationCount: record.manifest.migrations.length,
      statementCount: record.manifest.migrations.reduce((sum, migration) => sum + migration.statementCount, 0),
      baselineStateSha256: sha256(JSON.stringify(canonical(baseline))),
      stageStatesSha256: sha256(JSON.stringify(canonical(stages))),
      terminalStateSha256: sha256(JSON.stringify(canonical(stages.at(-1)))),
      compiledSqlBytes: Buffer.byteLength(plan.sql),
      compiledSqlSha256: sha256(plan.sql),
      results: {
        rollbackStageCount: stages.length,
        rollbackExact: true,
        forcedErrorRejected: true,
        forcedErrorRollbackExact: true,
        lostResponseMutationAttempts: 1,
        lostResponseRestorationExact: true,
        contendedExpiryRejected: true,
        contendedExpiryRollbackExact: true,
      },
      hostedWrites: false,
      operatingRowsRead: false,
      rawSqlInProof: false,
      sourceMutation: false,
    };
  } finally {
    removeOwnedContainer(ownership);
  }
  proof.temporaryContainerRemoved = ownership.removed === true;
  if (!proof.temporaryContainerRemoved) fail('LOCAL_REHEARSAL_CONTAINER_REMOVAL_UNCONFIRMED');
  publishCurrentProof({ retainedProof, proof, outputPath: options.outputPath });
  return Object.freeze({ retainedProof, currentProof: proof, currentOutputPath: options.outputPath });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run();
}
