export type BadgeViewerMode = "viewer" | "fallback" | "recovering";

let activeRenderers = 0;

export function resetBadgeViewerSessionsForTests(): void {
  activeRenderers = 0;
}

export function badgeViewerClosesOnKey(key: string): boolean {
  return key === "Escape";
}

export function createBadgeViewerSession() {
  let released = false;
  let holdsRenderer = false;
  let contextLost = false;

  return {
    open(lowPower: boolean): BadgeViewerMode {
      if (released) {
        throw new Error("badge_viewer_released");
      }
      if (lowPower) {
        return "fallback";
      }
      if (contextLost) {
        contextLost = false;
      }
      if (holdsRenderer || activeRenderers >= 1) {
        throw new Error("duplicate_badge_renderer");
      }
      holdsRenderer = true;
      activeRenderers += 1;
      return "viewer";
    },
    loseContext(): BadgeViewerMode {
      if (released) {
        throw new Error("badge_viewer_released");
      }
      if (holdsRenderer) {
        holdsRenderer = false;
        activeRenderers = Math.max(0, activeRenderers - 1);
      }
      contextLost = true;
      return "recovering";
    },
    release(): void {
      if (holdsRenderer) {
        holdsRenderer = false;
        activeRenderers = Math.max(0, activeRenderers - 1);
      }
      released = true;
      contextLost = false;
    },
  };
}
