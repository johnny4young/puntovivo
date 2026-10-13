import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import i18n from '@/i18n';
import { render } from '@/test/utils';

const authMock = vi.hoisted(() => ({
  error: null as unknown,
  login: vi.fn(),
  health: vi.fn(),
  setup: vi.fn(),
}));

vi.mock('./AuthProvider', () => ({
  useAuth: () => ({
    login: authMock.login,
    isLoading: false,
    error: authMock.error,
  }),
}));

vi.mock('@/lib/trpc', () => ({
  vanillaClient: {
    health: { check: { query: authMock.health } },
    auth: { setupStatus: { query: authMock.setup } },
  },
}));

import { LoginPage } from './LoginPage';
import { __resetApiBootstrapForTests, ensureApiBootstrap } from '@/lib/apiBootstrap';

beforeEach(() => {
  __resetApiBootstrapForTests();
  authMock.health.mockReset().mockResolvedValue({ status: 'ok' });
  authMock.setup.mockReset().mockResolvedValue({ required: false, countries: [] });
});

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

it.each([
  ['en', 'This register is still assigned to another operator.'],
  ['es', 'Esta caja sigue asignada a otro operador.'],
] as const)(
  'explains verified staff handoff rather than allowing partial login in %s',
  async (locale, expected) => {
    await i18n.changeLanguage(locale);
    authMock.error = { data: { errorCode: 'AUTH_IDENTITY_CHANGED' } };
    render(<LoginPage />);
    expect(screen.getByText(text => text.startsWith(expected))).toBeVisible();
    expect(document.body).not.toHaveTextContent('AUTH_IDENTITY_CHANGED');
  }
);

describe('LoginPage safe bootstrap ordering', () => {
  it('waits for the shared health response before requesting setup status', async () => {
    let release!: () => void;
    authMock.health.mockReturnValue(
      new Promise<void>(resolve => {
        release = resolve;
      })
    );
    const authBootstrap = ensureApiBootstrap();
    render(<LoginPage />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(authMock.setup).not.toHaveBeenCalled();
    expect(authMock.health).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
      await authBootstrap;
    });
    await waitFor(() => expect(authMock.setup).toHaveBeenCalledTimes(1));
    expect(authMock.health).toHaveBeenCalledTimes(1);
  });

  it('does not issue setup or silently retry a failed bootstrap after remount', async () => {
    authMock.health.mockRejectedValue(new Error('offline'));
    await expect(ensureApiBootstrap()).rejects.toThrow('offline');
    const first = render(<LoginPage />);
    await act(async () => {
      await Promise.resolve();
    });
    first.unmount();
    render(<LoginPage />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(authMock.setup).not.toHaveBeenCalled();
    expect(authMock.health).toHaveBeenCalledTimes(1);
  });

  it('reuses completed initialization for an ordinary setup status read', async () => {
    await ensureApiBootstrap();
    render(<LoginPage />);
    await waitFor(() => expect(authMock.setup).toHaveBeenCalledTimes(1));
    expect(authMock.health).toHaveBeenCalledTimes(1);
  });
});
