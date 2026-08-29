import type { AutoUpdateStatus } from './contracts.ts';

export interface TrayUpdatePresentation {
  badge: boolean;
  action: 'restart' | 'verification-pending';
  actionEnabled: boolean;
}

/** Electron-free projection used by the native tray and its regression tests. */
export function resolveTrayUpdatePresentation(
  status: AutoUpdateStatus
): TrayUpdatePresentation | null {
  if (status.state !== 'downloaded') return null;
  return {
    badge: true,
    action: status.installReady ? 'restart' : 'verification-pending',
    actionEnabled: status.installReady,
  };
}
