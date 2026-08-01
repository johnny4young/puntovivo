import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { render } from '@/test/utils';

vi.mock('./ReceiptSharePanel', () => ({
  ReceiptSharePanel: ({ onClose }: { onClose: () => void }) => (
    <div>
      Customer share review
      <button type="button" onClick={onClose}>
        Close review
      </button>
    </div>
  ),
}));

vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({ currentSite: { id: 'site-1', name: 'Central' } }),
}));

import { ReceiptShareSection } from './ReceiptShareSection';

describe('ReceiptShareSection', () => {
  it('keeps sharing optional and opens the review only on operator action', () => {
    render(<ReceiptShareSection saleId="sale-1" />);

    expect(screen.queryByText('Customer share review')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Share receipt' }));
    expect(screen.getByText('Customer share review')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }));
    expect(screen.queryByText('Customer share review')).not.toBeInTheDocument();
  });
});
