import { describe, expect, it } from 'vitest';
import {
  arcPath,
  buildOwnerSummary,
  closeGuideStep,
  ownerWhatsAppUrl,
  soldArcFractions,
  soldChange,
  type CloseGuide,
} from './closeGuideModel';
import { guideFixture } from './fixtures';

describe('closeGuideModel', () => {
  it('walks Contar, Comparar and Firmar from the guide state', () => {
    expect(
      closeGuideStep(guideFixture({ sessions: { closed: 2, open: 1, lastClosed: null } }))
    ).toBe(0);
    expect(closeGuideStep(guideFixture({ readyToSign: false }))).toBe(1);
    expect(closeGuideStep(guideFixture({ readyToSign: true }))).toBe(2);
    expect(
      closeGuideStep(
        guideFixture({
          signoff: {
            id: 's',
            signedAt: '2026-11-12T02:41:00.000Z',
            signedByName: 'Marta',
            signatureMethod: 'pin',
            signatureImage: null,
          },
        } as Partial<CloseGuide>)
      )
    ).toBe(3);
  });

  it('measures today against last week on one scale', () => {
    expect(soldChange(105.8, 100)).toBe(5.8);
    expect(soldChange(10, 0)).toBeNull();
    expect(soldArcFractions(50, 100)).toEqual({ sold: 0.5, comparison: 1 });
    expect(soldArcFractions(200, 0)).toEqual({ sold: 1, comparison: null });
    expect(arcPath(1, 100, 100, 50)).toBe('M 50.0 100.0 A 50 50 0 0 1 150.0 100.0');
  });

  it('builds the owner summary with figures only', () => {
    const text = buildOwnerSummary(
      {
        title: 'Close of Wednesday 11',
        sold: 'Sold',
        cashToDeposit: 'Cash to deposit',
        electronic: 'Card and wallets',
        cashDifference: 'Cash difference',
        signedBy: 'Signed by Marta',
      },
      { sold: '$10', cashToDeposit: '$6', electronic: '$4', cashDifference: '-$1' }
    );
    expect(text.split('\n')).toEqual([
      'Close of Wednesday 11',
      'Sold: $10',
      'Cash to deposit: $6',
      'Card and wallets: $4',
      'Cash difference: -$1',
      '',
      'Signed by Marta',
    ]);
    expect(ownerWhatsAppUrl('a b')).toBe('https://wa.me/?text=a%20b');
  });
});
