import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import i18next from '@/i18n';
import { render, screen, waitFor } from '@/test/utils';
import { AuthContext, type AuthContextType } from '@/features/auth/AuthContext';
import type { ScaleReadResult } from '@/types/electron';
import { buildCartItem } from '@/features/sales/saleCart';
import type { WeighedItemSession } from '@/features/sales/useWeighedItem';
import { WeighedItemPanel } from '@/features/sales/WeighedItemPanel';
import type { ProductSearchSelection } from '@/types';

const selection = {
  product: {
    id: 'p-kg',
    name: 'Queso costeño',
    sku: 'QSO-1',
    price: 24000,
    stock: 10,
    taxRate: 0,
    sellByFraction: true,
    fractionStep: 0.001,
    fractionMinimum: 0.05,
  },
  unit: {
    id: 'ua-1',
    unitId: 'u-kg',
    equivalence: 1,
    price: 24000,
    isBase: true,
    unitDimension: 'mass',
    unitReferenceFactor: 1000,
  },
  price: 24000,
} as unknown as ProductSearchSelection;

function renderPanel(applied = 0, discount = 0) {
  const onApply = vi.fn();
  const onClose = vi.fn();
  const session: WeighedItemSession = { id: 1, selection, grams: 1000, applied, scope: null };
  const view = render(
    <AuthContext.Provider
      value={{ user: { id: 'cashier', tenantId: 'synthetic' } } as AuthContextType}
    >
      <WeighedItemPanel
        session={session}
        line={{ ...buildCartItem(selection), discount }}
        onApply={onApply}
        onClose={onClose}
      />
    </AuthContext.Provider>
  );
  return { onApply, onClose, unmount: view.unmount };
}

const originalElectron = window.electron;
function installScale(configured: boolean, readScale: () => Promise<ScaleReadResult>) {
  const read = vi.fn(readScale);
  window.electron = {
    getScaleStatus: vi.fn(async () => ({ configured })),
    readScale: read,
  } as unknown as NonNullable<typeof window.electron>;
  return read;
}

describe('WeighedItemPanel', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
  });
  afterEach(() => {
    if (originalElectron) window.electron = originalElectron;
    else delete window.electron;
  });

  it('applies a weight key and marks it', async () => {
    const user = userEvent.setup();
    const { onApply } = renderPanel();
    expect(screen.getByRole('region', { name: 'Queso costeño · how much did it weigh?' })).toBe(
      screen.getByTestId('weighed-item-panel')
    );
    expect(screen.getByTestId('weighed-item-preset-0.25')).toHaveFocus();
    expect(screen.getByTestId('weighed-item-readout')).toBeEmptyDOMElement();

    await user.click(screen.getByTestId('weighed-item-preset-0.5'));
    expect(onApply).toHaveBeenCalledWith(0.5);
    expect(screen.getByTestId('weighed-item-preset-0.5')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('weighed-item-preset-0.25')).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows what is on the ticket', () => {
    renderPanel(0.25);
    expect(screen.getByTestId('weighed-item-readout')).toHaveTextContent('0.250 kg = $6,000');
  });

  it('sells by value with a live preview at three decimals', async () => {
    const user = userEvent.setup();
    const { onApply } = renderPanel();
    await user.click(screen.getByTestId('weighed-item-value'));
    expect(screen.getByTestId('weighed-item-value')).toHaveAttribute('aria-expanded', 'true');
    await user.type(screen.getByRole('spinbutton', { name: 'Amount' }), '5000');
    expect(screen.getByTestId('weighed-item-readout')).toHaveTextContent('0.208 kg = $4,992');

    await user.click(screen.getByTestId('weighed-item-submit'));
    expect(onApply).toHaveBeenCalledWith(0.208);
    expect(screen.getByTestId('weighed-item-value')).toHaveFocus();
    expect(screen.getByTestId('weighed-item-value')).toHaveTextContent('By value $5,000');
    expect(screen.queryByTestId('weighed-item-value-input')).not.toBeInTheDocument();
  });

  it('sells by value at the discounted line price', async () => {
    const user = userEvent.setup();
    const { onApply } = renderPanel(0, 50);
    await user.click(screen.getByTestId('weighed-item-value'));
    await user.type(screen.getByRole('spinbutton', { name: 'Amount' }), '6000');
    expect(screen.getByTestId('weighed-item-readout')).toHaveTextContent('0.500 kg = $6,000');
    await user.click(screen.getByTestId('weighed-item-submit'));
    expect(onApply).toHaveBeenCalledWith(0.5);
  });

  it('takes a typed weight and refuses one under the minimum', async () => {
    const user = userEvent.setup();
    const { onApply } = renderPanel();
    await user.click(screen.getByTestId('weighed-item-weight'));
    const input = screen.getByRole('spinbutton', { name: 'Weight in kg' });
    await user.type(input, '0.02{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('The minimum is 0.050 kg.');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(onApply).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, '0.75{Enter}');
    expect(onApply).toHaveBeenCalledWith(0.75);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('closes on Escape and on the close button', async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('speaks usted in Spanish', async () => {
    await i18next.changeLanguage('es');
    const user = userEvent.setup();
    renderPanel();
    expect(screen.getByTestId('weighed-item-panel')).toHaveTextContent(
      'Queso costeño · ¿cuánto pesó?'
    );
    await user.click(screen.getByTestId('weighed-item-value'));
    await user.click(screen.getByTestId('weighed-item-submit'));
    expect(screen.getByRole('alert')).toHaveTextContent('Ingrese un valor mayor que cero.');
  });

  it('offers no scale outside the desktop app or before a scale is saved', async () => {
    renderPanel();
    expect(screen.queryByTestId('weighed-item-scale')).not.toBeInTheDocument();
    const read = installScale(false, async () => ({ status: 'ok', kilograms: 1 }));
    renderPanel();
    await waitFor(() => expect(window.electron!.getScaleStatus).toHaveBeenCalled());
    expect(screen.queryByTestId('weighed-item-scale')).not.toBeInTheDocument();
    expect(read).not.toHaveBeenCalled();
  });

  it('puts the scale weight on the line and marks the scale key', async () => {
    const user = userEvent.setup();
    let finish!: (result: ScaleReadResult) => void;
    installScale(true, () => new Promise(resolve => (finish = resolve)));
    const { onApply } = renderPanel();
    const scale = await screen.findByRole('button', { name: 'Read scale' });
    expect(screen.getByTestId('weighed-item-preset-0.25')).toHaveFocus();

    await user.click(scale);
    expect(scale).toHaveTextContent('Reading…');
    expect(scale).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('weighed-item-preset-0.5')).toBeDisabled();
    finish({ status: 'ok', kilograms: 0.385 });

    await waitFor(() => expect(onApply).toHaveBeenCalledWith(0.385));
    expect(scale).toHaveAttribute('aria-pressed', 'true');
    expect(scale).toHaveFocus();
    expect(screen.getByTestId('weighed-item-preset-0.5')).toBeEnabled();
  });

  it('explains a failed reading and keeps the typed weight', async () => {
    await i18next.changeLanguage('es');
    const user = userEvent.setup();
    installScale(true, async () => ({ status: 'error', code: 'SCALE_UNSTABLE' }));
    const { onApply } = renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Leer báscula' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El peso no se estabiliza. Espere a que el producto quede quieto.'
    );
    expect(onApply).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('weighed-item-weight'));
    await user.type(screen.getByTestId('weighed-item-weight-input'), '0.4{Enter}');
    expect(onApply).toHaveBeenCalledWith(0.4);
  });

  it('drops a reading that arrives after the panel closed', async () => {
    const user = userEvent.setup();
    let finish!: (result: ScaleReadResult) => void;
    installScale(true, () => new Promise(resolve => (finish = resolve)));
    const { onApply, unmount } = renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Read scale' }));
    unmount();
    finish({ status: 'ok', kilograms: 0.5 });
    await Promise.resolve();
    expect(onApply).not.toHaveBeenCalled();
  });
});
