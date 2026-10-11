"use client";

import { useEffect } from "react";
import { installScrollReveals } from '@/lib/motion/scroll-reveal';

/** Animate opted-in panels once; never animate table rows or virtualized items. */
export function ScrollEffects() {
  useEffect(() => installScrollReveals(), []);
  return null;
}
