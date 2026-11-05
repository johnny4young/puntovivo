interface HardwareHints {
  hardwareConcurrency?: number;
  /** Chromium's rounded RAM estimate in GiB; absent in other engines. */
  deviceMemory?: number;
}

/**
 * Backdrop blur makes the GPU repaint whatever sits behind each panel. A
 * 4 GB, four-core till pays for that in memory and paint time, so such
 * hardware renders panels without it.
 */
export function prefersLiteGraphics({ hardwareConcurrency, deviceMemory }: HardwareHints): boolean {
  return (
    (deviceMemory !== undefined && deviceMemory <= 4) ||
    (hardwareConcurrency !== undefined && hardwareConcurrency <= 4)
  );
}

export function applyGraphicsTier(
  root: HTMLElement = document.documentElement,
  hints: HardwareHints = navigator as Navigator & HardwareHints
): void {
  if (prefersLiteGraphics(hints)) root.dataset.graphics = 'lite';
}
