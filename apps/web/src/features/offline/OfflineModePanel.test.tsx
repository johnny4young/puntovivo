/**
 * ENG-088 — OfflineModePanel rendering smoke.
 *
 * Pins the visibility gate (`visible=false` returns null) and
 * confirms the panel composes the capability grid + sync queue
 * list when shown. Detailed sync-queue behavior is covered in
 * `OfflineSyncQueueList.test.tsx`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from '@/i18n';
import { render, screen } from '@/test/utils';
import { OfflineModePanel } from './OfflineModePanel';

// Mock the children so this suite focuses on composition, not the
// inner contracts (those are pinned by their own test files).
vi.mock('./OfflineCapabilityGrid', () => ({
  OfflineCapabilityGrid: ({ visible }: { visible: boolean }) =>
    visible ? <div data-testid="offline-capability-grid-stub" /> : null,
}));
vi.mock('./OfflineSyncQueueList', () => ({
  OfflineSyncQueueList: () => <div data-testid="offline-sync-queue-list-stub" />,
}));

describe('OfflineModePanel (ENG-088)', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
  });

  it('renders nothing when visible=false', () => {
    const { container } = render(<OfflineModePanel visible={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the reassurance copy + capability grid + sync queue when visible=true', () => {
    render(<OfflineModePanel visible={true} />);
    expect(screen.getByTestId('offline-mode-panel')).toBeInTheDocument();
    expect(screen.getByTestId('offline-mode-reassurance')).toHaveTextContent(/keep selling/i);
    expect(screen.getByTestId('offline-capability-grid-stub')).toBeInTheDocument();
    expect(screen.getByTestId('offline-sync-queue-list-stub')).toBeInTheDocument();
  });

  it('uses neutral LATAM tu Spanish reassurance copy on es locale flip', async () => {
    await i18next.changeLanguage('es');
    render(<OfflineModePanel visible={true} />);
    expect(screen.getByTestId('offline-mode-reassurance')).toHaveTextContent(/sigue vendiendo/i);
  });
});
