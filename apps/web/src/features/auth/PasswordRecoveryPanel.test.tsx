import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import i18n from '@/i18n';
import { render } from '@/test/utils';
import { __resetRuntimeConfigCacheForTests } from '@/lib/runtimeConfigClient';

const mocks = vi.hoisted(() => ({
  health: vi.fn(),
  setup: vi.fn(),
  recoverWithCode: vi.fn(),
}));

vi.mock('./AuthProvider', () => ({
  useAuth: () => ({ login: vi.fn(), isLoading: false, error: null }),
}));

vi.mock('@/lib/trpc', () => ({
  vanillaClient: {
    health: { check: { query: mocks.health } },
    auth: {
      setupStatus: { query: mocks.setup },
      recoverWithCode: { mutate: mocks.recoverWithCode },
    },
  },
}));

import { LoginPage } from './LoginPage';
import { __resetApiBootstrapForTests } from '@/lib/apiBootstrap';

const NEW_PASSWORD = 'FreshOwnerPassword42!';

function installOwnerRecovery(available: boolean, recover = vi.fn(async () => ({ ok: true }))) {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      session: { ownerRecovery: { status: vi.fn(async () => ({ available })), recover } },
    },
  });
  __resetRuntimeConfigCacheForTests();
  return recover;
}

function fillPasswords() {
  fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: NEW_PASSWORD } });
  fireEvent.change(screen.getByLabelText('Confirmar nueva contraseña'), {
    target: { value: NEW_PASSWORD },
  });
}

async function openRecovery() {
  render(<LoginPage />);
  fireEvent.change(await screen.findByLabelText('Correo electrónico'), {
    target: { value: 'owner@example.com' },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '¿Olvidaste tu contraseña?' }));
  });
  expect(screen.getByRole('heading', { name: 'Restablece tu contraseña' })).toBeInTheDocument();
}

beforeEach(async () => {
  await i18n.changeLanguage('es');
  __resetApiBootstrapForTests();
  mocks.health.mockReset().mockResolvedValue({ status: 'ok' });
  mocks.setup.mockReset().mockResolvedValue({ required: false, countries: [] });
  mocks.recoverWithCode.mockReset().mockResolvedValue({ success: true });
});

afterEach(() => {
  delete window.api;
  __resetRuntimeConfigCacheForTests();
});

describe('forgotten password with a recovery code', () => {
  it('resets the password and returns to sign in with the email kept', async () => {
    await openRecovery();
    expect(
      screen.getByText(
        '¿No tienes código? Pide a un administrador que restablezca tu contraseña en Usuarios.'
      )
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Código de recuperación'), {
      target: { value: 'ab12c-de34f-gh56j-km78n' },
    });
    fillPasswords();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));

    await waitFor(() =>
      expect(mocks.recoverWithCode).toHaveBeenCalledWith({
        email: 'owner@example.com',
        recoveryCode: 'ab12c-de34f-gh56j-km78n',
        newPassword: NEW_PASSWORD,
      })
    );
    expect(
      await screen.findByText('Contraseña actualizada. Inicia sesión con la nueva.')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Correo electrónico')).toHaveValue('owner@example.com');
  });

  it('explains a rejected code without leaving the form', async () => {
    mocks.recoverWithCode.mockRejectedValue(
      Object.assign(new Error('UNAUTHORIZED'), { data: { errorCode: 'AUTH_RECOVERY_INVALID' } })
    );
    await openRecovery();
    fireEvent.change(screen.getByLabelText('Código de recuperación'), {
      target: { value: 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ' },
    });
    fillPasswords();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El correo o el código de recuperación no son correctos.'
    );
    expect(screen.getByRole('heading', { name: 'Restablece tu contraseña' })).toBeInTheDocument();
  });

  it('validates the password policy before calling the server', async () => {
    await openRecovery();
    fireEvent.change(screen.getByLabelText('Código de recuperación'), {
      target: { value: 'AB12C-DE34F-GH56J-KM78N' },
    });
    fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));

    await waitFor(() => expect(screen.getAllByText(/12/).length).toBeGreaterThan(0));
    expect(mocks.recoverWithCode).not.toHaveBeenCalled();
  });
});

describe('forgotten password on the owner computer', () => {
  it('skips the code when this installation qualifies', async () => {
    const recover = installOwnerRecovery(true);
    await openRecovery();
    expect(
      await screen.findByText(
        'Eres el único usuario de esta instalación, así que puedes crear una contraseña nueva desde este equipo.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Código de recuperación')).not.toBeInTheDocument();
    fillPasswords();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));

    await waitFor(() =>
      expect(recover).toHaveBeenCalledWith({
        email: 'owner@example.com',
        newPassword: NEW_PASSWORD,
      })
    );
    expect(
      await screen.findByText('Contraseña actualizada. Inicia sesión con la nueva.')
    ).toBeInTheDocument();
    expect(mocks.recoverWithCode).not.toHaveBeenCalled();
  });

  it('shows the owner mismatch returned by the desktop bridge', async () => {
    installOwnerRecovery(
      true,
      vi.fn(async () => ({ ok: false, errorCode: 'AUTH_LOCAL_RECOVERY_EMAIL_MISMATCH' }))
    );
    await openRecovery();
    await screen.findByText(/Eres el único usuario/);
    fillPasswords();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ese correo no corresponde al propietario de esta instalación.'
    );
  });

  it('falls back to the recovery code when the installation does not qualify', async () => {
    installOwnerRecovery(false);
    await openRecovery();
    expect(await screen.findByLabelText('Código de recuperación')).toBeInTheDocument();
  });
});
