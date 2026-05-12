/**
 * ENG-038 — deterministic payment rail adapter.
 *
 * This adapter deliberately avoids network I/O. It lets tests, demos
 * and the Operations reconciliation tab exercise every provider
 * branch until real Wompi / Bold / ePayco / Mercado Pago credentials
 * are available.
 *
 * @module services/payments/mock-adapter
 */

import { createHash } from 'node:crypto';
import type { PaymentRailId } from '../../db/schema.js';
import type {
  PaymentChargeInput,
  PaymentChargeResult,
  PaymentRailAdapter,
  PaymentRailValidationContext,
  PaymentRailValidationIssue,
  PaymentRailValidationResult,
  PaymentRefundInput,
  PaymentRefundResult,
  PaymentStatusInput,
  PaymentStatusResult,
} from './contracts.js';
import { readPaymentRailCredentials } from './credentials.js';
import {
  CREDENTIAL_FIELDS_BY_RAIL,
  PAYMENT_RAILS_MANIFEST,
} from './manifest.js';

function stableId(parts: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 18);
}

function inferScenario(reference: string): 'approved' | 'declined' | 'pending' | 'timeout' {
  const normalized = reference.toLowerCase();
  if (normalized.includes('decline')) return 'declined';
  if (normalized.includes('pending')) return 'pending';
  if (normalized.includes('timeout')) return 'timeout';
  return 'approved';
}

export class DeterministicPaymentRailAdapter implements PaymentRailAdapter {
  readonly capabilities;

  constructor(readonly railId: PaymentRailId) {
    this.capabilities = PAYMENT_RAILS_MANIFEST[railId].capabilities;
  }

  async charge(input: PaymentChargeInput): Promise<PaymentChargeResult> {
    const providerTransactionId = `${this.railId}_${stableId([
      input.tenantId,
      input.reference,
      input.amount,
      input.currencyCode,
    ])}`;
    const scenario = inferScenario(input.reference);

    if (scenario === 'declined') {
      return {
        status: 'declined',
        providerTransactionId,
        reason: 'Deterministic decline fixture',
      };
    }
    if (scenario === 'pending') {
      return {
        status: 'pending',
        providerTransactionId,
        reference: input.reference,
      };
    }
    if (scenario === 'timeout') {
      return {
        status: 'timeout',
        providerTransactionId,
        retryable: true,
      };
    }

    return {
      status: 'approved',
      providerTransactionId,
      authCode: stableId([providerTransactionId, 'auth']).slice(0, 8).toUpperCase(),
      reference: input.reference,
    };
  }

  async refund(input: PaymentRefundInput): Promise<PaymentRefundResult> {
    const scenario = inferScenario(`${input.providerTransactionId} ${input.reason ?? ''}`);
    if (scenario === 'declined') {
      return {
        status: 'declined',
        providerTransactionId: input.providerTransactionId,
        reason: 'Deterministic refund decline fixture',
      };
    }
    if (scenario === 'timeout') {
      return {
        status: 'timeout',
        providerTransactionId: input.providerTransactionId,
        retryable: true,
      };
    }
    return {
      status: 'refunded',
      providerTransactionId: input.providerTransactionId,
      refundId: `${this.railId}_refund_${stableId([
        input.tenantId,
        input.providerTransactionId,
        input.amount,
      ])}`,
    };
  }

  async getStatus(input: PaymentStatusInput): Promise<PaymentStatusResult> {
    const scenario = inferScenario(input.providerTransactionId);
    return {
      status: scenario === 'pending' ? 'pending' : scenario,
      providerTransactionId: input.providerTransactionId,
      raw: { deterministic: true, railId: this.railId },
    };
  }

  /**
   * ENG-038 slice 2 — readiness probe. Walks the rail's declared
   * credential descriptor; required fields with no stored value
   * surface as `PAYMENT_CREDENTIAL_MISSING` issues so the admin UI can
   * pinpoint exactly which inputs the operator still owes. Real
   * provider clients will replace this with a stronger probe (e.g. an
   * actual sandbox round-trip) when they swap into the registry.
   */
  validateConfig(
    ctx: PaymentRailValidationContext
  ): PaymentRailValidationResult {
    const credentials = readPaymentRailCredentials(ctx.settings, this.railId);
    const issues: PaymentRailValidationIssue[] = [];
    for (const descriptor of CREDENTIAL_FIELDS_BY_RAIL[this.railId]) {
      if (!descriptor.required) continue;
      const stored = credentials[descriptor.key];
      if (!stored || stored.length === 0) {
        issues.push({
          code: 'PAYMENT_CREDENTIAL_MISSING',
          message: `Required credential ${descriptor.key} is not configured for ${this.railId}`,
          field: descriptor.key,
        });
      }
    }
    return { ok: issues.length === 0, issues };
  }
}
