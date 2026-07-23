/**
 * Provider-neutral ownership contract for operational recovery.
 *
 * These values are intentionally shared by the server, renderer, docs checker,
 * and release evidence. They describe who responds, how quickly, where the
 * recovery starts, and which executable drill proves the path still works.
 */

export const OPERATIONAL_SERVICE_IDS = [
  'sync',
  'fiscal',
  'device',
  'payments',
  'backup',
  'updates',
] as const;

export type OperationalServiceId = (typeof OPERATIONAL_SERVICE_IDS)[number];
export type OperationalServiceSource = 'server' | 'desktop';
export type OperationalOwnerRole = 'store_manager' | 'administrator';

export interface OperationalDrillEvidence {
  file: string;
  testTitle: string;
}

export interface OperationalReadinessContract {
  id: OperationalServiceId;
  source: OperationalServiceSource;
  ownerRole: OperationalOwnerRole;
  escalationOwner: 'support';
  responseTargetMinutes: number;
  runbookId: string;
  actionTarget: string;
  threshold:
    | { kind: 'queue'; warningCount: number; dangerOnConflict: true }
    | { kind: 'failure'; dangerCount: 1 }
    | { kind: 'freshness'; maximumAgeHours: number };
  drills: readonly OperationalDrillEvidence[];
}

export const OPERATIONAL_READINESS_CONTRACT = {
  sync: {
    id: 'sync',
    source: 'server',
    ownerRole: 'store_manager',
    escalationOwner: 'support',
    responseTargetMinutes: 30,
    runbookId: 'sync-recovery',
    // Operations exposes diagnosis only; conflict resolution and queue processing
    // live in the Company data surface.
    actionTarget: '/company?tab=data',
    threshold: { kind: 'queue', warningCount: 25, dangerOnConflict: true },
    drills: [
      {
        file: 'packages/server/src/__tests__/operations-needs-attention.test.ts',
        testTitle: 'marks sync conflicts as danger and outranks a pending backlog',
      },
    ],
  },
  fiscal: {
    id: 'fiscal',
    source: 'server',
    ownerRole: 'store_manager',
    escalationOwner: 'support',
    responseTargetMinutes: 15,
    runbookId: 'fiscal-recovery',
    actionTarget: '/operations?tab=fiscal',
    threshold: { kind: 'failure', dangerCount: 1 },
    drills: [
      {
        file: 'packages/server/src/__tests__/operations-needs-attention.test.ts',
        testTitle: 'surfaces fiscal outbox failures as a danger area',
      },
    ],
  },
  device: {
    id: 'device',
    source: 'server',
    ownerRole: 'store_manager',
    escalationOwner: 'support',
    responseTargetMinutes: 30,
    runbookId: 'device-recovery',
    actionTarget: '/operations?tab=device',
    threshold: { kind: 'failure', dangerCount: 1 },
    drills: [
      {
        file: 'packages/server/src/__tests__/operations-needs-attention.test.ts',
        testTitle: 'surfaces hardware outbox failures (device area)',
      },
    ],
  },
  payments: {
    id: 'payments',
    source: 'server',
    ownerRole: 'store_manager',
    escalationOwner: 'support',
    responseTargetMinutes: 15,
    runbookId: 'payment-recovery',
    actionTarget: '/operations?tab=payments',
    threshold: { kind: 'failure', dangerCount: 1 },
    drills: [
      {
        file: 'packages/server/src/__tests__/operations-needs-attention.test.ts',
        testTitle: 'surfaces payment outbox failures',
      },
    ],
  },
  backup: {
    id: 'backup',
    source: 'desktop',
    ownerRole: 'administrator',
    escalationOwner: 'support',
    responseTargetMinutes: 60,
    runbookId: 'backup-recovery',
    actionTarget: '/company?tab=data',
    threshold: { kind: 'freshness', maximumAgeHours: 30 },
    drills: [
      {
        file: 'apps/desktop/src/main/__tests__/backup-restore-drill.test.ts',
        testTitle: 'verifies an encrypted snapshot and compares only the active tenant',
      },
      {
        file: 'apps/desktop/src/main/__tests__/backup-cloud-vault.test.ts',
        testTitle:
          'skips cleanly without configuration and normalizes provider diagnostics on failure',
      },
    ],
  },
  updates: {
    id: 'updates',
    source: 'desktop',
    ownerRole: 'administrator',
    escalationOwner: 'support',
    responseTargetMinutes: 240,
    runbookId: 'update-rollback',
    actionTarget: '/company?tab=device',
    threshold: { kind: 'freshness', maximumAgeHours: 24 },
    drills: [
      {
        file: 'apps/desktop/src/main/__tests__/auto-updater-policy.test.ts',
        testTitle: 'accepts a strict normal policy and rollback only at 100 percent',
      },
    ],
  },
} as const satisfies Record<OperationalServiceId, OperationalReadinessContract>;

export const OPERATIONAL_READINESS_SERVICES = OPERATIONAL_SERVICE_IDS.map(
  id => OPERATIONAL_READINESS_CONTRACT[id]
);
