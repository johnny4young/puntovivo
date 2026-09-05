import { fireEvent, render, screen } from '@/test/utils';
import { describe, expect, it, vi } from 'vitest';
import { Header } from '../Header';

const { switchSite, openPalette } = vi.hoisted(() => ({
  switchSite: vi.fn(),
  openPalette: vi.fn(),
}));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { name: 'María Alejandra Rodríguez', role: 'viewer', email: 'reader@example.test' },
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
vi.mock('@/components/feedback/CommandPaletteProvider', () => ({
  useCommandPalette: () => ({ openPalette }),
}));

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
    const search = screen.getByRole('button', { name: 'Open task and product search' });
    search.focus();
    fireEvent.pointerDown(search);
    expect(account).toHaveAttribute('aria-expanded', 'false');
    expect(search).toHaveFocus();
    fireEvent.click(search);
    expect(openPalette).toHaveBeenCalledOnce();
  });
});
