"use client";

import { useEffect, useRef, useState } from "react";
import {
  AmbientLight,
  CylinderGeometry,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";

import { createBadgeViewerSession } from "@/lib/evidence-engineering/badge-viewer-session";
import {
  createBadgeContextLossHandler,
  createBadgeContextRecoveryLimit,
  handleBadgeViewerCloseKey,
  releaseBadgeRendererResources,
  sizeBadgeCanvas,
  startBadgeRenderLoop,
} from "@/lib/evidence-engineering/badge-viewer-lifecycle";

const TIER_COLOR = { fire: 0xff6a00, rainbow: 0x7c5cff } as const;

export default function Badge3DViewer({
  tier,
  onClose,
  lowPower = false,
}: {
  tier: "fire" | "rainbow";
  onClose: () => void;
  lowPower?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [staticFallback, setStaticFallback] = useState(lowPower);

  useEffect(() => {
    const root = rootRef.current;
    const host = hostRef.current;
    if (!root || !host) return;
    const session = createBadgeViewerSession();
    let disposed = false;
    let renderer: WebGLRenderer | null = null;
    let geometry: CylinderGeometry | null = null;
    let material: MeshStandardMaterial | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let contextLossListener: EventListener | null = null;
    let stopAnimation: (() => void) | null = null;
    const tryContextRecovery = createBadgeContextRecoveryLimit();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const teardownRenderer = () => {
      releaseBadgeRendererResources({
        canvas,
        contextLossListener,
        stopAnimation,
        disposeGeometry: () => geometry?.dispose(),
        disposeMaterial: () => material?.dispose(),
        disposeRenderer: () => renderer?.dispose(),
        forceContextLoss: () => renderer?.forceContextLoss(),
      });
      stopAnimation = null;
      contextLossListener = null;
      geometry = null;
      material = null;
      renderer = null;
      canvas = null;
    };

    const showStaticFallback = () => {
      root.setAttribute("data-badge-viewer", "fallback");
      setStaticFallback(true);
    };

    const mount = () => {
      if (disposed) return;
      if (lowPower) {
        root.setAttribute("data-badge-viewer", session.open(true));
        showStaticFallback();
        return;
      }
      try {
        root.setAttribute("data-badge-viewer", session.open(false));
      } catch (error) {
        if (error instanceof Error && error.message === "duplicate_badge_renderer") {
          showStaticFallback();
          return;
        }
        throw error;
      }
      canvas = document.createElement("canvas");
      canvas.setAttribute("aria-hidden", "true");
      host.appendChild(canvas);
      try {
        renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false });
        if (renderer.getContext() == null) throw new Error("webgl_unavailable");
      } catch {
        session.loseContext();
        teardownRenderer();
        showStaticFallback();
        return;
      }
      sizeBadgeCanvas(canvas, renderer, window.devicePixelRatio);
      const scene = new Scene();
      const camera = new PerspectiveCamera(40, 1, 0.1, 10);
      camera.position.z = 2.8;
      geometry = new CylinderGeometry(0.66, 0.5, 0.24, 7, 1, false);
      material = new MeshStandardMaterial({
        color: TIER_COLOR[tier],
        flatShading: true,
        metalness: 0.3,
        roughness: 0.34,
      });
      const mesh = new Mesh(geometry, material);
      mesh.rotation.x = Math.PI / 2 - 0.22;
      mesh.rotation.y = 0.36;
      mesh.rotation.z = -0.14;
      const ambientLight = new AmbientLight(0xffffff, 1.15);
      const keyLight = new DirectionalLight(0xffffff, 3.2);
      keyLight.position.set(2.5, 3.5, 4);
      const fillLight = new DirectionalLight(0x8fb8ff, 1.1);
      fillLight.position.set(-3, -1.5, 2.5);
      scene.add(mesh, ambientLight, keyLight, fillLight);
      stopAnimation = startBadgeRenderLoop({
        reducedMotion,
        rotate: () => {
          mesh.rotation.y += 0.015;
          mesh.rotation.z += 0.0025;
        },
        render: () => renderer?.render(scene, camera),
        requestFrame: (callback) => window.requestAnimationFrame(callback),
        cancelFrame: (handle) => window.cancelAnimationFrame(handle),
      });
      contextLossListener = createBadgeContextLossHandler({
        releaseLostContext: () => {
          session.loseContext();
          teardownRenderer();
        },
        tryRecover: tryContextRecovery,
        recover: mount,
        fallback: showStaticFallback,
      });
      canvas.addEventListener("webglcontextlost", contextLossListener);
    };

    mount();
    root.focus();
    return () => {
      disposed = true;
      teardownRenderer();
      session.release();
    };
  }, [lowPower, tier]);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="3D 배지"
      tabIndex={0}
      data-badge-3d={tier}
      data-badge-viewer={lowPower ? "fallback" : "viewer"}
      onKeyDown={(event) => {
        handleBadgeViewerCloseKey(event, onClose);
      }}
    >
      <div ref={hostRef} />
      {staticFallback ? <p>정적 배지로 표시합니다.</p> : null}
      <button type="button" onClick={onClose}>닫기</button>
    </div>
  );
}
