import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@/test/utils';
import { ProductBulkBar } from './ProductBulkBar';

const h = vi.hoisted(() => ({
  update: vi.fn(),
  remove: vi.fn(),
  invalidate: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: h.success, warning: h.warning }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ products: { list: { invalidate: h.invalidate } } }),
    products: {
      update: { useMutation: () => ({ mutateAsync: h.update }) },
      delete: { useMutation: () => ({ mutateAsync: h.remove }) },
    },
  },
}));

const selected = [
  { id: 'p-1', version: 3 },
  { id: 'p-2', version: 7 },
];
const categories = [{ id: 'c-1', name: 'Groceries' }];

describe('ProductBulkBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.update.mockResolvedValue({});
    h.remove.mockResolvedValue({});
  });

  it('moves every selected product with the version it was read at', async () => {
    const onDone = vi.fn();
    render(
      <ProductBulkBar selected={selected} categories={categories} canArchive onDone={onDone} />
    );

    await userEvent.selectOptions(screen.getByTestId('products-bulk-category'), 'c-1');

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(h.update).toHaveBeenCalledWith({ id: 'p-1', version: 3, categoryId: 'c-1' });
    expect(h.update).toHaveBeenCalledWith({ id: 'p-2', version: 7, categoryId: 'c-1' });
    expect(h.success).toHaveBeenCalledOnce();
  });

  it('says how many could not change when a row is stale', async () => {
    h.update.mockRejectedValueOnce(new Error('STALE_VERSION'));
    render(
      <ProductBulkBar selected={selected} categories={categories} canArchive onDone={vi.fn()} />
    );

    await userEvent.selectOptions(screen.getByTestId('products-bulk-category'), 'c-1');

    await waitFor(() => expect(h.warning).toHaveBeenCalledOnce());
    expect(h.warning.mock.calls[0]?.[0].title).toMatch(/1 updated, 1 could not change/);
  });

  it('asks before archiving and keeps the action from those who cannot delete', async () => {
    const { unmount } = render(
      <ProductBulkBar selected={selected} categories={categories} canArchive onDone={vi.fn()} />
    );
    await userEvent.click(screen.getByTestId('products-bulk-archive'));
    expect(h.remove).not.toHaveBeenCalled();
    unmount();

    render(
      <ProductBulkBar
        selected={selected}
        categories={categories}
        canArchive={false}
        onDone={vi.fn()}
      />
    );
    expect(screen.queryByTestId('products-bulk-archive')).not.toBeInTheDocument();
  });
});
