import { describe, expect, test } from 'bun:test';

import { createLatestSelection } from '@/lib/ocr/latest-selection';

describe('latest async file selection', () => {
  test('rejects an older completion after a newer selection begins', () => {
    const selection = createLatestSelection();
    const first = selection.begin();
    const second = selection.begin();

    expect(selection.isCurrent(first)).toBe(false);
    expect(selection.isCurrent(second)).toBe(true);
  });

  test('invalidates pending preparation when the selection is cleared', () => {
    const selection = createLatestSelection();
    const pending = selection.begin();
    selection.begin();

    expect(selection.isCurrent(pending)).toBe(false);
  });
});
