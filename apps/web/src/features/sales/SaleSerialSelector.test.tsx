import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import i18n from '@/i18n';
import { render } from '@/test/utils';
import { SaleSerialSelector } from './SaleSerialSelector';

const defaultItems = [
  { id: 'serial-1', serialNumber: 'SN-001', status: 'in_stock' },
  { id: 'serial-2', serialNumber: 'SN-002', status: 'returned' },
];

const queryState = {
  data: {
    items: defaultItems,
  },
  isLoading: false,
  isError: false,
  refetch: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@/lib/trpc', () => ({
  trpc: {
    productSerials: {
      list: { useQuery: () => queryState },
    },
  },
}));

beforeEach(async () => {
  queryState.data = { items: defaultItems };
  queryState.isLoading = false;
  queryState.isError = false;
  queryState.refetch.mockClear();
  await i18n.changeLanguage('en');
});

describe('SaleSerialSelector (ENG-110c)', () => {
  it('requires exactly one available identity per base unit', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <SaleSerialSelector
        siteId="site-1"
        productId="product-1"
        productName="Laptop"
        requiredCount={1}
        selectedIds={[]}
        onChange={onChange}
      />
    );

    expect(screen.getByText('0 / 1 selected')).toBeVisible();
    expect(screen.getByText('Returned')).toBeVisible();
    await user.click(screen.getByRole('checkbox', { name: /SN-001/ }));
    expect(onChange).toHaveBeenCalledWith(['serial-1']);

    rerender(
      <SaleSerialSelector
        siteId="site-1"
        productId="product-1"
        productName="Laptop"
        requiredCount={1}
        selectedIds={['serial-1']}
        onChange={onChange}
      />
    );
    expect(screen.getByText('1 / 1 selected')).toBeVisible();
    expect(screen.queryByText(/Select one exact serial/)).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /SN-002/ })).toBeDisabled();
  });

  it('prevents selecting one physical identity on two cart lines', () => {
    render(
      <SaleSerialSelector
        siteId="site-1"
        productId="product-1"
        productName="Laptop"
        requiredCount={2}
        selectedIds={[]}
        unavailableIds={['serial-1']}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByRole('checkbox', { name: /SN-001/ })).toBeDisabled();
    expect(screen.getByText('Used in another line')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: /SN-002/ })).toBeEnabled();
  });

  it('shows a retryable error instead of claiming the site has no inventory', async () => {
    const user = userEvent.setup();
    queryState.isError = true;

    render(
      <SaleSerialSelector
        siteId="site-1"
        productId="product-1"
        productName="Laptop"
        requiredCount={1}
        selectedIds={[]}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Available serial numbers could not be loaded.'
    );
    expect(
      screen.queryByText('No sellable serial numbers are available at this site.')
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(queryState.refetch).toHaveBeenCalledTimes(1);
  });

  it('drops a selected identity after a refetch no longer reports it sellable', async () => {
    queryState.data = { items: [defaultItems[1]!] };
    const onChange = vi.fn();

    render(
      <SaleSerialSelector
        siteId="site-1"
        productId="product-1"
        productName="Laptop"
        requiredCount={1}
        selectedIds={['serial-1']}
        onChange={onChange}
      />
    );

    await waitFor(() => expect(onChange).toHaveBeenCalledWith([]));
    expect(screen.getByText('0 / 1 selected')).toBeVisible();
  });
});
