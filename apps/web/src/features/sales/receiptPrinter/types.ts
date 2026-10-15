// Shared types for the sale-receipt printer ( slice 29 — split
// from the former monolithic `receiptPrinter.ts`).

import type { PaymentStatus, PaymentMethod, SaleItem, SalePayment, SaleStatus } from '@/types';
import type { FiscalDocumentStatus } from '@/components/fiscal/FiscalStatusBadge';
import type { FiscalMaturity } from '@/components/fiscal/FiscalMaturityBadge';
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
  maturity: FiscalMaturity;
  /**
   * Country-specific QR payload string (URL for DIAN/SAT, TED for
   * SII). Null unless the provider pack is certified and the document
   * has an authority-verifiable final identifier.
   */
  qrPayload: string | null;
  xmlRef: string | null;
  resolution: string | null;
  emittedAt: string;
  countryCode: string;
}

export type ReceiptSale = {
  id?: string;
  saleNumber: string;
  customerName?: string | null;
  customerNameSnapshot?: string | null;
  siteNameSnapshot?: string | null;
  cashierNameSnapshot?: string | null;
  receiptIdentitySnapshotVersion?: number | null;
  companyNameSnapshot?: string | null;
  companyTaxIdSnapshot?: string | null;
  companyAddressSnapshot?: string | null;
  companyPhoneSnapshot?: string | null;
  companyEmailSnapshot?: string | null;
  customerTaxIdSnapshot?: string | null;
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
  { status: 'printed' } | { status: 'system-fallback' } | ({ status: 'fallback' } & EscPosFailure);

export interface EscPosFailure {
  error?: string | undefined;
  errorMessage?: string | undefined;
  /** True only after the authority confirms a durable retry row. */
  retryQueued?: boolean | undefined;
}

// explicit `| undefined` on optional fields.
export interface PrintSaleReceiptOptions {
  /**
   * When supplied, called first to attempt the ESC/POS path. Returns
   * the server's dispatch outcome. Only System/no-printer proceeds to HTML.
   */
  escposDispatcher?: (() => Promise<EscPosDispatchOutcome>) | undefined;
  /**
   * Called when ESC/POS fails. No automatic HTML print follows.
   */
  onEscposFailure?: ((outcome: EscPosFailure) => void) | undefined;
  /**
   * Fetches the server-rendered active receipt template for system/browser
   * printing. Null keeps the legacy hardcoded receipt as an upgrade fallback.
   */
  htmlProvider?: (() => Promise<string | null>) | undefined;
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
