import { describe, expect, test } from "bun:test";

import {
  badgeViewerClosesOnKey,
  createBadgeViewerSession,
  resetBadgeViewerSessionsForTests,
} from "../lib/evidence-engineering/badge-viewer-session";

describe("badge viewer session", () => {
  test("releases on close, recovers one renderer after context loss, and falls back on low power", () => {
    resetBadgeViewerSessionsForTests();
    const session = createBadgeViewerSession();
    expect(session.open(false)).toBe("viewer");
    expect(() => createBadgeViewerSession().open(false)).toThrow("duplicate_badge_renderer");
    expect(session.loseContext()).toBe("recovering");
    expect(session.open(false)).toBe("viewer");
    expect(() => createBadgeViewerSession().open(false)).toThrow("duplicate_badge_renderer");
    session.release();
    expect(() => session.open(false)).toThrow("badge_viewer_released");

    const lowPower = createBadgeViewerSession();
    expect(lowPower.open(true)).toBe("fallback");
    const afterFallback = createBadgeViewerSession();
    expect(afterFallback.open(false)).toBe("viewer");
    afterFallback.release();
    lowPower.release();

    expect(badgeViewerClosesOnKey("Escape")).toBe(true);
    expect(badgeViewerClosesOnKey("Enter")).toBe(false);
  });
});
