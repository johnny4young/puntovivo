import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/services/export/exportService', () => ({
  exportToCSV: vi.fn(),
  exportToExcel: vi.fn().mockResolvedValue(undefined),
  exportToPDF: vi.fn().mockResolvedValue(undefined),
  printTable: vi.fn(),
}));

import {
  exportToCSV,
  exportToExcel,
  exportToPDF,
  printTable,
} from '@/services/export/exportService';
import { useTableExport } from './useTableExport';

interface Row {
  id: string;
  name: string;
}

const columns = [
  { key: 'id', header: 'ID' },
  { key: 'name', header: 'Name' },
  { key: 'extra', header: 'Extra' },
];

const sample: Row[] = [
  { id: '1', name: 'A' },
  { id: '2', name: 'B' },
];

beforeEach(() => {
  vi.mocked(exportToCSV).mockReset();
  vi.mocked(exportToExcel).mockReset().mockResolvedValue(undefined);
  vi.mocked(exportToPDF).mockReset().mockResolvedValue(undefined);
  vi.mocked(printTable).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useTableExport — visibility defaults', () => {
  it('starts with every column visible when initialVisibleColumns is omitted', () => {
    const { result } = renderHook(() =>
      useTableExport<Row>({ columns, filename: 'rows' })
    );
    expect(result.current.visibleColumns).toEqual(new Set(['id', 'name', 'extra']));
  });

  it('honours initialVisibleColumns when provided', () => {
    const { result } = renderHook(() =>
      useTableExport<Row>({
        columns,
        initialVisibleColumns: ['id'],
      })
    );
    expect(result.current.visibleColumns).toEqual(new Set(['id']));
    expect(result.current.isColumnVisible('id')).toBe(true);
    expect(result.current.isColumnVisible('extra')).toBe(false);
  });
});

describe('useTableExport — visibility mutations', () => {
  it('toggleColumnVisibility adds, then removes; refuses to hide the last visible column', () => {
    const { result } = renderHook(() =>
      useTableExport<Row>({
        columns,
        initialVisibleColumns: ['id'],
      })
    );
    act(() => result.current.toggleColumnVisibility('name'));
    expect(result.current.visibleColumns).toEqual(new Set(['id', 'name']));
    act(() => result.current.toggleColumnVisibility('name'));
    expect(result.current.visibleColumns).toEqual(new Set(['id']));
    // Trying to hide the only remaining column is a no-op (invariant: ≥1 column visible).
    act(() => result.current.toggleColumnVisibility('id'));
    expect(result.current.visibleColumns).toEqual(new Set(['id']));
  });

  it('setColumnsVisibility(visible=true) adds; (visible=false) removes but ensures ≥1 column visible', () => {
    const { result } = renderHook(() =>
      useTableExport<Row>({ columns })
    );
    act(() => result.current.setColumnsVisibility(['id', 'name'], false));
    expect(result.current.visibleColumns).toEqual(new Set(['extra']));
    act(() => result.current.setColumnsVisibility(['id'], true));
    expect(result.current.visibleColumns).toEqual(new Set(['extra', 'id']));
    // Trying to hide all remaining columns at once promotes the first column.
    act(() => result.current.setColumnsVisibility(['extra', 'id'], false));
    expect(result.current.visibleColumns).toEqual(new Set(['id']));
  });

  it('showAllColumns / hideAllColumns flip to {all} / {first} respectively', () => {
    const { result } = renderHook(() =>
      useTableExport<Row>({ columns })
    );
    act(() => result.current.hideAllColumns());
    expect(result.current.visibleColumns).toEqual(new Set(['id']));
    act(() => result.current.showAllColumns());
    expect(result.current.visibleColumns).toEqual(new Set(['id', 'name', 'extra']));
  });

  it('getVisibleColumns returns only the visible ExportColumn entries (in source order)', () => {
    const { result } = renderHook(() =>
      useTableExport<Row>({
        columns,
        initialVisibleColumns: ['extra', 'id'],
      })
    );
    expect(result.current.getVisibleColumns().map(c => c.key)).toEqual([
      'id',
      'extra',
    ]);
  });
});

describe('useTableExport — export handlers per format', () => {
  it('handleExportCSV invokes exportToCSV with visible columns + filename + options; clears state in finally', () => {
    const { result } = renderHook(() =>
      useTableExport<Row>({
        columns,
        filename: 'rows',
        title: 'Rows Report',
      })
    );
    act(() => result.current.handleExportCSV(sample));
    expect(exportToCSV).toHaveBeenCalledOnce();
    const args = vi.mocked(exportToCSV).mock.calls[0]!;
    expect(args[0]).toEqual(sample);
    expect(args[1].map((c: { key: string }) => c.key)).toEqual([
      'id',
      'name',
      'extra',
    ]);
    expect(args[2]).toBe('rows');
    expect(args[3]).toEqual({ title: 'Rows Report', includeTimestamp: true });
    // Synchronous handler — state should already have flipped back.
    expect(result.current.isExporting).toBe(false);
    expect(result.current.exportFormat).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('handleExportExcel awaits exportToExcel and clears state on success', async () => {
    const { result } = renderHook(() =>
      useTableExport<Row>({ columns })
    );
    await act(async () => {
      await result.current.handleExportExcel(sample);
    });
    expect(exportToExcel).toHaveBeenCalledOnce();
    expect(result.current.isExporting).toBe(false);
    expect(result.current.exportFormat).toBeNull();
  });

  it('handleExportPDF awaits exportToPDF and clears state on success', async () => {
    const { result } = renderHook(() =>
      useTableExport<Row>({ columns })
    );
    await act(async () => {
      await result.current.handleExportPDF(sample);
    });
    expect(exportToPDF).toHaveBeenCalledOnce();
    expect(result.current.isExporting).toBe(false);
  });

  it('handleExport dispatches per format', async () => {
    const { result } = renderHook(() =>
      useTableExport<Row>({ columns })
    );
    await act(async () => {
      await result.current.handleExport(sample, 'csv');
    });
    await act(async () => {
      await result.current.handleExport(sample, 'excel');
    });
    await act(async () => {
      await result.current.handleExport(sample, 'pdf');
    });
    expect(exportToCSV).toHaveBeenCalledOnce();
    expect(exportToExcel).toHaveBeenCalledOnce();
    expect(exportToPDF).toHaveBeenCalledOnce();
  });

  it('handleExport sets an error for an unknown format', async () => {
    const { result } = renderHook(() =>
      useTableExport<Row>({ columns })
    );
    await act(async () => {
      await result.current.handleExport(sample, 'xml' as unknown as 'csv');
    });
    await waitFor(() => {
      expect(result.current.error).toContain('Unknown export format');
    });
  });

  it('handlePrint invokes printTable with the visible columns', () => {
    const { result } = renderHook(() =>
      useTableExport<Row>({ columns, title: 'Report' })
    );
    act(() => result.current.handlePrint(sample));
    expect(printTable).toHaveBeenCalledOnce();
  });
});

describe('useTableExport — error handling', () => {
  it('captures Error.message when exportToCSV throws', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(exportToCSV).mockImplementationOnce(() => {
      throw new Error('boom csv');
    });
    const { result } = renderHook(() =>
      useTableExport<Row>({ columns })
    );
    act(() => result.current.handleExportCSV(sample));
    expect(result.current.error).toBe('boom csv');
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('captures fallback message when exportToExcel rejects with a non-Error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(exportToExcel).mockRejectedValueOnce('non-error rejection');
    const { result } = renderHook(() =>
      useTableExport<Row>({ columns })
    );
    await act(async () => {
      await result.current.handleExportExcel(sample);
    });
    expect(result.current.error).toBe('Failed to export Excel');
  });

  it('captures fallback message when exportToPDF rejects with a non-Error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(exportToPDF).mockRejectedValueOnce('non-error rejection');
    const { result } = renderHook(() =>
      useTableExport<Row>({ columns })
    );
    await act(async () => {
      await result.current.handleExportPDF(sample);
    });
    expect(result.current.error).toBe('Failed to export PDF');
  });

  it('captures the message when printTable throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(printTable).mockImplementationOnce(() => {
      throw new Error('print broken');
    });
    const { result } = renderHook(() =>
      useTableExport<Row>({ columns })
    );
    act(() => result.current.handlePrint(sample));
    expect(result.current.error).toBe('print broken');
  });

  it('clearError resets the error to null', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(exportToCSV).mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const { result } = renderHook(() =>
      useTableExport<Row>({ columns })
    );
    act(() => result.current.handleExportCSV(sample));
    expect(result.current.error).toBe('boom');
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});
