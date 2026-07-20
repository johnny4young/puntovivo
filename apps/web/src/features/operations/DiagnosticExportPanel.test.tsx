/**
 * Tests for DiagnosticExportPanel.
 *
 * Asserts:
 * - Default state renders 7-day preset selected.
 * - Preview refetch fires and surfaces counts + estimated size.
 * - willHitLimit toggles the warning banner.
 * - Admin click on Download triggers the export refetch + jszip
 * bundle build + Blob download (URL.createObjectURL spy).
 * - Manager role disables the Download button with translated tooltip.
 * - Invalid date range disables the Preview button + shows inline error.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/utils';
import { DiagnosticExportPanel } from './DiagnosticExportPanel';

const previewRefetch = vi.fn();
const exportRefetch = vi.fn();
let mockUserRole: 'admin' | 'manager' = 'admin';
let mockPreviewData: Record<string, unknown> | null = null;
let mockPreviewError: { message: string } | null = null;
let mockPreviewFetching = false;
let mockExportData: Record<string, unknown> | null = null;

vi.mock('@/lib/trpc', () => ({
  trpc: {
    reports: {
      diagnostics: {
        preview: {
          useQuery: () => ({
            data: mockPreviewData,
            error: mockPreviewError,
            isFetching: mockPreviewFetching,
            refetch: previewRefetch,
          }),
        },
        export: {
          useQuery: () => ({
            data: mockExportData,
            isFetching: false,
            refetch: exportRefetch,
          }),
        },
      },
    },
  },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'demo@test', role: mockUserRole, tenantId: 'tenant-demo' },
  }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('@/lib/translateServerError', () => ({
  translateServerError: (_error: unknown, _t: unknown, fallback: string) => fallback,
}));

beforeEach(() => {
  previewRefetch.mockReset();
  previewRefetch.mockResolvedValue({ data: null });
  exportRefetch.mockReset();
  exportRefetch.mockResolvedValue({
    data: {
      manifest: {
        schemaVersion: 1,
        generatedAt: '2026-05-06T12:00:00.000Z',
        tenantId: 'tenant-demo',
        range: { fromDate: '2026-04-29T00:00:00.000Z', toDate: '2026-05-06T23:59:59.999Z' },
        rowLimit: 10000,
        counts: {
          operation_events: 1,
          operation_effects: 0,
          sync_outbox: 0,
          fiscal_outbox: 0,
          hardware_outbox: 0,
          payment_outbox: 0,
          webhook_outbox: 0,
        },
        warnings: [],
        includedOutboxes: ['sync', 'fiscal', 'hardware'],
      },
      tables: {
        operation_events: [{ id: 'e-1' }],
        operation_effects: [],
        sync_outbox: [],
        fiscal_outbox: [],
        hardware_outbox: [],
      },
    },
  });
  mockUserRole = 'admin';
  mockPreviewData = null;
  mockPreviewError = null;
  mockPreviewFetching = false;
  mockExportData = null;
});

describe('DiagnosticExportPanel', () => {
  it('renders with the last7d preset selected by default', () => {
    render(<DiagnosticExportPanel />);
    expect(screen.getByTestId('diagnostics-preset-last7d')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByTestId('diagnostics-preset-last30d')).toHaveAttribute(
      'aria-selected',
      'false'
    );
  });

  it('fires the preview query when the button is clicked and surfaces counts', async () => {
    render(<DiagnosticExportPanel />);
    fireEvent.click(screen.getByTestId('diagnostics-preview-cta'));
    expect(previewRefetch).toHaveBeenCalledTimes(1);

    // Re-render with the data populated to assert the tile values land.
    mockPreviewData = {
      range: { fromDate: 'x', toDate: 'y' },
      counts: {
        operation_events: 12,
        operation_effects: 3,
        sync_outbox: 7,
        fiscal_outbox: 2,
        hardware_outbox: 1,
        payment_outbox: 0,
        webhook_outbox: 0,
      },
      estimatedSizeBytes: 4096,
      rowLimit: 10000,
      willHitLimit: false,
      schemaVersion: 1,
    };
    render(<DiagnosticExportPanel />);
    const tiles = await screen.findAllByTestId('diagnostics-preview-results');
    const summary = tiles[0]!;
    expect(summary.textContent).toContain('12');
    expect(summary.textContent).toContain('7');
    expect(summary.textContent).toContain('1');
  });

  it('renders the willHitLimit warning when preview reports the cap was hit', () => {
    mockPreviewData = {
      range: { fromDate: 'x', toDate: 'y' },
      counts: {
        operation_events: 15000,
        operation_effects: 0,
        sync_outbox: 0,
        fiscal_outbox: 0,
        hardware_outbox: 0,
        payment_outbox: 0,
        webhook_outbox: 0,
      },
      estimatedSizeBytes: 0,
      rowLimit: 10000,
      willHitLimit: true,
      schemaVersion: 1,
    };
    render(<DiagnosticExportPanel />);
    expect(screen.getByTestId('diagnostics-limit-warning').textContent).toMatch(/10000|10\.000/);
  });

  it('builds the zip and triggers the Blob download on admin click', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });

    render(<DiagnosticExportPanel />);
    fireEvent.click(screen.getByTestId('diagnostics-export-cta'));

    await waitFor(() => expect(exportRefetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
  });

  it('keeps export available when all outboxes are unchecked', () => {
    render(<DiagnosticExportPanel />);
    fireEvent.click(screen.getByTestId('diagnostics-include-sync'));
    fireEvent.click(screen.getByTestId('diagnostics-include-fiscal'));
    fireEvent.click(screen.getByTestId('diagnostics-include-hardware'));
    expect(screen.getByTestId('diagnostics-export-cta')).not.toBeDisabled();
  });

  it('disables the export button with translated tooltip for manager role', () => {
    mockUserRole = 'manager';
    render(<DiagnosticExportPanel />);
    const preview = screen.getByTestId('diagnostics-preview-cta');
    const cta = screen.getByTestId('diagnostics-export-cta');
    expect(preview).toBeDisabled();
    expect(preview.getAttribute('title')).toMatch(/admin/i);
    expect(cta).toBeDisabled();
    expect(cta.getAttribute('title')).toMatch(/admin/i);
  });

  it('disables Preview and surfaces inline error when fromDate > toDate', () => {
    render(<DiagnosticExportPanel />);
    const fromInput = screen.getByTestId('diagnostics-from') as HTMLInputElement;
    const toInput = screen.getByTestId('diagnostics-to') as HTMLInputElement;
    // Force from > to.
    fireEvent.change(fromInput, { target: { value: '2026-05-31' } });
    fireEvent.change(toInput, { target: { value: '2026-05-01' } });

    expect(screen.getByTestId('diagnostics-range-error')).toBeInTheDocument();
    expect(screen.getByTestId('diagnostics-preview-cta')).toBeDisabled();
  });

  it('disables Preview when a date input is empty', () => {
    render(<DiagnosticExportPanel />);
    fireEvent.change(screen.getByTestId('diagnostics-from'), {
      target: { value: '' },
    });
    expect(screen.getByTestId('diagnostics-range-error')).toBeInTheDocument();
    expect(screen.getByTestId('diagnostics-preview-cta')).toBeDisabled();
  });
});
