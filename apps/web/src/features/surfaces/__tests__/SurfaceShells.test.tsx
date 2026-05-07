/**
 * ENG-069 — Layout shell render tests for the 4 new surfaces.
 *
 * Each shell mounts the `RequireModule` gate around its `<Outlet />`,
 * so the contract is:
 *   - Module ON + auth OK → shell + outlet child renders.
 *   - Module OFF → fallback (Navigate to /dashboard) renders, which
 *     produces a navigate effect — we assert the Outlet did NOT
 *     render.
 *
 * Auth gate testing is handled separately in ProtectedRoute tests; we
 * mock `ProtectedRoute` here as a passthrough so each shell's module
 * gate is the only thing under test.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';

const { useIsModuleActiveMock } = vi.hoisted(() => ({
  useIsModuleActiveMock: vi.fn(),
}));

vi.mock('@/features/modules/ModulesContext', () => ({
  useIsModuleActive: (id: string) => useIsModuleActiveMock(id),
}));

vi.mock('@/features/auth/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/feedback/LoadingState', () => ({
  PageLoadingState: () => <div data-testid="loading" />,
}));

vi.mock('react-i18next', async () => {
  const mod = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...mod,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { changeLanguage: vi.fn() },
    }),
  };
});

import { TouchShell } from '../TouchShell';
import { KdsShell } from '../KdsShell';
import { CustomerDisplayShell } from '../CustomerDisplayShell';
import { MobileWaiterShell } from '../MobileWaiterShell';

beforeEach(() => {
  useIsModuleActiveMock.mockReset();
});

function renderShell(
  Shell: () => ReactElement,
  childPath: string,
  initialEntries: string[]
): void {
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path={childPath} element={<Shell />}>
          <Route index element={<span data-testid="outlet-child">CHILD</span>} />
        </Route>
        <Route
          path="/dashboard"
          element={<span data-testid="dashboard-fallback">DASHBOARD</span>}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('TouchShell (ENG-069)', () => {
  it('renders the outlet child when pos-touch module is on', () => {
    useIsModuleActiveMock.mockReturnValue(true);
    renderShell(TouchShell, '/touch', ['/touch']);
    expect(screen.getByTestId('touch-shell')).toBeInTheDocument();
    expect(screen.getByTestId('outlet-child')).toHaveTextContent('CHILD');
    expect(useIsModuleActiveMock).toHaveBeenCalledWith('pos-touch');
  });

  it('redirects to /dashboard when pos-touch module is off', () => {
    useIsModuleActiveMock.mockReturnValue(false);
    renderShell(TouchShell, '/touch', ['/touch']);
    expect(screen.queryByTestId('outlet-child')).toBeNull();
    expect(screen.getByTestId('dashboard-fallback')).toBeInTheDocument();
  });
});

describe('KdsShell (ENG-069)', () => {
  it('renders the outlet child when kds module is on with fullscreen styling', () => {
    useIsModuleActiveMock.mockReturnValue(true);
    renderShell(KdsShell, '/kds', ['/kds']);
    const shell = screen.getByTestId('kds-shell');
    expect(shell).toBeInTheDocument();
    // Fullscreen black backdrop assertion: shell uses the dark
    // secondary-950 background class.
    expect(shell.className).toMatch(/bg-secondary-950/);
    expect(screen.getByTestId('outlet-child')).toBeInTheDocument();
    expect(useIsModuleActiveMock).toHaveBeenCalledWith('kds');
  });

  it('redirects to /dashboard when kds module is off', () => {
    useIsModuleActiveMock.mockReturnValue(false);
    renderShell(KdsShell, '/kds', ['/kds']);
    expect(screen.queryByTestId('outlet-child')).toBeNull();
    expect(screen.getByTestId('dashboard-fallback')).toBeInTheDocument();
  });
});

describe('CustomerDisplayShell (ENG-069)', () => {
  it('renders the outlet child when customer-display module is on', () => {
    useIsModuleActiveMock.mockReturnValue(true);
    renderShell(CustomerDisplayShell, '/customer-display', ['/customer-display']);
    expect(screen.getByTestId('customer-display-shell')).toBeInTheDocument();
    expect(screen.getByTestId('outlet-child')).toBeInTheDocument();
    expect(useIsModuleActiveMock).toHaveBeenCalledWith('customer-display');
  });

  it('redirects to /dashboard when customer-display module is off', () => {
    useIsModuleActiveMock.mockReturnValue(false);
    renderShell(CustomerDisplayShell, '/customer-display', ['/customer-display']);
    expect(screen.queryByTestId('outlet-child')).toBeNull();
    expect(screen.getByTestId('dashboard-fallback')).toBeInTheDocument();
  });
});

describe('MobileWaiterShell (ENG-069)', () => {
  it('renders the outlet child with phone-width container when mobile-waiter module is on', () => {
    useIsModuleActiveMock.mockReturnValue(true);
    renderShell(MobileWaiterShell, '/m', ['/m']);
    const shell = screen.getByTestId('mobile-waiter-shell');
    expect(shell).toBeInTheDocument();
    // Phone-width container assertion.
    expect(shell.className).toMatch(/max-w-md/);
    expect(screen.getByTestId('outlet-child')).toBeInTheDocument();
    expect(useIsModuleActiveMock).toHaveBeenCalledWith('mobile-waiter');
  });

  it('redirects to /dashboard when mobile-waiter module is off', () => {
    useIsModuleActiveMock.mockReturnValue(false);
    renderShell(MobileWaiterShell, '/m', ['/m']);
    expect(screen.queryByTestId('outlet-child')).toBeNull();
    expect(screen.getByTestId('dashboard-fallback')).toBeInTheDocument();
  });
});
