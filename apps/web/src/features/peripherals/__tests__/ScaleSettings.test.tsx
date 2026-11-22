import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from '@/i18n';
import { render } from '@/test/utils';
import { AuthContext, type AuthContextType } from '@/features/auth/AuthContext';
import { ScaleSettings } from '../ScaleSettings';
import type { ScaleConfig, ScaleSettingsState } from '@/types/electron';

const original = window.electron;
const ports = [
  { path: '/dev/tty.usbserial-1', label: 'FTDI (/dev/tty.usbserial-1)' },
  { path: '/dev/tty.usbserial-2', label: '/dev/tty.usbserial-2' },
];

function setup(state: Partial<ScaleSettingsState> = {}) {
  let current: ScaleSettingsState = { available: true, ports, config: null, ...state };
  const api = {
    getScaleSettings: vi.fn(async () => current),
    saveScaleSettings: vi.fn(async (config: ScaleConfig | null) => {
      current = { ...current, config };
      return { status: 'saved' as const, settings: current };
    }),
    testScale: vi.fn(async () => ({ status: 'ok' as const, kilograms: 0.385 })),
  };
  window.electron = api as unknown as NonNullable<typeof window.electron>;
  render(
    <AuthContext.Provider
      value={{ user: { id: 'admin', tenantId: 'synthetic' } } as AuthContextType}
    >
      <ScaleSettings />
    </AuthContext.Provider>
  );
  return api;
}

describe('scale settings on this computer', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
  });
  afterEach(() => {
    if (original) window.electron = original;
    else delete window.electron;
  });

  it('tests a draft before saving it, then saves the chosen port', async () => {
    const user = userEvent.setup();
    const api = setup();
    const port = await screen.findByTestId('scale-settings-port');
    await waitFor(() => expect(port).toBeEnabled());
    expect(screen.getByTestId('scale-settings-save')).toBeDisabled();
    expect(screen.getByTestId('scale-settings-test')).toBeDisabled();

    await user.selectOptions(port, '/dev/tty.usbserial-2');
    await user.selectOptions(screen.getByTestId('scale-settings-protocol'), 'toledo');
    expect(screen.getByTestId('scale-settings-framing')).toHaveValue('7E1');
    await user.click(screen.getByRole('button', { name: 'Test reading' }));
    const draft = {
      path: '/dev/tty.usbserial-2',
      protocol: 'toledo',
      baudRate: 9600,
      framing: '7E1',
    };
    expect(api.testScale).toHaveBeenCalledWith(draft);
    expect(await screen.findByTestId('scale-settings-result')).toHaveTextContent('Read 0.385 kg.');
    expect(api.saveScaleSettings).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.saveScaleSettings).toHaveBeenCalledWith(draft);
    expect(await screen.findByText('Scale saved.')).toBeVisible();
    expect(screen.getByTestId('scale-settings-save')).toBeDisabled();
  });

  it('flags a saved port that is no longer connected and can remove it', async () => {
    await i18next.changeLanguage('es');
    const user = userEvent.setup();
    const api = setup({
      config: { path: 'COM7', protocol: 'enq', baudRate: 4800, framing: '8N1' },
    });
    const port = await screen.findByTestId('scale-settings-port');
    await waitFor(() => expect(port).toHaveValue('COM7'));
    expect(screen.getByRole('option', { name: 'COM7 (no conectada)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Probar lectura' })).toBeDisabled();

    await user.selectOptions(port, '');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(api.saveScaleSettings).toHaveBeenCalledWith(null);
  });

  it('says so when this computer cannot read serial scales', async () => {
    setup({ available: false, ports: [] });
    expect(
      await screen.findByText(
        'This computer cannot read serial scales. Weights are typed at the till.'
      )
    ).toBeVisible();
    expect(screen.queryByTestId('scale-settings-port')).not.toBeInTheDocument();
  });

  it('renders nothing outside the desktop app', () => {
    delete window.electron;
    const { container } = render(
      <AuthContext.Provider value={{ user: null } as AuthContextType}>
        <ScaleSettings />
      </AuthContext.Provider>
    );
    expect(container).toBeEmptyDOMElement();
  });
});
