import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/utils';
import { SupportHealthPanel } from './SupportHealthPanel';

const { authorityQuery, companyQuery, modulesSnapshot } = vi.hoisted(() => ({
  authorityQuery: {
    data: {
      devices: [
        { id: 'online', healthStatus: 'online' },
        { id: 'stale', healthStatus: 'stale' },
        { id: 'revoked', healthStatus: 'revoked' },
      ],
    },
    isLoading: false,
    error: null as Error | null,
  },
  companyQuery: {
    data: { telemetryOptIn: false },
    isLoading: false,
    error: null as Error | null,
  },
  modulesSnapshot: {
    modules: { diagnostics: true, fiscal: true, copilot: false },
    isLoading: false,
    isPlaceholder: false,
  },
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    authority: { status: { useQuery: () => authorityQuery } },
    companies: { getCurrent: { useQuery: () => companyQuery } },
  },
}));

vi.mock('@/features/modules', () => ({
  useModulesSnapshot: () => modulesSnapshot,
}));

describe('SupportHealthPanel', () => {
  beforeEach(() => {
    authorityQuery.data = {
      devices: [
        { id: 'online', healthStatus: 'online' },
        { id: 'stale', healthStatus: 'stale' },
        { id: 'revoked', healthStatus: 'revoked' },
      ],
    };
    authorityQuery.isLoading = false;
    authorityQuery.error = null;
    companyQuery.data = { telemetryOptIn: false };
    companyQuery.isLoading = false;
    companyQuery.error = null;
    modulesSnapshot.modules = { diagnostics: true, fiscal: true, copilot: false };
    modulesSnapshot.isLoading = false;
    modulesSnapshot.isPlaceholder = false;
    Reflect.deleteProperty(window, 'electron');
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'electron');
  });

  it('summarizes web runtime, module state, active devices, and telemetry consent', () => {
    render(<SupportHealthPanel />);

    expect(screen.getByRole('heading', { name: 'Support health' })).toBeInTheDocument();
    expect(screen.getByText('Web')).toBeInTheDocument();
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      '2 support signals need review.'
    );
  });

  it('reads version and update health through the existing desktop bridge', async () => {
    authorityQuery.data = { devices: [{ id: 'online', healthStatus: 'online' }] };
    companyQuery.data = { telemetryOptIn: true };
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        getAutoUpdateStatus: vi.fn().mockResolvedValue({
          state: 'idle',
          currentVersion: '1.5.1',
          lastCheckedAt: '2026-07-13T20:00:00.000Z',
        }),
      },
    });

    render(<SupportHealthPanel />);

    expect(await screen.findByText('1.5.1')).toBeInTheDocument();
    expect(screen.getByText('Up to date')).toBeInTheDocument();
    expect(screen.getByTestId('support-health-summary')).toHaveTextContent(
      'All available support signals are healthy.'
    );
  });

  it('surfaces partial read failures without exposing raw error details', () => {
    authorityQuery.error = new Error('database path /private/store.db');

    render(<SupportHealthPanel />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Some support-health signals could not be loaded.'
    );
    expect(screen.queryByText(/private\/store\.db/)).not.toBeInTheDocument();
  });
});
