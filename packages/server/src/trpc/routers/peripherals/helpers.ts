/**
 * Peripherals router shared helpers ( split).
 *
 * Leaf module: the tenant-scoped peripheral row loader and the adapter test
 * dispatcher. Imported by crud.ts; never imports a procedure module.
 *
 * @module trpc/routers/peripherals/helpers
 */
import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../../db/index.js';
import { sitePeripherals } from '../../../db/schema.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import type { SaleFiscalDocumentRow } from '../../../application/sales/sale-read.js';
import { instantiateAdapter } from '../../../services/peripherals/index.js';
import type {
  CashDrawerAdapter,
  PaymentTerminalAdapter,
  ReceiptPrinterAdapter,
  SaleReceiptInput,
  BarcodeScannerAdapter,
  TestResult,
} from '../../../services/peripherals/index.js';

export async function loadPeripheralOrThrow(db: DatabaseInstance, tenantId: string, id: string) {
  const row = await db
    .select()
    .from(sitePeripherals)
    .where(and(eq(sitePeripherals.id, id), eq(sitePeripherals.tenantId, tenantId)))
    .get();
  if (!row) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'PERIPHERAL_NOT_FOUND',
      message: 'Peripheral not found',
    });
  }
  return row!;
}

export async function runAdapterTest(
  adapter: ReturnType<typeof instantiateAdapter>
): Promise<TestResult> {
  if (!adapter) {
    return {
      status: 'failed',
      message: 'Driver not implemented for this kind yet.',
      details: { code: 'PERIPHERAL_DRIVER_NOT_IMPLEMENTED' },
    };
  }
  switch (adapter.kind) {
    case 'printer':
      return (adapter as ReceiptPrinterAdapter).testPrint();
    case 'cash_drawer':
      return (adapter as CashDrawerAdapter).testKick();
    case 'scanner':
      return (adapter as BarcodeScannerAdapter).testScan();
    case 'payment_terminal':
      return (adapter as PaymentTerminalAdapter).testCharge();
    default:
      return { status: 'failed', message: 'Unknown adapter kind' };
  }
}

/**
 * Keep every ESC/POS receipt entry point on the same fiscal-proof contract.
 * The sale reader already decides whether a document is locally informative
 * or authority-verifiable; the printer builder only renders that decision.
 */
export function toSaleReceiptFiscalDocuments(
  documents: SaleFiscalDocumentRow[]
): NonNullable<SaleReceiptInput['fiscalDocuments']> {
  return documents.map(document => ({
    documentNumber: document.documentNumber,
    status: document.status,
    maturity: document.maturity,
    identifier: document.cufe,
    resolution: document.resolution,
    qrPayload: document.qrPayload,
    countryCode: document.countryCode,
  }));
}
