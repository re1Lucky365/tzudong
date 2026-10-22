import { expect, test } from 'bun:test';
import { removeNaverMapListener } from '../lib/naver-map-event-cleanup';

test('listener removal preserves the provider receiver and handle', () => {
    const handle = { id: 'listener' };
    const events = {
        removed: null as object | null,
        removeListener(listener: object) { this.removed = listener; },
    };
    expect(removeNaverMapListener(events, handle)).toBe(true);
    expect(events.removed).toBe(handle);
});

test('absent provider or listener is safe during partial initialization', () => {
    let calls = 0;
    const events = { removeListener: () => { calls += 1; } };
    expect(removeNaverMapListener(undefined, {})).toBe(false);
    expect(removeNaverMapListener(events, null)).toBe(false);
    expect(removeNaverMapListener(events, undefined)).toBe(false);
    expect(calls).toBe(0);
});

test('one failed provider removal does not prevent the next teardown', () => {
    const attempts: number[] = [];
    const events = { removeListener: (id: number) => {
        attempts.push(id);
        if (id === 1) throw new TypeError("Cannot read properties of null (reading 'isArray')");
    } };
    expect(removeNaverMapListener(events, 1)).toBe(false);
    expect(removeNaverMapListener(events, 2)).toBe(true);
    expect(attempts).toEqual([1, 2]);
});
