import { createRef, useState, type ComponentProps } from 'react';
import { fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/utils';
import { SalesQuickSearchBar } from './SalesQuickSearchBar';
import { buildRegisterBarActions } from './registerBarActions';

const phone = vi.hoisted(() => ({ layout: false, camera: false }));
vi.mock('./usePhoneLayout', () => ({ usePhoneLayout: () => phone.layout }));
vi.mock('./cameraScan', async importOriginal => ({
  ...(await importOriginal<typeof import('./cameraScan')>()),
  isCameraScanSupported: () => phone.camera,
}));
vi.mock('./CameraScanDialog', () => ({
  CameraScanDialog: ({ onDetected }: { onDetected: (code: string) => void }) => (
    <button type="button" onClick={() => onDetected('7701234567890')}>
      fake camera read
    </button>
  ),
}));

const PLACEHOLDER = 'Scan, or type a product, code or command';

type BarProps = ComponentProps<typeof SalesQuickSearchBar>;

function Harness(props: Partial<BarProps>) {
  const [query, setQuery] = useState('');
  const [quantity, setQuantity] = useState<number | null>(null);
  return (
    <SalesQuickSearchBar
      query={query}
      onQueryChange={setQuery}
      onSubmit={vi.fn()}
      inputRef={createRef<HTMLInputElement>()}
      pendingQuantity={quantity}
      onPendingQuantityChange={setQuantity}
      {...props}
    />
  );
}

function input() {
  return screen.getByRole('combobox');
}

function type(value: string) {
  fireEvent.change(input(), { target: { value } });
}

describe('SalesQuickSearchBar', () => {
  it('advertises the grammar and the search key while editable', () => {
    render(<Harness onAttachCustomer={vi.fn()} />);

    expect(screen.getByPlaceholderText(PLACEHOLDER)).toHaveAttribute('aria-keyshortcuts', 'Alt+P');
    expect(input()).toHaveAccessibleDescription(
      'Type 3* before scanning to sell three, @ to find a customer or / to see register actions.'
    );
    const search = screen.getByRole('button', { name: 'Search' });
    expect(search).toHaveAttribute('aria-keyshortcuts', 'F5');
    expect(search).toHaveTextContent('F5');
    for (const [key, label] of [
      ['3*', 'quantity'],
      ['@', 'customer'],
      ['/', 'action'],
    ] as const) {
      expect(screen.getByText(key)).toBeInTheDocument();
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('does not advertise or dispatch product input for a locked ticket', () => {
    const onSubmit = vi.fn();
    const { container } = render(<Harness disabled onSubmit={onSubmit} />);

    expect(
      screen.getByText(
        'Product search and scanner input are disabled for this locked ticket. Continue with the permitted checkout actions.'
      )
    ).toBeVisible();
    const field = screen.getByPlaceholderText(PLACEHOLDER);
    const submit = screen.getByRole('button', { name: 'Search' });
    expect(field).toBeDisabled();
    expect(field).not.toHaveAttribute('aria-keyshortcuts');
    expect(submit).toBeDisabled();
    expect(submit).not.toHaveAttribute('aria-keyshortcuts');
    expect(screen.queryByText('F5')).not.toBeInTheDocument();
    expect(screen.queryByText('3*')).not.toBeInTheDocument();

    fireEvent.submit(container.querySelector('form')!);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('opens the product search with plain text on Enter', () => {
    const onSubmit = vi.fn();
    const { container } = render(<Harness onSubmit={onSubmit} />);

    type('arroz');
    fireEvent.submit(container.querySelector('form')!);

    expect(onSubmit).toHaveBeenCalledWith('arroz');
  });

  it('adds a typed exact code directly and searches only when it matches nothing', async () => {
    const onSubmit = vi.fn();
    const onSubmitCode = vi.fn<(query: string) => Promise<boolean>>();
    const { container } = render(<Harness onSubmit={onSubmit} onSubmitCode={onSubmitCode} />);

    onSubmitCode.mockResolvedValueOnce(true);
    type('7702001000028');
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(onSubmitCode).toHaveBeenCalledWith('7702001000028'));
    expect(onSubmit).not.toHaveBeenCalled();

    onSubmitCode.mockResolvedValueOnce(false);
    type('arroz');
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('arroz'));
  });

  it('turns 3* into a pending quantity chip that can be cleared', () => {
    render(<Harness />);

    type('3*');
    expect(input()).toHaveValue('');
    expect(screen.getByTestId('sales-command-quantity')).toHaveTextContent('Qty 3');
    expect(screen.getByRole('status')).toHaveTextContent('Quantity for the next read: 3');

    fireEvent.keyDown(input(), { key: 'Backspace' });
    expect(screen.queryByTestId('sales-command-quantity')).not.toBeInTheDocument();

    type('2*leche');
    expect(input()).toHaveValue('leche');
    fireEvent.click(screen.getByRole('button', { name: 'Clear quantity' }));
    expect(screen.queryByTestId('sales-command-quantity')).not.toBeInTheDocument();
  });

  it('lists register actions with their keys after / and runs the chosen one', () => {
    const suspend = vi.fn();
    const newSale = vi.fn();
    const returns = vi.fn();
    const { container } = render(
      <Harness actions={buildRegisterBarActions({ suspend, returns, newSale })} />
    );

    type('/');
    const options = screen.getAllByRole('option');
    expect(options.map(option => option.textContent)).toEqual([
      expect.stringContaining('Suspend sale'),
      'Return',
      expect.stringContaining('New sale'),
    ]);
    expect(input()).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(input()).toHaveAttribute('aria-activedescendant', 'sales-command-option-newSale');
    fireEvent.submit(container.querySelector('form')!);

    expect(newSale).toHaveBeenCalledOnce();
    expect(suspend).not.toHaveBeenCalled();
    expect(input()).toHaveValue('');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('filters actions without accents and says when nothing matches', () => {
    const returns = vi.fn();
    render(<Harness actions={buildRegisterBarActions({ returns, newSale: vi.fn() })} />);

    type('/RET');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('sales-command-option-returns'));
    expect(returns).toHaveBeenCalledOnce();

    type('/zzz');
    expect(screen.getByText('No action matches')).toBeInTheDocument();
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(input()).toHaveValue('');
  });

  it('attaches a customer found after @', () => {
    const customers = [
      { id: 'c1', name: 'María López', detail: '1020304050' },
      { id: 'c2', name: 'Mario Ruiz', detail: null },
    ];
    const onAttachCustomer = vi.fn();
    const { container } = render(
      <Harness onAttachCustomer={onAttachCustomer} customers={customers} />
    );

    type('@ mar');
    expect(screen.getByText('1020304050')).toBeInTheDocument();
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.submit(container.querySelector('form')!);

    expect(onAttachCustomer).toHaveBeenCalledWith({ id: 'c2', name: 'Mario Ruiz' });
    expect(input()).toHaveValue('');
  });

  it('offers walk-in when a customer is attached and creating when allowed', () => {
    const onAttachCustomer = vi.fn();
    const onCreateCustomer = vi.fn();
    render(
      <Harness
        customers={[{ id: 'c1', name: 'María López', detail: null }]}
        attachedCustomerId="c1"
        onAttachCustomer={onAttachCustomer}
        onCreateCustomer={onCreateCustomer}
      />
    );

    type('@Rosa');
    expect(screen.getAllByRole('option').at(-1)).toHaveTextContent('Back to walk-in customer');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('María López');
    fireEvent.click(screen.getByTestId('sales-command-option-walk-in'));
    expect(onAttachCustomer).toHaveBeenCalledWith(null);

    type('@Rosa');
    fireEvent.click(screen.getByRole('option', { name: 'Create customer “Rosa”' }));
    expect(onCreateCustomer).toHaveBeenCalledWith('Rosa');
  });

  it('keeps the attached customer when Enter lands on the walk-in row alone', () => {
    const onAttachCustomer = vi.fn();
    const { container } = render(
      <Harness customers={[]} attachedCustomerId="c1" onAttachCustomer={onAttachCustomer} />
    );

    type('@zzz');
    fireEvent.submit(container.querySelector('form')!);
    expect(onAttachCustomer).not.toHaveBeenCalled();

    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.submit(container.querySelector('form')!);
    expect(onAttachCustomer).toHaveBeenCalledWith(null);
  });

  it('lists no customers while the lookup is still loading', () => {
    render(
      <Harness
        customers={[{ id: 'c1', name: 'María López', detail: null }]}
        isLoadingCustomers
        onAttachCustomer={vi.fn()}
        onCreateCustomer={vi.fn()}
      />
    );

    type('@Mar');

    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(screen.getByText('Loading')).toBeVisible();
  });

  it('asks for text before listing customers', () => {
    render(<Harness onAttachCustomer={vi.fn()} />);

    type('@');

    expect(screen.getByText('Type a name, document or phone')).toBeVisible();
  });

  it('explains that a frozen ticket keeps its customer', () => {
    render(<Harness />);

    type('@ana');

    expect(screen.getByText('This ticket’s customer is fixed and cannot be changed')).toBeVisible();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  describe('on a phone', () => {
    afterEach(() => {
      phone.layout = false;
      phone.camera = false;
    });

    it('asks for a product, opens search from the icon and hides the desktop key hints', () => {
      phone.layout = true;
      const onSubmit = vi.fn();
      render(<Harness onSubmit={onSubmit} />);

      expect(screen.getByPlaceholderText('Search for a product')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Search' })).toHaveLength(1);
      fireEvent.click(screen.getByRole('button', { name: 'Search' }));
      expect(onSubmit).toHaveBeenCalledWith('');
      expect(screen.queryByText('F5')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Scan with the camera' })
      ).not.toBeInTheDocument();
    });

    it('sends a camera read down the scanner path when the device can scan', async () => {
      phone.layout = true;
      phone.camera = true;
      const onCameraCode = vi.fn();
      render(<Harness onCameraCode={onCameraCode} />);

      fireEvent.click(screen.getByRole('button', { name: 'Scan with the camera' }));
      fireEvent.click(await screen.findByRole('button', { name: 'fake camera read' }));

      expect(onCameraCode).toHaveBeenCalledWith('7701234567890');
      expect(screen.queryByRole('button', { name: 'fake camera read' })).not.toBeInTheDocument();
    });

    it('offers no camera on a locked ticket', () => {
      phone.layout = true;
      phone.camera = true;
      render(<Harness disabled onCameraCode={vi.fn()} />);
      expect(
        screen.queryByRole('button', { name: 'Scan with the camera' })
      ).not.toBeInTheDocument();
    });
  });
});
