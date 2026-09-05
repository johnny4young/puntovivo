import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/lib/utils';
import type { AuditLogEntry } from '@/types';

// use i18next's `TFunction` directly so the multi-namespace
// projection from `useTranslation([...])` flows in without per-call casts.
function translateQuotationStatus(status: unknown, t: TFunction): string {
  return typeof status === 'string'
    ? t(`quotations:status.${status}`, { defaultValue: status })
    : '?';
}

export function AuditLogSummary({ entry }: { entry: AuditLogEntry }) {
  const { t } = useTranslation([
    'auditLogs',
    'quotations',
    'sales',
    'workforce',
    'schedulePlans',
    'shiftSwaps',
  ]);

  if (entry.action === 'shift_swap.changed') {
    const status = entry.after?.status,
      version = entry.after?.version;
    // Never reflect reasons, shift details or fingerprints from the private consent ledger.
    if (
      typeof status !== 'string' ||
      !['requested', 'accepted', 'approved', 'rejected', 'cancelled'].includes(status) ||
      typeof version !== 'number' ||
      !Number.isSafeInteger(version) ||
      version < 1
    )
      return <span className="text-sm text-secondary-500">—</span>;
    return (
      <span className="text-sm text-secondary-700">
        {t(`shiftSwaps:statuses.${status}`)} · {t('shiftSwaps:version', { version })}
      </span>
    );
  }

  if (entry.action === 'schedule_plan.changed') {
    const status = entry.after?.status,
      version = entry.after?.version,
      count = entry.after?.occurrenceCount;
    // A summary may show only a recognized state and bounded counts, never the private plan content.
    if (
      typeof status !== 'string' ||
      !['draft', 'published', 'discarded'].includes(status) ||
      typeof version !== 'number' ||
      !Number.isSafeInteger(version) ||
      version < 1 ||
      typeof count !== 'number' ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 1000
    )
      return <span className="text-sm text-secondary-500">—</span>;
    return (
      <span className="text-sm text-secondary-700">
        {t(`schedulePlans:statuses.${status}`)} · {t('schedulePlans:shiftCount', { count })} ·{' '}
        {t('shiftSwaps:version', { version })}
      </span>
    );
  }

  if (entry.action === 'employment_contract.changed') {
    const kind = entry.after?.kind;
    const version = entry.after?.version;
    // Never stringify the private payload or render an unrecognized event name.
    if (
      typeof kind !== 'string' ||
      !['created', 'ended', 'replaced', 'voided'].includes(kind) ||
      typeof version !== 'number' ||
      !Number.isSafeInteger(version) ||
      version < 1
    ) {
      return <span className="text-sm text-secondary-500">—</span>;
    }
    return (
      <span className="text-sm text-secondary-700">
        {t(`workforce:kinds.${kind}`)} · {t('shiftSwaps:version', { version })}
      </span>
    );
  }

  // Render a short human string per action type. The summary is derived
  // from the audit payload rather than free-formed so every row reads
  // consistently and stays grep-able across tenants.
  if (entry.action === 'transfer.create') {
    const totalQuantity =
      entry.after && typeof entry.after.totalQuantity === 'number'
        ? entry.after.totalQuantity
        : null;
    const status =
      entry.after && typeof entry.after.status === 'string' ? entry.after.status : null;
    const fromSiteName =
      entry.metadata && typeof entry.metadata.fromSiteName === 'string'
        ? entry.metadata.fromSiteName
        : null;
    const toSiteName =
      entry.metadata && typeof entry.metadata.toSiteName === 'string'
        ? entry.metadata.toSiteName
        : null;
    if (totalQuantity === null || status === null || !fromSiteName || !toSiteName) {
      return <span className="text-sm text-secondary-500">—</span>;
    }
    return (
      <span className="text-sm text-secondary-700">
        {t('summary.transferCreate', {
          count: totalQuantity,
          quantity: totalQuantity,
          from: fromSiteName,
          to: toSiteName,
          status: t(`summary.transferStatus.${status}`, { defaultValue: status }),
        })}
      </span>
    );
  }

  if (entry.action === 'transfer.receive') {
    const shipped =
      entry.before && typeof entry.before.totalQuantityShipped === 'number'
        ? entry.before.totalQuantityShipped
        : null;
    const received =
      entry.after && typeof entry.after.totalQuantityReceived === 'number'
        ? entry.after.totalQuantityReceived
        : null;
    const fromSiteName =
      entry.metadata && typeof entry.metadata.fromSiteName === 'string'
        ? entry.metadata.fromSiteName
        : null;
    const toSiteName =
      entry.metadata && typeof entry.metadata.toSiteName === 'string'
        ? entry.metadata.toSiteName
        : null;
    const shortage =
      entry.metadata && typeof entry.metadata.shortageQuantity === 'number'
        ? entry.metadata.shortageQuantity
        : null;
    if (
      shipped === null ||
      received === null ||
      shortage === null ||
      !fromSiteName ||
      !toSiteName
    ) {
      return <span className="text-sm text-secondary-500">—</span>;
    }
    return (
      <span className="text-sm text-secondary-700">
        {shortage > 0
          ? t('summary.transferReceiveShortage', {
              count: shipped,
              received,
              shipped,
              from: fromSiteName,
              to: toSiteName,
              shortage,
            })
          : t('summary.transferReceiveExact', {
              count: received,
              received,
              from: fromSiteName,
              to: toSiteName,
            })}
      </span>
    );
  }

  if (entry.action === 'transfer.void') {
    const reason =
      entry.metadata && typeof entry.metadata.reason === 'string' ? entry.metadata.reason : null;
    return reason ? (
      <span className="text-sm text-secondary-700">{t('summary.voidReason', { reason })}</span>
    ) : (
      <span className="text-sm text-secondary-500">—</span>
    );
  }

  if (entry.action === 'quotation.convert') {
    const from = translateQuotationStatus(entry.before?.status, t);
    const to = translateQuotationStatus(entry.after?.status, t);
    return (
      <span className="text-sm text-secondary-700">
        {t('summary.statusTransition', { from, to })}
      </span>
    );
  }

  if (entry.action === 'quotation.delete') {
    const before = entry.before;
    const number =
      before && typeof before.quotationNumber === 'string'
        ? before.quotationNumber
        : entry.resourceId;
    return (
      <span className="text-sm text-secondary-700">
        {t('summary.deletedSnapshot', { label: number })}
      </span>
    );
  }

  // sensitive sale + cash + inventory branches.
  if (entry.action === 'sale.void') {
    const reason =
      entry.metadata && typeof entry.metadata.reason === 'string' ? entry.metadata.reason : null;
    const saleNumber =
      entry.before && typeof entry.before.saleNumber === 'string'
        ? entry.before.saleNumber
        : entry.resourceId;
    return reason ? (
      <span className="text-sm text-secondary-700">
        {t('summary.saleVoid', { saleNumber, reason })}
      </span>
    ) : (
      <span className="text-sm text-secondary-700">
        {t('summary.saleVoidNoReason', { saleNumber })}
      </span>
    );
  }

  if (entry.action === 'sale.return') {
    const persistedReason =
      entry.metadata && typeof entry.metadata.reason === 'string' ? entry.metadata.reason : null;
    const reason = persistedReason
      ? t(`sales:refund.reasons.${persistedReason}`, { defaultValue: persistedReason })
      : null;
    const saleNumber =
      entry.metadata && typeof entry.metadata.saleNumber === 'string'
        ? entry.metadata.saleNumber
        : entry.before && typeof entry.before.saleNumber === 'string'
          ? entry.before.saleNumber
          : entry.resourceId;
    const refundAmount =
      entry.after && typeof entry.after.refundAmount === 'number' ? entry.after.refundAmount : null;
    if (refundAmount === null) {
      return <span className="text-sm text-secondary-500">—</span>;
    }
    return reason ? (
      <span className="text-sm text-secondary-700">
        {t('summary.saleRefundReason', {
          saleNumber,
          amount: formatCurrency(refundAmount),
          reason,
        })}
      </span>
    ) : (
      <span className="text-sm text-secondary-700">
        {t('summary.saleRefund', { saleNumber, amount: formatCurrency(refundAmount) })}
      </span>
    );
  }

  if (entry.action === 'cash_session.close') {
    const overShort =
      entry.after && typeof entry.after.overShort === 'number' ? entry.after.overShort : null;
    if (overShort === null) {
      return <span className="text-sm text-secondary-500">—</span>;
    }
    // The signed amount communicates over/short at a glance — positive is
    // over (drawer count exceeded expected), negative is short.
    return (
      <span className="text-sm text-secondary-700">
        {t('summary.cashSessionClose', {
          overShort: formatCurrency(overShort),
        })}
      </span>
    );
  }

  if (entry.action === 'inventory.adjust_stock') {
    const delta =
      entry.metadata && typeof entry.metadata.delta === 'number' ? entry.metadata.delta : null;
    const beforeStock =
      entry.before && typeof entry.before.stock === 'number' ? entry.before.stock : null;
    const afterStock =
      entry.after && typeof entry.after.stock === 'number' ? entry.after.stock : null;
    if (delta === null || beforeStock === null || afterStock === null) {
      return <span className="text-sm text-secondary-500">—</span>;
    }
    // Show the absolute transition + the signed delta — auditors looking at
    // shrinkage need both the new value and the magnitude of the change.
    return (
      <span className="text-sm text-secondary-700">
        {t('summary.stockAdjust', {
          before: beforeStock,
          after: afterStock,
          delta: delta > 0 ? `+${delta}` : String(delta),
        })}
      </span>
    );
  }

  if (entry.action === 'purchase.receive') {
    const purchaseNumber =
      entry.after && typeof entry.after.purchaseNumber === 'string'
        ? entry.after.purchaseNumber
        : null;
    const baseUnitsReceived =
      entry.after && typeof entry.after.baseUnitsReceived === 'number'
        ? entry.after.baseUnitsReceived
        : null;
    const siteName =
      entry.metadata && typeof entry.metadata.siteName === 'string'
        ? entry.metadata.siteName
        : null;
    if (purchaseNumber === null || baseUnitsReceived === null || siteName === null) {
      return <span className="text-sm text-secondary-500">—</span>;
    }
    return (
      <span className="text-sm text-secondary-700">
        {t('summary.purchaseReceive', {
          purchaseNumber,
          quantity: baseUnitsReceived,
          site: siteName,
        })}
      </span>
    );
  }

  if (entry.action === 'purchase.return') {
    const purchaseNumber =
      entry.before && typeof entry.before.purchaseNumber === 'string'
        ? entry.before.purchaseNumber
        : entry.resourceId;
    const returnAmount =
      entry.after && typeof entry.after.returnAmount === 'number' ? entry.after.returnAmount : null;
    const reason =
      entry.metadata && typeof entry.metadata.reason === 'string' ? entry.metadata.reason : null;
    if (returnAmount === null) {
      return <span className="text-sm text-secondary-500">—</span>;
    }
    return (
      <span className="text-sm text-secondary-700">
        {t(reason ? 'summary.purchaseReturnReason' : 'summary.purchaseReturn', {
          purchaseNumber,
          amount: formatCurrency(returnAmount),
          reason,
        })}
      </span>
    );
  }

  if (entry.action === 'order.create') {
    const orderNumber =
      entry.after && typeof entry.after.orderNumber === 'string' ? entry.after.orderNumber : null;
    const lineCount =
      entry.after && typeof entry.after.lineCount === 'number' ? entry.after.lineCount : null;
    const total = entry.after && typeof entry.after.total === 'number' ? entry.after.total : null;
    const siteName =
      entry.metadata && typeof entry.metadata.siteName === 'string'
        ? entry.metadata.siteName
        : null;
    if (orderNumber === null || lineCount === null || total === null || siteName === null) {
      return <span className="text-sm text-secondary-500">—</span>;
    }
    return (
      <span className="text-sm text-secondary-700">
        {t('summary.orderCreate', {
          count: lineCount,
          orderNumber,
          total: formatCurrency(total),
          site: siteName,
        })}
      </span>
    );
  }

  if (entry.action === 'order.void') {
    const orderNumber =
      entry.before && typeof entry.before.orderNumber === 'string'
        ? entry.before.orderNumber
        : entry.resourceId;
    const reason =
      entry.metadata && typeof entry.metadata.reason === 'string' ? entry.metadata.reason : null;
    return (
      <span className="text-sm text-secondary-700">
        {t(reason ? 'summary.orderVoidReason' : 'summary.orderVoid', {
          orderNumber,
          reason,
        })}
      </span>
    );
  }

  // expiry-radar discount suggestions. Both branches read the
  // product + lot from metadata (the resource row is the suggestion, which
  // may outlive the lot) and surface the percent the manager accepted.
  if (
    entry.action === 'inventory.lot.discount_suggested' ||
    entry.action === 'inventory.lot.discount_suggestion_dismissed'
  ) {
    const productName =
      entry.metadata && typeof entry.metadata.productName === 'string'
        ? entry.metadata.productName
        : null;
    const lotNumber =
      entry.metadata && typeof entry.metadata.lotNumber === 'string'
        ? entry.metadata.lotNumber
        : null;
    const snapshot =
      entry.action === 'inventory.lot.discount_suggested' ? entry.after : entry.before;
    const pct = snapshot && typeof snapshot.discountPct === 'number' ? snapshot.discountPct : null;
    if (pct === null) {
      return <span className="text-sm text-secondary-500">—</span>;
    }
    return (
      <span className="text-sm text-secondary-700">
        {t(
          entry.action === 'inventory.lot.discount_suggested'
            ? 'summary.discountSuggested'
            : 'summary.discountSuggestionDismissed',
          {
            pct,
            product: productName ?? entry.resourceId,
            lot: lotNumber ?? '—',
          }
        )}
      </span>
    );
  }

  // second wave — purchase voids, admin user lifecycle, price
  // overrides. Each branch renders a compact, searchable summary the
  // auditor can scan without expanding the raw JSON payload.
  if (entry.action === 'purchase.void') {
    const reason =
      entry.metadata && typeof entry.metadata.reason === 'string' ? entry.metadata.reason : null;
    const purchaseNumber =
      entry.before && typeof entry.before.purchaseNumber === 'string'
        ? entry.before.purchaseNumber
        : entry.resourceId;
    return reason ? (
      <span className="text-sm text-secondary-700">
        {t('summary.purchaseVoid', { purchaseNumber, reason })}
      </span>
    ) : (
      <span className="text-sm text-secondary-700">
        {t('summary.purchaseVoidNoReason', { purchaseNumber })}
      </span>
    );
  }

  if (entry.action === 'user.create') {
    const email = entry.after && typeof entry.after.email === 'string' ? entry.after.email : null;
    const role = entry.after && typeof entry.after.role === 'string' ? entry.after.role : null;
    if (email === null || role === null) {
      return <span className="text-sm text-secondary-500">—</span>;
    }
    return (
      <span className="text-sm text-secondary-700">{t('summary.userCreate', { email, role })}</span>
    );
  }

  if (entry.action === 'user.update') {
    // Only role/isActive changes land here — name/email edits don't write
    // an audit row. Render the transition that actually occurred.
    const beforeRole =
      entry.before && typeof entry.before.role === 'string' ? entry.before.role : null;
    const afterRole = entry.after && typeof entry.after.role === 'string' ? entry.after.role : null;
    const beforeActive =
      entry.before && typeof entry.before.isActive === 'boolean' ? entry.before.isActive : null;
    const afterActive =
      entry.after && typeof entry.after.isActive === 'boolean' ? entry.after.isActive : null;
    const roleChange =
      beforeRole !== null && afterRole !== null
        ? t('summary.userRoleChange', { from: beforeRole, to: afterRole })
        : null;
    const activeChange =
      beforeActive !== null && afterActive !== null
        ? afterActive
          ? t('summary.userReactivate')
          : t('summary.userDeactivate')
        : null;
    const parts = [roleChange, activeChange].filter((part): part is string => part !== null);
    if (parts.length === 0) {
      return <span className="text-sm text-secondary-500">—</span>;
    }
    return <span className="text-sm text-secondary-700">{parts.join(' · ')}</span>;
  }

  if (entry.action === 'sale.price_override') {
    const count =
      entry.after && typeof entry.after.overrideCount === 'number'
        ? entry.after.overrideCount
        : null;
    const saleNumber =
      entry.after && typeof entry.after.saleNumber === 'string'
        ? entry.after.saleNumber
        : entry.resourceId;
    if (count === null) {
      return <span className="text-sm text-secondary-500">—</span>;
    }
    return (
      <span className="text-sm text-secondary-700">
        {t('summary.priceOverride', { saleNumber, count })}
      </span>
    );
  }

  // park / resume / discard. Each renders a short
  // descriptor pulled from the `after` snapshot + metadata so the
  // auditor sees the label and discard flag at a glance.
  if (entry.action === 'sale.park') {
    const saleNumber =
      (entry.before && typeof entry.before.saleNumber === 'string'
        ? entry.before.saleNumber
        : null) ?? entry.resourceId;
    const label =
      entry.metadata && typeof entry.metadata.label === 'string' ? entry.metadata.label : null;
    const discarded = entry.metadata && entry.metadata.discarded === true;
    if (discarded) {
      return (
        <span className="text-sm text-secondary-700">
          {t('summary.salePark_discarded', { saleNumber })}
        </span>
      );
    }
    return label ? (
      <span className="text-sm text-secondary-700">
        {t('summary.salePark_label', { saleNumber, label })}
      </span>
    ) : (
      <span className="text-sm text-secondary-700">{t('summary.salePark', { saleNumber })}</span>
    );
  }

  if (entry.action === 'sale.resume') {
    const saleNumber =
      (entry.before && typeof entry.before.saleNumber === 'string'
        ? entry.before.saleNumber
        : null) ?? entry.resourceId;
    const override = entry.metadata && entry.metadata.override === true;
    return override ? (
      <span className="text-sm text-secondary-700">
        {t('summary.saleResume_override', { saleNumber })}
      </span>
    ) : (
      <span className="text-sm text-secondary-700">{t('summary.saleResume', { saleNumber })}</span>
    );
  }

  if (entry.action === 'sale.changeTable') {
    const saleNumber =
      entry.metadata && typeof entry.metadata.saleNumber === 'string'
        ? entry.metadata.saleNumber
        : entry.resourceId;
    const from =
      entry.metadata && typeof entry.metadata.priorTableName === 'string'
        ? entry.metadata.priorTableName
        : entry.before && typeof entry.before.suspendedLabel === 'string'
          ? entry.before.suspendedLabel
          : t('summary.saleChangeTableNoTable');
    const to =
      entry.metadata && typeof entry.metadata.nextTableName === 'string'
        ? entry.metadata.nextTableName
        : entry.after && entry.after.tableId === null
          ? t('summary.saleChangeTableNoTable')
          : entry.after && typeof entry.after.suspendedLabel === 'string'
            ? entry.after.suspendedLabel
            : t('summary.saleChangeTableNoTable');
    return (
      <span className="text-sm text-secondary-700">
        {t('summary.saleChangeTable', { saleNumber, from, to })}
      </span>
    );
  }

  if (entry.action === 'sale.splitDraft') {
    const sourceSaleNumber =
      entry.metadata && typeof entry.metadata.sourceSaleNumber === 'string'
        ? entry.metadata.sourceSaleNumber
        : entry.before && typeof (entry.before as Record<string, unknown>).sourceSaleId === 'string'
          ? ((entry.before as Record<string, unknown>).sourceSaleId as string)
          : '';
    const newSaleNumber =
      entry.metadata && typeof entry.metadata.newSaleNumber === 'string'
        ? entry.metadata.newSaleNumber
        : entry.resourceId;
    const count =
      entry.metadata && typeof entry.metadata.movedItemCount === 'number'
        ? entry.metadata.movedItemCount
        : 0;
    const tableName =
      entry.metadata && typeof entry.metadata.tableName === 'string'
        ? entry.metadata.tableName
        : null;
    return (
      <span className="text-sm text-secondary-700">
        {tableName
          ? t('summary.saleSplitDraftWithTable', {
              sourceSaleNumber,
              newSaleNumber,
              tableName,
              count,
            })
          : t('summary.saleSplitDraft', {
              sourceSaleNumber,
              newSaleNumber,
              count,
            })}
      </span>
    );
  }

  if (entry.action === 'sale.reprint') {
    const saleNumber =
      (entry.before && typeof entry.before.saleNumber === 'string'
        ? entry.before.saleNumber
        : null) ?? entry.resourceId;
    const count =
      entry.metadata && typeof entry.metadata.count === 'number'
        ? entry.metadata.count
        : entry.after && typeof entry.after.reprintCount === 'number'
          ? entry.after.reprintCount
          : null;
    const reason =
      entry.metadata && typeof entry.metadata.reason === 'string' ? entry.metadata.reason : null;
    if (count === null) {
      return <span className="text-sm text-secondary-500">—</span>;
    }
    return reason ? (
      <span className="text-sm text-secondary-700">
        {t('summary.saleReprintReason', { saleNumber, count, reason })}
      </span>
    ) : (
      <span className="text-sm text-secondary-700">
        {t('summary.saleReprint', { saleNumber, count })}
      </span>
    );
  }

  // draft completion. Pulls the sale number from metadata
  // (the server copies it at write-time so we do not rely on a join).
  if (entry.action === 'sale.complete') {
    const saleNumber =
      entry.metadata && typeof entry.metadata.saleNumber === 'string'
        ? entry.metadata.saleNumber
        : entry.resourceId;
    return (
      <span className="text-sm text-secondary-700">
        {t('summary.saleComplete', { saleNumber })}
      </span>
    );
  }

  // anomaly detector persistence. The row links to the
  // cashier user and keeps metric details in metadata for audit drilldown.
  if (entry.action === 'ai.anomaly.detected') {
    const kind =
      entry.metadata && typeof entry.metadata.kind === 'string' ? entry.metadata.kind : '?';
    const severity =
      entry.metadata && typeof entry.metadata.severity === 'string' ? entry.metadata.severity : '?';
    const distance =
      entry.metadata && typeof entry.metadata.distance === 'number'
        ? entry.metadata.distance.toFixed(2)
        : '?';
    return (
      <span className="text-sm text-secondary-700">
        {t('summary.aiAnomaly', { kind, severity, distance })}
      </span>
    );
  }

  if (entry.action === 'device.revoke') {
    const name =
      entry.before && typeof entry.before.name === 'string' ? entry.before.name : entry.resourceId;
    return (
      <span className="text-sm text-secondary-700">{t('summary.deviceRevoke', { name })}</span>
    );
  }

  return <span className="text-sm text-secondary-500">—</span>;
}
