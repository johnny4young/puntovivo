import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { UserRole } from '@/types';
import { HomeRedirect } from './appRouteHelpers';

const state = vi.hoisted(() => ({
  role: 'cashier' as UserRole,
  businessType: undefined as string | undefined,
  posTouch: true,
  isPlaceholder: false,
  isError: false,
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'u-1', role: state.role, tenantId: 't-1' },
    tenant: { settings: { businessType: state.businessType } },
  }),
}));

vi.mock('@/features/modules', async () => {
  const actual = await vi.importActual<typeof import('@/features/modules')>('@/features/modules');
  return {
    ...actual,
    useModulesSnapshot: () => ({
      // Like the store, a placeholder snapshot keeps the manifest defaults.
      modules: {
        ...actual.CLIENT_MODULE_DEFAULTS,
        ...(state.isPlaceholder ? {} : { 'pos-touch': state.posTouch }),
      },
      isLoading: state.isPlaceholder,
      isPlaceholder: state.isPlaceholder,
      isError: state.isError,
    }),
  };
});

vi.mock('@/components/feedback/LoadingState', () => ({
  PageLoadingState: () => <div data-testid="home-loading" />,
  FullscreenLoadingState: () => null,
}));

function Landed() {
  return <div data-testid="landed">{useLocation().pathname}</div>;
}

function renderHome() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="*" element={<Landed />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  state.role = 'cashier';
  state.businessType = undefined;
  state.posTouch = true;
  state.isPlaceholder = false;
  state.isError = false;
});

describe('HomeRedirect', () => {
  it.each([
    ['restaurant', '/touch'],
    ['quickservice', '/touch'],
    ['retail', '/sales'],
    ['pharmacy', '/sales'],
    ['hardware', '/sales'],
    ['butchery', '/sales'],
    ['wholesale', '/sales'],
    [undefined, '/sales'],
  ])('opens a %s cashier on %s', (businessType, route) => {
    state.businessType = businessType;
    renderHome();
    expect(screen.getByTestId('landed')).toHaveTextContent(route);
  });

  it('keeps a restaurant cashier on Vender when POS táctil is off', () => {
    state.businessType = 'restaurant';
    state.posTouch = false;
    renderHome();
    expect(screen.getByTestId('landed')).toHaveTextContent('/sales');
  });

  it.each(['admin', 'manager', 'viewer'] as const)('keeps %s on the role default', role => {
    state.role = role;
    state.businessType = 'restaurant';
    renderHome();
    expect(screen.getByTestId('landed')).toHaveTextContent('/dashboard');
  });

  it('waits for module state before choosing a touch register', () => {
    state.businessType = 'restaurant';
    state.isPlaceholder = true;
    renderHome();
    expect(screen.getByTestId('home-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('landed')).not.toBeInTheDocument();
  });

  it('never waits on module state for profiles that sell on Vender', () => {
    state.businessType = 'retail';
    state.isPlaceholder = true;
    renderHome();
    expect(screen.getByTestId('landed')).toHaveTextContent('/sales');
  });

  it('falls back to Vender when module state fails to load', () => {
    state.businessType = 'restaurant';
    state.isPlaceholder = true;
    state.isError = true;
    renderHome();
    expect(screen.getByTestId('landed')).toHaveTextContent('/sales');
  });
});
