'use strict';

// Local mitigation for GHSA-vfj7-8cjw-p6xm; the package is explicitly a private fork.
const MAX_DEPTH = 128;
const MAX_NODES = 50000;
const nestingError = () => Object.assign(new RangeError('BRACES_NESTING_LIMIT'), { code: 'BRACES_NESTING_LIMIT' });

// Validate child containers and text values, not getters or JS callbacks.
// Expansion replaces queues on visited nodes; retained external-parent queues
// are not covered by this structural check.
const assertNode = node => {
  if (!node || typeof node !== 'object' || Array.isArray(node)) throw nestingError();
  if ('nodes' in node && !Array.isArray(node.nodes)) throw nestingError();
  if ('value' in node && typeof node.value !== 'string') throw nestingError();
};

const assertAstDepth = root => {
  const pending = [[root, 0, undefined]];
  const seen = new Set();
  const parents = new Map();
  while (pending.length) {
    const [node, depth, parent] = pending.pop();
    assertNode(node);
    if (depth > MAX_DEPTH || seen.has(node) || seen.size >= MAX_NODES) throw nestingError();
    seen.add(node);
    parents.set(node, parent);
    if (node.nodes !== undefined) {
      if (node.nodes.length > MAX_NODES - seen.size - pending.length) throw nestingError();
      for (const child of node.nodes) pending.push([child, depth + 1, node]);
    }
  }

  // Child-to-parent backlinks are normal. Check the directed parent graph
  // separately, including blocks retained after unbalanced parsing flattens
  // their children. Memoization counts each parent-only object just once.
  const ancestry = new Map();
  let nodeCount = seen.size;
  for (const start of seen) {
    const path = [];
    const active = new Set();
    let node = start;
    while (node != null && !ancestry.has(node)) {
      assertNode(node);
      if (active.has(node) || path.length > MAX_DEPTH) throw nestingError();
      if (!seen.has(node) && ++nodeCount > MAX_NODES) throw nestingError();
      active.add(node);
      path.push(node);
      node = node.parent;
    }

    let depth = node == null ? -1 : ancestry.get(node).depth;
    let ancestor = node == null ? undefined : seen.has(node) ? node : ancestry.get(node).ancestor;
    while (path.length) {
      node = path.pop();
      if (++depth > MAX_DEPTH) throw nestingError();
      ancestry.set(node, { depth, ancestor });
      if (seen.has(node)) ancestor = node;
    }

    // Missing backlinks are allowed for hand-built trees. A present backlink
    // must reach the actual containing node before any other node in this tree.
    // A parsed subtree may retain ancestors outside the supplied child tree.
    if (start.parent != null && ancestry.get(start).ancestor !== parents.get(start)) {
      throw nestingError();
    }
  }
};
module.exports = { MAX_DEPTH, nestingError, assertAstDepth };
