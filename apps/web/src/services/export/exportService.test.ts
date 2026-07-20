import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSemanticFilename,
  exportToExcel,
  exportToPDF,
  generateFilename,
  mimeTypeForExtension,
  MIME_BY_EXT,
  type ExportColumn,
} from './exportService';

const autoTableSpy = vi.fn();
const docSaveSpy = vi.fn();
const writeBufferSpy = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer);
const anchorClickSpy = vi.fn();
const createObjectURLSpy = vi.fn(() => 'blob:mock-export');
const revokeObjectURLSpy = vi.fn();

vi.mock('jspdf', () => ({
  default: class MockJsPdf {
    static API = {};
    internal = {
      pageSize: {
        width: 210,
        height: 297,
      },
    };

    setFontSize() {}

    setFont() {}

    setTextColor() {}

    text() {}

    getNumberOfPages() {
      return 1;
    }

    save(filename: string) {
      docSaveSpy(filename);
    }
  },
}));

vi.mock('jspdf-autotable', () => ({
  autoTable: autoTableSpy,
}));

vi.mock('exceljs/dist/exceljs.bare.min.js', () => ({
  default: {
    Workbook: class MockWorkbook {
      addWorksheet() {
        return {
          mergeCells() {},
          getCell() {
            return {
              value: null,
              font: {},
              alignment: {},
            };
          },
          getRow() {
            return {
              getCell() {
                return {
                  value: null,
                  font: {},
                  fill: {},
                };
              },
            };
          },
          columns: [],
        };
      }

      xlsx = {
        writeBuffer: writeBufferSpy,
      };
    },
  },
}));

describe('generateFilename', () => {
  beforeEach(() => {
    const originalCreateElement = document.createElement.bind(document);
    vi.useFakeTimers();
    // Freeze time to a deterministic, padded-digit ISO so the slice(0, 19)
    // stability doesn't depend on the wall clock.
    vi.setSystemTime(new Date('2026-04-18T03:23:57.123Z'));
    autoTableSpy.mockReset();
    docSaveSpy.mockReset();
    writeBufferSpy.mockClear();
    anchorClickSpy.mockClear();
    createObjectURLSpy.mockClear();
    revokeObjectURLSpy.mockClear();
    vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURLSpy);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURLSpy);
    vi.spyOn(document, 'createElement').mockImplementation(tagName => {
      if (tagName === 'a') {
        return {
          href: '',
          download: '',
          rel: '',
          click: anchorClickSpy,
        } as unknown as HTMLAnchorElement;
      }
      return originalCreateElement(tagName);
    });
    vi.spyOn(document.body, 'appendChild').mockImplementation(node => node);
    vi.spyOn(document.body, 'removeChild').mockImplementation(node => node);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('appends the extension exactly once with a timestamped base', () => {
    const name = generateFilename('sales-history', 'csv');
    expect(name).toBe('sales-history_2026-04-18T03-23-57.csv');
    expect(name).toMatch(/\.csv$/);
    // Exactly one dot — the one before the extension.
    expect(name.split('.')).toHaveLength(2);
  });

  it('omits the timestamp when includeTimestamp is false but keeps the extension', () => {
    const name = generateFilename('sales-history', 'csv', false);
    expect(name).toBe('sales-history.csv');
  });

  it('applies the extension regardless of punctuation in the base name', () => {
    // The sanitizer swaps punctuation for `-`; the dot in
    // `v1.2` must NOT collide with the extension separator.
    expect(generateFilename('app.v1.2/report', 'xlsx')).toBe(
      'app-v1-2-report_2026-04-18T03-23-57.xlsx'
    );
    // One dot in the result — the extension.
    const parts = generateFilename('a.b.c', 'pdf').split('.');
    expect(parts).toHaveLength(2);
    expect(parts[1]).toBe('pdf');
  });

  it('lowercases the base name for cross-filesystem portability', () => {
    expect(generateFilename('Sales-HISTORY', 'csv', false)).toBe('sales-history.csv');
  });

  it('normalizes accents so customer-facing filenames stay readable', () => {
    expect(generateFilename('Cuenta corriente José Pérez', 'csv', false)).toBe(
      'cuenta-corriente-jose-perez.csv'
    );
  });

  it('works for every export format the service emits', () => {
    expect(generateFilename('x', 'csv', false)).toBe('x.csv');
    expect(generateFilename('x', 'xlsx', false)).toBe('x.xlsx');
    expect(generateFilename('x', 'pdf', false)).toBe('x.pdf');
  });

  it('replaces the full ISO time, stripping every colon and dot', () => {
    // `.slice(0, 19)` must land BEFORE the milliseconds so the timestamp
    // never leaks an extra dot into the filename.
    const name = generateFilename('x', 'csv');
    const [stem] = name.split('.');
    expect(stem).not.toContain(':');
    // The timestamp suffix has hyphens instead of colons/dots.
    expect(stem).toContain('2026-04-18T03-23-57');
  });

  it('exports PDF through jspdf-autotable v5 named function', async () => {
    const columns: ExportColumn<{ number: string }>[] = [{ key: 'number', header: 'Number' }];

    await exportToPDF([{ number: 'COT-000001' }], columns, 'quotations-history', {
      title: 'Export quotations',
      includeTimestamp: false,
    });

    expect(autoTableSpy).toHaveBeenCalledTimes(1);
    expect(docSaveSpy).toHaveBeenCalledWith('quotations-history.pdf');
  });

  it('exports Excel through the browser-only exceljs bundle', async () => {
    const columns: ExportColumn<{ number: string }>[] = [{ key: 'number', header: 'Number' }];

    await exportToExcel([{ number: 'COT-000001' }], columns, 'quotations-history', {
      includeTimestamp: false,
    });

    expect(writeBufferSpy).toHaveBeenCalledTimes(1);
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
  });
});

// Audit-grade export and download contract.
describe('buildSemanticFilename', () => {
  it('builds statement filenames with the canonical pattern', () => {
    const filename = buildSemanticFilename(
      {
        kind: 'statement',
        provider: 'wompi',
        from: '2026-05-01',
        to: '2026-05-31',
      },
      'csv'
    );
    // Pattern: statement-<provider>-<from>_<to>.<ext>
    expect(filename).toMatch(/^statement-wompi-2026-05-01-2026-05-31\.csv$/);
  });

  it('encodes the customer + tax id segment for ledger statements', () => {
    const filename = buildSemanticFilename(
      {
        kind: 'ledger',
        customer: 'Juán Pérez',
        taxId: '900654321',
        date: '2026-05-20',
      },
      'csv'
    );
    // Accents normalize and the tax id rides as a discriminator.
    expect(filename).toBe('ledger-estadocuenta-juan-perez-900654321-2026-05-20.csv');
  });

  it('keeps the ledger filename clean when no tax id is provided', () => {
    const filename = buildSemanticFilename(
      {
        kind: 'ledger',
        customer: 'Anonymous customer',
        taxId: null,
        date: '2026-05-20',
      },
      'csv'
    );
    expect(filename).toBe('ledger-estadocuenta-anonymous-customer-2026-05-20.csv');
  });

  it('builds fiscal filenames anchored on country + document number', () => {
    expect(
      buildSemanticFilename({ kind: 'fiscal', country: 'mx', documentNumber: 'F0000000042' }, 'xml')
    ).toBe('cfdi-mx-f0000000042.xml');
  });

  it('builds diagnostic filenames for the operations export', () => {
    expect(
      buildSemanticFilename(
        {
          kind: 'diagnostic',
          tenant: 'acme-store',
          timestamp: '20260520-123456',
        },
        'zip'
      )
    ).toBe('puntovivo-diagnostic-acme-store-20260520-123456.zip');
  });

  it('rejects unsupported extensions before constructing the filename', () => {
    expect(() =>
      buildSemanticFilename(
        { kind: 'report', name: 'sales-history', date: '2026-05-20' },
        'docx' as unknown as 'csv'
      )
    ).toThrow(/Unsupported export extension/);
  });
});

describe('MIME_BY_EXT registry', () => {
  it('maps every supported extension to a Blob-ready MIME type', () => {
    // The registry is the only source of truth; treat each entry as a
    // contract pin so adding an extension never silently downgrades to
    // application/octet-stream.
    expect(MIME_BY_EXT.csv).toBe('text/csv;charset=utf-8');
    expect(MIME_BY_EXT.xml).toBe('application/xml;charset=utf-8');
    expect(MIME_BY_EXT.xlsx).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(MIME_BY_EXT.pdf).toBe('application/pdf');
    expect(MIME_BY_EXT.zip).toBe('application/zip');
  });

  it('throws on unknown extensions via mimeTypeForExtension', () => {
    expect(() => mimeTypeForExtension('docx')).toThrow(/Unsupported export extension/);
  });

  it('normalises leading dots + casing in mimeTypeForExtension', () => {
    expect(mimeTypeForExtension('.CSV')).toBe('text/csv;charset=utf-8');
    expect(mimeTypeForExtension('Xml')).toBe('application/xml;charset=utf-8');
  });
});
