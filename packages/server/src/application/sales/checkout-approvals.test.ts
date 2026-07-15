import { describe, expect, it, vi } from 'vitest';
import type { CompleteSaleContext } from './types.js';
import {
  enqueueCheckoutApprovalConsumptions,
  requiredCheckoutApprovalActions,
} from './checkout-approvals.js';

describe('requiredCheckoutApprovalActions', () => {
  it('preserves direct manager/admin permissions and escalates cashier checkouts', () => {
    expect(
      requiredCheckoutApprovalActions({
        role: 'cashier',
        isCompletion: true,
        hasDiscount: true,
        hasCreditTender: true,
        creditOverride: false,
      })
    ).toEqual(['sale_discount', 'credit_sale']);

    expect(
      requiredCheckoutApprovalActions({
        role: 'cashier',
        isCompletion: true,
        hasDiscount: true,
        hasCreditTender: true,
        creditOverride: true,
      })
    ).toEqual(['sale_discount', 'credit_override']);

    expect(
      requiredCheckoutApprovalActions({
        role: 'manager',
        isCompletion: true,
        hasDiscount: true,
        hasCreditTender: true,
        creditOverride: false,
      })
    ).toEqual([]);

    expect(
      requiredCheckoutApprovalActions({
        role: 'manager',
        isCompletion: true,
        hasDiscount: false,
        hasCreditTender: true,
        creditOverride: true,
      })
    ).toEqual(['credit_override']);

    expect(
      requiredCheckoutApprovalActions({
        role: 'admin',
        isCompletion: true,
        hasDiscount: true,
        hasCreditTender: true,
        creditOverride: true,
      })
    ).toEqual([]);
  });

  it('never requires a checkout grant while a sale remains a draft', () => {
    expect(
      requiredCheckoutApprovalActions({
        role: 'cashier',
        isCompletion: false,
        hasDiscount: true,
        hasCreditTender: true,
        creditOverride: true,
      })
    ).toEqual([]);
  });

  it('keeps post-commit approval sync failures best-effort', async () => {
    const warn = vi.fn();
    const context = {
      db: {
        select() {
          throw new Error('sync outbox unavailable');
        },
      },
      tenantId: 'tenant-1',
      siteId: 'site-1',
      user: { id: 'cashier-1', role: 'cashier' },
      log: { warn },
    } as unknown as CompleteSaleContext;

    await expect(
      enqueueCheckoutApprovalConsumptions(context, [
        {
          requestId: 'approval-1',
          action: 'sale_discount',
          token: '00',
          claimExpiresAt: '2026-07-15T00:00:00.000Z',
          approverId: 'manager-1',
          approvedResourceId: 'checkout:sha256:test',
        },
      ])
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'approval-1', err: expect.any(Error) }),
      'manager approval consumption sync enqueue failed after sale commit'
    );
  });
});
