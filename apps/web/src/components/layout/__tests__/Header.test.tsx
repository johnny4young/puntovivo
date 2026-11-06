import { act, fireEvent, render, screen, within } from '@/test/utils';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { USER_ROLES } from '@puntovivo/shared/roles';
import enSettings from '@/i18n/locales/en/settings.json';
import esSettings from '@/i18n/locales/es/settings.json';
import { shortcutDisplayFor } from '@/lib/shortcuts';
import { Header } from '../Header';

const { switchSite, openPalette, auth, recoveryCode } = vi.hoisted(() => ({
  switchSite: vi.fn(),
  openPalette: vi.fn(),
  auth: { role: 'viewer' },
  recoveryCode: { missing: false },
}));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { name: 'María Alejandra Rodríguez', role: auth.role, email: 'reader@example.test' },
    logout: vi.fn(),
  }),
}));
vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({
    currentTenant: { name: 'Comercializadora Latinoamericana del Centro' },
    currentSite: { id: 'a', name: 'Sucursal Centro Comercial Internacional' },
    sites: [
      { id: 'a', name: 'Sucursal Centro Comercial Internacional' },
      { id: 'b', name: 'Secondary location' },
    ],
    isLoadingSites: false,
    switchSite,
  }),
}));
vi.mock('@/features/fiscal/FiscalContingencyIndicator', () => ({
  FiscalContingencyIndicator: () => null,
}));
vi.mock('@/features/auth/ChangePasswordModal', () => ({ ChangePasswordModal: () => null }));
vi.mock('@/features/staff/TimeClockControl', () => ({ TimeClockControl: () => null }));
vi.mock('@/features/auth/useRecoveryCodeMissing', () => ({
  useRecoveryCodeMissing: (isAdmin: boolean) => isAdmin && recoveryCode.missing,
}));
vi.mock('@/components/feedback/CommandPaletteProvider', () => ({
  useCommandPalette: () => ({ openPalette }),
}));

beforeEach(async () => {
  auth.role = 'viewer';
  recoveryCode.missing = false;
  await i18next.changeLanguage('en');
});

describe('Header account disclosure', () => {
  it('closes with Escape and restores focus to its trigger', () => {
    render(<Header onOpenSidebar={vi.fn()} />);
    const account = screen.getByRole('button', { name: /María Alejandra/ });
    fireEvent.click(account);
    expect(account).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('reader@example.test')).toBeVisible();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(account).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('reader@example.test')).not.toBeInTheDocument();
    expect(account).toHaveFocus();
  });

  it('closes on outside pointer without stealing focus from the chosen control', () => {
    render(<Header onOpenSidebar={vi.fn()} />);
    const account = screen.getByRole('button', { name: /María Alejandra/ });
    fireEvent.click(account);
    const search = screen.getByRole('button', { name: /What do you want to do\?/ });
    search.focus();
    fireEvent.pointerDown(search);
    expect(account).toHaveAttribute('aria-expanded', 'false');
    expect(search).toHaveFocus();
    fireEvent.click(search);
    expect(openPalette).toHaveBeenCalledOnce();
  });
});

describe('Header accessible names', () => {
  it.each([
    {
      locale: 'en',
      prompt: 'What do you want to do?',
      searchSuffix: 'open task and product search',
      accountPrefix: 'Open user menu for',
      role: 'Viewer',
    },
    {
      locale: 'es',
      prompt: '¿Qué quieres hacer?',
      searchSuffix: 'abre el buscador de tareas y productos',
      accountPrefix: 'Abre el menú de usuario de',
      role: 'Observador',
    },
  ])(
    'contain the visible button text in $locale',
    async ({ locale, prompt, searchSuffix, accountPrefix, role }) => {
      await i18next.changeLanguage(locale);
      render(<Header onOpenSidebar={vi.fn()} />);
      const shortcut = shortcutDisplayFor('palette.open');
      const search = screen.getByRole('button', {
        name: `${prompt} ${shortcut}: ${searchSuffix}`,
      });
      expect(within(search).getByText(prompt)).toBeInTheDocument();
      expect(within(search).getByText(shortcut)).toBeInTheDocument();
      const account = screen.getByRole('button', {
        name: `${accountPrefix} María Alejandra Rodríguez, ${role}`,
      });
      expect(account).toHaveTextContent(`María Alejandra Rodríguez ${role}`);
    }
  );

  describe.each([
    { locale: 'en', accountPrefix: 'Open user menu for', labels: enSettings.users.roles },
    { locale: 'es', accountPrefix: 'Abre el menú de usuario de', labels: esSettings.users.roles },
  ])('in $locale', ({ locale, accountPrefix, labels }) => {
    it.each(USER_ROLES)('label the %s role as the users page does', async role => {
      auth.role = role;
      await i18next.changeLanguage(locale);
      render(<Header onOpenSidebar={vi.fn()} />);
      const account = screen.getByRole('button', {
        name: `${accountPrefix} María Alejandra Rodríguez, ${labels[role]}`,
      });
      expect(account).toHaveTextContent(`María Alejandra Rodríguez ${labels[role]}`);
    });
  });
});

async function renderHeader() {
  await act(async () => {
    render(<Header onOpenSidebar={vi.fn()} />);
  });
}

async function openAccountMenu() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /María Alejandra/ }));
  });
}

describe('Header recovery code', () => {
  it('flags an admin without a recovery code without opening anything', async () => {
    auth.role = 'admin';
    recoveryCode.missing = true;
    await renderHeader();
    expect(screen.getByTestId('recovery-code-missing-dot')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await openAccountMenu();
    expect(screen.getByRole('button', { name: 'Recovery code not set up' })).toBeInTheDocument();
  });

  it('stays quiet once the admin has a code', async () => {
    auth.role = 'admin';
    await renderHeader();
    expect(screen.queryByTestId('recovery-code-missing-dot')).not.toBeInTheDocument();
    await openAccountMenu();
    expect(screen.getByRole('button', { name: 'Recovery code' })).toBeInTheDocument();
  });

  it('never offers recovery codes to non-admins', async () => {
    auth.role = 'manager';
    recoveryCode.missing = true;
    await renderHeader();
    expect(screen.queryByTestId('recovery-code-missing-dot')).not.toBeInTheDocument();
    await openAccountMenu();
    expect(screen.queryByRole('button', { name: /Recovery code/ })).not.toBeInTheDocument();
  });
});
