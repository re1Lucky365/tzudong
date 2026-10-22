#!/usr/bin/env node
/** Rollback-only operating rehearsal for the eleven-stage review-media successor. */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  successorFailureResult,
  runReviewMediaSuccessorRehearsal,
} from './review-media-sql-successor.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

export function parseRehearsalArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!['--admission', '--journal', '--receipt'].includes(option)
      || !value
      || value.startsWith('--')
      || option.slice(2) in result) {
      fail('SUCCESSOR_REHEARSAL_ARGUMENT_INVALID');
    }
    result[option.slice(2)] = value;
  }
  if (argv.length !== 6 || !result.admission || !result.journal || !result.receipt) {
    fail('SUCCESSOR_REHEARSAL_ARGUMENT_INVALID');
  }
  return result;
}

export function main(argv = process.argv.slice(2), dependencies) {
  const args = parseRehearsalArguments(argv);
  return runReviewMediaSuccessorRehearsal({
    admissionPath: args.admission,
    journalPath: args.journal,
    receiptPath: args.receipt,
  }, dependencies);
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    console.log(JSON.stringify(main()));
  } catch (error) {
    console.error(JSON.stringify(successorFailureResult(error)));
    process.exitCode = 1;
  }
}
