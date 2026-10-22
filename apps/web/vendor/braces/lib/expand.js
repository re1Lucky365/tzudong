'use strict';

const fill = require('fill-range');
const stringify = require('./stringify');
const utils = require('./utils');
const { createBudget, reserveRange, MAX_GENERATED_DEPTH } = require('./resource-guard');

const append = (queue = '', stash = '', enclose = false, budget, depth = 0) => {
  if (depth > MAX_GENERATED_DEPTH) {
    throw Object.assign(new RangeError('brace output exceeds private resource limit'), { code: 'BRACES_OUTPUT_LIMIT' });
  }
  budget.consume(1, 0);
  const result = [];

  queue = [].concat(queue);
  stash = [].concat(stash);

  if (!stash.length) return queue;
  if (!queue.length) {
    return enclose ? utils.flatten(stash).map(ele => {
      budget.consume(1, String(ele).length + 2);
      return `{${ele}}`;
    }) : stash;
  }

  for (const item of queue) {
    if (Array.isArray(item)) {
      for (const value of item) {
        result.push(append(value, stash, enclose, budget, depth + 1));
      }
    } else {
      for (let ele of stash) {
        if (enclose === true && typeof ele === 'string') {
          budget.consume(1, ele.length + 2);
          ele = `{${ele}}`;
        }
        if (Array.isArray(ele)) {
          result.push(append(item, ele, enclose, budget, depth + 1));
        } else {
          budget.consume(1, String(item).length + String(ele).length);
          result.push(item + ele);
        }
      }
    }
  }
  return utils.flatten(result);
};

const expand = (ast, options = {}) => {
  const rangeLimit = options.rangeLimit === undefined ? 1000 : options.rangeLimit;
  const budget = createBudget();

  const walk = (node, parent = {}) => {
    node.queue = [];

    let p = parent;
    let q = parent.queue;

    while (p.type !== 'brace' && p.type !== 'root' && p.parent) {
      p = p.parent;
      q = p.queue;
    }

    if (node.invalid || node.dollar) {
      q.push(append(q.pop(), stringify(node, options), false, budget));
      return;
    }

    if (node.type === 'brace' && node.invalid !== true && node.nodes.length === 2) {
      q.push(append(q.pop(), ['{}'], false, budget));
      return;
    }

    if (node.nodes && node.ranges > 0) {
      const args = utils.reduce(node.nodes);

      const step = args[2] || options.step || 1;
      if (utils.exceedsLimit(args[0], args[1], step, rangeLimit)) {
        const error = new RangeError('expanded array length exceeds range limit. Use options.rangeLimit to increase or disable the limit.');
        error.code = 'BRACES_RANGE_LIMIT';
        throw error;
      }

      const info = reserveRange(args, options, budget);
      const fillOptions = typeof options.transform === 'function' && info ? {
        ...options,
        transform(value, index) {
          const transformed = options.transform(value, index);
          budget.consume(0, Math.max(0, String(transformed).length - info.width));
          return transformed;
        }
      } : options;
      let range = fill(...args, fillOptions);
      if (range.length === 0) {
        range = stringify(node, options);
      }

      q.push(append(q.pop(), range, false, budget));
      node.nodes = [];
      return;
    }

    const enclose = utils.encloseBrace(node);
    let queue = node.queue;
    let block = node;

    while (block.type !== 'brace' && block.type !== 'root' && block.parent) {
      block = block.parent;
      queue = block.queue;
    }

    for (let i = 0; i < node.nodes.length; i++) {
      const child = node.nodes[i];

      if (child.type === 'comma' && node.type === 'brace') {
        if (i === 1) queue.push('');
        queue.push('');
        continue;
      }

      if (child.type === 'close') {
        q.push(append(q.pop(), queue, enclose, budget));
        continue;
      }

      if (child.value && child.type !== 'open') {
        queue.push(append(queue.pop(), child.value, false, budget));
        continue;
      }

      if (child.nodes) {
        walk(child, node);
      }
    }

    return queue;
  };

  return utils.flatten(walk(ast));
};

module.exports = expand;
