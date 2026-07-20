// Shared types for the sale-receipt printer ( slice 29 — split
// from the former monolithic `receiptPrinter.ts`).

import type { PaymentStatus, PaymentMethod, SaleItem, SalePayment, SaleStatus } from '@/types';
import type { FiscalDocumentStatus } from '@/components/fiscal/FiscalStatusBadge';
import type { LocalEscPosTransportHint } from '@/types/electron';

/**
 * Per-fiscal-document data the receipt prints. Mirrors the
 * shape returned by `sales.getById` / `sales.getForReprint` after the
 * `getSaleRecord` widening.
 */
export interface ReceiptFiscalDocument {
  id: string;
  source: 'sale' | 'void' | 'return';
  kind: 'DEE' | 'FEV' | 'NC' | 'ND';
  cufe: string;
  documentNumber: string;
  status: FiscalDocumentStatus;
  /**
   * Country-specific QR payload string (URL for DIAN/SAT, TED for
   * SII). Null when the doc is not in an eligible status, when the
   * CUFE is still a `pending-<nanoid>` placeholder, or when the
   * country pack is not yet implemented.
   */
  qrPayload: string | null;
  xmlRef: string | null;
  resolution: string | null;
  emittedAt: string;
  countryCode: string;
}

export type ReceiptSale = {
  saleNumber: string;
  customerName?: string | null;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  status: SaleStatus;
  notes?: string | null;
  createdAt: string;
  items?: SaleItem[];
  // follow-on — include the tender breakdown on the
  // printed receipt when the sale was settled as a split payment.
  payments?: SalePayment[];
  /**
   * fiscal proof block(s). Always rendered when present;
   * the section is omitted entirely for non-fiscal sales (DIAN-disabled
   * tenants, drafts, sales emitted before fiscal pack activation).
   */
  fiscalDocuments?: ReceiptFiscalDocument[];
};

export type EscPosDispatchOutcome =
  | { status: 'printed' }
  | { status: 'system-fallback' }
  | { status: 'fallback'; error?: string | undefined; errorMessage?: string | undefined };

// explicit `| undefined` on optional fields.
export interface PrintSaleReceiptOptions {
  /**
   * When supplied, called first to attempt the ESC/POS path. Returns
   * the server's dispatch outcome which steers whether to also
   * trigger the legacy HTML path.
   */
  escposDispatcher?: (() => Promise<EscPosDispatchOutcome>) | undefined;
  /**
   * Called when the ESC/POS attempt fails and the renderer falls
   * back to the legacy HTML path. The SalesPage uses this to fire a
   * translated toast.
   */
  onEscposFallback?:
    | ((outcome: { error?: string | undefined; errorMessage?: string | undefined }) => void)
    | undefined;
}

/** Server `peripherals.buildReceiptBytes` query result projection. */
export interface HubReceiptBytesPayload {
  status: 'ready' | 'system-fallback';
  bytes: number[];
  transportHint: LocalEscPosTransportHint | null;
}

/** Server `peripherals.buildDrawerKickBytes` mutation result projection. */
export interface HubDrawerBytesPayload {
  status: 'ready' | 'no-drawer-registered';
  bytes: number[];
  transportHint: LocalEscPosTransportHint | null;
}

export interface CreateEscposReceiptDispatcherInput {
  /**
   * Server-managed dispatch closure. Used in `device_local` /
   * `site_hub`. Typically a `peripherals.printReceipt` mutation
   * wrapper that returns `EscPosDispatchOutcome`.
   */
  serverPrint: () => Promise<EscPosDispatchOutcome>;
  /**
   * Hub bytes fetch closure. Used in `hub_client`. Typically a
   * `peripherals.buildReceiptBytes` query call. Receives no args
   * because the closure already binds `{saleId, siteId}`.
   */
  fetchHubReceiptBytes: () => Promise<HubReceiptBytesPayload>;
}

// explicit `| undefined` on optional fields.
/** Cash-drawer kick outcome shape mirrored from server `kickCashDrawer`. */
export type DrawerKickOutcome =
  | { status: 'ok' }
  | { status: 'no-drawer-registered' }
  | { status: 'error'; error?: string | undefined; errorMessage?: string | undefined }
  | { status: 'failed'; error?: string | undefined; errorMessage?: string | undefined };

export interface DispatchDrawerKickInput {
  /** Server-managed drawer kick. Used in `device_local` / `site_hub`. */
  serverKick: () => Promise<DrawerKickOutcome>;
  /** Hub bytes fetch. Used in `hub_client`. */
  fetchHubDrawerBytes: () => Promise<HubDrawerBytesPayload>;
}
