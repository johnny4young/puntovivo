import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act, fireEvent } from '@testing-library/react';
import { render, screen } from '@/test/utils';
import i18n from '@/i18n';
import { ConnectorForm } from './ConnectorForm';
import { generateConnectorSecret } from './connectorSecret';
import type { ExternalConnector } from './types';
const h = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (path: string) => ({
    mutateAsync: path.endsWith('createConnector') ? h.create : h.update,
    isPending: false,
  }),
}));
beforeEach(async () => {
  vi.clearAllMocks();
  h.create.mockResolvedValue({});
  h.update.mockResolvedValue({});
  await i18n.changeLanguage('en');
});
async function prepare() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Connector name'), 'Sandbox');
  await user.click(screen.getByRole('button', { name: 'Generate secure key' }));
  return user;
}
describe('Connector credential ownership', () => {
  it('generates 32 cryptographic bytes, with no random fallback', () => {
    const random = vi.spyOn(crypto, 'getRandomValues');
    const first = generateConnectorSecret(),
      second = generateConnectorSecret();
    expect(random).toHaveBeenCalledWith(expect.any(Uint8Array));
    expect(random.mock.calls[0]?.[0]?.byteLength).toBe(32);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
    random.mockImplementationOnce(() => {
      throw new Error('unavailable');
    });
    expect(() => generateConnectorSecret()).toThrow('unavailable');
    random.mockRestore();
  });
  it('requires secure-save consent and resets consent after regeneration', async () => {
    const saved = vi.fn();
    render(<ConnectorForm siteId="site" onSaved={saved} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Create connector' })).toBeDisabled();
    const user = await prepare();
    const key = screen.getByLabelText('Signing key');
    expect(key).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Create connector' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Show key' }));
    expect(key).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Generate secure key' }));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(key).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('checkbox'));
    const secret = (key as HTMLInputElement).value;
    await user.click(screen.getByRole('button', { name: 'Create connector' }));
    expect(h.create).toHaveBeenCalledWith({
      siteId: 'site',
      name: 'Sandbox',
      adapter: 'sandbox_v1',
      secret,
    });
    expect(saved).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText('Signing key')).not.toBeInTheDocument();
  });
  it('coalesces immediate submit attempts and masks unexpected errors', async () => {
    let reject!: (failure: unknown) => void;
    h.create.mockImplementation(
      () =>
        new Promise((_resolve, r) => {
          reject = r;
        })
    );
    render(<ConnectorForm siteId="site" onSaved={vi.fn()} onCancel={vi.fn()} />);
    const user = await prepare();
    await user.click(screen.getByRole('checkbox'));
    const form = screen.getByRole('form', { name: 'Create connector' });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(h.create).toHaveBeenCalledOnce();
    await act(async () => {
      reject({ data: { code: 'INTERNAL_SERVER_ERROR' }, message: 'SQLite secret.db failed' });
    });
    expect(await screen.findByRole('alert')).not.toHaveTextContent('secret.db');
  });
  it('rotates an explicit version without retrieving or echoing the old key', async () => {
    const connector = {
      id: 'connector',
      name: 'Shop',
      version: 4,
      enabled: true,
    } as ExternalConnector;
    render(
      <ConnectorForm siteId="site" connector={connector} onSaved={vi.fn()} onCancel={vi.fn()} />
    );
    expect(screen.getByText(/old key stops working immediately/)).toBeVisible();
    expect(screen.queryByLabelText('Signing key')).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Generate secure key' }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Rotate key' }));
    expect(h.update).toHaveBeenCalledWith({
      siteId: 'site',
      id: 'connector',
      expectedVersion: 4,
      enabled: true,
      secret: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    expect(h.create).not.toHaveBeenCalled();
  });
});
