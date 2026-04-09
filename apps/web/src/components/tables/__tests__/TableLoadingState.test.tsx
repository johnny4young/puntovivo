import { describe, expect, it } from 'vitest';
import { render, screen } from '@/test/utils';
import { TableLoadingState } from '../TableLoadingState';

describe('TableLoadingState', () => {
  it('renders an accessible loading status with the provided message', () => {
    render(<TableLoadingState message="Loading products..." />);

    expect(screen.getByRole('status', { name: /loading products/i })).toBeInTheDocument();
  });

  it('renders the requested number of placeholder rows', () => {
    const { container } = render(<TableLoadingState message="Loading users..." rowCount={5} />);

    expect(container.querySelectorAll('.divide-y > div')).toHaveLength(5);
  });
});
