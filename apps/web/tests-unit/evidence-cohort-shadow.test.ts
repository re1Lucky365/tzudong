import { describe, expect, test } from "bun:test";

import { compareCohortShadow, decay, refuseOperationalWrite, visitsMultiplier } from "../lib/evidence-engineering/scoring";

describe("cohort shadow", () => {
  test("a missing comparison blocks live writes and a complete one still does not overwrite", () => {
    const freshness = decay(10, 0.5, 460);
    const visits = visitsMultiplier(["abc123DEF45", "abc123DEF45"], 0.25);
    expect(visits).toBe(1);
    const signals = { freshness, visit_multiplier: visits };
    const incomplete = compareCohortShadow([
      { identity: "shop:a", operational_score: 4, candidate_signals: signals },
      { identity: "shop:b", operational_score: null, candidate_signals: null },
    ]);
    expect(incomplete.summary.live_write_allowed).toBe(false);
    expect(() => refuseOperationalWrite(incomplete.summary)).toThrow("shadow_comparison_required");

    const complete = compareCohortShadow([
      { identity: "shop:a", operational_score: 4, candidate_signals: signals },
      { identity: "shop:b", operational_score: null, candidate_signals: signals },
    ]);
    expect(complete.summary.count).toBe(2);
    expect(complete.summary.differ_count).toBe(1);
    expect(complete.records[0]?.candidate_freshness).toBe(freshness);
    expect(complete.records[0]?.candidate_visit_multiplier).toBe(visits);
    expect(complete.records[0]?.operational_score).toBe(4);
    const kept = refuseOperationalWrite(complete.summary);
    expect(kept.popularity_score).toBeNull();
    expect(kept.popularity_tier).toBeNull();
    expect(kept.overwrites_operational_values).toBe(false);
  });
});
