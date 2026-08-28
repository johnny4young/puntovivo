import JSZip from 'jszip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportColumn } from '@/services/export/exportService';

const { downloadFileMock, exportToCSVMock } = vi.hoisted(() => ({
  downloadFileMock: vi.fn(),
  exportToCSVMock: vi.fn(),
}));

vi.mock('@/services/export/exportService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/export/exportService')>();
  return {
    ...actual,
    downloadFile: downloadFileMock,
    exportToCSV: exportToCSVMock,
  };
});

import type { SiigoRow } from './accountingExportFormats';
import { exportSiigoChunks } from './accountingSiigoExport';

const columns: ExportColumn<SiigoRow>[] = [
  {
    key: 'cells.0',
    header: 'Consecutivo',
    formatter: (_value, row) => row.cells[0] ?? '',
  },
];

beforeEach(() => {
  downloadFileMock.mockReset();
  exportToCSVMock.mockReset();
});

describe('exportSiigoChunks', () => {
  it('keeps a one-part export as one CSV download', async () => {
    const result = await exportSiigoChunks([[{ cells: ['1'] }]], columns, 'siigo-periodo');

    expect(result).toEqual({
      fileCount: 1,
      downloadedAsZip: false,
      filename: 'siigo-periodo.csv',
    });
    expect(exportToCSVMock).toHaveBeenCalledOnce();
    expect(downloadFileMock).not.toHaveBeenCalled();
  });

  it('creates one ZIP with every capped CSV part instead of multiple browser downloads', async () => {
    const result = await exportSiigoChunks(
      [[{ cells: ['1'] }], [{ cells: ['2'] }], [{ cells: ['3'] }]],
      columns,
      'siigo-periodo'
    );

    expect(result).toEqual({
      fileCount: 3,
      downloadedAsZip: true,
      filename: 'siigo-periodo.zip',
    });
    expect(downloadFileMock).toHaveBeenCalledOnce();
    expect(exportToCSVMock).not.toHaveBeenCalled();
    const [blob, filename] = downloadFileMock.mock.calls[0] as [Blob, string];
    expect(filename).toBe('siigo-periodo.zip');
    const archive = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(Object.keys(archive.files).sort()).toEqual([
      'siigo-periodo-parte-1.csv',
      'siigo-periodo-parte-2.csv',
      'siigo-periodo-parte-3.csv',
    ]);
    await expect(archive.file('siigo-periodo-parte-2.csv')!.async('string')).resolves.toContain(
      '"2"'
    );
  });

  it('produces no download for an empty period', async () => {
    await expect(exportSiigoChunks([], columns, 'siigo-periodo')).resolves.toEqual({
      fileCount: 0,
      downloadedAsZip: false,
      filename: null,
    });
    expect(downloadFileMock).not.toHaveBeenCalled();
    expect(exportToCSVMock).not.toHaveBeenCalled();
  });
});
