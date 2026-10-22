import { describe, expect, it } from "bun:test";
import { shouldUseStaticBadgeViewer } from "@/lib/evidence-engineering/badge-device-capability";

const high = { isLowEndDevice: false, cpuCores: 8, memoryGB: 8 };
const desktop = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 0 };

describe("optional badge viewer capability policy", () => {
  it("does not let an OS-derived model override unknown mobile hardware", () => {
    for (const os of [15, 16, 17, 18, 26]) {
      for (const cpuCores of [2, 6, 8]) {
        const browser = { userAgent: `Mozilla/5.0 (iPhone; CPU iPhone OS ${os}_0 like Mac OS X)`, maxTouchPoints: 1 };
        expect(shouldUseStaticBadgeViewer({ ...high, cpuCores, memoryGB: null }, browser)).toBe(true);
      }
    }
  });

  it("uses a static preview for desktop-UA iPads and unknown Android memory", () => {
    expect(shouldUseStaticBadgeViewer({ ...high, memoryGB: null }, { ...desktop, maxTouchPoints: 5 })).toBe(true);
    expect(shouldUseStaticBadgeViewer({ ...high, memoryGB: null }, { userAgent: "Android", maxTouchPoints: 0 })).toBe(true);
  });

  it("reuses existing hardware tiers, rejecting invalid or mid/low mobile memory", () => {
    const mobile = { userAgent: "Android", maxTouchPoints: 1 };
    for (const memoryGB of [null, -1, 0, 2, 4, NaN, Infinity]) {
      expect(shouldUseStaticBadgeViewer({ ...high, memoryGB }, mobile)).toBe(true);
    }
    for (const memoryGB of [6, 8]) {
      expect(shouldUseStaticBadgeViewer({ ...high, memoryGB }, mobile)).toBe(false);
    }
    expect(shouldUseStaticBadgeViewer({ ...high, isLowEndDevice: true }, mobile)).toBe(true);
  });

  it("preserves normal desktop opt-in and handles SSR without navigator", () => {
    expect(shouldUseStaticBadgeViewer({ ...high, memoryGB: null }, desktop)).toBe(false);
    expect(shouldUseStaticBadgeViewer({ ...high, isLowEndDevice: true }, desktop)).toBe(true);
    expect(shouldUseStaticBadgeViewer(high, null)).toBe(true);
  });
});
