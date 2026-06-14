/**
 * Tests para el detector de anomalías ENG-032.
 *
 * Cada describe block representa un escenario operativo concreto. Los
 * fixtures comentan en español neutral lo que se está simulando para
 * que el revisor pueda leer la lógica de fraude sin descifrar las
 * fórmulas. Si agregás un fixture nuevo, mantené el formato:
 *
 *   // Escenario: <patrón de fraude> — <una línea de descripción>
 *   // Esperamos: <resultado del detector y por qué>
 *
 * Convención: tenant A es el sujeto de la mayoría de los tests; tenant
 * B existe sólo para pinear cross-tenant isolation.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hash } from 'argon2';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../../index.js';
import { getDatabase } from '../../db/index.js';
import {
  auditLogs,
  cashSessions,
  companies,
  saleReturns,
  sales,
  sites,
  tenants,
  users,
} from '../../db/schema.js';

import { detectAnomalies, anomalyDetectionConstants } from './anomalyDetection/index.js';

let server: PuntovivoServer;
let tenantA: string;
let tenantB: string;
let companyA: string;
let companyB: string;
let siteA: string;
let siteB: string;

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  const now = new Date().toISOString();

  tenantA = nanoid();
  tenantB = nanoid();
  await db.insert(tenants).values([
    {
      id: tenantA,
      name: 'Tenant A — Anomaly',
      slug: `tenant-a-anom-${nanoid(6)}`,
      settings: {},
      createdAt: now,
      updatedAt: now,
    },
    {
      id: tenantB,
      name: 'Tenant B — Anomaly',
      slug: `tenant-b-anom-${nanoid(6)}`,
      settings: {},
      createdAt: now,
      updatedAt: now,
    },
  ]);

  companyA = nanoid();
  companyB = nanoid();
  await db.insert(companies).values([
    { id: companyA, tenantId: tenantA, name: 'Co A', createdAt: now, updatedAt: now },
    { id: companyB, tenantId: tenantB, name: 'Co B', createdAt: now, updatedAt: now },
  ]);

  siteA = nanoid();
  siteB = nanoid();
  await db.insert(sites).values([
    {
      id: siteA,
      tenantId: tenantA,
      companyId: companyA,
      name: 'Site A',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: siteB,
      tenantId: tenantB,
      companyId: companyB,
      name: 'Site B',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
});

afterAll(async () => {
  if (server) await server.close();
});

beforeEach(async () => {
  const db = getDatabase();
  // Wipe transactional tables between tests (preserve tenants / sites /
  // companies that beforeAll created). Order respects FKs: returns →
  // sales → sessions → audit logs → users.
  await db.delete(saleReturns).run();
  await db.delete(sales).run();
  await db.delete(cashSessions).run();
  await db.delete(auditLogs).run();
  await db.delete(users).run();
});

// ============================================================================
// FIXTURE BUILDERS
// ============================================================================

interface MakeUserOpts {
  id?: string;
  tenantId: string;
  name: string;
  role?: 'admin' | 'manager' | 'cashier';
}

async function makeUser(opts: MakeUserOpts): Promise<string> {
  const db = getDatabase();
  const id = opts.id ?? nanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    tenantId: opts.tenantId,
    email: `${id}@example.com`,
    passwordHash: await hash('AnomPass123!'),
    name: opts.name,
    role: opts.role ?? 'cashier',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

interface MakeSaleOpts {
  tenantId: string;
  cashierId: string;
  cashSessionId?: string | null;
  status?: 'completed' | 'voided' | 'cancelled' | 'draft';
  total?: number;
  createdAt: Date;
}

async function makeSale(opts: MakeSaleOpts): Promise<string> {
  const db = getDatabase();
  const id = nanoid();
  const iso = opts.createdAt.toISOString();
  const status = opts.status ?? 'completed';
  // ENG-177c — the schema now enforces `cash_session_id IS NOT NULL OR
  // status = 'draft'`. These fixtures bypass the application layer, so a
  // committed sale without a supplied session would violate the CHECK.
  // Attach a throwaway closed session; the anomaly detectors group by
  // cashier (created_by), so the specific session is irrelevant to every
  // assertion in this file.
  let cashSessionId = opts.cashSessionId ?? null;
  if (cashSessionId === null && status !== 'draft') {
    cashSessionId = await makeSession({
      tenantId: opts.tenantId,
      siteId: opts.tenantId === tenantA ? siteA : siteB,
      cashierId: opts.cashierId,
      openedAt: opts.createdAt,
      closedAt: opts.createdAt,
    });
  }
  await db.insert(sales).values({
    id,
    tenantId: opts.tenantId,
    saleNumber: `SALE-${id.slice(0, 6)}`,
    customerId: null,
    subtotal: opts.total ?? 100,
    taxAmount: 0,
    discountAmount: 0,
    total: opts.total ?? 100,
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status,
    cashSessionId,
    notes: null,
    createdBy: opts.cashierId,
    createdAt: iso,
    updatedAt: iso,
  });
  return id;
}

async function makeVoidLog(opts: {
  tenantId: string;
  cashierId: string;
  saleId: string;
  createdAt: Date;
}): Promise<void> {
  const db = getDatabase();
  await db.insert(auditLogs).values({
    id: nanoid(),
    tenantId: opts.tenantId,
    actorId: opts.cashierId,
    action: 'sale.void',
    resourceType: 'sale',
    resourceId: opts.saleId,
    before: null,
    after: null,
    metadata: null,
    createdAt: opts.createdAt.toISOString(),
  });
}

async function makeRefund(opts: {
  tenantId: string;
  cashierId: string;
  saleId: string;
  refundAmount: number;
  createdAt: Date;
}): Promise<void> {
  const db = getDatabase();
  const iso = opts.createdAt.toISOString();
  await db.insert(saleReturns).values({
    id: nanoid(),
    tenantId: opts.tenantId,
    saleId: opts.saleId,
    refundAmount: opts.refundAmount,
    reason: 'test',
    createdBy: opts.cashierId,
    createdAt: iso,
    updatedAt: iso,
  });
}

async function makeSession(opts: {
  tenantId: string;
  siteId: string;
  cashierId: string;
  openedAt: Date;
  closedAt: Date;
}): Promise<string> {
  const db = getDatabase();
  const id = nanoid();
  await db.insert(cashSessions).values({
    id,
    tenantId: opts.tenantId,
    siteId: opts.siteId,
    cashierId: opts.cashierId,
    registerName: `register-${id.slice(0, 4)}`,
    openingFloat: 0,
    openingCountDenominations: [],
    expectedBalance: 0,
    status: 'closed',
    openedAt: opts.openedAt.toISOString(),
    closedAt: opts.closedAt.toISOString(),
    createdAt: opts.openedAt.toISOString(),
    updatedAt: opts.closedAt.toISOString(),
  });
  return id;
}

const NOW = new Date('2026-04-30T12:00:00.000Z');
const FROM = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days back

function detect(tenantId: string) {
  return detectAnomalies(getDatabase(), { tenantId, from: FROM, to: NOW });
}

// ============================================================================
// EMPTY / DEGENERATE CASES
// ============================================================================

describe('detectAnomalies — empty / degenerate', () => {
  it('returns no alerts when the tenant has zero data', async () => {
    // Escenario: tenant recién creado sin ventas, sin voids, sin refunds.
    // Esperamos: result vacío, sin division-by-zero, sin error.
    const result = await detect(tenantA);
    expect(result.totalCount).toBe(0);
    expect(result.alerts).toEqual([]);
    expect(result.severityCounts).toEqual({ medium: 0, high: 0 });
    expect(result.kindCounts).toEqual({
      ticketsPerHourSpike: 0,
      voidRate: 0,
      refundAmount: 0,
      noSaleSessions: 0,
    });
  });

  it('skips cross-cashier detectors when fewer than MIN_SAMPLE_SIZE cashiers', async () => {
    // Escenario: tenant pequeño con 3 cashiers (debajo del MIN_SAMPLE_SIZE=5).
    // Aún si un cashier hace muchos voids, no hay población suficiente
    // para comparar. El detector retorna sin alertas cross-cashier.
    const cashiers = await Promise.all(
      Array.from({ length: 3 }).map((_, i) =>
        makeUser({ tenantId: tenantA, name: `Cashier ${i}` })
      )
    );
    // Cashier 0 = anomalía: 10 voids con apenas 5 sales.
    for (let i = 0; i < 5; i += 1) {
      const saleId = await makeSale({
        tenantId: tenantA,
        cashierId: cashiers[0]!,
        createdAt: new Date(NOW.getTime() - i * 60_000),
      });
      if (i < 10) {
        await makeVoidLog({
          tenantId: tenantA,
          cashierId: cashiers[0]!,
          saleId,
          createdAt: new Date(NOW.getTime() - i * 60_000),
        });
      }
    }
    const result = await detect(tenantA);
    expect(result.kindCounts.voidRate).toBe(0);
  });
});

// ============================================================================
// PATTERN 2 — VOIDS FANTASMA
// ============================================================================

describe('detectAnomalies — voidRate (Voids fantasma)', () => {
  it('flags one cashier whose void ratio is far above the tenant population', async () => {
    // Escenario: 6 cashiers en el tenant. 5 de ellos voidean 1 venta de
    // cada 50 (ratio ≈ 0.02). El sexto (Carlos) voidea 15 de 30 (ratio
    // 0.5) — "voids fantasma" clásico.
    // Esperamos: 1 alert kind='voidRate', cashierId=Carlos, severity='high'.
    const honest = await Promise.all(
      Array.from({ length: 5 }).map((_, i) =>
        makeUser({ tenantId: tenantA, name: `Honest ${i}` })
      )
    );
    const carlos = await makeUser({ tenantId: tenantA, name: 'Carlos' });

    // Cada cashier honesto: 50 sales, 1 void.
    for (const cashierId of honest) {
      for (let i = 0; i < 50; i += 1) {
        const saleId = await makeSale({
          tenantId: tenantA,
          cashierId,
          createdAt: new Date(NOW.getTime() - i * 3_600_000),
        });
        if (i === 0) {
          await makeVoidLog({
            tenantId: tenantA,
            cashierId,
            saleId,
            createdAt: new Date(NOW.getTime() - i * 3_600_000),
          });
        }
      }
    }
    // Carlos: 30 sales, 15 voids.
    for (let i = 0; i < 30; i += 1) {
      const saleId = await makeSale({
        tenantId: tenantA,
        cashierId: carlos,
        createdAt: new Date(NOW.getTime() - i * 3_600_000),
      });
      if (i < 15) {
        await makeVoidLog({
          tenantId: tenantA,
          cashierId: carlos,
          saleId,
          createdAt: new Date(NOW.getTime() - i * 3_600_000),
        });
      }
    }

    const result = await detect(tenantA);
    const voidAlerts = result.alerts.filter(a => a.kind === 'voidRate');
    expect(voidAlerts.length).toBe(1);
    expect(voidAlerts[0]?.cashierId).toBe(carlos);
    expect(voidAlerts[0]?.cashierName).toBe('Carlos');
    expect(voidAlerts[0]?.severity).toBe('high');
    expect(voidAlerts[0]?.observed).toBeGreaterThan(0.4);
  });

  it('returns no alerts when all cashiers void at similar rates', async () => {
    // Escenario: 6 cashiers con ratios 0.02 ± noise. Nadie es outlier.
    // Esperamos: cero voidRate alerts.
    const cashiers = await Promise.all(
      Array.from({ length: 6 }).map((_, i) =>
        makeUser({ tenantId: tenantA, name: `Even ${i}` })
      )
    );
    for (const cashierId of cashiers) {
      for (let i = 0; i < 50; i += 1) {
        const saleId = await makeSale({
          tenantId: tenantA,
          cashierId,
          createdAt: new Date(NOW.getTime() - i * 3_600_000),
        });
        if (i === 0) {
          await makeVoidLog({
            tenantId: tenantA,
            cashierId,
            saleId,
            createdAt: new Date(NOW.getTime() - i * 3_600_000),
          });
        }
      }
    }
    const result = await detect(tenantA);
    expect(result.kindCounts.voidRate).toBe(0);
  });
});

// ============================================================================
// PATTERN 3 — REFUND AMOUNT OUTLIERS
// ============================================================================

describe('detectAnomalies — refundAmount (Refunds fraudulentos)', () => {
  it('flags a single huge refund vs a tenant-wide low-mean baseline', async () => {
    // Escenario: 50 refunds normales de ~$50 cada uno. Un refund de
    // $5000 escapado por un cashier sospechoso. z-score >> 3σ.
    // Esperamos: 1 alert con refund=5000, evidenceRef = saleId.
    const cashier = await makeUser({ tenantId: tenantA, name: 'María' });
    let bigSaleId: string | null = null;
    for (let i = 0; i < 50; i += 1) {
      const saleId = await makeSale({
        tenantId: tenantA,
        cashierId: cashier,
        total: 100,
        createdAt: new Date(NOW.getTime() - i * 3_600_000),
      });
      await makeRefund({
        tenantId: tenantA,
        cashierId: cashier,
        saleId,
        refundAmount: 50 + (i % 5) * 2,
        createdAt: new Date(NOW.getTime() - i * 3_600_000),
      });
    }
    const bigSale = await makeSale({
      tenantId: tenantA,
      cashierId: cashier,
      total: 5000,
      createdAt: NOW,
    });
    bigSaleId = bigSale;
    await makeRefund({
      tenantId: tenantA,
      cashierId: cashier,
      saleId: bigSale,
      refundAmount: 5000,
      createdAt: NOW,
    });

    const result = await detect(tenantA);
    const refundAlerts = result.alerts.filter(a => a.kind === 'refundAmount');
    expect(refundAlerts.length).toBeGreaterThan(0);
    expect(refundAlerts[0]?.observed).toBe(5000);
    expect(refundAlerts[0]?.evidenceRef).toBe(bigSaleId);
    expect(refundAlerts[0]?.cashierName).toBe('María');
  });
});

// ============================================================================
// PATTERN 4 — NO-SALE SESSIONS
// ============================================================================

describe('detectAnomalies — noSaleSessions (No-sale opens)', () => {
  it('flags a cashier with abnormal count of long zero-sale sessions', async () => {
    // Escenario: 5 cashiers honestos abren caja durante un mes;
    // típicamente cada uno tiene 1 sesión vacía en 30 días. Un sexto
    // cashier (Andrés) tiene 12 sesiones vacías, todas > 30 min.
    // Esperamos: 1 alert kind='noSaleSessions', cashierId=Andrés.
    const honest = await Promise.all(
      Array.from({ length: 5 }).map((_, i) =>
        makeUser({ tenantId: tenantA, name: `Steady ${i}` })
      )
    );
    const andres = await makeUser({ tenantId: tenantA, name: 'Andrés' });

    for (const cashierId of honest) {
      // 1 sesión empty + 9 sesiones con sales.
      const empty = await makeSession({
        tenantId: tenantA,
        siteId: siteA,
        cashierId,
        openedAt: new Date(NOW.getTime() - 24 * 3_600_000),
        closedAt: new Date(NOW.getTime() - 23 * 3_600_000),
      });
      void empty;
      for (let i = 0; i < 9; i += 1) {
        const sessionId = await makeSession({
          tenantId: tenantA,
          siteId: siteA,
          cashierId,
          openedAt: new Date(NOW.getTime() - (i + 2) * 24 * 3_600_000),
          closedAt: new Date(NOW.getTime() - (i + 2) * 24 * 3_600_000 + 60 * 60_000),
        });
        await makeSale({
          tenantId: tenantA,
          cashierId,
          cashSessionId: sessionId,
          createdAt: new Date(NOW.getTime() - (i + 2) * 24 * 3_600_000 + 30 * 60_000),
        });
      }
    }

    // Andrés: 12 sesiones vacías de >30 min.
    for (let i = 0; i < 12; i += 1) {
      await makeSession({
        tenantId: tenantA,
        siteId: siteA,
        cashierId: andres,
        openedAt: new Date(NOW.getTime() - i * 24 * 3_600_000),
        closedAt: new Date(NOW.getTime() - i * 24 * 3_600_000 + 60 * 60_000),
      });
    }

    const result = await detect(tenantA);
    const nsAlerts = result.alerts.filter(a => a.kind === 'noSaleSessions');
    expect(nsAlerts.length).toBe(1);
    expect(nsAlerts[0]?.cashierId).toBe(andres);
    expect(nsAlerts[0]?.observed).toBe(12);
  });

  it('ignores empty sessions shorter than the 30-minute floor', async () => {
    // Escenario: cashier que abre caja durante 5 min varias veces sin
    // ventas. Esperamos: cero alertas, esas son sesiones de chequeo
    // legítimas, no fraude.
    const cashiers = await Promise.all(
      Array.from({ length: 6 }).map((_, i) =>
        makeUser({ tenantId: tenantA, name: `Quick ${i}` })
      )
    );
    for (const cashierId of cashiers) {
      for (let i = 0; i < 10; i += 1) {
        await makeSession({
          tenantId: tenantA,
          siteId: siteA,
          cashierId,
          openedAt: new Date(NOW.getTime() - i * 24 * 3_600_000),
          closedAt: new Date(NOW.getTime() - i * 24 * 3_600_000 + 5 * 60_000),
        });
      }
    }
    const result = await detect(tenantA);
    expect(result.kindCounts.noSaleSessions).toBe(0);
  });
});

// ============================================================================
// PATTERN 5 — TICKETS PER HOUR PERSONAL SPIKE
// ============================================================================

describe('detectAnomalies — ticketsPerHourSpike', () => {
  it('flags a cashier with one hour at 4x their personal mean', async () => {
    // Escenario: cashier (Sofía) trabaja consistentemente a ~5 tickets/hora.
    // Una hora aislada hace 25 tickets/hora — 4x su media personal.
    // Esperamos: 1 alert kind='ticketsPerHourSpike', cashierId=Sofía.
    const sofia = await makeUser({ tenantId: tenantA, name: 'Sofía' });
    // 10 horas distintas con 5 tickets cada una.
    for (let h = 0; h < 10; h += 1) {
      const hourStart = new Date(NOW.getTime() - (h + 2) * 24 * 3_600_000);
      for (let t = 0; t < 5; t += 1) {
        await makeSale({
          tenantId: tenantA,
          cashierId: sofia,
          createdAt: new Date(hourStart.getTime() + t * 60_000),
        });
      }
    }
    // Hora anómala: 25 tickets en una sola hora.
    const spikeHour = new Date(NOW.getTime() - 24 * 3_600_000);
    for (let t = 0; t < 25; t += 1) {
      await makeSale({
        tenantId: tenantA,
        cashierId: sofia,
        createdAt: new Date(spikeHour.getTime() + t * 60_000),
      });
    }

    const result = await detect(tenantA);
    const spikes = result.alerts.filter(a => a.kind === 'ticketsPerHourSpike');
    expect(spikes.length).toBeGreaterThan(0);
    expect(spikes[0]?.cashierId).toBe(sofia);
    expect(spikes[0]?.observed).toBe(25);
  });
});

// ============================================================================
// CROSS-TENANT ISOLATION
// ============================================================================

describe('detectAnomalies — cross-tenant isolation', () => {
  it('does not surface tenant B anomalies when querying tenant A', async () => {
    // Escenario: tenant B tiene cashiers obviamente fraudulentos. Tenant A
    // tiene cero data. La query a tenantA debe retornar [].
    const cashiers = await Promise.all(
      Array.from({ length: 6 }).map((_, i) =>
        makeUser({ tenantId: tenantB, name: `B Cashier ${i}` })
      )
    );
    // Cashier 0: voidea TODO.
    for (let i = 0; i < 30; i += 1) {
      const saleId = await makeSale({
        tenantId: tenantB,
        cashierId: cashiers[0]!,
        createdAt: new Date(NOW.getTime() - i * 3_600_000),
      });
      await makeVoidLog({
        tenantId: tenantB,
        cashierId: cashiers[0]!,
        saleId,
        createdAt: new Date(NOW.getTime() - i * 3_600_000),
      });
    }
    // Otros cashiers: 1 void cada uno.
    for (let c = 1; c < 6; c += 1) {
      for (let i = 0; i < 30; i += 1) {
        const saleId = await makeSale({
          tenantId: tenantB,
          cashierId: cashiers[c]!,
          createdAt: new Date(NOW.getTime() - i * 3_600_000),
        });
        if (i === 0) {
          await makeVoidLog({
            tenantId: tenantB,
            cashierId: cashiers[c]!,
            saleId,
            createdAt: new Date(NOW.getTime() - i * 3_600_000),
          });
        }
      }
    }

    const resultA = await detect(tenantA);
    expect(resultA.totalCount).toBe(0);

    const resultB = await detect(tenantB);
    expect(resultB.alerts.some(a => a.cashierId === cashiers[0])).toBe(true);
  });
});

// ============================================================================
// CONSTANTS
// ============================================================================

describe('anomalyDetectionConstants', () => {
  it('exposes the tuning constants for tests + future settings UI', () => {
    expect(anomalyDetectionConstants.MAHALANOBIS_THRESHOLD).toBe(3);
    expect(anomalyDetectionConstants.HIGH_SEVERITY_THRESHOLD).toBe(4.5);
    expect(anomalyDetectionConstants.MIN_SAMPLE_SIZE).toBe(5);
    expect(anomalyDetectionConstants.REFUND_TOP_K).toBe(10);
    expect(anomalyDetectionConstants.MIN_NOSALE_DURATION_MS).toBe(30 * 60 * 1000);
    expect(anomalyDetectionConstants.MIN_PERSONAL_HOURS).toBe(5);
    expect(anomalyDetectionConstants.ANALYSIS_WINDOW_DAYS).toBe(30);
  });
});
