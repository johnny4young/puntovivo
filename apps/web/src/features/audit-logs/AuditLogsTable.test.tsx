import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import i18next from 'i18next';
import { render } from '@/test/utils';
import type { AuditLogEntry } from '@/types';
import { AuditLogsTable } from './AuditLogsTable';

vi.mock('@/lib/trpc', () => ({
  trpc: {}, // AuditLogsTable is presentational — no trpc calls.
}));

function build(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 'log-1',
    actorId: 'user-1',
    actorName: 'Administrator',
    actorEmail: 'admin@localhost',
    action: 'transfer.void',
    resourceType: 'transfer_order',
    resourceId: 'tx-123',
    before: { status: 'completed' },
    after: { status: 'void' },
    metadata: { reason: 'Counted wrong' },
    createdAt: new Date('2026-04-17T12:00:00Z').toISOString(),
    ...overrides,
  };
}

describe('AuditLogsTable', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
  });

  it('renders the empty state when there are no entries', () => {
    render(
      <AuditLogsTable items={[]} isLoading={false} error={null} onRetry={() => {}} />
    );
    expect(
      screen.getByText(/No audit events yet/i)
    ).toBeInTheDocument();
  });

  it('renders one row per entry with the translated action label', () => {
    render(
      <AuditLogsTable
        items={[build()]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText('Transfer voided')).toBeInTheDocument();
    expect(screen.getByText('Administrator')).toBeInTheDocument();
    expect(screen.getByText('admin@localhost')).toBeInTheDocument();
    expect(screen.getByText('tx-123')).toBeInTheDocument();
    // Metadata summary.
    expect(screen.getByText(/Reason: Counted wrong/)).toBeInTheDocument();
  });

  it('renders a status-transition summary for quotation.convert events', () => {
    render(
      <AuditLogsTable
        items={[
          build({
            action: 'quotation.convert',
            resourceType: 'quotation',
            before: { status: 'accepted' },
            after: { status: 'converted' },
            metadata: null,
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText('Accepted → Converted')).toBeInTheDocument();
    expect(screen.getByText('Quotation converted')).toBeInTheDocument();
    expect(screen.getByText('Quotation')).toBeInTheDocument();
  });

  it('localizes quotation status transitions when the language changes', async () => {
    await i18next.changeLanguage('es');

    render(
      <AuditLogsTable
        items={[
          build({
            action: 'quotation.convert',
            resourceType: 'quotation',
            before: { status: 'accepted' },
            after: { status: 'converted' },
            metadata: null,
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />
    );

    expect(screen.getByText('Aceptada → Convertida')).toBeInTheDocument();
    expect(screen.getByText('Cotización convertida')).toBeInTheDocument();
    expect(screen.getByText('Cotización')).toBeInTheDocument();
  });

  it('renders a deleted-snapshot summary for quotation.delete events with the quotation number', () => {
    render(
      <AuditLogsTable
        items={[
          build({
            action: 'quotation.delete',
            resourceType: 'quotation',
            resourceId: 'q-99',
            before: { quotationNumber: 'COT-000042', status: 'draft' },
            after: null,
            metadata: null,
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText('Deleted COT-000042')).toBeInTheDocument();
  });

  it('falls back to the resourceId when the deleted snapshot is missing a number', () => {
    render(
      <AuditLogsTable
        items={[
          build({
            action: 'quotation.delete',
            resourceType: 'quotation',
            resourceId: 'q-xyz',
            before: null,
            after: null,
            metadata: null,
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText('Deleted q-xyz')).toBeInTheDocument();
  });

  // ─── Phase 8 step 3 — new sensitive-action summaries ────────────────────

  it('renders sale.void as saleNumber + reason when metadata.reason is a string', () => {
    render(
      <AuditLogsTable
        items={[
          build({
            action: 'sale.void',
            resourceType: 'sale',
            resourceId: 'sale-42',
            before: { status: 'completed', saleNumber: 'POS-000042', total: 200 },
            after: { status: 'voided' },
            metadata: { reason: 'Customer mind change' },
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />
    );
    expect(
      screen.getByText('POS-000042 — Customer mind change')
    ).toBeInTheDocument();
    expect(screen.getByText('Sale voided')).toBeInTheDocument();
  });

  it('renders sale.void as just the saleNumber when no reason was supplied', () => {
    render(
      <AuditLogsTable
        items={[
          build({
            action: 'sale.void',
            resourceType: 'sale',
            resourceId: 'sale-43',
            before: { status: 'completed', saleNumber: 'POS-000043', total: 200 },
            after: { status: 'voided' },
            metadata: {},
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText('POS-000043')).toBeInTheDocument();
  });

  it('renders sale.return with the refunded amount and optional reason', () => {
    render(
      <AuditLogsTable
        items={[
          build({
            action: 'sale.return',
            resourceType: 'sale',
            resourceId: 'sale-44',
            before: { paymentStatus: 'paid', total: 150 },
            after: { paymentStatus: 'refunded', refundAmount: 150, refundId: 'rf-1' },
            metadata: { reason: 'Damaged goods' },
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />
    );
    // formatCurrency renders $150.00 in the en locale.
    expect(
      screen.getByText('Refunded $150.00 — Damaged goods')
    ).toBeInTheDocument();
  });

  it('renders cash_session.close showing the signed over/short delta', () => {
    render(
      <AuditLogsTable
        items={[
          build({
            action: 'cash_session.close',
            resourceType: 'cash_session',
            resourceId: 'cs-9',
            before: { status: 'open' },
            after: { status: 'closed', overShort: -12.5, actualCount: 100 },
            metadata: { siteId: 'site-1' },
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText(/Over\/short: -\$12\.50/)).toBeInTheDocument();
    expect(screen.getByText('Cash session closed')).toBeInTheDocument();
  });

  it('renders inventory.adjust_stock with the transition and signed delta', () => {
    render(
      <AuditLogsTable
        items={[
          build({
            action: 'inventory.adjust_stock',
            resourceType: 'product',
            resourceId: 'prod-7',
            before: { stock: 20 },
            after: { stock: 13 },
            metadata: { delta: -7, siteId: 'site-1' },
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />
    );
    // The signed delta renders with a leading sign so shrinkage is obvious.
    expect(screen.getByText('20 → 13 (-7)')).toBeInTheDocument();
    expect(screen.getByText('Stock adjusted')).toBeInTheDocument();
  });

  it('falls back to — for actions whose audit payload is missing expected fields', () => {
    render(
      <AuditLogsTable
        items={[
          build({
            action: 'inventory.adjust_stock',
            resourceType: 'product',
            resourceId: 'prod-8',
            // Corrupted / partially-migrated row — no delta, no stock values.
            before: {},
            after: {},
            metadata: null,
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('falls back to actorEmail when actorName is null, and to actorId when both are null', () => {
    render(
      <AuditLogsTable
        items={[
          build({ id: 'a', actorName: null, actorEmail: 'someone@example.com' }),
          build({
            id: 'b',
            resourceId: 'tx-999',
            actorName: null,
            actorEmail: null,
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText('someone@example.com')).toBeInTheDocument();
    expect(screen.getByText('user-1')).toBeInTheDocument();
  });
});
