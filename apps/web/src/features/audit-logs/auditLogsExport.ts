import type { TFunction } from 'i18next';
import type { ExportColumn } from '@/services/export/exportService';
import { formatDateTime } from '@/lib/utils';
import type { AuditLogEntry } from '@/types';

/**
 * Phase 8 / Tier-2 #8 — CSV / Excel / PDF export columns for the audit
 * log viewer. Keep the column config as a pure builder so the table can
 * regenerate localized headers and enum labels when the operator switches
 * languages without duplicating export formatting logic in the component.
 */
// ENG-179b — accept i18next's `TFunction` directly so any namespace
// projection from `useTranslation([...])` flows in without per-test
// casts.
type TranslateFn = TFunction;

export function getAuditLogsExportColumns(
  t: TranslateFn
): ExportColumn<AuditLogEntry>[] {
  return [
    {
      key: 'createdAt',
      header: t('auditLogs:history.columns.createdAt'),
      formatter: value => formatDateTime(String(value ?? '')),
    },
    {
      key: 'actorName',
      header: t('auditLogs:history.columns.actor'),
      formatter: (_, row) => row.actorName ?? row.actorEmail ?? row.actorId,
    },
    {
      key: 'action',
      header: t('auditLogs:history.columns.action'),
      formatter: value =>
        t(`auditLogs:actions.${String(value ?? '')}`, {
          defaultValue: String(value ?? ''),
        }),
    },
    {
      key: 'resourceType',
      header: t('auditLogs:history.columns.resource'),
      formatter: value =>
        t(`auditLogs:resourceTypes.${String(value ?? '')}`, {
          defaultValue: String(value ?? ''),
        }),
    },
    {
      key: 'resourceId',
      header: t('auditLogs:history.columns.resourceId'),
    },
    {
      key: 'metadata',
      header: t('auditLogs:history.columns.metadata'),
      formatter: value => (value ? JSON.stringify(value) : ''),
    },
  ];
}
