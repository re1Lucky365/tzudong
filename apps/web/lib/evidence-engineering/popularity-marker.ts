export const POPULARITY_MARKER_CSS = `
.tz-popularity-marker { position: relative; width: 100%; height: 100%; isolation: isolate; }
.tz-popularity-flame { position: absolute; width: 20px; height: 26px; left: 50%; bottom: calc(100% - 2px); z-index: 300; pointer-events: none; transform: translateX(-50%); animation: tz-popularity-flame 1.4s ease-in-out infinite; }
.tz-popularity-marker[data-popularity-tier="fire"]::before,
.tz-popularity-marker[data-popularity-tier="rainbow"]::before {
  content: "";
  position: absolute;
  inset: -5px;
  border-radius: 9999px;
  pointer-events: none;
  opacity: 0.7;
  transform: scale(1);
  animation: tz-popularity-pulse 1.8s ease-in-out infinite;
}
.tz-popularity-marker[data-popularity-tier="fire"]::before { border: 2px solid #ff6a00; }
.tz-popularity-marker[data-popularity-tier="rainbow"]::before { border: 2px solid #7c5cff; }
@keyframes tz-popularity-pulse {
  50% { transform: scale(1.12); opacity: 1; }
}
[data-map-interacting="true"] .tz-popularity-marker::before { animation-play-state: paused; }
@keyframes tz-popularity-flame {
  50% { transform: translateX(-50%) translateY(-2px) scale(1.06); opacity: 0.85; }
}
[data-map-interacting="true"] .tz-popularity-flame { animation-play-state: paused; }
@media (prefers-reduced-motion: reduce) {
  .tz-popularity-marker::before { animation: none; }
  .tz-popularity-flame { animation: none; }
}
`;

export function publicPopularityTier(value: unknown): "fire" | "rainbow" | "standard" {
  return value === "fire" || value === "rainbow" ? value : "standard";
}

export function wrapMarkerWithPopularityTier(innerHtml: string, tier: "fire" | "rainbow" | "standard" | null | undefined): string {
  const safeTier = publicPopularityTier(tier);
  const flame = safeTier === "fire" ? '<svg class="tz-popularity-flame" viewBox="0 0 32 42" aria-hidden="true" focusable="false"><path fill="#f97316" stroke="#fff7ed" stroke-width="1.4" d="M17 1c3 12-7 14-6 22 3-2 5-5 5-8 12 9 17 26 0 26C-3 41-3 24 6 15c0 6 1 8 3 9C6 15 19 12 17 1Z"/><path fill="#fde047" d="M17 24c1 6-5 7-4 11 5 4 12-2 4-11Z"/></svg>' : '';
  return `<style>${POPULARITY_MARKER_CSS}</style><div class="tz-popularity-marker" data-popularity-tier="${safeTier}">${innerHtml}${flame}</div>`;
}

export function syncPopularityMarkerInteraction(
  element: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void },
  interacting: boolean,
): void {
  if (interacting) element.setAttribute("data-map-interacting", "true");
  else element.removeAttribute("data-map-interacting");
}
