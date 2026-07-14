import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@/test/utils';
import { SupportSnapshotPanel } from './SupportSnapshotPanel';
import type { SupportSnapshotSource } from './supportSnapshot';

const { downloadFile, toastError, toastSuccess, writeText } = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  writeText: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/export/exportService', () => ({ downloadFile }));
vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

const source: SupportSnapshotSource = {
  runtime: { kind: 'web', currentVersion: null, updateState: 'unavailable' },
  modules: { diagnostics: true, fiscal: false },
  devices: [{ healthStatus: 'online', appVersion: '1.5.1' }],
  telemetryEnabled: true,
};

describe('SupportSnapshotPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(new Date('2026-07-13T23:45:12.345Z'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('copies and downloads the same portable snapshot shape', async () => {
    render(<SupportSnapshotPanel source={source} disabled={false} />);

    fireEvent.click(screen.getByTestId('support-snapshot-copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = JSON.parse(writeText.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(copied).toMatchObject({
      schemaVersion: 1,
      generatedAt: '2026-07-13T23:45:12.345Z',
      modules: { active: 1, total: 2 },
      devices: { active: 1, online: 1, stale: 0, revoked: 0 },
    });

    fireEvent.click(screen.getByTestId('support-snapshot-download'));
    expect(downloadFile).toHaveBeenCalledWith(
      expect.any(Blob),
      'puntovivo-support-snapshot-20260713T234512Z.json'
    );
    expect(toastSuccess).toHaveBeenCalledTimes(2);
  });

  it('disables sharing when the source signals are incomplete', () => {
    render(<SupportSnapshotPanel source={source} disabled />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Wait for all support signals before sharing.'
    );
    expect(screen.getByTestId('support-snapshot-copy')).toBeDisabled();
    expect(screen.getByTestId('support-snapshot-download')).toBeDisabled();
  });

  it('fails closed when clipboard access is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    render(<SupportSnapshotPanel source={source} disabled={false} />);

    fireEvent.click(screen.getByTestId('support-snapshot-copy'));

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
