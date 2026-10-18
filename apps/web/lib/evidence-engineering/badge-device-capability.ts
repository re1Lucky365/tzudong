import { getTierFromHardware, type DevicePerformance } from "@/hooks/useDevicePerformance";

/** Conservative policy for the optional viewer, not a physical device/model detector. */
export function shouldUseStaticBadgeViewer(
  performance: Pick<DevicePerformance, "isLowEndDevice" | "cpuCores" | "memoryGB">,
  browser: { userAgent: string; maxTouchPoints: number } | null,
): boolean {
  if (performance.isLowEndDevice || !browser) return true;
  const mobileOrTouch = /Android|iPhone|iPad|iPod|Mobile/i.test(browser.userAgent)
    || browser.maxTouchPoints > 0;
  if (!mobileOrTouch) return false;

  // OS versions cannot identify iPhone hardware. Missing/coarse memory data is
  // deliberately insufficient to opt a touch/mobile device into experimental 3D.
  const { memoryGB, cpuCores } = performance;
  return memoryGB === null || !Number.isFinite(memoryGB)
    || getTierFromHardware(cpuCores, memoryGB) !== "HIGH";
}
