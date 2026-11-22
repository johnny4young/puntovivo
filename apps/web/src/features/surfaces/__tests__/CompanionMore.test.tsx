import { act } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { logout, persistLanguage, changeLanguage, dropPush, auth } = vi.hoisted(() => ({
  logout: vi.fn(),
  persistLanguage: vi.fn(),
  changeLanguage: vi.fn(),
  dropPush: vi.fn(),
  auth: { role: 'viewer' },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ logout, user: { role: auth.role } }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: { ownerPush: { unsubscribe: { useMutation: () => ({ mutateAsync: vi.fn() }) } } },
}));

vi.mock('../companionPush', () => ({ dropBrowserPush: dropPush }));
vi.mock('../CompanionPushCard', () => ({
  CompanionPushCard: () => <p data-testid="push-stub">push</p>,
}));

vi.mock('@/i18n/resolveLocale', () => ({
  readLanguagePreference: () => 'system',
  persistLanguagePreference: persistLanguage,
  resolveBootLocale: () => 'es',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { changeLanguage } }),
}));

import { CompanionMore } from '../CompanionMore';

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'viewer';
  logout.mockResolvedValue(undefined);
  dropPush.mockResolvedValue(undefined);
  changeLanguage.mockResolvedValue(undefined);
});

describe('CompanionMore', () => {
  it('persists EN/ES selection through the canonical locale resolver', () => {
    render(<CompanionMore />);
    fireEvent.change(screen.getByTestId('companion-language'), { target: { value: 'es' } });
    expect(persistLanguage).toHaveBeenCalledWith('es');
    expect(changeLanguage).toHaveBeenCalledWith('es');
  });

  it('logs a viewer out without touching notifications', async () => {
    render(<CompanionMore />);
    expect(screen.getByTestId('companion-more')).toHaveTextContent('companion:shell.readOnly');
    expect(screen.queryByTestId('push-stub')).not.toBeInTheDocument();
    expect(screen.queryByTestId('companion-open-app')).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByTestId('companion-logout'));
    });
    expect(dropPush).not.toHaveBeenCalled();
    expect(logout).toHaveBeenCalledOnce();
  });

  it('gives owners notifications and drops this phone from them on logout', async () => {
    auth.role = 'admin';
    render(<CompanionMore />);
    expect(screen.getByTestId('push-stub')).toBeInTheDocument();
    expect(screen.getByTestId('companion-open-app')).toHaveAttribute('href', '/');
    await act(async () => {
      fireEvent.click(screen.getByTestId('companion-logout'));
    });
    expect(dropPush).toHaveBeenCalledOnce();
    expect(logout).toHaveBeenCalledOnce();
  });
});
