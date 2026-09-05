import { afterEach, describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { act, render, screen } from '@/test/utils';
import type { AuditLogEntry } from '@/types';
import { AuditLogSummary } from './AuditLogSummary';

function entry(after: AuditLogEntry['after']): AuditLogEntry {
  return {
    id: 'event',
    actorId: 'admin',
    actorName: 'Administrator',
    actorEmail: 'admin@localhost',
    action: 'employment_contract.changed',
    resourceType: 'employment_contract',
    resourceId: 'terms',
    before: { payAmount: 9876543, reason: 'Never expose private evidence' },
    after,
    metadata: { reason: 'Never expose private evidence' },
    createdAt: '2026-09-04T10:00:00.000Z',
  };
}

afterEach(async () => {
  await act(async () => {
    await i18next.changeLanguage('en');
  });
});

describe('Employment audit summary privacy', () => {
  it.each([
    ['en', 'created', 'Terms created · version 3'],
    ['en', 'ended', 'End date recorded · version 3'],
    ['en', 'replaced', 'Replaced with new terms · version 3'],
    ['en', 'voided', 'Incorrect terms voided · version 3'],
  ])('renders only recognized kind and version (%s %s)', async (language, kind, expected) => {
    await i18next.changeLanguage(language);
    const { container } = render(
      <AuditLogSummary entry={entry({ kind, version: 3, payAmount: 9876543 })} />
    );
    expect(screen.getByText(expected)).toBeVisible();
    expect(container).not.toHaveTextContent('9876543');
    expect(container).not.toHaveTextContent('Never expose');
  });
  it('localizes the safe summary in Spanish', async () => {
    await i18next.changeLanguage('es');
    const { container } = render(
      <AuditLogSummary entry={entry({ kind: 'created', version: 3 })} />
    );
    expect(container).toHaveTextContent('Condiciones creadas · versión 3');
    expect(container).not.toHaveTextContent('Terms created');
    expect(container).not.toHaveTextContent('summary.');
  });
  it.each([
    null,
    {},
    { kind: '<img src=x onerror=alert(1)>', version: 3 },
    { kind: 'created', version: '3' },
    { kind: 'created', version: 0 },
    { kind: 'created', version: -1 },
    { kind: 'created', version: 1.5 },
    { kind: 'created', version: Number.MAX_SAFE_INTEGER + 1 },
  ])('fails closed for malformed summary %j', after => {
    const { container } = render(<AuditLogSummary entry={entry(after)} />);
    expect(container.textContent).toBe('—');
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('Schedule plan audit summary privacy', () => {
  it.each([
    ['en', 'draft', 1, 'Draft · 1 shift · version 2'],
    ['en', 'published', 2, 'Published · 2 shifts · version 2'],
    ['es', 'discarded', 2, 'Descartado · 2 turnos · versión 2'],
  ])(
    'renders only safe publication metadata in %s',
    async (language, status, occurrenceCount, expected) => {
      await i18next.changeLanguage(String(language));
      const value: AuditLogEntry = {
        ...entry({
          status,
          occurrenceCount,
          version: 2,
          title: 'Private coverage',
          notes: 'Never expose private evidence',
        }),
        action: 'schedule_plan.changed',
        resourceType: 'schedule_plan',
      };
      const { container } = render(<AuditLogSummary entry={value} />);
      expect(container).toHaveTextContent(String(expected));
      expect(container).not.toHaveTextContent('Private coverage');
      expect(container).not.toHaveTextContent('Never expose');
    }
  );
  it.each([
    {},
    { status: '<img src=x onerror=alert(1)>', version: 2, occurrenceCount: 2 },
    { status: 'draft', version: 0, occurrenceCount: 2 },
    { status: 'draft', version: 1.5, occurrenceCount: 2 },
    { status: 'draft', version: 1, occurrenceCount: 0 },
    { status: 'draft', version: 1, occurrenceCount: 1001 },
    { status: 'draft', version: 1, occurrenceCount: '2' },
  ])('does not stringify malformed private metadata %j', after => {
    const { container } = render(
      <AuditLogSummary
        entry={{ ...entry(after), action: 'schedule_plan.changed', resourceType: 'schedule_plan' }}
      />
    );
    expect(container.textContent).toBe('—');
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('Shift exchange audit summary privacy', () => {
  it.each([
    ['en', 'requested', 'Requested · version 3'],
    ['en', 'accepted', 'Accepted by employee · version 3'],
    ['en', 'approved', 'Approved · version 3'],
    ['es', 'rejected', 'Rechazado · versión 3'],
    ['es', 'cancelled', 'Cancelado · versión 3'],
  ])('renders only state and version in %s (%s)', async (language, status, expected) => {
    await i18next.changeLanguage(language);
    const { container } = render(
      <AuditLogSummary
        entry={{
          ...entry({
            status,
            version: 3,
            reason: 'Never expose private evidence',
            fingerprint: 'secret-fingerprint',
            intent: { private: true },
          }),
          action: 'shift_swap.changed',
          resourceType: 'shift_swap',
        }}
      />
    );
    expect(container).toHaveTextContent(expected);
    expect(container).not.toHaveTextContent('Never expose');
    expect(container).not.toHaveTextContent('secret-fingerprint');
    expect(container).not.toHaveTextContent('intent');
  });
  it.each([
    {},
    null,
    { status: '<img src=x onerror=alert(1)>', version: 1 },
    { status: 'approved', version: 0 },
    { status: 'accepted', version: 1.5 },
    { status: 'requested', version: Number.MAX_SAFE_INTEGER + 1 },
    { status: 'cancelled', version: '3' },
  ])('rejects malformed private metadata %j', after => {
    const { container } = render(
      <AuditLogSummary
        entry={{ ...entry(after), action: 'shift_swap.changed', resourceType: 'shift_swap' }}
      />
    );
    expect(container.textContent).toBe('—');
    expect(container.querySelector('img')).toBeNull();
  });
});
