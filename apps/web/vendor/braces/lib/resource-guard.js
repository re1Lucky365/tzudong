'use strict';

// Private downstream resource profile. These are work/output bounds, not a
// replacement for the documented rangeLimit. Neither bound can be disabled.
const MAX_GENERATED_ITEMS = 50000;
const MAX_GENERATED_CHARACTERS = 1024 * 1024;
const MAX_GENERATED_DEPTH = 128;

const fail = (code, message) => {
  const error = new RangeError(message);
  error.code = code;
  throw error;
};

const isInteger = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
  && Number.isInteger(Number(value));

const rangeInfo = (args, options = {}) => {
  const [start, end] = args;
  const numeric = isInteger(start) && isInteger(end);
  let a, b, width;
  if (numeric) {
    a = Number(start); b = Number(end);
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) {
      fail('BRACES_RANGE_PRECISION', 'numeric brace range exceeds safe integer precision');
    }
    width = Math.max(String(start).length, String(end).length);
  } else if (typeof start === 'string' && start.length === 1 && typeof end === 'string' && end.length === 1) {
    a = start.charCodeAt(0); b = end.charCodeAt(0); width = 1;
  } else {
    return null; // Preserve fill-range's invalid-range/literal behavior.
  }
  // This matches fill-range: explicit third argument wins; zero defaults to1
  // and negative steps specify magnitude, not direction.
  const rawStep = args[2] || options.step || 1;
  const number = Number(rawStep);
  if (!Number.isInteger(number)) return null;
  const step = Math.max(Math.abs(number), 1);
  if (!Number.isSafeInteger(step)) fail('BRACES_RANGE_PRECISION', 'numeric brace step exceeds safe integer precision');
  return { numeric, step, width, count: Math.floor(Math.abs(b - a) / step) + 1 };
};

const createBudget = () => {
  let items = 0, characters = 0;
  return {
    consume(count, length) {
      if (!Number.isSafeInteger(count) || !Number.isSafeInteger(length) || count < 0 || length < 0
        || count > MAX_GENERATED_ITEMS - items || length > MAX_GENERATED_CHARACTERS - characters) {
        fail('BRACES_OUTPUT_LIMIT', 'brace output exceeds private resource limit');
      }
      items += count; characters += length;
    }
  };
};

const reserveRange = (args, options, budget, toRegex = false) => {
  const info = rangeInfo(args, options);
  // Unit-step regex ranges use a compact character/numeric representation;
  // stepped regex ranges enumerate internally, just like array expansion.
  if (info && (!toRegex || info.step !== 1)) {
    budget.consume(info.count, info.count * (info.width + (toRegex ? 1 : 0)));
  }
  return info;
};

const assertOutputLength = value => {
  if (value.length > MAX_GENERATED_CHARACTERS) fail('BRACES_OUTPUT_LIMIT', 'brace output exceeds private resource limit');
  return value;
};

module.exports = { rangeInfo, createBudget, reserveRange, assertOutputLength,
  MAX_GENERATED_ITEMS, MAX_GENERATED_DEPTH };
