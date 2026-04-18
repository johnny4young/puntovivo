import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import type { AuditLogEntry } from '@/types';
import { getAuditLogsExportColumns } from './auditLogsExport';

function buildEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 'log-1',
    actorId: 'user-1',
    actorName: 'Administrator',
    actorEmail: 'admin@localhost',
    action: 'quotation.convert',
    resourceType: 'quotation',
    resourceId: 'q-1',
    before: { status: 'accepted' },
    after: { status: 'converted' },
    metadata: { reason: 'Converted at POS' },
    createdAt: new Date('2026-04-17T12:00:00Z').toISOString(),
    ...overrides,
  };
}

describe('getAuditLogsExportColumns', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('uses localized headers and enum labels in English', () => {
    const columns = getAuditLogsExportColumns(i18n.t.bind(i18n));
    const entry = buildEntry();

    expect(columns.find(column => column.key === 'createdAt')?.header).toBe('When');
    expect(columns.find(column => column.key === 'resourceId')?.header).toBe(
      'Resource id'
    );

    const actionColumn = columns.find(column => column.key === 'action');
    const resourceTypeColumn = columns.find(column => column.key === 'resourceType');
    expect(actionColumn?.formatter?.(entry.action, entry)).toBe('Quotation converted');
    expect(resourceTypeColumn?.formatter?.(entry.resourceType, entry)).toBe('Quotation');
  });

  it('switches export copy when the app language changes', async () => {
    await i18n.changeLanguage('es');
    const columns = getAuditLogsExportColumns(i18n.t.bind(i18n));
    const entry = buildEntry();

    expect(columns.find(column => column.key === 'metadata')?.header).toBe(
      'Metadatos'
    );

    const actionColumn = columns.find(column => column.key === 'action');
    const resourceTypeColumn = columns.find(column => column.key === 'resourceType');
    expect(actionColumn?.formatter?.(entry.action, entry)).toBe('Cotización convertida');
    expect(resourceTypeColumn?.formatter?.(entry.resourceType, entry)).toBe('Cotización');
  });
});
