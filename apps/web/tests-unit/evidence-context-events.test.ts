import { describe, expect, test } from "bun:test";

import { summarizeContextEvents } from "../lib/evidence-engineering/render-measurement";

describe("context event counts", () => {
  test("counts WebGL loss and recovery without locking a threshold", () => {
    const summary = summarizeContextEvents(["lost", "restored", "lost"]);
    expect(summary.lossCount).toBe(2);
    expect(summary.recoveryCount).toBe(1);
    expect(summary.locksThreshold).toBe(false);
    expect(summarizeContextEvents([])).toEqual({
      lossCount: 0,
      recoveryCount: 0,
      locksThreshold: false,
    });
    expect(() => summarizeContextEvents(["dropped" as "lost"])).toThrow("invalid_context_event");
  });
});
