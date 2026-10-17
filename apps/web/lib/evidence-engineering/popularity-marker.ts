export const POPULARITY_MARKER_CSS = `
.tz-popularity-marker { position: relative; }
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
@keyframes tz-popularity-pulse {
  50% { transform: scale(1.12); opacity: 1; }
}
[data-map-interacting="true"] .tz-popularity-marker::before { animation-play-state: paused; }
@media (prefers-reduced-motion: reduce) {
  .tz-popularity-marker::before { animation: none; }
}
`;

export function wrapMarkerWithPopularityTier(innerHtml: string, tier: "fire" | "rainbow" | "standard" | null | undefined): string {
  const safeTier = tier === "fire" || tier === "rainbow" ? tier : "standard";
  return `<style>${POPULARITY_MARKER_CSS}</style><div class="tz-popularity-marker" data-popularity-tier="${safeTier}">${innerHtml}</div>`;
}

export function syncPopularityMarkerInteraction(
  element: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void },
  interacting: boolean,
): void {
  if (interacting) element.setAttribute("data-map-interacting", "true");
  else element.removeAttribute("data-map-interacting");
}
