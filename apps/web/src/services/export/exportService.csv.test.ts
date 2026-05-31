import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportService, exportToCSV, printTable, type ExportColumn } from './exportService';

interface Row {
  id: string;
  name: string;
  qty: number;
  active: boolean;
  tags: string[] | null;
  meta: { code: string };
}

const sample: Row[] = [
  {
    id: '1',
    name: 'Café "premium"',
    qty: 2.5,
    active: true,
    tags: ['a', 'b'],
    meta: { code: 'CAF' },
  },
  {
    id: '2',
    name: 'Pan con <coma>',
    qty: 0,
    active: false,
    tags: null,
    meta: { code: 'PAN' },
  },
];

const columns: ExportColumn<Row>[] = [
  { key: 'id', header: 'ID' },
  {
    key: 'name',
    header: 'Item "label"',
    formatter: value => `>>${value}<<`,
  },
  { key: 'qty', header: 'Qty' },
  { key: 'active', header: 'Active' },
  { key: 'tags', header: 'Tags' },
  { key: 'meta.code', header: 'Code' },
];

let createdUrl: string | null = null;
let revokedUrl: string | null = null;
let clickedDownloadName: string | null = null;

beforeEach(() => {
  createdUrl = null;
  revokedUrl = null;
  clickedDownloadName = null;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((src: Blob | MediaSource) => {
    const blob = src as Blob;
    createdUrl = `blob:mock/${blob.size}`;
    return createdUrl;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(url => {
    revokedUrl = url;
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    clickedDownloadName = this.download;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('exportToCSV', () => {
  it('creates a Blob with text/csv mime and a BOM-prefixed body', async () => {
    let captured: Blob | null = null;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((src: Blob | MediaSource) => {
      const blob = src as Blob;
      captured = blob;
      return 'blob:csv';
    });

    exportToCSV(sample, columns, 'rows', { includeTimestamp: false });

    expect(captured).not.toBeNull();
    expect(captured!.type).toBe('text/csv;charset=utf-8;');
    // Read raw bytes (so the BOM is observable — TextDecoder strips it by
    // default when invoked via Blob.text()).
    const buf = await captured!.arrayBuffer();
    const bytes = new Uint8Array(buf);
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    // Header row escapes embedded double quotes by doubling them.
    expect(text).toContain('"Item ""label"""');
    // Formatter prepends `>>` and appends `<<`; CSV escaping wraps the
    // result in additional quotes and doubles the inner quotes.
    expect(text).toContain('">>Café ""premium""<<"');
    // Nested key meta.code resolves to CAF / PAN.
    expect(text).toContain('"CAF"');
    expect(text).toContain('"PAN"');
    // Boolean formats as Yes / No.
    expect(text).toContain('"Yes"');
    expect(text).toContain('"No"');
    // Array fallback hits JSON.stringify (and gets every quote doubled).
    expect(text).toContain('"[""a"",""b""]"');
    // null tags resolves to empty cell.
    expect(text).toMatch(/,""[\n,]/);
    // Number with no formatter renders via String(value).
    expect(text).toContain('"2.5"');
    expect(text).toContain('"0"');
  });

  it('appends an anchor with the correct download filename and revokes the URL after a grace period', async () => {
    vi.useFakeTimers();
    exportToCSV(sample, columns, 'My Rows!', { includeTimestamp: false });
    expect(clickedDownloadName).toBe('my-rows.csv');
    expect(revokedUrl).toBeNull();
    await vi.advanceTimersByTimeAsync(999);
    expect(revokedUrl).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(revokedUrl).toBe(createdUrl);
  });

  it('handles an empty data set without crashing — emits header-only CSV', async () => {
    let captured: Blob | null = null;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((src: Blob | MediaSource) => {
      const blob = src as Blob;
      captured = blob;
      return 'blob:csv';
    });
    exportToCSV([] as Row[], columns, 'empty', { includeTimestamp: false });
    expect(captured).not.toBeNull();
    const text = await captured!.text();
    // Header row only — strip the leading BOM and split on newlines.
    expect(text.replace(/\uFEFF/, '').split('\n')).toHaveLength(1);
  });
});

describe('printTable', () => {
  it('opens a print window and writes the rendered HTML with title + headers + rows', () => {
    const writeSpy = vi.fn();
    const closeSpy = vi.fn();
    const fakeWindow = {
      document: { write: writeSpy, close: closeSpy },
    } as unknown as Window;
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWindow);

    printTable(sample, columns, { title: 'Rows <Report> "A"' });

    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    expect(writeSpy).toHaveBeenCalledOnce();
    const html = writeSpy.mock.calls[0]![0] as string;
    // Title is HTML-escaped in both the document title and visible header.
    expect(html).toContain('<title>Rows &lt;Report&gt; &quot;A&quot;</title>');
    expect(html).toContain('Rows &lt;Report&gt; &quot;A&quot;');
    // Header escapes the embedded double quotes.
    expect(html).toContain('Item &quot;label&quot;');
    // Data rows include the formatter output and the nested-key value.
    expect(html).toContain('&gt;&gt;Café &quot;premium&quot;&lt;&lt;');
    expect(html).toContain('CAF');
    // Boolean → Yes / No.
    expect(html).toContain('>Yes<');
    expect(html).toContain('>No<');
    // Total Records footer reflects the data length.
    expect(html).toContain('Total Records: 2');
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it('logs a friendly error when the popup blocker returns null', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(window, 'open').mockReturnValue(null);
    printTable(sample, columns);
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to open print window. Please allow popups for this site.'
    );
  });

  it('omits the title block when no title is supplied (raw header pipeline)', () => {
    const writeSpy = vi.fn();
    const fakeWindow = {
      document: { write: writeSpy, close: vi.fn() },
    } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(fakeWindow);
    printTable(sample, columns);
    const html = writeSpy.mock.calls[0]![0] as string;
    expect(html).toContain('<title>Print</title>');
    expect(html).not.toContain('class="title"');
  });
});

describe('exportService default object', () => {
  it('binds all four exporters', () => {
    expect(exportService.exportToCSV).toBe(exportToCSV);
    expect(typeof exportService.exportToExcel).toBe('function');
    expect(typeof exportService.exportToPDF).toBe('function');
    expect(exportService.printTable).toBe(printTable);
  });
});
