import { act } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { logout, registerWorker, persistLanguage, changeLanguage } = vi.hoisted(() => ({
  logout: vi.fn(),
  registerWorker: vi.fn(),
  persistLanguage: vi.fn(),
  changeLanguage: vi.fn(),
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ logout }),
}));

vi.mock('../companionPwa', () => ({
  registerCompanionServiceWorker: registerWorker,
}));

vi.mock('@/i18n/resolveLocale', () => ({
  readLanguagePreference: () => 'system',
  persistLanguagePreference: persistLanguage,
  resolveBootLocale: () => 'es',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { changeLanguage } }),
}));

import { CompanionShell } from '../CompanionShell';

beforeEach(() => {
  vi.clearAllMocks();
  logout.mockResolvedValue(undefined);
  registerWorker.mockResolvedValue(null);
  changeLanguage.mockResolvedValue(undefined);
});

describe('CompanionShell', () => {
  function renderShell() {
    return render(
      <MemoryRouter initialEntries={['/c']}>
        <Routes>
          <Route path="/c" element={<CompanionShell />}>
            <Route index element={<p>companion body</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
  }

  it('hosts the standalone PWA chrome and registers the bounded worker', () => {
    renderShell();
    expect(screen.getByTestId('companion-shell')).toHaveTextContent('companion:shell.product');
    expect(screen.getByText('companion body')).toBeInTheDocument();
    expect(registerWorker).toHaveBeenCalledOnce();
  });

  it('persists EN/ES selection through the canonical locale resolver', async () => {
    renderShell();
    fireEvent.change(screen.getByTestId('companion-language'), { target: { value: 'es' } });
    expect(persistLanguage).toHaveBeenCalledWith('es');
    expect(changeLanguage).toHaveBeenCalledWith('es');
  });

  it('uses the shared logout path that clears authenticated query state', async () => {
    renderShell();
    await act(async () => {
      fireEvent.click(screen.getByTestId('companion-logout'));
    });
    expect(logout).toHaveBeenCalledOnce();
  });
});
