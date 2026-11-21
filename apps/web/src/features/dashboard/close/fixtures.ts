import type { CloseChecklist, CloseReport, CloseSignoff } from './closeModel';

export function closeReportFixture(overrides: Partial<CloseReport> = {}): CloseReport {
  return {
    date: '2026-11-11',
    timeZone: 'America/Bogota',
    currencyCode: 'COP',
    generatedAt: '2026-11-12T02:41:00.000Z',
    window: { start: '2026-11-11T05:00:00.000Z', endExclusive: '2026-11-12T05:00:00.000Z' },
    sales: {
      count: 171,
      subtotal: 0,
      discounts: 0,
      taxes: 0,
      tips: 0,
      serviceCharges: 0,
      grossRevenue: 8_600_000,
      refundAmount: 0,
      netRevenue: 8_517_350,
    },
    payments: [
      { method: 'cash', amount: 5_204_150, transactionCount: 120 },
      { method: 'card', amount: 2_000_000, transactionCount: 30 },
      { method: 'transfer', amount: 1_313_200, transactionCount: 21 },
      { method: 'credit', amount: 50_000, transactionCount: 1 },
    ],
    cash: {
      closedSessions: 2,
      openSessions: 0,
      expected: 5_204_150,
      counted: 5_189_850,
      overShort: -14_300,
      balancedSessions: 0,
      discrepancySessions: 2,
    },
    fiscal: {
      total: 171,
      totalAmount: 8_517_350,
      byStatus: {
        pending: 1,
        sent: 1,
        accepted: 169,
        rejected: 0,
        contingency: 0,
        voided: 0,
        notified_correction: 0,
        partial_send: 0,
      },
    },
    adjustments: { voids: { count: 0, amount: 0 }, refunds: { count: 0, amount: 0 } },
    anomalies: {
      total: 0,
      high: 0,
      medium: 0,
      byKind: { ticketsPerHourSpike: 0, voidRate: 0, refundAmount: 0, noSaleSessions: 0 },
    },
    capabilities: { commissions: 'not_tracked', waste: 'not_tracked' },
    readiness: {
      readyToSign: false,
      blockers: ['unexplained_differences', 'unresolved_drafts'],
      warnings: ['cash_discrepancies', 'fiscal_pending'],
    },
    ...overrides,
  };
}

export function closeChecklistFixture(overrides: Partial<CloseChecklist> = {}): CloseChecklist {
  return {
    date: '2026-11-11',
    sessions: [
      {
        id: 'session-1',
        registerName: 'Caja 1',
        cashierName: 'Andrés Rojas',
        status: 'closed',
        closedAt: '2026-11-11T19:04:00.000Z',
        counted: true,
        overShort: -12_300,
        hasDifference: true,
        differenceReason: null,
        differenceNote: null,
      },
      {
        id: 'session-2',
        registerName: 'Caja 2',
        cashierName: 'Camila Pérez',
        status: 'closed',
        closedAt: '2026-11-12T01:41:00.000Z',
        counted: true,
        overShort: -2_000,
        hasDifference: true,
        differenceReason: 'wrong_change',
        differenceNote: null,
      },
    ],
    drafts: [
      {
        id: 'draft-1',
        saleNumber: 'VTA-N-80',
        label: 'Domicilio Calle 80',
        total: 42_100,
        suspendedAt: '2026-11-11T18:51:00.000Z',
        carriedOver: false,
      },
    ],
    ...overrides,
  };
}

export function closeSignoffFixture(report: CloseReport): CloseSignoff {
  return {
    id: 'signoff-1',
    date: report.date,
    schemaVersion: 1,
    timeZone: report.timeZone,
    currencyCode: report.currencyCode,
    reportHash: 'a'.repeat(64),
    signedAt: '2026-11-12T02:41:00.000Z',
    signedBy: { id: 'm-1', name: 'Marta Ríos' },
    pdf: null,
    signatureMethod: 'drawn',
    signaturePath: 'M10 20L40 30L60 10',
    report,
  };
}
