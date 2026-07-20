/**
 * Events manifest regression tests.
 *
 * Pin the public-event contract every integrator relies on:
 * - Tuple exhaustiveness + uniqueness.
 * - Each event type has a Zod payload schema entry.
 * - Schemas accept valid fixtures.
 * - Schemas reject malformed payloads.
 * - `buildPublicEventContract` exposes per-field required flags.
 */

import { describe, expect, it } from 'vitest';
import {
  PUBLIC_EVENT_PAYLOAD_SCHEMAS,
  PUBLIC_EVENT_TYPES,
  PUBLIC_EVENTS_VERSION,
  buildPublicEventContract,
  getPayloadSchema,
  isPublicEventType,
} from '../services/events/manifest.js';

describe('PUBLIC_EVENT_TYPES', () => {
  it('lists exactly the 5 events the AC enumerates', () => {
    expect([...PUBLIC_EVENT_TYPES].sort()).toEqual([
      'cash_session.closed',
      'fiscal_document.accepted',
      'inventory.adjusted',
      'sale.completed',
      'sale.refunded',
    ]);
  });

  it('event types are unique', () => {
    expect(new Set(PUBLIC_EVENT_TYPES).size).toBe(PUBLIC_EVENT_TYPES.length);
  });

  it('has a payload schema entry per event type (no missing arms)', () => {
    for (const type of PUBLIC_EVENT_TYPES) {
      expect(PUBLIC_EVENT_PAYLOAD_SCHEMAS[type]).toBeDefined();
    }
  });

  it('PUBLIC_EVENTS_VERSION is a positive integer (v1 ships)', () => {
    expect(PUBLIC_EVENTS_VERSION).toBeGreaterThan(0);
    expect(Number.isInteger(PUBLIC_EVENTS_VERSION)).toBe(true);
  });

  it('isPublicEventType narrows on known + unknown strings', () => {
    expect(isPublicEventType('sale.completed')).toBe(true);
    expect(isPublicEventType('sale.future_event')).toBe(false);
    expect(isPublicEventType('')).toBe(false);
  });

  it('getPayloadSchema returns the schema or throws for unknown', () => {
    expect(getPayloadSchema('sale.completed')).toBeDefined();
    expect(() => getPayloadSchema('not.a.real.event' as never)).toThrow(
      /Unknown public event type/
    );
  });
});

describe('payload schemas accept valid fixtures', () => {
  it('sale.completed accepts a populated payload', () => {
    const result = PUBLIC_EVENT_PAYLOAD_SCHEMAS['sale.completed'].safeParse({
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
      completedAt: '2026-05-07T10:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('sale.refunded accepts a populated payload with reasonCode null', () => {
    const result = PUBLIC_EVENT_PAYLOAD_SCHEMAS['sale.refunded'].safeParse({
      saleReturnId: 'ret-1',
      originalSaleId: 'sale-1',
      siteId: 'site-1',
      cashSessionId: 'cs-1',
      refundedAmount: 119,
      currencyCode: 'COP',
      reasonCode: null,
      refundedAt: '2026-05-07T10:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('inventory.adjusted accepts a populated payload', () => {
    const result = PUBLIC_EVENT_PAYLOAD_SCHEMAS['inventory.adjusted'].safeParse({
      productId: 'prod-1',
      siteId: 'site-1',
      locationId: 'loc-1',
      quantityBefore: 10,
      quantityAfter: 8,
      delta: -2,
      reasonCode: 'damage',
      adjustedByUserId: 'user-1',
      adjustedAt: '2026-05-07T10:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('cash_session.closed accepts a populated payload', () => {
    const result = PUBLIC_EVENT_PAYLOAD_SCHEMAS['cash_session.closed'].safeParse({
      cashSessionId: 'cs-1',
      siteId: 'site-1',
      cashierId: 'user-1',
      openedAt: '2026-05-07T08:00:00.000Z',
      closedAt: '2026-05-07T20:00:00.000Z',
      expectedCashBalance: 500000,
      countedCashBalance: 499500,
      overShortAmount: -500,
      currencyCode: 'COP',
    });
    expect(result.success).toBe(true);
  });

  it('fiscal_document.accepted accepts a populated payload', () => {
    const result = PUBLIC_EVENT_PAYLOAD_SCHEMAS['fiscal_document.accepted'].safeParse({
      fiscalDocumentId: 'fd-1',
      cufe: 'sii-cl:76123456-0:39:1',
      documentNumber: '1',
      source: 'sale',
      sourceId: 'sale-1',
      countryCode: 'CL',
      providerId: 'sii-cl',
      acceptedAt: '2026-05-07T10:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });
});

describe('payload schemas reject malformed fixtures', () => {
  it('sale.completed rejects missing required field', () => {
    const result = PUBLIC_EVENT_PAYLOAD_SCHEMAS['sale.completed'].safeParse({
      saleId: 'sale-1',
      // missing saleNumber + everything else
    });
    expect(result.success).toBe(false);
  });

  it('sale.completed rejects wrong type (total as string)', () => {
    const result = PUBLIC_EVENT_PAYLOAD_SCHEMAS['sale.completed'].safeParse({
      saleId: 'sale-1',
      saleNumber: 'VTA-N-001',
      siteId: 'site-1',
      cashSessionId: 'cs-1',
      customerId: null,
      subtotal: 100,
      taxAmount: 19,
      discountAmount: 0,
      total: 'not-a-number',
      currencyCode: 'COP',
      paymentMethod: 'cash',
      completedAt: '2026-05-07T10:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('buildPublicEventContract', () => {
  it('returns the manifest version + every event type', () => {
    const contract = buildPublicEventContract();
    expect(contract.version).toBe(PUBLIC_EVENTS_VERSION);
    expect([...contract.eventTypes].sort()).toEqual([...PUBLIC_EVENT_TYPES].sort());
  });

  it('exposes per-event field metadata with required flags', () => {
    const contract = buildPublicEventContract();
    const saleCompletedFields = contract.fields['sale.completed'];
    // saleId is required; the schema lists it with required=true.
    const saleId = saleCompletedFields.find(f => f.name === 'saleId');
    expect(saleId).toBeDefined();
    expect(saleId?.required).toBe(true);
    // customerId is nullable but still required (z.string().nullable()).
    const customerId = saleCompletedFields.find(f => f.name === 'customerId');
    expect(customerId).toBeDefined();
  });

  it('every event has at least one field exposed', () => {
    const contract = buildPublicEventContract();
    for (const type of PUBLIC_EVENT_TYPES) {
      expect(contract.fields[type].length).toBeGreaterThan(0);
    }
  });
});
