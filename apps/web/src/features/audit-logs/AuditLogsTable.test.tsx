import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    render(<AuditLogsTable items={[]} isLoading={false} error={null} onRetry={() => {}} />);
    expect(screen.getByText(/No audit events yet/i)).toBeInTheDocument();
  });

  it('renders one row per entry with the translated action label', () => {
    render(<AuditLogsTable items={[build()]} isLoading={false} error={null} onRetry={() => {}} />);
    expect(screen.getByText('Transfer voided')).toBeInTheDocument();
    expect(screen.getByText('Administrator')).toBeInTheDocument();
    expect(screen.getByText('admin@localhost')).toBeInTheDocument();
    expect(screen.getByText('tx-123')).toBeInTheDocument();
    // Metadata summary.
    expect(screen.getByText(/Reason: Counted wrong/)).toBeInTheDocument();
  });

  it('filters rows by resourceId from the toolbar search input', async () => {
    const user = userEvent.setup();

    render(
      <AuditLogsTable
        items={[
          build({ resourceId: 'sale-123', action: 'sale.void', resourceType: 'sale' }),
          build({ id: 'log-2', resourceId: 'sale-999', action: 'sale.void', resourceType: 'sale' }),
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />
    );

    await user.type(screen.getByPlaceholderText('Search by resource id…'), 'sale-123');

    expect(screen.getByText('sale-123')).toBeInTheDocument();
    expect(screen.queryByText('sale-999')).not.toBeInTheDocument();
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

  it('renders AI anomaly audit rows with translated action and metric summary', () => {
    render(
      <AuditLogsTable
        items={[
          build({
            action: 'ai.anomaly.detected',
            resourceType: 'user',
            resourceId: 'cashier-1',
            metadata: {
              kind: 'refundAmount',
              severity: 'high',
              distance: 4.75,
            },
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />
    );

    expect(screen.getByText('AI anomaly detected')).toBeInTheDocument();
    expect(screen.getByText('refundAmount · high · distance 4.75')).toBeInTheDocument();
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

  // ─── new sensitive-action summaries ────────────────────

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
    expect(screen.getByText('POS-000042 — Customer mind change')).toBeInTheDocument();
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
    expect(screen.getByText('Refunded $150.00 — Damaged goods')).toBeInTheDocument();
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

  it('renders readable expiry-suggestion audit summaries for acceptance and dismissal', () => {
    render(
      <AuditLogsTable
        items={[
          build({
            action: 'inventory.lot.discount_suggested',
            resourceType: 'price_suggestion',
            resourceId: 'suggestion-1',
            before: null,
            after: { discountPct: 30, status: 'active' },
            metadata: { productName: 'Yogur Fresa', lotNumber: 'RADAR-001' },
          }),
          build({
            id: 'log-dismissed',
            action: 'inventory.lot.discount_suggestion_dismissed',
            resourceType: 'price_suggestion',
            resourceId: 'suggestion-1',
            before: { discountPct: 30, status: 'active' },
            after: { status: 'dismissed' },
            metadata: { productName: 'Yogur Fresa', lotNumber: 'RADAR-001' },
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />
    );

    expect(screen.getByText('-30% for Yogur Fresa (lot RADAR-001)')).toBeInTheDocument();
    expect(screen.getByText('Dismissed -30% for Yogur Fresa (lot RADAR-001)')).toBeInTheDocument();
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

  // ───  second wave — purchase, user, price-override summaries ────

  it('renders purchase.void as purchaseNumber + reason when metadata.reason is a string', () => {
    render(
      <AuditLogsTable
        items={[
          build({
            action: 'purchase.void',
            resourceType: 'purchase',
            resourceId: 'purchase-88',
            before: { status: 'completed', purchaseNumber: 'COM-000088', total: 400 },
            after: { status: 'voided' },
            metadata: { reason: 'Wrong supplier' },
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText('COM-000088 — Wrong supplier')).toBeInTheDocument();
    expect(screen.getByText('Purchase voided')).toBeInTheDocument();
  });

  it('renders user.create with email and role', () => {
    render(
      <AuditLogsTable
        items={[
          build({
            action: 'user.create',
            resourceType: 'user',
            resourceId: 'user-9',
            before: null,
            after: {
              email: 'newcashier@example.com',
              name: 'New Cashier',
              role: 'cashier',
              isActive: true,
            },
            metadata: null,
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText('newcashier@example.com (cashier)')).toBeInTheDocument();
    expect(screen.getByText('User created')).toBeInTheDocument();
  });

  it('renders user.update role change as a from/to transition', () => {
    render(
      <AuditLogsTable
        items={[
          build({
            action: 'user.update',
            resourceType: 'user',
            resourceId: 'user-10',
            before: { role: 'cashier' },
            after: { role: 'manager' },
            metadata: { email: 'promoted@example.com', roleChanged: true },
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText('Role cashier → manager')).toBeInTheDocument();
  });

  it('renders user.update deactivation with the deactivation badge', () => {
    render(
      <AuditLogsTable
        items={[
          build({
            action: 'user.update',
            resourceType: 'user',
            resourceId: 'user-11',
            before: { isActive: true },
            after: { isActive: false },
            metadata: { email: 'disabled@example.com', activeChanged: true },
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText('Deactivated')).toBeInTheDocument();
  });

  it('renders user.update combined role + deactivation with both facets', () => {
    render(
      <AuditLogsTable
        items={[
          build({
            action: 'user.update',
            resourceType: 'user',
            resourceId: 'user-12',
            before: { role: 'manager', isActive: true },
            after: { role: 'cashier', isActive: false },
            metadata: {
              email: 'demoted@example.com',
              roleChanged: true,
              activeChanged: true,
            },
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />
    );
    // Both facets separated by a middle dot — keeps the summary scannable.
    expect(screen.getByText('Role manager → cashier · Deactivated')).toBeInTheDocument();
  });

  it('renders sale.price_override with the overridden line count', () => {
    render(
      <AuditLogsTable
        items={[
          build({
            action: 'sale.price_override',
            resourceType: 'sale',
            resourceId: 'sale-67',
            before: null,
            after: { saleNumber: 'POS-000067', overrideCount: 2 },
            metadata: {
              overrides: [
                {
                  saleItemId: 'i-1',
                  productId: 'p-1',
                  productName: 'Widget',
                  referenceUnitPrice: 100,
                  unitPrice: 80,
                  quantity: 1,
                },
                {
                  saleItemId: 'i-2',
                  productId: 'p-2',
                  productName: 'Gadget',
                  referenceUnitPrice: 50,
                  unitPrice: 40,
                  quantity: 2,
                },
              ],
            },
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText('POS-000067 — 2 lines overridden')).toBeInTheDocument();
    expect(screen.getByText('Sale price override')).toBeInTheDocument();
  });

  it('renders sale.price_override with singular copy for a single overridden line', () => {
    render(
      <AuditLogsTable
        items={[
          build({
            action: 'sale.price_override',
            resourceType: 'sale',
            resourceId: 'sale-68',
            before: null,
            after: { saleNumber: 'POS-000068', overrideCount: 1 },
            metadata: {
              overrides: [
                {
                  saleItemId: 'i-3',
                  productId: 'p-3',
                  productName: 'Cable',
                  referenceUnitPrice: 25,
                  unitPrice: 20,
                  quantity: 1,
                },
              ],
            },
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText('POS-000068 — 1 line overridden')).toBeInTheDocument();
  });

  it('falls back to — for user.update rows with neither role nor isActive transitions', () => {
    render(
      <AuditLogsTable
        items={[
          build({
            action: 'user.update',
            resourceType: 'user',
            resourceId: 'user-13',
            // Corrupted audit row with no role/isActive change captured.
            before: {},
            after: {},
            metadata: {},
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders the module activation action and resource labels', () => {
    render(
      <AuditLogsTable
        items={[
          build({
            action: 'module.toggle',
            resourceType: 'tenant_module',
            resourceId: 'copilot',
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />
    );

    expect(screen.getByText('Module toggled')).toBeInTheDocument();
    expect(screen.getByText('Tenant module')).toBeInTheDocument();
  });

  it('renders the vertical module preset action label', () => {
    render(
      <AuditLogsTable
        items={[
          build({
            action: 'module.preset_applied',
            resourceType: 'tenant_module',
            resourceId: 'restaurant',
          }),
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />
    );

    expect(screen.getByText('Module preset applied')).toBeInTheDocument();
    expect(screen.getByText('Tenant module')).toBeInTheDocument();
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
