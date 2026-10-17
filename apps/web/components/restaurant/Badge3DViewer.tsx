"use client";

import { useEffect, useRef } from "react";

import {
  badgeViewerClosesOnKey,
  createBadgeViewerSession,
} from "@/lib/evidence-engineering/badge-viewer-session";

export default function Badge3DViewer({
  tier,
  onClose,
  lowPower = false,
}: {
  tier: "fire" | "rainbow";
  onClose: () => void;
  lowPower?: boolean;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const session = createBadgeViewerSession();
    const node = nodeRef.current;
    const apply = (mode: string) => node?.setAttribute("data-badge-viewer", mode);
    try {
      apply(session.open(lowPower));
    } catch (error) {
      if (error instanceof Error && error.message === "duplicate_badge_renderer") {
        apply("fallback");
      } else {
        throw error;
      }
    }
    const onLost = (event: Event) => {
      event.preventDefault();
      session.loseContext();
      apply(session.open(lowPower));
    };
    node?.addEventListener("webglcontextlost", onLost);
    return () => {
      node?.removeEventListener("webglcontextlost", onLost);
      session.release();
    };
  }, [lowPower]);

  return (
    <div
      ref={nodeRef}
      data-badge-3d={tier}
      data-badge-viewer={lowPower ? "fallback" : "viewer"}
      onKeyDown={(event) => {
        if (badgeViewerClosesOnKey(event.key)) onClose();
      }}
    >
      {lowPower ? <p>정적 배지로 표시합니다.</p> : <div style={{ transform: "rotateY(12deg)" }}>{tier}</div>}
      <button type="button" onClick={onClose}>닫기</button>
    </div>
  );
}
