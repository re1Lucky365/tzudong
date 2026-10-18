"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useDevicePerformance } from "@/hooks/useDevicePerformance";
import { shouldUseStaticBadgeViewer } from "@/lib/evidence-engineering/badge-device-capability";
import { handleBadgeViewerCloseKey, restoreBadgeViewerFocus } from "@/lib/evidence-engineering/badge-viewer-lifecycle";

const Badge3DViewer = dynamic(
  () => import("./Badge3DViewer"),
  { ssr: false, loading: () => null },
);

export const POPULARITY_BADGE_KINDS = ["fire", "rainbow"] as const;
export const BADGE_BYTE_COUNT_IS_PASS_THRESHOLD = false;
const BADGE_SRC = {
  fire: "/assets/badges/badge_popular_fire_40.webp",
  rainbow: "/assets/badges/badge_popular_rainbow_40.webp",
} as const satisfies Record<(typeof POPULARITY_BADGE_KINDS)[number], string>;

export type BadgeViewerPhase = "off" | "offer" | "open";

export function badgeViewerPhase(experimental3D: boolean, open: boolean): BadgeViewerPhase {
  if (!experimental3D) return "off";
  return open ? "open" : "offer";
}

function StaticBadgeViewer({ tier, onClose }: { tier: "fire" | "rainbow"; onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => { rootRef.current?.focus(); }, []);
  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="3D 배지"
      tabIndex={0}
      data-badge-3d={tier}
      data-badge-viewer="fallback"
      onKeyDown={(event) => handleBadgeViewerCloseKey(event, onClose)}
    >
      <p>정적 배지로 표시합니다.</p>
      <button type="button" onClick={onClose}>닫기</button>
    </div>
  );
}

export function PopularityBadge({
  tier,
  experimental3D = false,
}: {
  tier: "fire" | "rainbow" | "standard";
  experimental3D?: boolean;
}) {
  const performance = useDevicePerformance();
  const useStaticViewer = shouldUseStaticBadgeViewer(
    performance,
    typeof navigator === "undefined" ? null : navigator,
  );
  const [open, setOpen] = useState(false);
  const [assetFailed, setAssetFailed] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreFocusRef = useRef(false);
  const closeViewer = useCallback(() => {
    shouldRestoreFocusRef.current = true;
    setOpen(false);
  }, []);

  useLayoutEffect(() => {
    if (open || !shouldRestoreFocusRef.current) return;
    shouldRestoreFocusRef.current = false;
    restoreBadgeViewerFocus(openerRef.current);
  }, [open]);

  if (tier === "standard" || assetFailed) return null;
  const phase = badgeViewerPhase(experimental3D, open);
  return (
    <section aria-label="인기 맛집 배지" className="tz-popularity-badge">
      <style>{`
        .tz-popularity-badge img { transform: scale(1); }
        @media (hover: hover) and (prefers-reduced-motion: no-preference) {
          .tz-popularity-badge img { transition: transform var(--duration-quick, 150ms) var(--ease-smooth-out, cubic-bezier(0.22, 1, 0.36, 1)); }
          .tz-popularity-badge:hover img { transform: scale(1.15); }
        }
      `}</style>
      {/* eslint-disable-next-line @next/next/no-img-element -- Static badge WebP hides itself when the file is missing, and the hover scale targets this img. */}
      <img
        src={BADGE_SRC[tier]}
        srcSet={`${BADGE_SRC[tier]} 1x, /assets/badges/badge_popular_${tier}_80.webp 2x`}
        alt={tier === "fire" ? "인기 맛집 불꽃 배지" : "인기 맛집 무지개 배지"}
        width={40}
        height={40}
        onError={() => setAssetFailed(true)}
      />
      {phase !== "off" ? (
        <button
          ref={openerRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={phase === "open"}
          hidden={phase === "open"}
          onClick={() => {
            shouldRestoreFocusRef.current = false;
            setOpen(true);
          }}
        >
          3D 보기
        </button>
      ) : null}
      {phase === "open" ? (
        useStaticViewer
          ? <StaticBadgeViewer tier={tier} onClose={closeViewer} />
          : <Badge3DViewer tier={tier} onClose={closeViewer} lowPower={useStaticViewer} />
      ) : null}
    </section>
  );
}
