/**
 * Public result/context types for the voice cart-command parser ().
 *
 * @module services/ai/voice/parse-cart-command/types
 */
import type { DatabaseInstance } from '../../../../db/index.js';
import type { AIProvider } from '../../providers/types.js';

/**
 * Shape the modal consumes per matched line. Carries enough to
 * construct a `ProductSearchSelection` on the web side without a
 * second tRPC round-trip; `unitPrice` is the unit's selling price
 * (from `unit_x_product.price`) and `taxRate` flows from the
 * product row.
 */
export interface MatchedCartProduct {
  productId: string;
  productName: string;
  productSku: string;
  unitId: string;
  unitName: string | null;
  unitAbbreviation: string | null;
  unitEquivalence: number;
  unitPrice: number;
  taxRate: number;
  stock: number;
  sellByFraction: boolean;
  fractionStep: number | null;
  fractionMinimum: number | null;
  similarity: number;
}

export interface CartCommandMatch {
  productHint: string;
  quantity: number | null;
  /** Free-form modifier captured by the parser (e.g. "sin queso").
   * Null when no modifier was spoken. Consumers route this to the
   * cart row's `notes` field at hydration time. */
  note: string | null;
  product: MatchedCartProduct | null;
}

export type CartCommandResult =
  | {
      mode: 'parsed';
      transcript: string;
      matches: CartCommandMatch[];
      confidence: 'high' | 'medium' | 'low';
      costUsd: number;
      durationMs: number;
      provider: AIProvider['id'];
      model: string;
      auditLogId: string;
    }
  | {
      mode: 'unrecognized';
      transcript: string;
      reason: string;
      costUsd: number;
      durationMs: number;
      provider: AIProvider['id'];
      model: string;
      auditLogId: string;
    };

export interface CartCommandContext {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string | null;
  userId: string | null;
}

export interface CartCommandInput {
  transcript: string;
}
