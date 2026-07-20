/**
 * Projector regression tests.
 *
 * Pure-function tests; no DB. Cover:
 * - Every operation_kind in the mapping table projects to the
 * right event type.
 * - Non-mapped ops return null.
 * - status='failed'/'started' ops return null.
 * - Malformed summary returns null (defensive — never throws).
 * - The fiscal_document.accepted special-case projector validates
 * payload via the manifest schema.
 */

import { describe, expect, it } from 'vitest';
import type { OperationEvent } from '../services/operation-journal/journal.js';
import {
  projectFiscalDocumentAccepted,
  projectOperationEvent,
} from '../services/events/projector.js';

function buildOp(overrides: Partial<OperationEvent> = {}): OperationEvent {
  return {
    id: 'op-1',
    tenantId: 'tenant-1',
    operationId: 'envelope-1',
    operationKind: 'sales.create',
    deviceId: 'device-1',
    userId: 'user-1',
    status: 'succeeded',
    requestHash: 'hash',
    summary: null,
    startedAt: '2026-05-07T10:00:00.000Z',
    completedAt: '2026-05-07T10:00:01.000Z',
    createdAt: '2026-05-07T10:00:00.000Z',
    ...overrides,
  } as OperationEvent;
}

const baseSaleSummary = {
  saleId: 'sale-1',
  saleNumber: 'VTA-N-001',
  siteId: 'site-1',
  cashSessionId: 'cs-1',
  customerId: null,
  subtotal: 100,
  taxAmount: 19,
  discountAmount: 0,
  total: 119,
  currencyCode: 'COP',
  paymentMethod: 'cash',
};

describe('projectOperationEvent — happy paths', () => {
  it('sales.create succeeded → sale.completed', () => {
    const op = buildOp({ summary: baseSaleSummary });
    const result = projectOperationEvent({ op });
    expect(result).not.toBeNull();
    expect(result?.type).toBe('sale.completed');
    expect(result?.tenantId).toBe('tenant-1');
    expect(result?.operationEventId).toBe('op-1');
    expect(result?.payload.saleId).toBe('sale-1');
    expect(result?.payload.total).toBe(119);
  });

  it('sales.completeDraft succeeded → sale.completed', () => {
    const op = buildOp({
      operationKind: 'sales.completeDraft',
      summary: baseSaleSummary,
    });
    const result = projectOperationEvent({ op });
    expect(result?.type).toBe('sale.completed');
  });

  it('sales.returnSale succeeded → sale.refunded', () => {
    const op = buildOp({
      operationKind: 'sales.returnSale',
      summary: {
        saleReturnId: 'ret-1',
        originalSaleId: 'sale-1',
        siteId: 'site-1',
        cashSessionId: 'cs-1',
        refundedAmount: 119,
        currencyCode: 'COP',
        reasonCode: 'damage',
      },
    });
    const result = projectOperationEvent({ op });
    expect(result?.type).toBe('sale.refunded');
    expect(result?.payload.saleReturnId).toBe('ret-1');
  });

  it('inventory.adjustStock succeeded → inventory.adjusted', () => {
    const op = buildOp({
      operationKind: 'inventory.adjustStock',
      summary: {
        productId: 'prod-1',
        siteId: 'site-1',
        locationId: 'loc-1',
        quantityBefore: 10,
        quantityAfter: 8,
        delta: -2,
        reasonCode: null,
      },
    });
    const result = projectOperationEvent({ op });
    expect(result?.type).toBe('inventory.adjusted');
    expect(result?.payload.delta).toBe(-2);
  });

  it('cashSessions.close succeeded → cash_session.closed', () => {
    const op = buildOp({
      operationKind: 'cashSessions.close',
      summary: {
        cashSessionId: 'cs-1',
        siteId: 'site-1',
        openedAt: '2026-05-07T08:00:00.000Z',
        expectedCashBalance: 500000,
        countedCashBalance: 499500,
        overShortAmount: -500,
        currencyCode: 'COP',
      },
    });
    const result = projectOperationEvent({ op });
    expect(result?.type).toBe('cash_session.closed');
    expect(result?.payload.overShortAmount).toBe(-500);
  });
});

describe('projectOperationEvent — null branches', () => {
  it('returns null for unmapped operation_kind', () => {
    const op = buildOp({
      operationKind: 'auth.changePassword',
      summary: { userId: 'user-1' },
    });
    expect(projectOperationEvent({ op })).toBeNull();
  });

  it('returns null when status is failed', () => {
    const op = buildOp({ status: 'failed', summary: baseSaleSummary });
    expect(projectOperationEvent({ op })).toBeNull();
  });

  it('returns null when status is started (not yet completed)', () => {
    const op = buildOp({ status: 'started', summary: baseSaleSummary });
    expect(projectOperationEvent({ op })).toBeNull();
  });

  it('returns null when summary is missing required fields', () => {
    const op = buildOp({
      summary: { saleId: 'sale-1' /* nothing else */ },
    });
    expect(projectOperationEvent({ op })).toBeNull();
  });

  it('returns null when summary is null', () => {
    const op = buildOp({ summary: null });
    expect(projectOperationEvent({ op })).toBeNull();
  });

  it('returns null when summary is non-object (defensive)', () => {
    const op = buildOp({ summary: 'not-an-object' as unknown as Record<string, unknown> });
    expect(projectOperationEvent({ op })).toBeNull();
  });
});

describe('projectFiscalDocumentAccepted', () => {
  it('returns a valid PublicEvent for a complete payload', () => {
    const result = projectFiscalDocumentAccepted({
      tenantId: 'tenant-1',
      operationEventId: 'op-1',
      payload: {
        fiscalDocumentId: 'fd-1',
        cufe: 'sii-cl:76123456-0:39:1',
        documentNumber: '1',
        source: 'sale',
        sourceId: 'sale-1',
        countryCode: 'CL',
        providerId: 'sii-cl',
        acceptedAt: '2026-05-07T10:00:00.000Z',
      },
    });
    expect(result).not.toBeNull();
    expect(result?.type).toBe('fiscal_document.accepted');
    expect(result?.tenantId).toBe('tenant-1');
    expect(result?.operationEventId).toBe('op-1');
    expect(result?.payload.cufe).toBe('sii-cl:76123456-0:39:1');
  });

  it('accepts null operationEventId (worker path without envelope)', () => {
    const result = projectFiscalDocumentAccepted({
      tenantId: 'tenant-1',
      operationEventId: null,
      payload: {
        fiscalDocumentId: 'fd-1',
        cufe: 'cufe-1',
        documentNumber: '1',
        source: 'sale',
        sourceId: 'sale-1',
        countryCode: 'CO',
        providerId: 'dian-co',
        acceptedAt: '2026-05-07T10:00:00.000Z',
      },
    });
    expect(result?.operationEventId).toBeNull();
  });

  it('returns null for malformed payload (missing field)', () => {
    const result = projectFiscalDocumentAccepted({
      tenantId: 'tenant-1',
      operationEventId: null,
      payload: {
        fiscalDocumentId: 'fd-1',
        cufe: 'cufe-1',
        // missing documentNumber etc.
      } as never,
    });
    expect(result).toBeNull();
  });
});
