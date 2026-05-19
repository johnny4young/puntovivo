import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OfflineStatusBanner } from '../OfflineStatusBanner';
import { useOfflineSync } from '@/hooks/useOfflineSync';

vi.mock('@/hooks/useOfflineSync', () => ({
  useOfflineSync: vi.fn(),
}));

// ENG-088 — the banner now calls useHubReachability() directly.
// The real hook schedules a setInterval which leaks across tests
// in jsdom; the suite never asserts hub-reachable behaviour so a
// neutral stub keeps the focus on the banner copy + retry CTA.
vi.mock('@/hooks/useHubReachability', () => ({
  useHubReachability: () => ({ reachable: null, lastChecked: null, lastError: null }),
}));

// ENG-088 — the banner now mounts OfflineModePanel below itself
// when offline / hub unreachable. The panel pulls from
// `trpc.sync.listQueue` which requires a tRPC provider that this
// suite does not wire up. Stub it so the banner-only behaviour
// stays the focus; the panel has its own dedicated test files.
vi.mock('@/features/offline/OfflineModePanel', () => ({
  OfflineModePanel: ({ visible }: { visible: boolean }) =>
    visible ? <div data-testid="offline-mode-panel-stub" /> : null,
}));

const mockUseOfflineSync = vi.mocked(useOfflineSync);

describe('OfflineStatusBanner', () => {
  it('does not render when the app is online and fully synced', () => {
    mockUseOfflineSync.mockReturnValue({
      isOnline: true,
      lastSync: null,
      pendingItems: 0,
      conflicts: 0,
      isSyncing: false,
      error: null,
      triggerSync: vi.fn(),
      refreshStatus: vi.fn(),
    });

    const { container } = render(<OfflineStatusBanner />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders an offline warning when connectivity is lost', () => {
    mockUseOfflineSync.mockReturnValue({
      isOnline: false,
      lastSync: null,
      pendingItems: 2,
      conflicts: 0,
      isSyncing: false,
      error: null,
      triggerSync: vi.fn(),
      refreshStatus: vi.fn(),
    });

    render(<OfflineStatusBanner />);

    expect(screen.getByText('You are offline')).toBeInTheDocument();
    expect(screen.getByText(/2 queued changes will sync when the connection returns\./i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry sync/i })).not.toBeInTheDocument();
  });

  it('lets the user retry a failed sync when online', async () => {
    const user = userEvent.setup();
    const triggerSync = vi.fn();

    mockUseOfflineSync.mockReturnValue({
      isOnline: true,
      lastSync: new Date('2026-04-07T10:00:00.000Z'),
      pendingItems: 3,
      conflicts: 0,
      isSyncing: false,
      error: 'Sync failed',
      triggerSync,
      refreshStatus: vi.fn(),
    });

    render(<OfflineStatusBanner />);

    expect(screen.getByText('Sync needs attention')).toBeInTheDocument();
    expect(screen.getByText('Sync failed')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /retry sync/i }));

    expect(triggerSync).toHaveBeenCalledTimes(1);
  });
});
