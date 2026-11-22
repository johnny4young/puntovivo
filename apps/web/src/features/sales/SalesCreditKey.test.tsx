import type { ContextType, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { render } from '@/test/utils';
import { AuthContext } from '@/features/auth/AuthContext';
import { formatCurrency } from '@/lib/utils';
import { SalesCreditKey } from './SalesCreditKey';

type AuthValue = ContextType<typeof AuthContext>;

function asProfile(businessType: string) {
  return ({ children }: { children: ReactNode }) => (
    <AuthContext.Provider
      value={{ tenant: { settings: { businessType } } } as unknown as AuthValue}
    >
      {children}
    </AuthContext.Provider>
  );
}

const BASE = {
  className: 'sales-secondary-key',
  disabled: false,
  creditLimit: 150_000,
  testId: 'credit-key',
};

describe('SalesCreditKey', () => {
  it('says Fiar and what the account would come to', () => {
    const onClick = vi.fn();
    render(<SalesCreditKey {...BASE} onClick={onClick} projectedBalance={103_100} />);

    const key = screen.getByTestId('credit-key');
    expect(key).toHaveTextContent('On credit');
    expect(screen.getByTestId('credit-key-projection')).toHaveTextContent(
      `would owe ${formatCurrency(103_100)}`
    );
    expect(screen.getByTestId('credit-key-projection')).not.toHaveAttribute('data-over');
    fireEvent.click(key);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('warns when the ticket would pass the cupo', () => {
    render(<SalesCreditKey {...BASE} projectedBalance={160_000} />);
    const projection = screen.getByTestId('credit-key-projection');
    expect(projection).toHaveAttribute('data-over', 'true');
    expect(projection).toHaveTextContent('over the credit limit');
  });

  it('leaves the projection out until the account is known', () => {
    render(<SalesCreditKey {...BASE} projectedBalance={null} />);
    expect(screen.queryByTestId('credit-key-projection')).not.toBeInTheDocument();
  });

  it('sells on account for hardware stores', () => {
    const Wrapper = asProfile('hardware');
    render(
      <Wrapper>
        <SalesCreditKey {...BASE} projectedBalance={3_020_985} creditLimit={5_000_000} />
      </Wrapper>
    );
    expect(screen.getByTestId('credit-key')).toHaveTextContent('On account');
    expect(screen.getByTestId('credit-key-projection')).toHaveTextContent(
      `owes ${formatCurrency(3_020_985)} after`
    );
  });

  it('shows only the amount on a narrow key and keeps the sentence for screen readers', () => {
    render(<SalesCreditKey {...BASE} projectedBalance={88_300} compact />);
    const projection = screen.getByTestId('credit-key-projection');
    expect(projection.querySelector('[aria-hidden="true"]')).toHaveTextContent(
      formatCurrency(88_300)
    );
    expect(projection.querySelector('.sr-only')).toHaveTextContent(
      `would owe ${formatCurrency(88_300)}`
    );
  });
});
