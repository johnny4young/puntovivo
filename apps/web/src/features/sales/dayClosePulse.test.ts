import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDayClosePulseText,
  buildDayCloseWhatsAppUrl,
  createDayClosePulsePng,
  pulseComparisonDirection,
  type DayClosePulseCardModel,
} from './dayClosePulse';

const model: DayClosePulseCardModel = {
  brand: 'Puntovivo · Daily pulse',
  title: 'How your business closed',
  date: 'July 10, 2026',
  salesLabel: 'Sales',
  salesValue: '$950.00',
  salesDetail: '12 completed sales',
  marginLabel: 'Gross margin',
  marginValue: '44.2%',
  marginDetail: '$420.00 gross profit',
  averageTicketLabel: 'Average ticket',
  averageTicketValue: '$79.17',
  comparisonLabel: 'Weekly comparison',
  comparisonValue: '18.8% more than the same weekday last week ($800.00).',
  privacyNote: 'Includes aggregate metrics only; no customer data is shared.',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('day-close pulse helpers', () => {
  it('builds deterministic aggregate-only text and an encoded WhatsApp URL', () => {
    const text = buildDayClosePulseText(model);
    expect(text).toContain('Sales: $950.00 (12 completed sales)');
    expect(text).toContain('Average ticket: $79.17');
    expect(text).not.toContain('customer@example.com');

    const url = buildDayCloseWhatsAppUrl(model);
    expect(url).toBe(`https://wa.me/?text=${encodeURIComponent(text)}`);
  });

  it.each([
    [18.8, 'up'],
    [-12.5, 'down'],
    [0, 'flat'],
    [null, 'unavailable'],
  ] as const)('classifies the %s comparison as %s', (value, expected) => {
    expect(pulseComparisonDirection(value)).toBe(expected);
  });

  it('renders the social card to a client-side PNG canvas', async () => {
    const fillText = vi.fn();
    const addColorStop = vi.fn();
    const context = {
      fillStyle: '',
      font: '',
      fillRect: vi.fn(),
      fillText,
      measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
      createLinearGradient: vi.fn(() => ({ addColorStop })),
    } as unknown as CanvasRenderingContext2D;
    const png = new Blob(['png'], { type: 'image/png' });
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toBlob: vi.fn((callback: BlobCallback, type?: string) => {
        expect(type).toBe('image/png');
        callback(png);
      }),
    } as unknown as HTMLCanvasElement;
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(tagName =>
      tagName === 'canvas' ? canvas : createElement(tagName)
    );

    await expect(createDayClosePulsePng(model)).resolves.toBe(png);
    expect(canvas.width).toBe(1_200);
    expect(canvas.height).toBe(1_200);
    expect(addColorStop).toHaveBeenCalledTimes(2);
    expect(fillText.mock.calls.flat()).toContain('How your business closed');
  });
});
