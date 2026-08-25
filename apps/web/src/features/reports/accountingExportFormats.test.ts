/**
 * Column-contract + balance tests for the accountant hand-off
 * builders. These pin what an accountant's importer actually sees, so
 * a refactor cannot silently reorder or drop a template column.
 */

import { describe, expect, it } from 'vitest';
import {
  buildGenericVoucherRows,
  buildJournalEntries,
  buildSiigoInvoiceRows,
  chunkSiigoRows,
  findSiigoConsecutiveCollisions,
  siigoConsecutive,
  SIIGO_INVOICE_COLUMNS,
  SIIGO_MAX_ROWS_PER_FILE,
  type AccountingVoucher,
} from './accountingExportFormats';

function makeVoucher(overrides: Partial<AccountingVoucher> = {}): AccountingVoucher {
  return {
    saleNumber: 'VTA-N-000123',
    createdAt: '2026-07-15T14:30:00.000Z',
    localDate: '2026-07-15',
    siteNameSnapshot: 'Sede Norte',
    customerNameSnapshot: 'Panadería La Espiga',
    customerTaxIdSnapshot: '900123456',
    currencyCode: 'COP',
    subtotal: 100,
    discountAmount: 0,
    taxAmount: 27,
    tipAmount: 0,
    serviceChargeAmount: 0,
    total: 127,
    ivaAmount: 19,
    incAmount: 8,
    lines: [
      {
        productNameSnapshot: 'Pan francés',
        productSkuSnapshot: 'PAN-001',
        quantity: 2,
        unitPrice: 50,
        discount: 0,
        taxRate: 19,
        taxKind: 'iva',
        taxAmount: 19,
        total: 119,
      },
      {
        productNameSnapshot: 'Almuerzo del día',
        productSkuSnapshot: 'ALM-001',
        quantity: 1,
        unitPrice: 100,
        discount: 0,
        taxRate: 8,
        taxKind: 'inc',
        taxAmount: 8,
        total: 108,
      },
    ],
    payments: [
      { method: 'cash', amount: 100 },
      { method: 'card', amount: 27 },
    ],
    fiscalDocumentNumber: 'SETP-990000001',
    fiscalCufe: 'abc123',
    fiscalStatus: 'accepted',
    refundAmount: 0,
    taxReconciled: true,
    ...overrides,
  } as AccountingVoucher;
}

describe('Siigo invoice rows', () => {
  it('emits the 31 documented template columns in order', () => {
    // The count is the contract: the page maps one CSV column per
    // entry, so a drift here changes what Siigo receives.
    expect(SIIGO_INVOICE_COLUMNS).toHaveLength(31);
    expect(SIIGO_INVOICE_COLUMNS[0]).toBe('Tipo de comprobante');
    expect(SIIGO_INVOICE_COLUMNS[1]).toBe('Consecutivo');
    expect(SIIGO_INVOICE_COLUMNS[5]).toBe('Fecha de elaboración');
    expect(SIIGO_INVOICE_COLUMNS[SIIGO_INVOICE_COLUMNS.length - 1]).toBe('Observaciones');
  });

  it('produces one row per sale line with the documented cell layout', () => {
    const rows = buildSiigoInvoiceRows([makeVoucher()]);
    expect(rows).toHaveLength(2);
    const [first] = rows;
    expect(first!.cells).toHaveLength(SIIGO_INVOICE_COLUMNS.length);
    // Consecutivo is digits-only (Siigo rejects prefixed values).
    expect(first!.cells[1]).toBe('123');
    expect(first!.cells[2]).toBe('900123456');
    // Dated from the tenant-local day the server resolved.
    expect(first!.cells[5]).toBe('15/07/2026');
    expect(first!.cells[13]).toBe('PAN-001');
    expect(first!.cells[14]).toBe('Pan francés');
    expect(first!.cells[17]).toBe('2');
    expect(first!.cells[18]).toBe('50');
    // Company-specific codes stay blank rather than guessed.
    expect(first!.cells[0]).toBe('');
    expect(first!.cells[22]).toBe('');
    expect(first!.cells[27]).toBe('');
    // Valor forma de pago is a per-row allocation: first row carries
    // the tender, continuation rows are blank (repeating it would
    // register the payment once per line).
    expect(first!.cells[28]).toBe('127');
    expect(rows[1]!.cells[28]).toBe('');
    expect(first!.cells[30]).toContain('VTA-N-000123');
  });

  it('falls back to the consumidor final id when the sale has no customer', () => {
    const rows = buildSiigoInvoiceRows([makeVoucher({ customerTaxIdSnapshot: null })]);
    expect(rows[0]!.cells[2]).toBe('222222222222');
  });

  it('leaves the currency blank for COP and names it otherwise', () => {
    expect(buildSiigoInvoiceRows([makeVoucher()])[0]!.cells[6]).toBe('');
    expect(buildSiigoInvoiceRows([makeVoucher({ currencyCode: 'USD' })])[0]!.cells[6]).toBe('USD');
  });

  it('chunks past the 500-row limit without splitting an invoice', () => {
    // 200 sales x 3 lines = 600 rows: the split must land on an
    // invoice boundary, never mid-invoice.
    const vouchers = Array.from({ length: 200 }, (_, index) =>
      makeVoucher({
        saleNumber: `VTA-${String(index + 1).padStart(6, '0')}`,
        lines: [makeVoucher().lines[0]!, makeVoucher().lines[1]!, makeVoucher().lines[0]!],
      })
    );
    const chunks = chunkSiigoRows(buildSiigoInvoiceRows(vouchers));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // Hard cap: Siigo rejects an over-limit file outright.
      expect(chunk.length).toBeLessThanOrEqual(SIIGO_MAX_ROWS_PER_FILE);
    }
    const consecutivesPerChunk = chunks.map(chunk => new Set(chunk.map(row => row.cells[1] ?? '')));
    const seen = new Set<string>();
    for (const set of consecutivesPerChunk) {
      for (const consecutive of set) {
        expect(seen.has(consecutive)).toBe(false);
        seen.add(consecutive);
      }
    }
  });
});

describe('oversized single invoice', () => {
  it('splits one invoice past the limit rather than emitting a rejected file', () => {
    const line = makeVoucher().lines[0]!;
    const rows = chunkSiigoRows(
      buildSiigoInvoiceRows([makeVoucher({ lines: Array.from({ length: 620 }, () => line) })])
    );
    expect(rows.length).toBe(2);
    expect(rows[0]!.length).toBe(SIIGO_MAX_ROWS_PER_FILE);
    expect(rows[1]!.length).toBe(120);
  });
});

describe('journal entries', () => {
  it('balances debits against credits for every sale', () => {
    const rows = buildJournalEntries([makeVoucher()]);
    const debit = rows.reduce((sum, row) => sum + row.debit, 0);
    const credit = rows.reduce((sum, row) => sum + row.credit, 0);
    expect(debit).toBeCloseTo(credit, 2);
    expect(debit).toBeCloseTo(127, 2);
  });

  it('posts one debit per tender and separate tax credits', () => {
    const rows = buildJournalEntries([makeVoucher()]);
    const accounts = rows.map(row => row.account);
    // cash + card debits, IVA + INC credits, income remainder.
    expect(accounts).toContain('110505');
    expect(accounts).toContain('111005');
    expect(accounts).toContain('240802');
    expect(accounts).toContain('246205');
    const income = rows.find(row => row.account === '413595');
    expect(income?.credit).toBeCloseTo(100, 2);
  });

  it('still balances with tips and a single implicit tender', () => {
    const rows = buildJournalEntries([
      makeVoucher({
        payments: [],
        tipAmount: 10,
        total: 137,
        ivaAmount: 19,
        incAmount: 8,
      }),
    ]);
    const debit = rows.reduce((sum, row) => sum + row.debit, 0);
    const credit = rows.reduce((sum, row) => sum + row.credit, 0);
    expect(debit).toBeCloseTo(credit, 2);
    expect(rows.find(row => row.account === '238095')?.credit).toBeCloseTo(10, 2);
  });

  it('balances a sale with a negative (refund) tender row', () => {
    const rows = buildJournalEntries([
      makeVoucher({
        payments: [
          { method: 'cash', amount: 150 },
          { method: 'cash', amount: -23 },
        ],
      }),
    ]);
    const debit = rows.reduce((sum, row) => sum + row.debit, 0);
    const credit = rows.reduce((sum, row) => sum + row.credit, 0);
    expect(debit).toBeCloseTo(credit, 2);
  });

  it('uses the consumidor final third party when the sale has no customer', () => {
    const rows = buildJournalEntries([
      makeVoucher({ customerTaxIdSnapshot: null, customerNameSnapshot: null }),
    ]);
    expect(rows[0]!.thirdPartyId).toBe('222222222222');
    expect(rows[0]!.thirdPartyName).toBe('Consumidor final');
  });
});

describe('per-site invoice identity', () => {
  it('detects two sites whose invoice numbers collapse to one consecutive', () => {
    // AGENTS.md mandates per-site prefixes because the numeric body is
    // only unique per site, and Siigo groups by Consecutivo — merging
    // them would fuse two invoices into one document. The export
    // refuses instead of guessing a branch code.
    const collisions = findSiigoConsecutiveCollisions([
      makeVoucher({ saleNumber: 'VTA-N-000123' }),
      makeVoucher({ saleNumber: 'VTA-S-000123' }),
    ]);
    expect(collisions).toEqual(['123']);
  });

  it('reports no collision for one site', () => {
    expect(
      findSiigoConsecutiveCollisions([
        makeVoucher({ saleNumber: 'VTA-N-000123' }),
        makeVoucher({ saleNumber: 'VTA-N-000124' }),
      ])
    ).toEqual([]);
  });

  it('never promotes prefix digits into the consecutive', () => {
    // A DIAN resolution prefix like FE1 would otherwise turn
    // FE1000123 into consecutive 1000123: the body is the LAST six
    // digits, never the whole trailing run.
    expect(siigoConsecutive('FE1000123')).toBe('123');
    expect(siigoConsecutive('VTA-N-000123')).toBe('123');
  });
});

describe('invoice-level amounts', () => {
  it('carries the header discount so the invoice total matches DIAN', () => {
    const rows = buildSiigoInvoiceRows([makeVoucher({ discountAmount: 20000 })]);
    // Header discount rides the FIRST line, once.
    expect(rows[0]!.cells[19]).toBe('20000');
    expect(rows[1]!.cells[19]).toBe('');
  });

  it('converts the frozen line discount percentage to a monetary amount', () => {
    const line = makeVoucher().lines[0]!;
    const rows = buildSiigoInvoiceRows([
      makeVoucher({
        discountAmount: 20,
        lines: [{ ...line, quantity: 2, unitPrice: 50, discount: 10 }],
      }),
    ]);
    // 10 percent of the 100 gross line + 20 header discount.
    expect(rows[0]!.cells[19]).toBe('30');
  });

  it('rounds the tender total instead of serializing float noise', () => {
    const rows = buildSiigoInvoiceRows([
      makeVoucher({
        payments: [
          { method: 'cash', amount: 33.33 },
          { method: 'cash', amount: 33.33 },
          { method: 'cash', amount: 33.34 },
        ],
        lines: [makeVoucher().lines[0]!],
      }),
    ]);
    expect(rows[0]!.cells[28]).toBe('100');
  });
});

describe('journal entries for partial and refunded sales', () => {
  it('posts the unpaid remainder as a receivable instead of shrinking income', () => {
    const rows = buildJournalEntries([makeVoucher({ payments: [{ method: 'cash', amount: 50 }] })]);
    const debit = rows.reduce((sum, row) => sum + row.debit, 0);
    const credit = rows.reduce((sum, row) => sum + row.credit, 0);
    expect(debit).toBeCloseTo(credit, 2);
    // Full invoice value is booked: 50 cash + 77 receivable.
    expect(rows.find(row => row.account === '130505')?.debit).toBeCloseTo(77, 2);
    expect(rows.find(row => row.account === '413595')?.credit).toBeCloseTo(100, 2);
  });

  it('offsets a refunded sale instead of declaring tax on returned money', () => {
    const rows = buildJournalEntries([makeVoucher({ refundAmount: 127 })]);
    const debit = rows.reduce((sum, row) => sum + row.debit, 0);
    const credit = rows.reduce((sum, row) => sum + row.credit, 0);
    expect(debit).toBeCloseTo(credit, 2);
    expect(rows.find(row => row.account === '417595')?.debit).toBeCloseTo(127, 2);
  });
});

describe('unconfirmed fiscal documents', () => {
  it('never cites a reserved-but-unemitted document in the Siigo observations', () => {
    // The consecutive is reserved at enqueue time with a placeholder
    // CUFE; the router nulls the CUFE until the adapter confirms.
    const rows = buildSiigoInvoiceRows([
      makeVoucher({ fiscalCufe: null, fiscalStatus: 'pending' }),
    ]);
    expect(rows[0]!.cells[30]).toBe('VTA-N-000123');
    expect(rows[0]!.cells[30]).not.toContain('Doc ');
  });

  it('exports the emission status so an unconfirmed sale is visible', () => {
    const rows = buildGenericVoucherRows([
      makeVoucher({ fiscalCufe: null, fiscalStatus: 'contingency' }),
    ]);
    expect(rows[0]!.fiscalCufe).toBe('');
    expect(rows[0]!.fiscalStatus).toBe('contingency');
  });
});

describe('generic voucher rows', () => {
  it('flattens each line with its own tax kind and the sale totals', () => {
    const rows = buildGenericVoucherRows([makeVoucher()]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.taxKind).toBe('iva');
    expect(rows[1]!.taxKind).toBe('inc');
    expect(rows[0]!.saleIva).toBe(19);
    expect(rows[0]!.saleInc).toBe(8);
    expect(rows[0]!.paymentMethods).toBe('cash:100 | card:27');
    expect(rows[0]!.fiscalDocument).toBe('SETP-990000001');
  });
});
