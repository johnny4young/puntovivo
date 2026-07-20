import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/tables/DataTable';
import { TableErrorState } from '@/components/tables/TableErrorState';
import { TableExportActions } from '@/components/tables/TableExportActions';
import { TableLoadingState } from '@/components/tables/TableLoadingState';
import { translateServerError } from '@/lib/translateServerError';
import { formatDateTime } from '@/lib/utils';
import type { AuditLogEntry } from '@/types';
import { AuditLogSummary } from './AuditLogSummary';
import { getAuditLogsExportColumns } from './auditLogsExport';

interface AuditLogsTableProps {
  items: AuditLogEntry[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

/**
 * audit log viewer table. Renders the action /
 * actor / resource columns plus a short summary derived from the event's
 * `before` / `after` / `metadata` payload. The underlying data is
 * reverse-chronological (server-enforced).
 */
export function AuditLogsTable({ items, isLoading, error, onRetry }: AuditLogsTableProps) {
  const { t } = useTranslation(['auditLogs', 'errors', 'quotations']);
  const exportColumns = useMemo(() => getAuditLogsExportColumns(t), [t]);

  const columns = useMemo<ColumnDef<AuditLogEntry>[]>(
    () => [
      {
        accessorKey: 'createdAt',
        header: () => t('history.columns.createdAt'),
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-mono text-xs text-secondary-700">
            {formatDateTime(row.original.createdAt)}
          </span>
        ),
      },
      {
        accessorKey: 'actorName',
        header: () => t('history.columns.actor'),
        cell: ({ row }) => {
          const { actorName, actorEmail } = row.original;
          return (
            <div className="flex flex-col">
              <span className="text-sm text-secondary-900">
                {actorName ?? actorEmail ?? row.original.actorId}
              </span>
              {actorName && actorEmail && (
                <span className="text-xs text-secondary-500">{actorEmail}</span>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: 'action',
        header: () => t('history.columns.action'),
        cell: ({ row }) => {
          const actionKey = `actions.${row.original.action}`;
          // Fall back to the raw action string when the translation is missing
          // so a new action type added server-side is still readable.
          const label = t(actionKey, { defaultValue: row.original.action });
          return (
            <span className="inline-flex items-center rounded-full bg-secondary-100 px-2 py-0.5 text-xs text-secondary-700">
              {label}
            </span>
          );
        },
      },
      {
        accessorKey: 'resourceId',
        header: () => t('history.columns.resource'),
        cell: ({ row }) => {
          const typeKey = `resourceTypes.${row.original.resourceType}`;
          const typeLabel = t(typeKey, {
            defaultValue: row.original.resourceType,
          });
          return (
            <div className="flex flex-col">
              <span className="text-xs text-secondary-500">{typeLabel}</span>
              <span className="font-mono text-xs text-secondary-700">
                {row.original.resourceId}
              </span>
            </div>
          );
        },
      },
      {
        id: 'summary',
        header: () => t('history.columns.summary'),
        cell: ({ row }) => <AuditLogSummary entry={row.original} />,
      },
    ],
    [t]
  );

  if (isLoading) {
    return <TableLoadingState message={t('history.loading')} rowCount={6} />;
  }
  if (error) {
    return (
      <TableErrorState
        title={t('history.error')}
        message={translateServerError(error, t, t('history.error'))}
        onRetry={onRetry}
      />
    );
  }
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-secondary-200 px-4 py-6 text-center text-sm text-secondary-500">
        {t('history.empty')}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <TableExportActions
        data={items}
        columns={exportColumns}
        filename="audit-log"
        title={t('history.exportTitle')}
      />
      <DataTable
        columns={columns}
        data={items}
        searchKey="resourceId"
        searchPlaceholder={t('history.search')}
        pageSize={15}
      />
    </div>
  );
}
