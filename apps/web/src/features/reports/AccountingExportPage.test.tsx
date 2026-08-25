import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@/test/utils';

const accountingUseQueryMock = vi.fn();

vi.mock('@/lib/trpc', () => ({
  trpc: {
    sites: {
      list: {
        useQuery: () => ({ data: { items: [] } }),
      },
    },
    reports: {
      accounting: {
        vouchers: {
          useQuery: (input: unknown, options: unknown) => accountingUseQueryMock(input, options),
        },
      },
    },
  },
}));

import { AccountingExportPage } from './AccountingExportPage';

beforeEach(() => {
  accountingUseQueryMock.mockReset();
  accountingUseQueryMock.mockReturnValue({
    data: { vouchers: [], truncated: false },
    error: null,
    isLoading: false,
  });
});

describe('AccountingExportPage date range', () => {
  it('disables the accounting request and exports while the range is invalid', () => {
    render(<AccountingExportPage />);
    expect(accountingUseQueryMock).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ enabled: true })
    );

    fireEvent.change(screen.getByLabelText(/^(From|Desde)$/), {
      target: { value: '9999-12-31' },
    });

    expect(accountingUseQueryMock).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ enabled: false })
    );
    expect(screen.getByTestId('accounting-invalid-range')).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('accounting-export-journal')).toBeDisabled();
    expect(screen.getByTestId('accounting-export-generic')).toBeDisabled();
  });
});
