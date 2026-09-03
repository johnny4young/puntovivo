import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import i18n from '@/i18n';
import { render } from '@/test/utils';

const authMock = vi.hoisted(() => ({
  error: null as unknown,
  login: vi.fn(),
}));

vi.mock('./AuthProvider', () => ({
  useAuth: () => ({
    login: authMock.login,
    isLoading: false,
    error: authMock.error,
  }),
}));

import { LoginPage } from './LoginPage';

describe('LoginPage Store Hub errors', () => {
  beforeEach(() => {
    authMock.login.mockReset();
    authMock.error = new Error('STORE_HUB_LOCAL_SESSION_ERROR');
  });

  it.each([
    ['en', 'Your session is no longer active on this device. Sign in again and retry.'],
    [
      'es',
      'Tu sesión ya no está activa en este equipo. Inicia sesión de nuevo y vuelve a intentarlo.',
    ],
  ] as const)(
    'renders safe localized copy for an unreadable local session in %s',
    async (locale, expected) => {
      await i18n.changeLanguage(locale);

      render(<LoginPage />);

      expect(screen.getByText(expected)).toBeInTheDocument();
      expect(document.body).not.toHaveTextContent(
        /STORE_HUB_LOCAL_SESSION_ERROR|\/Users\/|Library\/Application Support|keychain/i
      );
    }
  );
});
