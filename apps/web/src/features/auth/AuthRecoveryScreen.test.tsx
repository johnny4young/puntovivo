import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { render } from '@/test/utils';
import i18n from '@/i18n';
import { AuthRecoveryScreen } from './AuthRecoveryScreen';
import type { AuthContextType } from './AuthContext';

afterEach(() => vi.useRealTimers());
function recovery(overrides: Partial<NonNullable<AuthContextType['bootstrapRecovery']>> = {}) {
  return {
    kind: 'throttled' as const,
    retryAt: Date.now() + 2000,
    isRetrying: false,
    isChangingAccount: false,
    accountChangeFailed: false,
    retry: vi.fn(),
    signIn: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('locked bootstrap recovery', () => {
  it.each([
    ['en', 'Your session needs a moment', 'Retry connection', 'Sign in again'],
    ['es', 'Tu sesión necesita un momento', 'Reintentar conexión', 'Iniciar sesión de nuevo'],
  ] as const)(
    'keeps %s readable and requires a manual retry after cooldown',
    async (locale, title, retryLabel, signInLabel) => {
      await i18n.changeLanguage(locale);
      vi.useFakeTimers();
      const state = recovery();
      render(<AuthRecoveryScreen recovery={state} />);
      expect(screen.getByRole('heading', { name: title })).toHaveFocus();
      const button = screen.getByRole('button', { name: retryLabel });
      expect(button).toBeDisabled();
      fireEvent.click(button);
      expect(state.retry).not.toHaveBeenCalled();
      await act(() => vi.advanceTimersByTimeAsync(1000));
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(button).toBeEnabled();
      expect(state.retry).not.toHaveBeenCalled();
      fireEvent.click(button);
      expect(state.retry).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole('button', { name: signInLabel }));
      expect(state.signIn).toHaveBeenCalledOnce();
      expect(document.body).not.toHaveTextContent(
        /ipcRenderer|TRPCClientError|SQLITE|429|auth\.me|private diagnostic/
      );
    }
  );

  it('disables both actions during verification or credential removal and shows only safe failure copy', async () => {
    await i18n.changeLanguage('en');
    const state = recovery({ retryAt: 0, isRetrying: true });
    const { rerender, unmount } = render(<AuthRecoveryScreen recovery={state} />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session');
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    rerender(
      <AuthRecoveryScreen recovery={{ ...state, isRetrying: false, isChangingAccount: true }} />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Safely clearing the previous session');
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    rerender(
      <AuthRecoveryScreen recovery={{ ...state, isRetrying: false, accountChangeFailed: true }} />
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The previous session could not be cleared'
    );
    unmount();
  });
});
