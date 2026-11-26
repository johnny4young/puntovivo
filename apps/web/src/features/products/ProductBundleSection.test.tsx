import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mutateMock } = vi.hoisted(() => ({ mutateMock: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
        useMutation: () => ({ mutate: mutateMock, isPending: false }),
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
});
