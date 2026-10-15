import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils';
import { AuthContext, type AuthContextType } from '@/features/auth/AuthContext';
import { SystemPrinterSettings } from '../SystemPrinterSettings';

const original = window.electron;
afterEach(() => {
  if (original) window.electron = original;
  else delete window.electron;
});
function setup(
  selectedDeviceName: string | null = null,
  printers = [
    { name: 'os_one', displayName: 'First' },
    { name: 'os_two', displayName: 'Second' },
  ]
) {
  const test = vi.fn().mockResolvedValue({ success: false, errorCode: 'PRINT_CANCELLED' });
  const select = vi.fn(async (name: string | null) => ({ printers, selectedDeviceName: name }));
  window.electron = {
    getSystemPrinters: vi.fn(async () => ({ printers, selectedDeviceName })),
    selectSystemPrinter: select,
    testSystemPrinter: test,
  } as unknown as NonNullable<typeof window.electron>;
  render(
    <AuthContext.Provider
      value={{ user: { id: 'admin', tenantId: 'synthetic' } } as AuthContextType}
    >
      <SystemPrinterSettings />
    </AuthContext.Provider>
  );
  return { test, select };
}
describe('local system printer controls', () => {
  it('selects a non-default system name without automatically printing, then distinguishes cancellation', async () => {
    const user = userEvent.setup();
    const { test, select } = setup();
    const picker = await screen.findByLabelText('System printer on this computer');
    await waitFor(() => expect(picker).toBeEnabled());
    await user.selectOptions(picker, 'os_two');
    await waitFor(() => expect(select).toHaveBeenCalledWith('os_two'));
    expect(test).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Print a test ticket' }));
    expect(
      await screen.findByText('Print test canceled. No automatic retry was scheduled.')
    ).toBeVisible();
    expect(test).toHaveBeenCalledTimes(1);
  });
  it('retains a missing explicit selection without falling back to another printer', async () => {
    const { select, test } = setup('missing_queue');
    expect(await screen.findByText(/The saved printer is missing/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Print a test ticket' })).toBeDisabled();
    expect(select).not.toHaveBeenCalled();
    expect(test).not.toHaveBeenCalled();
  });
  it('explains absence of system queues and disables physical-test action', async () => {
    setup(null, []);
    expect(await screen.findByText(/No printers found/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Print a test ticket' })).toBeDisabled();
  });
});
