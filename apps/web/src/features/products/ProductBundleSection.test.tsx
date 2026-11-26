import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mutateMock, mutationOptions } = vi.hoisted(() => ({
  mutateMock: vi.fn(),
  mutationOptions: { current: null as null | { onError?: (error: unknown) => void } },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key.startsWith('errors:') ? `translated ${key}` : key),
  }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ products: { getBundleComponents: { invalidate: vi.fn() } } }),
    products: {
      getBundleComponents: {
        useQuery: () => ({
          data: [
            {
              componentProductId: 'c1',
              componentName: 'Coca-Cola 400ml',
              componentSku: 'CC-400',
              quantity: 1,
            },
          ],
        }),
      },
      search: { useQuery: () => ({ data: { items: [] } }) },
      setBundleComponents: {
        useMutation: (options: { onError?: (error: unknown) => void }) => {
          mutationOptions.current = options;
          return { mutate: mutateMock, isPending: false };
        },
      },
    },
  },
}));

import { ProductBundleSection } from './ProductBundleSection';

describe('ProductBundleSection', () => {
  beforeEach(() => mutateMock.mockReset());

  it('keeps a fractional component quantity typed through a leading zero', () => {
    render(<ProductBundleSection productId="bundle-1" />);
    const input = screen.getByLabelText('bundles.quantity') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '0' } });
    expect(input.value).toBe('0');
    fireEvent.change(input, { target: { value: '0.5' } });
    fireEvent.blur(input);

    fireEvent.click(screen.getByText('bundles.save'));
    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        components: [expect.objectContaining({ componentProductId: 'c1', quantity: 0.5 })],
      })
    );
  });

  it('shows the translated server reason when saving fails', () => {
    render(<ProductBundleSection productId="bundle-1" />);
    act(() => {
      mutationOptions.current?.onError?.({ data: { errorCode: 'PRODUCT_BUNDLE_TRACKS_STOCK' } });
    });
    expect(screen.getByText(/^translated errors:.*PRODUCT_BUNDLE_TRACKS_STOCK$/)).toBeTruthy();
  });
});
