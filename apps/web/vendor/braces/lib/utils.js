'use strict';

const { rangeInfo, MAX_GENERATED_ITEMS, MAX_GENERATED_DEPTH } = require('./resource-guard');

exports.isInteger = num => {
  if (typeof num === 'number') {
    return Number.isInteger(num);
  }
  if (typeof num === 'string' && num.trim() !== '') {
    return Number.isInteger(Number(num));
  }
  return false;
};

/**
 * Find a node of the given type
 */

exports.find = (node, type) => node.nodes.find(node => node.type === type);

/**
 * Find a node of the given type
 */

exports.exceedsLimit = (min, max, step = 1, limit) => {
  if (limit !== false && (!Number.isSafeInteger(limit) || limit < 0)) {
    const error = new RangeError('rangeLimit must be a non-negative safe integer or false');
    error.code = 'BRACES_RANGE_LIMIT';
    throw error;
  }
  const info = rangeInfo([min, max, step]);
  return limit !== false && info !== null && info.numeric && info.count > limit;
};

/**
 * Escape the given node with '\\' before node.value
 */

exports.escapeNode = (block, n = 0, type) => {
  const node = block.nodes[n];
  if (!node) return;

  if ((type && node.type === type) || node.type === 'open' || node.type === 'close') {
    if (node.escaped !== true) {
      node.value = '\\' + node.value;
      node.escaped = true;
    }
  }
};

/**
 * Returns true if the given brace node should be enclosed in literal braces
 */

exports.encloseBrace = node => {
  if (node.type !== 'brace') return false;
  if ((node.commas >> 0 + node.ranges >> 0) === 0) {
    node.invalid = true;
    return true;
  }
  return false;
};

/**
 * Returns true if a brace node is invalid.
 */

exports.isInvalidBrace = block => {
  if (block.type !== 'brace') return false;
  if (block.invalid === true || block.dollar) return true;
  if ((block.commas >> 0 + block.ranges >> 0) === 0) {
    block.invalid = true;
    return true;
  }
  if (block.open !== true || block.close !== true) {
    block.invalid = true;
    return true;
  }
  return false;
};

/**
 * Returns true if a node is an open or close node
 */

exports.isOpenOrClose = node => {
  if (node.type === 'open' || node.type === 'close') {
    return true;
  }
  return node.open === true || node.close === true;
};

/**
 * Reduce an array of text nodes.
 */

exports.reduce = nodes => nodes.reduce((acc, node) => {
  if (node.type === 'text') acc.push(node.value);
  if (node.type === 'range') node.type = 'text';
  return acc;
}, []);

/**
 * Flatten an array
 */

exports.flatten = (...args) => {
  const result = [];
  const pending = [{ values: args, index: 0 }];
  const active = new Set([args]);
  let visited = 0;
  const reject = () => { throw Object.assign(new RangeError('brace output exceeds private resource limit'), { code: 'BRACES_OUTPUT_LIMIT' }); };
  while (pending.length) {
    const frame = pending[pending.length - 1];
    if (frame.index === frame.values.length) { active.delete(frame.values); pending.pop(); continue; }
    if (++visited > MAX_GENERATED_ITEMS) reject();
    const value = frame.values[frame.index++];
    if (Array.isArray(value)) {
      if (active.has(value) || pending.length >= MAX_GENERATED_DEPTH) reject();
      active.add(value); pending.push({ values: value, index: 0 });
    } else if (value !== undefined) result.push(value);
  }
  return result;
};
