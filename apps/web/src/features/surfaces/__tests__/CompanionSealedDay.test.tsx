import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeChecklistFixture,
  closeReportFixture,
  closeSignoffFixture,
} from '@/features/dashboard/close/fixtures';

const { metadata, signoffs, signoffInputs } = vi.hoisted(() => ({
  metadata: { current: null as unknown },
  signoffs: new Map<string, unknown>(),
  signoffInputs: [] as string[],
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    reports: {
      dayClose: {
        signoffMetadata: {
          useQuery: () => ({ data: metadata.current, isSuccess: true, isError: false }),
        },
        signoff: {
          useQuery: ({ date }: { date: string }, { enabled }: { enabled: boolean }) => {
            if (enabled) signoffInputs.push(date);
            return { data: signoffs.get(date) ?? null, isPending: false, isError: false };
          },
        },
        checklist: { useQuery: () => ({ data: closeChecklistFixture() }) },
      },
    },
    operations: {
      dayCurve: {
        useQuery: () => ({
          data: {
            date: '2026-11-11',
            dayStartIso: '2026-11-11T05:00:00.000Z',
            hourly: Array.from({ length: 24 }, (_, hour) => ({
              hour,
              revenue: hour === 12 ? 50_000 : 0,
            })),
          },
        }),
      },
    },
  },
}));

import { CompanionSealedDay } from '../CompanionSealedDay';

beforeEach(() => {
  metadata.current = null;
  signoffs.clear();
  signoffInputs.length = 0;
});

describe('CompanionSealedDay', () => {
  it('shows yesterday until today is signed, with its figures and who signed', () => {
    const report = closeReportFixture({ date: '2026-11-10' });
    signoffs.set('2026-11-10', { ...closeSignoffFixture(report), date: '2026-11-10' });
    render(<CompanionSealedDay businessDay="2026-11-11" requestedDate={null} />);
    expect(signoffInputs.at(-1)).toBe('2026-11-10');
    expect(screen.getByTestId('companion-day-sealed')).toHaveTextContent('Tuesday 10, sealed');
    expect(screen.getByTestId('companion-day-sold')).toBeInTheDocument();
    expect(screen.getByTestId('companion-day-cash')).toHaveTextContent('Cash to deposit');
    expect(screen.getByTestId('companion-day-difference')).toHaveTextContent('Cash difference');
    expect(screen.getByTestId('companion-day-signer')).toHaveTextContent('Signed by Marta Ríos');
    expect(screen.getByTestId('companion-day-full')).toHaveAttribute('href', '/?close=2026-11-10');
    expect(screen.getAllByTestId('day-arc-mark').length).toBeGreaterThan(0);
  });

  it('shows today once it is signed', () => {
    metadata.current = { date: '2026-11-11' };
    const report = closeReportFixture();
    signoffs.set('2026-11-11', closeSignoffFixture(report));
    render(<CompanionSealedDay businessDay="2026-11-11" requestedDate={null} />);
    expect(signoffInputs.at(-1)).toBe('2026-11-11');
    expect(screen.getByTestId('companion-day-sealed')).toHaveTextContent('Wednesday 11, sealed');
  });

  it('points an unsigned day to the guided close', () => {
    render(<CompanionSealedDay businessDay="2026-11-11" requestedDate="2026-11-09" />);
    expect(screen.getByTestId('companion-day-unsigned')).toHaveTextContent(
      'Monday 9 has not been signed'
    );
    expect(screen.getByTestId('companion-day-open-close')).toHaveAttribute(
      'href',
      '/?close=2026-11-09'
    );
  });

  it('ignores a malformed date and still finds today once it is signed', () => {
    metadata.current = { date: '2026-11-11' };
    signoffs.set('2026-11-11', closeSignoffFixture(closeReportFixture()));
    render(<CompanionSealedDay businessDay="2026-11-11" requestedDate="foo" />);
    expect(signoffInputs.at(-1)).toBe('2026-11-11');
  });
});
