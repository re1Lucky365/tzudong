import { expect, test } from 'bun:test';
import { reducer } from '../hooks/use-toast';

function withClock(run: (clock: { pending: Map<number, () => void> }) => void) {
  const originalSet = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  const pending = new Map<number, () => void>();
  let nextId = 0;
  Object.defineProperty(globalThis, 'setTimeout', { value: (callback: () => void) => {
    pending.set(++nextId, callback);
    return nextId;
  }, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'clearTimeout', { value: (id: number) => pending.delete(id), configurable: true, writable: true });
  try { run({ pending }); } finally {
    // Flush only this test's synthetic callbacks to clear the module's queue.
    for (const callback of pending.values()) callback();
    globalThis.setTimeout = originalSet;
    globalThis.clearTimeout = originalClear;
  }
}

test('192 show/dismiss cycles retain only the current toast retirement timer', () => withClock(({ pending }) => {
  let state: ReturnType<typeof reducer> = { toasts: [] };
  for (let i = 0; i < 192; i++) {
    const id = `retirement-${i}`;
    state = reducer(state, { type: 'ADD_TOAST', toast: { id, title: 'Fixture', open: true } });
    state = reducer(state, { type: 'DISMISS_TOAST', toastId: id });
  }
  expect(state.toasts).toHaveLength(1);
  expect(pending.size).toBe(1);
  state = reducer(state, { type: 'REMOVE_TOAST' });
  expect(state.toasts).toHaveLength(0);
  expect(pending.size).toBe(0);
}));

test('stale dismiss and duplicate dismiss cannot accumulate retirement timers', () => withClock(({ pending }) => {
  let state: ReturnType<typeof reducer> = { toasts: [] };
  state = reducer(state, { type: 'ADD_TOAST', toast: { id: 'current', open: true } });
  state = reducer(state, { type: 'DISMISS_TOAST', toastId: 'missing' });
  expect(state.toasts[0].open).toBe(true);
  expect(pending.size).toBe(0);
  state = reducer(state, { type: 'DISMISS_TOAST', toastId: 'current' });
  state = reducer(state, { type: 'DISMISS_TOAST', toastId: 'current' });
  expect(pending.size).toBe(1);
  state = reducer(state, { type: 'ADD_TOAST', toast: { id: 'new', open: true } });
  expect(pending.size).toBe(0);
  expect(state.toasts[0]).toMatchObject({ id: 'new', open: true });
}));

test('explicit removal cancels the matching timer while update preserves retirement', () => withClock(({ pending }) => {
  let state: ReturnType<typeof reducer> = { toasts: [] };
  state = reducer(state, { type: 'ADD_TOAST', toast: { id: 'update', open: true } });
  state = reducer(state, { type: 'DISMISS_TOAST' });
  state = reducer(state, { type: 'UPDATE_TOAST', toast: { id: 'update', title: 'Updated' } });
  expect(pending.size).toBe(1);
  expect(state.toasts[0].title).toBe('Updated');
  state = reducer(state, { type: 'REMOVE_TOAST', toastId: 'update' });
  expect(state.toasts).toHaveLength(0);
  expect(pending.size).toBe(0);
}));
