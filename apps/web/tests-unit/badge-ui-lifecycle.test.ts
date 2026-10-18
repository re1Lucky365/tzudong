import { describe, expect, test } from "bun:test";

import {
  createBadgeContextLossHandler,
  createBadgeContextRecoveryLimit,
  handleBadgeViewerCloseKey,
  releaseBadgeRendererResources,
  restoreBadgeViewerFocus,
  sizeBadgeCanvas,
  startBadgeRenderLoop,
} from "../lib/evidence-engineering/badge-viewer-lifecycle";

describe("badge UI lifecycle", () => {
  test("keeps a 120px CSS canvas while sizing the DPR2 drawing buffer", () => {
    const canvas = {
      style: { display: "", height: "", width: "" },
      remove() {},
      removeEventListener() {},
    };
    const calls: unknown[][] = [];
    let pixelRatio = 1;
    let drawingBuffer = { height: 0, width: 0 };
    const renderer = {
      setPixelRatio(value: number) {
        pixelRatio = value;
        calls.push(["pixelRatio", value]);
      },
      setSize(width: number, height: number, updateStyle?: boolean) {
        drawingBuffer = { height: height * pixelRatio, width: width * pixelRatio };
        calls.push(["size", width, height, updateStyle]);
      },
    };

    sizeBadgeCanvas(canvas, renderer, 2);

    expect(canvas.style).toEqual({ display: "block", height: "120px", width: "120px" });
    expect(drawingBuffer).toEqual({ height: 240, width: 240 });
    expect(calls).toEqual([
      ["pixelRatio", 2],
      ["size", 120, 120, false],
    ]);
  });

  test("renders reduced motion once without scheduling RAF", () => {
    let renders = 0;
    let rotations = 0;
    let requests = 0;
    let cancels = 0;

    const stop = startBadgeRenderLoop({
      reducedMotion: true,
      rotate: () => rotations++,
      render: () => renders++,
      requestFrame: () => {
        requests++;
        return 1;
      },
      cancelFrame: () => cancels++,
    });
    stop();

    expect({ renders, rotations, requests, cancels }).toEqual({
      renders: 1,
      rotations: 0,
      requests: 0,
      cancels: 0,
    });
  });

  test("runs one animated RAF chain and cancels its pending frame", () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    const cancelled: number[] = [];
    let nextFrame = 0;
    let renders = 0;
    let rotations = 0;
    const stop = startBadgeRenderLoop({
      reducedMotion: false,
      rotate: () => rotations++,
      render: () => renders++,
      requestFrame: (callback) => {
        const handle = ++nextFrame;
        callbacks.set(handle, callback);
        return handle;
      },
      cancelFrame: (handle) => cancelled.push(handle),
    });

    expect({ renders, rotations, pending: callbacks.size }).toEqual({
      renders: 1,
      rotations: 1,
      pending: 1,
    });
    callbacks.get(1)?.(16);
    expect({ renders, rotations, pending: callbacks.size }).toEqual({
      renders: 2,
      rotations: 2,
      pending: 2,
    });
    stop();
    expect(cancelled).toEqual([2]);
    callbacks.get(2)?.(32);
    expect(renders).toBe(2);
  });

  test("allows one real context-loss recreation, then falls back", () => {
    const calls: string[] = [];
    const tryRecover = createBadgeContextRecoveryLimit();
    const createHandler = () =>
      createBadgeContextLossHandler({
        releaseLostContext: () => calls.push("release"),
        tryRecover,
        recover: () => calls.push("recover"),
        fallback: () => calls.push("fallback"),
      });
    const event = {
      preventDefault: () => calls.push("preventDefault"),
    } as unknown as Event;

    createHandler()(event);
    createHandler()(event);

    expect(calls).toEqual([
      "preventDefault",
      "release",
      "recover",
      "preventDefault",
      "release",
      "fallback",
    ]);
  });

  test("removes the loss listener before disposal and intentional context loss", () => {
    const calls: string[] = [];
    const listener = () => calls.push("unexpected-recovery");
    let listenerAttached = true;
    const canvas = {
      style: { display: "", height: "", width: "" },
      removeEventListener(type: string, candidate: EventListener) {
        expect(type).toBe("webglcontextlost");
        expect(candidate).toBe(listener);
        listenerAttached = false;
        calls.push("remove-listener");
      },
      remove: () => calls.push("remove-canvas"),
    };
    const forceContextLoss = () => {
        calls.push("force-context-loss");
        if (listenerAttached) listener(new Event("webglcontextlost"));
    };

    releaseBadgeRendererResources({
      canvas,
      contextLossListener: listener,
      stopAnimation: () => calls.push("stop-animation"),
      disposeGeometry: () => calls.push("dispose-geometry"),
      disposeMaterial: () => calls.push("dispose-material"),
      disposeRenderer: () => calls.push("dispose-renderer"),
      forceContextLoss,
    });

    expect(calls).toEqual([
      "stop-animation",
      "remove-listener",
      "dispose-geometry",
      "dispose-material",
      "dispose-renderer",
      "force-context-loss",
      "remove-canvas",
    ]);
  });

  test("consumes Escape and restores focus to the captured opener", () => {
    const calls: unknown[] = [];
    const escape = {
      key: "Escape",
      preventDefault: () => calls.push("preventDefault"),
      stopPropagation: () => calls.push("stopPropagation"),
    };
    expect(handleBadgeViewerCloseKey(escape, () => calls.push("close"))).toBe(true);
    expect(calls).toEqual(["preventDefault", "stopPropagation", "close"]);

    const opener = {
      focus: (options?: FocusOptions) => calls.push(["focus", options]),
    };
    expect(restoreBadgeViewerFocus(opener)).toBe(true);
    expect(calls.at(-1)).toEqual(["focus", { preventScroll: true }]);

    calls.length = 0;
    expect(handleBadgeViewerCloseKey({ ...escape, key: "Enter" }, () => calls.push("close"))).toBe(false);
    expect(restoreBadgeViewerFocus(null)).toBe(false);
    expect(calls).toEqual([]);
  });
});
