import { describe, expect, it } from 'vitest';
import {
  buildOwnerSummaryUrl,
  closeProgress,
  electronicTotal,
  fiscalInProgress,
  lastClosed,
  strokesToPath,
} from './closeModel';
import { closeChecklistFixture, closeReportFixture } from './fixtures';

describe('closeProgress', () => {
  it('counts what still needs the manager and keeps fiscal and anomalies as ready', () => {
    const progress = closeProgress(closeReportFixture(), closeChecklistFixture(), false);
    // registers, two differences, one draft, fiscal, anomalies, signature
    expect(progress.total).toBe(7);
    expect(progress.pendingDrafts).toHaveLength(1);
    expect(progress.ready).toBe(4);
    expect(progress.counted).toBe(true);
    expect(progress.compared).toBe(false);
  });

  it('marks count pending while a register is open and shows one balanced row without differences', () => {
    const checklist = closeChecklistFixture({
      sessions: [
        { ...closeChecklistFixture().sessions[0]!, overShort: 0, hasDifference: false },
        {
          ...closeChecklistFixture().sessions[1]!,
          status: 'open',
          closedAt: null,
          overShort: null,
          hasDifference: false,
          differenceReason: null,
        },
      ],
      drafts: [],
    });
    const report = closeReportFixture({
      fiscal: { ...closeReportFixture().fiscal, total: 0 },
    });
    const progress = closeProgress(report, checklist, false);
    expect(progress.differences).toHaveLength(0);
    expect(progress.counted).toBe(false);
    expect(progress.total).toBe(4);
    expect(progress.ready).toBe(2);
  });

  it('folds every sale left for tomorrow into one row', () => {
    const draft = closeChecklistFixture().drafts[0]!;
    const checklist = closeChecklistFixture({
      drafts: [
        { ...draft, id: 'a', carriedOver: true },
        { ...draft, id: 'b', carriedOver: true },
        { ...draft, id: 'c' },
      ],
    });
    const progress = closeProgress(closeReportFixture(), checklist, false);
    expect(progress.carriedDrafts).toHaveLength(2);
    expect(progress.carriedTotal).toBe(84_200);
    expect(progress.total).toBe(8);
    expect(progress.ready).toBe(5);
  });

  it('is complete once signed and nothing is pending', () => {
    const checklist = closeChecklistFixture({
      sessions: closeChecklistFixture().sessions.map(session => ({
        ...session,
        differenceReason: 'other' as const,
      })),
      drafts: [{ ...closeChecklistFixture().drafts[0]!, carriedOver: true }],
    });
    const progress = closeProgress(closeReportFixture(), checklist, true);
    expect(progress.ready).toBe(progress.total);
  });
});

describe('close figures', () => {
  it('adds card and transfer, and counts fiscal documents still in progress', () => {
    expect(electronicTotal(closeReportFixture())).toBe(3_313_200);
    expect(fiscalInProgress(closeReportFixture())).toBe(2);
  });

  it('names the register closed last', () => {
    expect(lastClosed(closeChecklistFixture().sessions)?.registerName).toBe('Caja 2');
    expect(lastClosed([])).toBeNull();
  });
});

describe('strokesToPath', () => {
  it('writes moves and lines rounded to one decimal, never negative', () => {
    expect(
      strokesToPath([
        [
          { x: 10.04, y: 20 },
          { x: 12.56, y: -3 },
        ],
        [{ x: 40, y: 20.25 }],
        [],
      ])
    ).toBe('M10 20L12.6 0M40 20.3');
  });
});

describe('buildOwnerSummaryUrl', () => {
  it('opens WhatsApp with the lines and lets the person pick the contact', () => {
    const url = buildOwnerSummaryUrl({
      title: 'Cierre',
      lines: ['Vendido: $ 1'],
      footer: 'Firmado',
    });
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(url.split('text=')[1]!)).toBe('Cierre\nVendido: $ 1\n\nFirmado');
  });
});
