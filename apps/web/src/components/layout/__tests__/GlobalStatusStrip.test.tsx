/**
 * GlobalStatusStrip.
 *
 * Hereda las aserciones de comportamiento del antiguo OfflineStatusBanner
 * (offline sin retry; error online con retry que dispara la cola) ahora que
 * los dos banners fijos se fusionaron en un solo strip compacto colapsable.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalStatusStrip } from '../GlobalStatusStrip';
import { useOfflineSync } from '@/hooks/useOfflineSync';

const authState = vi.hoisted(() => ({
  user: { id: 'u1', role: 'cashier', email: 'c@demo.co', tenantId: 't1' },
}));

const readinessState = vi.hoisted(() => ({
  query: {
    data: undefined as
      | {
          blockerCount: number;
          acknowledgedAt: string | null;
        }
      | undefined,
    isLoading: false,
  },
}));

vi.mock('@/hooks/useOfflineSync', () => ({
  useOfflineSync: vi.fn(),
}));

vi.mock('@/hooks/useHubReachability', () => ({
  useHubReachability: () => ({ reachable: null, lastChecked: null, lastError: null }),
}));

// El strip monta OfflineModePanel en el detalle expandido cuando está
// offline; el panel tiene sus propios tests, así que lo stubbeamos.
vi.mock('@/features/offline/OfflineModePanel', () => ({
  OfflineModePanel: ({ visible }: { visible: boolean }) =>
    visible ? <div data-testid="offline-mode-panel-stub" /> : null,
}));

// Cajero ⇒ el aviso de readiness queda gateado (solo admin), dejando el
// foco del suite en el comportamiento de sincronización.
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: authState.user }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    setupReadiness: {
      get: { useQuery: () => readinessState.query },
    },
  },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useLocation: () => ({ pathname: '/dashboard', search: '', hash: '', state: null, key: 'k' }),
  };
});

const mockUseOfflineSync = vi.mocked(useOfflineSync);

function renderStrip() {
  return render(
    <MemoryRouter>
      <GlobalStatusStrip />
    </MemoryRouter>
  );
}

describe('GlobalStatusStrip', () => {
  beforeEach(() => {
    authState.user = { id: 'u1', role: 'cashier', email: 'c@demo.co', tenantId: 't1' };
    readinessState.query = { data: undefined, isLoading: false };
    window.sessionStorage.clear();
  });

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

    const { container } = renderStrip();

    expect(container).toBeEmptyDOMElement();
  });

  it('renders an offline warning without a retry action, detail behind the disclosure', async () => {
    const user = userEvent.setup();
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

    renderStrip();

    // Summary line visible in the collapsed 44px strip.
    expect(screen.getByText('You are offline')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry sync/i })).not.toBeInTheDocument();

    // Detail (queued-change copy) lives in the expandable notification center.
    await user.click(screen.getByRole('button', { name: /show details/i }));
    expect(
      screen.getByText(/2 queued changes will sync when the connection returns\./i)
    ).toBeInTheDocument();
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

    renderStrip();

    expect(screen.getByText('Sync needs attention')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /retry sync/i }));

    expect(triggerSync).toHaveBeenCalledTimes(1);
  });

  it('shows readiness blockers again after the clean state clears a prior session dismiss', async () => {
    const user = userEvent.setup();
    authState.user = { id: 'u1', role: 'admin', email: 'a@demo.co', tenantId: 't1' };
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
    readinessState.query = {
      data: { blockerCount: 1, acknowledgedAt: null },
      isLoading: false,
    };

    const { rerender } = renderStrip();

    expect(screen.getByText(/setup incomplete/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /show details/i }));
    await user.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText(/setup incomplete/i)).not.toBeInTheDocument();

    readinessState.query = {
      data: { blockerCount: 0, acknowledgedAt: null },
      isLoading: false,
    };
    rerender(
      <MemoryRouter>
        <GlobalStatusStrip />
      </MemoryRouter>
    );

    readinessState.query = {
      data: { blockerCount: 2, acknowledgedAt: null },
      isLoading: false,
    };
    rerender(
      <MemoryRouter>
        <GlobalStatusStrip />
      </MemoryRouter>
    );

    expect(screen.getAllByText(/setup incomplete/i).length).toBeGreaterThan(0);
  });
});
