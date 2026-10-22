import { describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';

// Exercise the candidate source before the new archive is installed. The
// current measurement's shared node_modules must remain unchanged.
const braces = createRequire(import.meta.url)('../vendor/braces');
const { flatten } = createRequire(import.meta.url)('../vendor/braces/lib/utils');

function rejects(run: () => unknown, code: string) {
  try {
    run();
    throw new Error('expected bounded rejection');
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
  }
}

describe('private brace range and generation boundaries', () => {
  test('enforces the same inclusive numeric limit in both directions and with explicit steps', () => {
    for (const input of ['{1..1001}', '{1001..1}', '{1..1001..1}', '{1001..1..-1}', '{1..1001..0}']) {
      rejects(() => braces.expand(input), 'BRACES_RANGE_LIMIT');
    }
    expect(braces.expand('{1..1000}').length).toBe(1000);
    expect(braces.expand('{1000..1}').length).toBe(1000);
    expect(braces.expand('{1..1999..2}').length).toBe(1000);
  });

  test('matches fill-range step precedence, sign, zero and padded output', () => {
    expect(braces.expand('{1..5..2}', { step: 100, rangeLimit: 3 })).toEqual(['1', '3', '5']);
    expect(braces.expand('{5..1}', { step: -2, rangeLimit: 3 })).toEqual(['5', '3', '1']);
    expect(braces.expand('{03..01..0}')).toEqual(['03', '02', '01']);
    expect(braces.expand('{1..3}', { step: 0 })).toEqual(['1', '2', '3']);
    expect(braces.expand('{1..9..3}', { rangeLimit: 3 })).toEqual(['1', '4', '7']);
  });

  test('retains explicit range-limit opt-out within the non-optional work budget', () => {
    expect(braces.expand('{1001..1}', { rangeLimit: false }).length).toBe(1001);
    expect(braces.expand('{1..1001..1}', { rangeLimit: false }).length).toBe(1001);
    rejects(() => braces.expand('{1..1000000}', { rangeLimit: false }), 'BRACES_OUTPUT_LIMIT');
  });

  test('does not let malformed rangeLimit options silently disable the range check', () => {
    for (const rangeLimit of [NaN, Infinity, -1, 1.5, '1000', null]) {
      rejects(() => braces.expand('{1..3}', { rangeLimit }), 'BRACES_RANGE_LIMIT');
    }
    rejects(() => braces.expand('{1..1}', { rangeLimit: 0 }), 'BRACES_RANGE_LIMIT');
  });

  test('rejects unsafe numeric precision before a non-progressing fill loop, even with rangeLimit disabled', () => {
    for (const input of ['{9007199254740992..9007199254740993}', '{-9007199254740992..-9007199254740993}']) {
      for (const method of ['compile', 'expand']) {
        rejects(() => braces[method](input), 'BRACES_RANGE_PRECISION');
        rejects(() => braces[method](input, { rangeLimit: false }), 'BRACES_RANGE_PRECISION');
      }
    }
    expect(braces.expand('{9007199254740990..9007199254740991}')).toEqual(['9007199254740990', '9007199254740991']);
  });

  test('keeps compact large unit-step regex ranges but bounds enumerated stepped compilation', () => {
    const compact = braces.compile('{1..1000000}');
    expect(new RegExp('^(?:' + compact + ')$').test('1000000')).toBe(true);
    expect(new RegExp('^(?:' + compact + ')$').test('1000001')).toBe(false);
    rejects(() => braces.compile('{1..1000000..2}'), 'BRACES_OUTPUT_LIMIT');
    expect(new RegExp('^(?:' + braces.compile('{1..9..2}') + ')$').test('7')).toBe(true);
  });

  test('retains ordinary Cartesian expansion and rejects explosive work before materializing all combinations', () => {
    const normal = braces.expand('{a,b}'.repeat(12), { rangeLimit: 1 });
    expect(normal.length).toBe(4096);
    expect(normal[0]).toBe('a'.repeat(12));
    expect(normal.at(-1)).toBe('b'.repeat(12));
    rejects(() => braces.expand('{a,b}'.repeat(16)), 'BRACES_OUTPUT_LIMIT');
    rejects(() => braces.expand('{a,b}'.repeat(16), { rangeLimit: false }), 'BRACES_OUTPUT_LIMIT');
  });

  test('bounds generated characters including long prefixes and transformed ranges', () => {
    rejects(() => braces.expand('x'.repeat(8000) + '{a,b}'.repeat(8)), 'BRACES_OUTPUT_LIMIT');
    rejects(() => braces.expand('{1..20}', { transform: () => 'x'.repeat(100000) }), 'BRACES_OUTPUT_LIMIT');
    expect(braces.expand('{1..3}', { transform: (value: number) => 'item-' + value })).toEqual(['item-1', 'item-2', 'item-3']);
  });

  test('NaN maxLength cannot bypass the existing parser input-size boundary', () => {
    for (const method of ['parse', 'compile', 'expand', 'stringify']) {
      rejects(() => braces[method]('x', { maxLength: NaN }), 'BRACES_INPUT_LIMIT');
    }
    expect(braces.expand('ok', { maxLength: Infinity })).toEqual(['ok']);
  });

  test('flattening rejects active array cycles while preserving shared acyclic arrays', () => {
    const cycle: unknown[] = []; cycle.push(cycle);
    rejects(() => flatten(cycle), 'BRACES_OUTPUT_LIMIT');
    const shared = ['a', 'b'];
    expect(flatten([shared, shared])).toEqual(['a', 'b', 'a', 'b']);
  });

  test('retained external parent queues cannot reintroduce recursive array expansion', () => {
    const queue: unknown[] = []; queue.push(queue);
    const root: { type: string; nodes: unknown[] } = { type: 'root', nodes: [] };
    const retained = { type: 'brace', nodes: [], parent: root, queue };
    const child: { type: string; nodes: unknown[]; parent: unknown } = { type: 'paren', nodes: [], parent: retained };
    child.nodes.push({ type: 'close', value: ')', parent: child });
    root.nodes.push(child);
    rejects(() => braces.expand(root), 'BRACES_OUTPUT_LIMIT');
  });
});
