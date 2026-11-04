import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/utils';
import { ProductSearchIndexAction } from './ProductSearchIndexAction';

const mutate = vi.fn();
let moduleActive = true;

vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }));
vi.mock('@/features/modules', () => ({ useIsModuleActive: () => moduleActive }));
vi.mock('@/features/products/useRegenerateEmbeddings', () => ({
  useRegenerateEmbeddings: () => ({ mutate, isPending: false }),
}));

describe('ProductSearchIndexAction', () => {
  beforeEach(() => {
    mutate.mockClear();
    moduleActive = true;
  });

  it('rebuilds the index on request', async () => {
    render(<ProductSearchIndexAction />);
    await userEvent.click(screen.getByTestId('ai-search-index-update'));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('stays hidden when smart search is off', () => {
    moduleActive = false;
    render(<ProductSearchIndexAction />);
    expect(screen.queryByTestId('ai-search-index-update')).not.toBeInTheDocument();
  });
});
