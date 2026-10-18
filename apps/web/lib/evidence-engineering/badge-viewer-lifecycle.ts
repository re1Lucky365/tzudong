import { badgeViewerClosesOnKey } from "./badge-viewer-session";

type BadgeCanvasSurface = {
  style: {
    display: string;
    height: string;
    width: string;
  };
  remove(): void;
  removeEventListener(type: "webglcontextlost", listener: EventListener): void;
};

type BadgeRendererSurface = {
  setPixelRatio(value: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
};

export function sizeBadgeCanvas(
  canvas: BadgeCanvasSurface,
  renderer: Pick<BadgeRendererSurface, "setPixelRatio" | "setSize">,
  devicePixelRatio: number,
  logicalSize = 120,
): void {
  canvas.style.display = "block";
  canvas.style.width = `${logicalSize}px`;
  canvas.style.height = `${logicalSize}px`;
  renderer.setPixelRatio(Math.min(Math.max(devicePixelRatio || 1, 1), 2));
  renderer.setSize(logicalSize, logicalSize, false);
}

export function startBadgeRenderLoop({
  reducedMotion,
  rotate,
  render,
  requestFrame,
  cancelFrame,
}: {
  reducedMotion: boolean;
  rotate: () => void;
  render: () => void;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (handle: number) => void;
}): () => void {
  let stopped = false;
  let frame: number | null = null;

  const draw: FrameRequestCallback = () => {
    if (stopped) return;
    if (!reducedMotion) rotate();
    render();
    if (!reducedMotion) frame = requestFrame(draw);
  };

  draw(0);

  return () => {
    stopped = true;
    if (frame !== null) cancelFrame(frame);
    frame = null;
  };
}

export function releaseBadgeRendererResources({
  canvas,
  contextLossListener,
  stopAnimation,
  disposeGeometry,
  disposeMaterial,
  disposeRenderer,
  forceContextLoss,
}: {
  canvas: BadgeCanvasSurface | null;
  contextLossListener: EventListener | null;
  stopAnimation: (() => void) | null;
  disposeGeometry: () => void;
  disposeMaterial: () => void;
  disposeRenderer: () => void;
  forceContextLoss: () => void;
}): void {
  stopAnimation?.();
  if (canvas && contextLossListener) {
    canvas.removeEventListener("webglcontextlost", contextLossListener);
  }
  disposeGeometry();
  disposeMaterial();
  disposeRenderer();
  forceContextLoss();
  canvas?.remove();
}

export function createBadgeContextLossHandler({
  releaseLostContext,
  tryRecover,
  recover,
  fallback,
}: {
  releaseLostContext: () => void;
  tryRecover: () => boolean;
  recover: () => void;
  fallback: () => void;
}): EventListener {
  return (event) => {
    event.preventDefault();
    releaseLostContext();
    if (tryRecover()) {
      recover();
      return;
    }
    fallback();
  };
}

export function createBadgeContextRecoveryLimit(maxRecoveries = 1): () => boolean {
  let recoveryCount = 0;
  return () => {
    if (recoveryCount >= maxRecoveries) return false;
    recoveryCount += 1;
    return true;
  };
}

export function handleBadgeViewerCloseKey(
  event: Pick<KeyboardEvent, "key" | "preventDefault" | "stopPropagation">,
  onClose: () => void,
): boolean {
  if (!badgeViewerClosesOnKey(event.key)) return false;
  event.preventDefault();
  event.stopPropagation();
  onClose();
  return true;
}

export function restoreBadgeViewerFocus(
  opener: Pick<HTMLElement, "focus"> | null,
): boolean {
  if (!opener) return false;
  opener.focus({ preventScroll: true });
  return true;
}
