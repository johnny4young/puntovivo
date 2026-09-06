import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/utils';
import {
  CountIdentityEditor,
  CountIdentityReview,
  type CountIdentityEditorProps,
} from './CountIdentityEditor';

function props(): CountIdentityEditorProps {
  return {
    name: 'Tablet',
    mode: 'serials',
    identities: [],
    lotQuantities: {},
    serialText: '',
    emptyConfirmed: false,
    disabled: false,
    onLotChange: vi.fn(),
    onSerialChange: vi.fn(),
    onEmptyConfirmed: vi.fn(),
  };
}

describe('physical count identity controls', () => {
  it('requires an explicit empty serial count and supports keyboard scanner text', async () => {
    const input = props();
    const user = userEvent.setup();
    render(<CountIdentityEditor {...input} />);
    const scans = screen.getByRole('textbox', { name: 'Counted serial numbers for Tablet' });
    await user.type(scans, 'A');
    expect(input.onSerialChange).toHaveBeenCalledWith('A');
    const empty = screen.getByRole('checkbox', {
      name: 'I confirm no units were found for Tablet',
    });
    expect(empty).not.toBeChecked();
    await user.click(empty);
    expect(input.onEmptyConfirmed).toHaveBeenCalledWith(true);
  });
  it('does not offer an empty confirmation when serials have been entered', () => {
    render(<CountIdentityEditor {...props()} serialText={'A\nB'} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('A\nB');
  });
  it('renders separately labelled lot quantities without book amounts or status', async () => {
    const input = props();
    const user = userEvent.setup();
    render(
      <CountIdentityEditor
        {...input}
        name="Medicine"
        mode="lots"
        identities={[
          {
            code: 'LOT-1',
            countedQuantity: null,
            expectedQuantity: null,
            status: null,
            expiresAt: '2026-10-01',
          },
        ]}
      />
    );
    const quantity = screen.getByRole('spinbutton', {
      name: 'Counted quantity for Medicine, lot LOT-1',
    });
    expect(quantity).toHaveValue(null);
    await user.type(quantity, '2');
    expect(input.onLotChange).toHaveBeenCalledWith('LOT-1', '2');
    expect(screen.queryByText(/Expected/)).not.toBeInTheDocument();
  });
  it('prevents edits while a command is pending', () => {
    render(<CountIdentityEditor {...props()} disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });
  it('exposes submitted per-identity differences even when their total variance is zero', () => {
    render(
      <CountIdentityReview
        identities={[
          {
            code: 'A',
            expectedQuantity: 1,
            countedQuantity: 0,
            status: 'in_stock',
            expiresAt: null,
          },
          {
            code: 'B',
            expectedQuantity: 0,
            countedQuantity: 1,
            status: 'missing',
            expiresAt: null,
          },
        ]}
      />
    );
    expect(screen.getByText('2 identity discrepancies')).toBeVisible();
    expect(screen.getByText('Expected 1 · Counted 0')).toBeInTheDocument();
    expect(screen.getByText('Expected 0 · Counted 1')).toBeInTheDocument();
  });
});
