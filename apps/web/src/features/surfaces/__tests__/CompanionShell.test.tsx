import { act } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { registerWorker, auth } = vi.hoisted(() => ({
  registerWorker: vi.fn(),
  auth: { role: 'viewer' },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { role: auth.role } }),
}));

vi.mock('../companionPwa', () => ({
  registerCompanionServiceWorker: registerWorker,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { CompanionShell } from '../CompanionShell';

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'viewer';
  registerWorker.mockResolvedValue(null);
});

describe('CompanionShell', () => {
  function CompanionBody() {
    const location = useLocation();
    return (
      <>
        <p>companion body</p>
        <output data-testid="companion-path">{location.pathname}</output>
      </>
    );
  }

  function renderShell(path = '/c') {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/c/*" element={<CompanionShell />}>
            <Route index element={<CompanionBody />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
  }

  it('hosts the standalone PWA chrome and registers the bounded worker', () => {
    renderShell();
    expect(screen.getByText('companion body')).toBeInTheDocument();
    expect(screen.getByTestId('companion-path')).toHaveTextContent('/c/');
    expect(registerWorker).toHaveBeenCalledOnce();
  });

  it('gives viewers only the read-only tabs', () => {
    renderShell();
    expect(screen.getByTestId('companion-tab-today')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('companion-tab-more')).toHaveAttribute('href', '/c/?view=more');
    expect(screen.queryByTestId('companion-tab-day')).not.toBeInTheDocument();
    expect(screen.queryByTestId('companion-tab-registers')).not.toBeInTheDocument();
  });

  it('gives owners every tab and keeps an open decision across them', () => {
    auth.role = 'admin';
    renderShell('/c/?view=registers&decide=req-1');
    expect(screen.getByTestId('companion-tab-registers')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('companion-tab-today')).toHaveAttribute('href', '/c/?decide=req-1');
    expect(screen.getByTestId('companion-tab-day')).toHaveAttribute(
      'href',
      '/c/?view=day&decide=req-1'
    );
  });

  it('draws the sealed day on the dark tokens', () => {
    auth.role = 'manager';
    renderShell('/c/?view=day');
    expect(screen.getByTestId('companion-shell')).toHaveClass('dark');
  });

  it('follows a notification the worker routes to an open Companion', () => {
    const worker = new EventTarget();
    Object.defineProperty(window.navigator, 'serviceWorker', { configurable: true, value: worker });
    try {
      renderShell('/c/');
      act(() => {
        worker.dispatchEvent(
          new MessageEvent('message', {
            data: { type: 'companion:navigate', url: '/c/?decide=r-1' },
          })
        );
        worker.dispatchEvent(
          new MessageEvent('message', { data: { type: 'companion:navigate', url: '/admin' } })
        );
      });
      expect(screen.getByTestId('companion-tab-today')).toHaveAttribute('href', '/c/?decide=r-1');
    } finally {
      Reflect.deleteProperty(window.navigator, 'serviceWorker');
    }
  });
});
