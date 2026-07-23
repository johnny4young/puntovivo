import { describe, expect, it } from 'vitest';

import { render, screen } from '@/test/utils';
import { SalesFlowRail } from './SalesFlowRail';

describe('SalesFlowRail', () => {
  it('guides an empty ticket toward capture and opening the register', () => {
    render(<SalesFlowRail itemCount={0} hasCashSession={false} suspendedDraftsCount={12} />);

    expect(screen.getByRole('heading', { name: 'Scan. Review. Charge.' })).toBeInTheDocument();
    expect(screen.getByTestId('sales-flow-capture')).toHaveClass('is-active');
    expect(screen.getByTestId('sales-flow-review')).toHaveClass('is-waiting');
    expect(screen.getByTestId('sales-flow-charge')).toHaveClass('is-locked');
    expect(screen.getByText('Open the cash session to continue')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('surfaces a ready-to-charge ticket without hiding review', () => {
    render(<SalesFlowRail itemCount={3} hasCashSession suspendedDraftsCount={0} />);

    expect(screen.getByTestId('sales-flow-capture')).toHaveClass('is-complete');
    expect(screen.getByTestId('sales-flow-review')).toHaveClass('is-active');
    expect(screen.getByTestId('sales-flow-charge')).toHaveClass('is-ready');
    expect(screen.getByText('3 items captured')).toBeInTheDocument();
    expect(screen.getByText('Ready to charge with F1')).toBeInTheDocument();
  });
});
