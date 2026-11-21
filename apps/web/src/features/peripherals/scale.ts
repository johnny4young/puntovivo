import type { ScaleConfig } from '@/types/electron';

/** Device-local scale status, per signed-in owner so a user switch never reuses it. */
export const scaleStatusKey = (owner: string | null) => ['desktop', 'scale-status', owner] as const;

/** True only inside the desktop app with a preload that can read scales. */
export function hasScaleBridge(): boolean {
  return Boolean(window.electron?.readScale && window.electron.getScaleStatus);
}

export const DEFAULT_SCALE_CONFIG: Omit<ScaleConfig, 'path'> = {
  protocol: 'continuous',
  baudRate: 9600,
  framing: '8N1',
};
