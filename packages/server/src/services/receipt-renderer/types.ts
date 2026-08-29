/**
 * Receipt renderer data-shape contract.
 *
 * extracted verbatim from the former single-file
 * `services/receipt-renderer.ts` (1204 LOC) during the megafile decomposition.
 * Pure types (no runtime), so every module in `receipt-renderer/` can depend on
 * this leaf without a cycle. The barrel re-exports all of these under the same
 * names the two importers already use.
 *
 * @module services/receipt-renderer/types
 */
import type { FiscalDocumentStatus } from '../../db/schema.js';
import type { FiscalAdapterMaturity } from '../fiscal/adapter.js';

export interface RenderCompany {
  name: string;
  taxId: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
}

export interface RenderSaleItem {
  name: string;
  sku?: string | null;
  qty: number;
  unitPrice: number;
  taxPercent: number;
  discount: number;
  total: number;
}

export interface RenderTender {
  method: string;
  amount: number;
  reference?: string | null;
}

export interface RenderSale {
  saleNumber: string;
  cashier?: string | null;
  site?: string | null;
  customer?: string | null;
  customerTaxId?: string | null;
  createdAt: string;
  subtotal: number;
  discount: number;
  taxTotal: number;
  /** Per-kind snapshot; null means that kind is absent, while zero is a present exempt line. */
  taxBreakdown?: { iva: number | null; inc: number | null };
  tip: number;
  /**
   * Restaurant service charge / propina sugerida. Currency
   * value auto-applied from the tenant's configured rate; rendered on
   * its own totals line. Defaults to 0 for tenants without the setting.
   */
  serviceCharge: number;
  /** Percentage active when the sale was finalized (null when disabled). */
  serviceChargeRate?: number | null;
  grandTotal: number;
  changeDue?: number | null;
  notes?: string | null;
  items: RenderSaleItem[];
  tenders: RenderTender[];
}

export interface RenderFiscal {
  cufe?: string | null;
  qrUrl?: string | null;
  resolution?: string | null;
  documentNumber?: string | null;
  /**
   * Raw fiscal document status from the outbox lifecycle
   * (`pending`, `sent`, `accepted`, `rejected`, `contingency`). The
   * renderer never infers acceptance from CUFE presence — when a
   * template wants to display the status it binds `{{fiscal.status}}`
   * (raw enum) or `{{fiscal.statusLabel}}` (locale-resolved). This
   * is the single source of truth that protects against the
   * "contingency documents render as accepted" failure mode.
   */
  status?: FiscalDocumentStatus | null;
  /**
   * Pre-resolved i18n label for `status`. The renderer is
   * a pure function and does not load i18n; callers (the editor
   * preview, the future `sales.renderReceiptHtml` procedure) resolve
   * the label via `t('fiscal:status.<status>')` and pass it in.
   */
  statusLabel?: string | null;
  /** Provider maturity is distinct from the document lifecycle status. */
  maturity?: FiscalAdapterMaturity | null;
  /** Locale-resolved maturity label used by the mandatory proof appendix. */
  maturityLabel?: string | null;
  /**
   * Locale-resolved honesty notice for mock/draft providers. Null only for a
   * certified adapter, where the authority-specific pack owns the final proof.
   */
  nonCertifiedNotice?: string | null;
  /** Country code used only to name the fiscal authority in proof copy. */
  countryCode?: string | null;
  /** Locale-resolved field labels for the non-optional fiscal proof appendix. */
  evidenceLabels?: {
    document: string;
    status: string;
    maturity: string;
    resolution: string;
    identifier: string;
  };
}

/**
 * Logo is intentionally optional. If not present, the `logo` block
 * renders an empty placeholder in HTML and skips emission in ESC/POS.
 * This keeps the renderer pure and lets templates be safely shared
 * across tenants that may not have configured a logo yet.
 */
export interface RenderData {
  company: RenderCompany;
  sale: RenderSale;
  fiscal?: RenderFiscal;
  /**
   * Every fiscal document related to the sale. `fiscal` remains the primary
   * template binding while this collection feeds the mandatory proof appendix
   * so return/void evidence cannot disappear from a customized layout.
   */
  fiscalDocuments?: RenderFiscal[];
  logoDataUrl?: string | null;
  /**
   * resolved tenant locale. When present the renderer
   * formats currency-typed fields (unitPrice, total, subtotal, tax,
   * tenders, change) through `Intl.NumberFormat` so receipts match
   * the tenant's country (COP with 0 decimals for Colombia, USD with
   * 2 for USA, CLP with 0 for Chile, etc.). Optional for backwards
   * compatibility with test callers that synthesise RenderData by
   * hand — when absent the renderer falls back to raw `.toFixed(2)`
   * without a currency symbol (pre- behaviour).
   */
  locale?: ReceiptRenderLocale;
}

/**
 * Subset of `ResolvedLocale` the renderer needs. Kept separate from
 * the full `services/tenant-locale.ts` shape so the renderer can stay
 * pure (no DB imports) — callers resolve the locale once and hand the
 * small payload in.
 */
export interface ReceiptRenderLocale {
  locale: string;
  currency: string;
  legalDecimals: number;
  displayDecimals: number;
  /**
   * Optional default date pattern (`dd/MM/yyyy`, `MM/dd/yyyy`, …) drawn
   * from `tenant_locale_settings.dateFormatShort`. Used by the
   * `{{ date(value) }}` template function as the default pattern when
   * the operator does not pass one explicitly. Absent for legacy test
   * callers that synthesize the locale by hand — the template engine
   * falls back to `yyyy-MM-dd` in that case.
   */
  dateFormat?: string;
}

export interface ReceiptRenderLabels {
  documentTitle: string;
  itemColumns: {
    name: string;
    qty: string;
    unitPrice: string;
    taxPercent: string;
    discount: string;
    total: string;
  };
  totalsLines: {
    subtotal: string;
    discount: string;
    taxTotal: string;
    taxIva: string;
    taxInc: string;
    tip: string;
    serviceCharge: string;
    grandTotal: string;
  };
  tendersTable: {
    method: string;
    reference: string;
    amount: string;
    change: string;
    methods: {
      cash: string;
      card: string;
      transfer: string;
      credit: string;
      other: string;
    };
  };
}

export interface RenderResult {
  html: string;
  escpos: Uint8Array;
}
