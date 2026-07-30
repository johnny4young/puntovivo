/**
 * Stable handoff destinations shared by support checklists and incident guides.
 *
 * Each route names both the broad tab and the exact control that must receive
 * focus, so non-technical operators never have to rediscover the next step.
 */
export const RECOVERY_ROUTES = {
  appUpdates: '/company?tab=device&focus=app-updates',
  backupRestore: '/company?tab=data&focus=backup-restore',
  diagnostics: '/operations?tab=diagnostics',
  registeredDevices: '/operations?tab=authority&focus=registered-devices',
  telemetry: '/company?tab=data&focus=telemetry',
} as const;
