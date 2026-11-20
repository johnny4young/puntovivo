import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TransferQrCode } from './TransferQrCode';

const createMock = vi.hoisted(() => vi.fn());
vi.mock('qrcode', () => ({ create: createMock }));

describe('TransferQrCode', () => {
  it('draws the QR once encoded and keeps the placeholder out of the accessibility tree', async () => {
    createMock.mockReturnValue({ modules: { size: 1, data: new Uint8Array([1]) } });
    render(<TransferQrCode payload="000201abc" label="QR to Nequi" testId="qr" />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'QR to Nequi' })).toBeInTheDocument();
    expect(screen.getByTestId('qr')).toHaveAttribute('data-ready', 'true');
  });

  it('renders nothing when the payload cannot be encoded', async () => {
    createMock.mockImplementation(() => {
      throw new Error('too long');
    });
    render(<TransferQrCode payload="x" label="QR to Nequi" testId="qr" />);

    await waitFor(() => expect(screen.queryByTestId('qr')).not.toBeInTheDocument());
  });
});
