import type { CloseGuide } from './closeGuideModel';

export function guideFixture(overrides: Partial<CloseGuide> = {}): CloseGuide {
  return {
    date: '2026-11-11',
    timezone: 'America/Bogota',
    currencyCode: 'COP',
    isToday: true,
    signoff: null,
    figures: {
      sold: 8517350,
      salesCount: 171,
      comparisonTotal: 8050000,
      cashToDeposit: 5189850,
      electronic: 3313200,
      cashDifference: -14300,
    },
    sessions: {
      closed: 3,
      open: 0,
      lastClosed: {
        registerName: 'Caja 3',
        cashierName: 'Marta',
        closedAt: '2026-11-12T01:41:00.000Z',
      },
    },
    differenceTolerance: 5000,
    differences: [
      {
        sessionId: 'cs-1',
        registerName: 'Caja 1',
        cashierName: 'Laura',
        siteName: 'Norte',
        closedAt: '2026-11-11T23:00:00.000Z',
        overShort: -12300,
        reason: null,
        note: null,
        overTolerance: true,
        needsReason: true,
      },
      {
        sessionId: 'cs-2',
        registerName: 'Caja 2',
        cashierName: 'Camila',
        siteName: 'Norte',
        closedAt: '2026-11-12T00:00:00.000Z',
        overShort: -2000,
        reason: null,
        note: null,
        overTolerance: false,
        needsReason: false,
      },
    ],
    drafts: [
      {
        id: 'd-1',
        label: 'P3 Domicilio Calle 80',
        total: 42100,
        suspendedAt: '2026-11-11T18:51:00.000Z',
        carriedOver: false,
      },
    ],
    fiscal: { accepted: 169, inProcess: 2, rejected: 0 },
    highAnomalies: 0,
    handoffs: [],
    blockers: ['unexplained_differences'],
    readyToSign: false,
    ...overrides,
  };
}
