export function summarizeRenderSamples(frameTimesMs: readonly number[]): {
  sampleCount: number;
  p50Ms: number | null;
  p95Ms: number | null;
  longTaskCount: number;
  treats60FpsAsGate: false;
  treatsZeroPaintAsGate: false;
} {
  const samples = frameTimesMs.filter((value) => Number.isFinite(value) && value >= 0);
  if (samples.length === 0) {
    return {
      sampleCount: 0,
      p50Ms: null,
      p95Ms: null,
      longTaskCount: 0,
      treats60FpsAsGate: false,
      treatsZeroPaintAsGate: false,
    };
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const rank = (percentile: number) => {
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1));
    return sorted[index];
  };
  return {
    sampleCount: sorted.length,
    p50Ms: rank(50),
    p95Ms: rank(95),
    longTaskCount: sorted.filter((value) => value > 50).length,
    treats60FpsAsGate: false,
    treatsZeroPaintAsGate: false,
  };
}

export function summarizeContextEvents(events: readonly ("lost" | "restored")[]): {
  lossCount: number;
  recoveryCount: number;
  locksThreshold: false;
} {
  let lossCount = 0;
  let recoveryCount = 0;
  for (const event of events) {
    if (event === "lost") lossCount += 1;
    else if (event === "restored") recoveryCount += 1;
    else throw new Error("invalid_context_event");
  }
  return { lossCount, recoveryCount, locksThreshold: false };
}

function requireByteSample(value: number, code: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(code);
  return value;
}

export function recordBadgeAdditionDelta(beforeBytes: number, afterBytes: number): {
  beforeBytes: number;
  afterBytes: number;
  deltaBytes: number;
  locksThreshold: false;
} {
  const before = requireByteSample(beforeBytes, "invalid_badge_memory");
  const after = requireByteSample(afterBytes, "invalid_badge_memory");
  return {
    beforeBytes: before,
    afterBytes: after,
    deltaBytes: after - before,
    locksThreshold: false,
  };
}

export function recordPanelMemoryTrend(bytes: readonly number[]): {
  sampleCount: number;
  samples: number[];
  firstBytes: number | null;
  lastBytes: number | null;
  deltaBytes: number | null;
  locksThreshold: false;
} {
  const samples = bytes.map((value) => requireByteSample(value, "invalid_memory_sample"));
  if (samples.length === 0) {
    return {
      sampleCount: 0,
      samples,
      firstBytes: null,
      lastBytes: null,
      deltaBytes: null,
      locksThreshold: false,
    };
  }
  const firstBytes = samples[0];
  const lastBytes = samples[samples.length - 1];
  return {
    sampleCount: samples.length,
    samples,
    firstBytes,
    lastBytes,
    deltaBytes: lastBytes - firstBytes,
    locksThreshold: false,
  };
}
