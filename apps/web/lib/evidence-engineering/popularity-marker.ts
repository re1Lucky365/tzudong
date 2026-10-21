export const POPULARITY_MARKER_CSS = `
.tz-popularity-marker { position: relative; width: 100%; height: 100%; isolation: isolate; }
.tz-popularity-flames { position: absolute; left: 50%; bottom: calc(100% - 4px); z-index: 300; display: flex; align-items: flex-end; justify-content: center; pointer-events: none; transform: translateX(-50%); }
.tz-popularity-flame { width: 16px; height: 22px; margin: 0 -5px; transform-origin: center bottom; animation: tz-popularity-flame 1.15s ease-in-out infinite; }
.tz-popularity-flames[data-flame-count="3"] .tz-popularity-flame:nth-child(2) { width: 22px; height: 30px; }
.tz-popularity-flames .tz-popularity-flame:nth-child(2) { animation-delay: 0.16s; }
.tz-popularity-flames .tz-popularity-flame:nth-child(3) { animation-delay: 0.32s; }
@keyframes tz-popularity-flame {
  50% { transform: translateY(-3px) scale(1.08); opacity: 0.85; }
}
[data-map-interacting="true"] .tz-popularity-flame { animation-play-state: paused; }
@media (prefers-reduced-motion: reduce) {
  .tz-popularity-flame { animation: none; }
}
`;

const FLAME_SVG = '<svg class="tz-popularity-flame" viewBox="0 0 32 42" aria-hidden="true" focusable="false"><path fill="#f85c00" stroke="#fff7ed" stroke-width="1.4" d="M17 1c3 12-7 14-6 22 3-2 5-5 5-8 12 9 17 26 0 26C-3 41-3 24 6 15c0 6 1 8 3 9C6 15 19 12 17 1Z"/><path fill="#fde047" d="M17 24c1 6-5 7-4 11 5 4 12-2 4-11Z"/></svg>';

export function publicPopularityTier(value: unknown): "fire" | "rainbow" | "standard" {
  return value === "fire" || value === "rainbow" ? value : "standard";
}

/** Three flames mark the top published tier. Two mark the next tier. */
export function popularityFlameCount(tier: "fire" | "rainbow" | "standard" | null | undefined): 0 | 2 | 3 {
  const safeTier = publicPopularityTier(tier);
  if (safeTier === "fire") return 3;
  if (safeTier === "rainbow") return 2;
  return 0;
}

export function wrapMarkerWithPopularityTier(innerHtml: string, tier: "fire" | "rainbow" | "standard" | null | undefined): string {
  const safeTier = publicPopularityTier(tier);
  const count = popularityFlameCount(safeTier);
  const flames = count > 0
    ? `<span class="tz-popularity-flames" data-flame-count="${count}">${FLAME_SVG.repeat(count)}</span>`
    : "";
  return `<style>${POPULARITY_MARKER_CSS}</style><div class="tz-popularity-marker" data-popularity-tier="${safeTier}">${innerHtml}${flames}</div>`;
}

export function syncPopularityMarkerInteraction(
  element: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void },
  interacting: boolean,
): void {
  if (interacting) element.setAttribute("data-map-interacting", "true");
  else element.removeAttribute("data-map-interacting");
}
