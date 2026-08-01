import { describe, expect, it } from 'vitest';
import { buildReceiptImageFilename, buildReceiptWhatsAppUrl } from './receiptShare';

describe('receipt share helpers', () => {
  it('builds an explicit WhatsApp handoff without selecting a recipient', () => {
    const url = buildReceiptWhatsAppUrl('Receipt V-1\nTotal: $10');

    expect(url).toBe('https://wa.me/?text=Receipt%20V-1%0ATotal%3A%20%2410');
    expect(url).not.toContain('phone=');
  });

  it('encodes Unicode receipt text and accepts an empty handoff safely', () => {
    expect(buildReceiptWhatsAppUrl('Recibo Ñ-1\nCafé: $10')).toBe(
      'https://wa.me/?text=Recibo%20%C3%91-1%0ACaf%C3%A9%3A%20%2410'
    );
    expect(buildReceiptWhatsAppUrl('')).toBe('https://wa.me/?text=');
  });

  it('builds a filesystem-safe local image filename', () => {
    expect(buildReceiptImageFilename('FE / 2026 # 001')).toBe('puntovivo-recibo-fe-2026-001.png');
    expect(buildReceiptImageFilename('FÉ-Ñ-001')).toBe('puntovivo-recibo-fe-n-001.png');
    expect(buildReceiptImageFilename('🧾')).toBe('puntovivo-recibo-venta.png');
  });
});
