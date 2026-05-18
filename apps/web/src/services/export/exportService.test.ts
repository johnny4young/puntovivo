import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  exportToExcel,
  exportToPDF,
  generateFilename,
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
    vi.spyOn(document.body, 'appendChild').mockImplementation(
      node => node
    );
    vi.spyOn(document.body, 'removeChild').mockImplementation(
      node => node
    );
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
    expect(generateFilename('Sales-HISTORY', 'csv', false)).toBe(
      'sales-history.csv'
    );
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
    const columns: ExportColumn<{ number: string }>[] = [
      { key: 'number', header: 'Number' },
    ];

    await exportToPDF([{ number: 'COT-000001' }], columns, 'quotations-history', {
      title: 'Export quotations',
      includeTimestamp: false,
    });

    expect(autoTableSpy).toHaveBeenCalledTimes(1);
    expect(docSaveSpy).toHaveBeenCalledWith('quotations-history.pdf');
  });

  it('exports Excel through the browser-only exceljs bundle', async () => {
    const columns: ExportColumn<{ number: string }>[] = [
      { key: 'number', header: 'Number' },
    ];

    await exportToExcel([{ number: 'COT-000001' }], columns, 'quotations-history', {
      includeTimestamp: false,
    });

    expect(writeBufferSpy).toHaveBeenCalledTimes(1);
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
  });
});
