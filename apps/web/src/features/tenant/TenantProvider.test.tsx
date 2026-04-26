import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';

const { useAuthMock, useSitesQueryMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useSitesQueryMock: vi.fn(),
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: useAuthMock,
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    sites: {
      list: {
        useQuery: (input: unknown, options: { enabled?: boolean }) =>
          useSitesQueryMock(input, options),
      },
    },
  },
}));

import { TenantProvider, useTenant } from './TenantProvider';

const tenantPayload = {
  id: 'tenant-1',
  name: 'Demo',
  slug: 'demo',
  settings: { taxRate: 19 },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const sitesPayload = [
  {
    id: 'site-1',
    tenantId: 'tenant-1',
    name: 'Main',
    code: 'M',
    address: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'site-2',
    tenantId: 'tenant-1',
    name: 'Other',
    code: 'O',
    address: null,
    isActive: undefined,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

beforeEach(() => {
  useAuthMock.mockReset();
  useSitesQueryMock.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('useTenant — context guard', () => {
  it('throws a clear error when used outside TenantProvider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useTenant())).toThrow(
      /useTenant must be used within TenantProvider/
    );
    consoleSpy.mockRestore();
  });
});

describe('TenantProvider — context value', () => {
  it('exposes tenant + tenantSettings + sites + active site once authenticated and the query resolves', () => {
    useAuthMock.mockReturnValue({ tenant: tenantPayload, isAuthenticated: true });
    useSitesQueryMock.mockReturnValue({
      data: { items: sitesPayload, activeSiteId: 'site-1' },
      isLoading: false,
    });

    function Probe() {
      const t = useTenant();
      return (
        <div>
          <span data-testid="tenant">{t.currentTenant?.slug}</span>
          <span data-testid="tax">{String(t.tenantSettings?.taxRate)}</span>
          <span data-testid="sites">{t.sites.length}</span>
          <span data-testid="current">{t.currentSite?.id ?? '—'}</span>
          <span data-testid="loading">{t.isLoadingSites ? 'yes' : 'no'}</span>
        </div>
      );
    }

    render(
      <TenantProvider>
        <Probe />
      </TenantProvider>
    );
    expect(screen.getByTestId('tenant')).toHaveTextContent('demo');
    expect(screen.getByTestId('tax')).toHaveTextContent('19');
    expect(screen.getByTestId('sites')).toHaveTextContent('2');
    expect(screen.getByTestId('current')).toHaveTextContent('site-1');
    expect(screen.getByTestId('loading')).toHaveTextContent('no');
  });

  it('exposes tenantSettings=null when no tenant is logged in', () => {
    useAuthMock.mockReturnValue({ tenant: null, isAuthenticated: false });
    useSitesQueryMock.mockReturnValue({ data: undefined, isLoading: false });

    function Probe() {
      const t = useTenant();
      return (
        <span data-testid="settings">
          {t.tenantSettings === null ? 'null' : 'present'}
        </span>
      );
    }
    render(
      <TenantProvider>
        <Probe />
      </TenantProvider>
    );
    expect(screen.getByTestId('settings')).toHaveTextContent('null');
  });

  it('disables the sites query while unauthenticated (uses options.enabled)', () => {
    useAuthMock.mockReturnValue({ tenant: null, isAuthenticated: false });
    useSitesQueryMock.mockReturnValue({ data: undefined, isLoading: false });
    function Probe() {
      useTenant();
      return null;
    }
    render(
      <TenantProvider>
        <Probe />
      </TenantProvider>
    );
    expect(useSitesQueryMock).toHaveBeenCalled();
    const lastCall = useSitesQueryMock.mock.calls[useSitesQueryMock.mock.calls.length - 1];
    expect(lastCall![1]).toMatchObject({ enabled: false });
  });

  it('falls back to the first site id when activeSiteId is absent in the query payload', () => {
    useAuthMock.mockReturnValue({ tenant: tenantPayload, isAuthenticated: true });
    useSitesQueryMock.mockReturnValue({
      data: { items: sitesPayload, activeSiteId: null },
      isLoading: false,
    });
    function Probe() {
      const t = useTenant();
      return <span data-testid="current">{t.currentSite?.id ?? '—'}</span>;
    }
    render(
      <TenantProvider>
        <Probe />
      </TenantProvider>
    );
    expect(screen.getByTestId('current')).toHaveTextContent('site-1');
  });

  it('reflects isLoadingSites from the underlying query', () => {
    useAuthMock.mockReturnValue({ tenant: tenantPayload, isAuthenticated: true });
    useSitesQueryMock.mockReturnValue({ data: undefined, isLoading: true });
    function Probe() {
      const t = useTenant();
      return <span data-testid="loading">{t.isLoadingSites ? 'yes' : 'no'}</span>;
    }
    render(
      <TenantProvider>
        <Probe />
      </TenantProvider>
    );
    expect(screen.getByTestId('loading')).toHaveTextContent('yes');
  });
});
