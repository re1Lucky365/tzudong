import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cautionForDetailPanel, naverPlaceSearchUrl } from "../components/restaurant/OperationalCautionNotice";

describe("detail panel operational caution", () => {
  test("shows a reviewed closure notice and ignores a search miss", () => {
    expect(cautionForDetailPanel({ automaticState: "closure_candidate" })).toBe("closure_candidate");
    expect(cautionForDetailPanel({
      reviewedStatus: "closed_store",
      reviewed: true,
    })).toBe("closed_store");
    expect(cautionForDetailPanel({
      reviewed_status: "relocated",
      reviewed: true,
    })).toBe("relocated");
    expect(cautionForDetailPanel({ automaticState: "needs_review" })).toBeNull();
    expect(cautionForDetailPanel({
      reviewedStatus: "closed_store",
      reviewed: false,
    })).toBeNull();
    expect(cautionForDetailPanel(null)).toBeNull();
    expect(naverPlaceSearchUrl("회전초밥")).toBe("https://map.naver.com/p/search/%ED%9A%8C%EC%A0%84%EC%B4%88%EB%B0%A5");
    const panel = readFileSync(resolve(import.meta.dir, "../components/restaurant/RestaurantDetailPanel.tsx"), "utf8");
    expect(panel).toContain("cautionForDetailPanel(restaurant)");
    expect(panel).not.toContain("operationalCaution({})");
  });
});
