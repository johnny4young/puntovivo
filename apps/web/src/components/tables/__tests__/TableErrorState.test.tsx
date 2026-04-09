import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/utils';
import { TableErrorState } from '../TableErrorState';

describe('TableErrorState', () => {
  it('renders the provided title and message', () => {
    render(<TableErrorState title="Unable to load products" message="Network request failed" />);

    expect(screen.getByText('Unable to load products')).toBeInTheDocument();
    expect(screen.getByText('Network request failed')).toBeInTheDocument();
  });

  it('invokes retry when the retry action is clicked', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(
      <TableErrorState
        title="Unable to load products"
        message="Network request failed"
        onRetry={onRetry}
      />
    );

    await user.click(screen.getByRole('button', { name: /retry/i }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
