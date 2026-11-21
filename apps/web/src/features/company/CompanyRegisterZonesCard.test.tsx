import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';

const state = vi.hoisted(() => ({
  settings: { taxRate: 19 } as Record<string, unknown>,
  modules: { 'dine-in': false, quotations: true } as Record<string, boolean>,
  mutate: vi.fn(),
  updateTenantSettings: vi.fn(),
  onSuccess: undefined as undefined | ((result: { overrides: Record<string, boolean> }) => void),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    tenant: { settings: state.settings },
    updateTenantSettings: state.updateTenantSettings,
  }),
}));

vi.mock('@/features/modules', () => ({
  useModulesSnapshot: () => ({ modules: state.modules }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    registerZones: {
      set: {
        useMutation: (options: { onSuccess: typeof state.onSuccess }) => {
          state.onSuccess = options.onSuccess;
          return { mutate: state.mutate, isPending: false };
        },
      },
    },
  },
}));

import { CompanyRegisterZonesCard } from './CompanyRegisterZonesCard';

describe('CompanyRegisterZonesCard', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    state.settings = { taxRate: 19 };
    state.modules = { 'dine-in': false, quotations: true };
    await i18n.changeLanguage('en');
  });

  it('makes the profile column the editable one and shows its defaults', () => {
    state.settings = { taxRate: 19, businessType: 'pharmacy' };
    render(<CompanyRegisterZonesCard />);

    expect(screen.getByTestId('register-zones-own-column')).toHaveTextContent('Pharmacy');
    expect(screen.getByTestId('register-zone-toggle-quick-keys')).toHaveAttribute(
      'aria-checked',
      'false'
    );
    expect(screen.getByTestId('register-zone-toggle-promos-parked')).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByTestId('register-zone-toggle-pharmacy-lot')).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByTestId('register-zone-toggle-units-cut')).toHaveAttribute(
      'aria-checked',
      'false'
    );
    // The selling engine is never switched.
    expect(screen.queryByTestId('register-zone-toggle-checkout')).not.toBeInTheDocument();
    expect(screen.queryByTestId('register-zone-toggle-command-bar')).not.toBeInTheDocument();
  });

  it('adds a column for the register when no profile is chosen', () => {
    render(<CompanyRegisterZonesCard />);

    expect(screen.getByTestId('register-zones-own-column')).toHaveTextContent('Your register');
    expect(screen.getByTestId('register-zone-toggle-credit')).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('switches a zone and mirrors the saved overrides into the session', () => {
    state.settings = { taxRate: 19, businessType: 'pharmacy' };
    render(<CompanyRegisterZonesCard />);

    fireEvent.click(screen.getByTestId('register-zone-toggle-quick-keys'));
    expect(state.mutate).toHaveBeenCalledWith({ zoneId: 'quick-keys', enabled: true });

    state.onSuccess?.({ overrides: { 'quick-keys': true } });
    expect(state.updateTenantSettings).toHaveBeenCalledWith({
      registerZones: { 'quick-keys': true },
    });
  });

  it('marks an override and keeps a zone off while its module is off', () => {
    state.settings = {
      taxRate: 19,
      businessType: 'restaurant',
      registerZones: { 'tip-split': false },
    };
    render(<CompanyRegisterZonesCard />);

    expect(
      within(screen.getByTestId('register-zone-row-tip-split')).getByText('Custom')
    ).toBeInTheDocument();
    const tables = screen.getByTestId('register-zone-toggle-tables');
    expect(tables).toBeDisabled();
    expect(tables).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('register-zone-row-tables')).toHaveTextContent(
      'Needs the Table service module'
    );
  });
});
