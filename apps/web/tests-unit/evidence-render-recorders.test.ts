import { describe, expect, test } from "bun:test";

import {
  recordBadgeAdditionDelta,
  recordPanelMemoryTrend,
  summarizeRenderSamples,
} from "../lib/evidence-engineering/render-measurement";

describe("later render measurements", () => {
  test("records frame time, long tasks, badge delta, and panel memory without a pass gate", () => {
    const frames = summarizeRenderSamples([10, 20, 80, 40]);
    expect(frames.p50Ms).toBe(20);
    expect(frames.p95Ms).toBe(80);
    expect(frames.longTaskCount).toBe(1);
    expect(frames.treats60FpsAsGate).toBe(false);
    expect(frames.treatsZeroPaintAsGate).toBe(false);

    const badge = recordBadgeAdditionDelta(1000, 1800);
    expect(badge).toEqual({
      beforeBytes: 1000,
      afterBytes: 1800,
      deltaBytes: 800,
      locksThreshold: false,
    });
    expect(recordBadgeAdditionDelta(1800, 1000).deltaBytes).toBe(-800);
    expect(() => recordBadgeAdditionDelta(Number.NaN, 1)).toThrow("invalid_badge_memory");

    const trend = recordPanelMemoryTrend([400, 700, 500]);
    expect(trend.sampleCount).toBe(3);
    expect(trend.samples).toEqual([400, 700, 500]);
    expect(trend.firstBytes).toBe(400);
    expect(trend.lastBytes).toBe(500);
    expect(trend.deltaBytes).toBe(100);
    expect(trend.locksThreshold).toBe(false);
    expect(recordPanelMemoryTrend([]).deltaBytes).toBeNull();
    expect(() => recordPanelMemoryTrend([-1])).toThrow("invalid_memory_sample");
  });
});
