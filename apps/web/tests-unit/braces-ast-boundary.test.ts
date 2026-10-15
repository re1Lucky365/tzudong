import { describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Exercise this checkout, independently of the shared installed tarball.
const braces = require('../vendor/braces/index.js');
const { assertAstDepth, MAX_DEPTH } = require('../vendor/braces/lib/depth-guard.js');
const methods = ['compile', 'expand', 'stringify'] as const;

type AstNode = {
  type: string;
  nodes?: AstNode[];
  parent?: AstNode;
  value?: string;
  queue?: unknown[];
};

function expectBoundaryError(run: () => unknown) {
  let error: unknown;
  try {
    run();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(RangeError);
  expect(error).toHaveProperty('code', 'BRACES_NESTING_LIMIT');
  expect(error).toHaveProperty('message', 'BRACES_NESTING_LIMIT');
}

function rejectInWalkers(make: () => unknown) {
  for (const method of methods) {
    expectBoundaryError(() => braces[method](make()));
  }
}

describe('vendored braces structural AST boundary', () => {
  test('rejects self and multi-node parent cycles before expansion changes queues', () => {
    for (const indirect of [false, true]) {
      for (const method of methods) {
        const child: AstNode = { type: 'paren', nodes: [] };
        const other: AstNode = { type: 'paren', nodes: [], parent: child };
        child.parent = indirect ? other : child;
        const queue = ['untouched'];
        const ast = { type: 'root', nodes: [child], queue };
        expectBoundaryError(() => braces[method](ast));
        expect(ast.queue).toBe(queue);
        expect(ast.queue).toEqual(['untouched']);
        expect(child.queue).toBeUndefined();
      }
    }
  });

  test('rejects sibling, descendant and unrelated parent links', () => {
    for (const relation of ['sibling', 'descendant', 'unrelated']) {
      rejectInWalkers(() => {
        const leaf: AstNode = { type: 'text', value: 'x' };
        const child: AstNode = { type: 'paren', nodes: [leaf] };
        const sibling: AstNode = { type: 'paren', nodes: [] };
        child.parent = relation === 'sibling' ? sibling
          : relation === 'descendant' ? leaf : { type: 'root', nodes: [] };
        return { type: 'root', nodes: [child, sibling] };
      });
    }
  });

  test('rejects non-array nodes containers, including recursive Set and array-like cases', () => {
    const containers = [
      (node: unknown) => new Set([node]),
      (node: unknown) => ({ 0: node, length: 1 }),
      () => new Map(),
      () => new Uint8Array(1),
      () => 'x',
      () => undefined,
      () => null,
      () => false,
    ];
    for (const container of containers) {
      for (const nested of [false, true]) {
        rejectInWalkers(() => {
          const node: { type: string; nodes?: unknown } = { type: 'root' };
          node.nodes = container(node);
          return nested ? { type: 'root', nodes: [node] } : node;
        });
      }
    }
  });

  test('rejects non-string values, including cyclic arrays outside the child graph', () => {
    const cycle: unknown[] = [];
    cycle.push(cycle);
    for (const value of [cycle, ['x'], 1, false, null, undefined, {}, () => 'x']) {
      rejectInWalkers(() => ({ type: 'root', nodes: [{ type: 'text', value }] }));
    }
    expect(braces.expand({ type: 'root', nodes: [{ type: 'text', value: '' }] })).toEqual([]);
    expect(braces.stringify({ type: 'text', value: '' })).toBe('');
  });

  test('rejects invalid nodes and invalid parent objects instead of skipping them', () => {
    for (const node of [null, undefined, 1, 'x', [], () => 'x']) {
      rejectInWalkers(() => ({ type: 'root', nodes: [node] }));
    }
    for (const parent of [1, false, 'x', [], () => 'x']) {
      rejectInWalkers(() => ({ type: 'root', nodes: [], parent }));
    }
  });

  test('retains the existing child-depth, child-cycle and shared-node limits', () => {
    let ast: AstNode = { type: 'text', value: 'x' };
    for (let i = 0; i < MAX_DEPTH; i++) ast = { type: 'root', nodes: [ast] };
    expect(braces.compile(ast)).toBe('x');
    expect(braces.stringify(ast)).toBe('x');
    rejectInWalkers(() => ({ type: 'root', nodes: [ast] }));
    rejectInWalkers(() => {
      const root: AstNode = { type: 'root', nodes: [] };
      root.nodes!.push(root);
      return root;
    });
    rejectInWalkers(() => {
      const leaf = { type: 'text', value: 'x' };
      return { type: 'root', nodes: [leaf, leaf] };
    });
  });

  test('bounds parent-only depth and retains the 50000-object budget', () => {
    let node: AstNode = { type: 'root', nodes: [] };
    for (let i = 0; i < MAX_DEPTH; i++) node = { type: 'paren', nodes: [], parent: node };
    expect(() => assertAstDepth(node)).not.toThrow();
    expectBoundaryError(() => assertAstDepth({ type: 'paren', nodes: [], parent: node }));

    // One deterministic boundary allocation; no large expansion or fuzz loop.
    const root: AstNode = {
      type: 'root',
      nodes: Array.from({ length: 49999 }, () => ({ type: 'text', value: 'x' })),
    };
    expect(() => assertAstDepth(root)).not.toThrow();
    root.parent = { type: 'root', nodes: [] };
    expectBoundaryError(() => assertAstDepth(root));
    delete root.parent;
    root.nodes!.push({ type: 'text', value: 'x' });
    expectBoundaryError(() => assertAstDepth(root));
  });

  test('preserves parser-generated alternatives, literals, ranges and parentheses', () => {
    const cases: [string, string[]][] = [
      ['src/{app,components}/**/*.{ts,tsx}', [
        'src/app/**/*.ts', 'src/app/**/*.tsx', 'src/components/**/*.ts', 'src/components/**/*.tsx',
      ]],
      ['part-{01..03}', ['part-01', 'part-02', 'part-03']],
      ['a/(b|c)/{d,e}', ['a/(b|c)/d', 'a/(b|c)/e']],
      ['literal\\{x\\}', ['literal{x}']],
      ['"{{x}}"', ['{{x}}']],
      ['[{,}]', ['[{,}]']],
      ['${a,b}', ['${a,b}']],
    ];
    for (const [pattern, expanded] of cases) {
      expect(braces.expand(braces.parse(pattern))).toEqual(expanded);
      for (const method of ['compile', 'stringify'] as const) {
        expect(braces[method](braces.parse(pattern))).toBe(braces[method](pattern));
      }
    }
    expect(braces.compile(braces.parse('a/{b,c}/d'))).toBe('a/(b|c)/d');
    expect(braces.stringify(braces.parse('a/{b,c}/d'))).toBe('a/{b,c}/d');
  });

  test('allows retained parent links through flattened unbalanced blocks and parsed subtrees', () => {
    for (const pattern of ['((a)', '{x', '{{a,b}']) {
      const ast = braces.parse(pattern);
      expect(braces.stringify(ast)).toBe(pattern);
      for (const method of methods) {
        expect(braces[method](braces.parse(pattern))).toEqual(braces[method](pattern));
      }
    }
    expect(braces.expand(braces.parse('({a,b}'))).toEqual(['(a', '(b']);
    const subtree = braces.parse('a/{b,c}/d').nodes.find((node: AstNode) => node.type === 'brace');
    expect(braces.compile(subtree)).toBe('(b|c)');
    expect(braces.stringify(subtree)).toBe('{b,c}');
  });

  test('accepts already-expanded ASTs and ignores queues that expansion replaces', () => {
    const ast = braces.parse('a/({b,c})');
    const staleQueue: unknown[] = [];
    staleQueue.push(staleQueue);
    ast.queue = staleQueue;
    expect(braces.expand(ast)).toEqual(['a/(b)', 'a/(c)']);
    expect(ast.queue).not.toBe(staleQueue);
    expect(braces.expand(ast)).toEqual(['a/(b)', 'a/(c)']);
    expect(braces.compile(ast)).toBe('a/((b|c))');
    expect(braces.stringify(ast)).toBe('a/({b,c})');

    const range = braces.parse('part-{01..03}');
    expect(braces.expand(range)).toEqual(['part-01', 'part-02', 'part-03']);
    // expand consumes range nodes; acceptance is not a promise of replay equivalence.
    expect(() => assertAstDepth(range)).not.toThrow();
  });

  test('options cannot relax the structural boundary', () => {
    for (const method of methods) {
      expectBoundaryError(() => braces[method]({ type: 'root', nodes: new Set() }, {
        maxDepth: Infinity, maxLength: Infinity, rangeLimit: false,
      }));
    }
  });
});
