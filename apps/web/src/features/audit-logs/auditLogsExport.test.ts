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

  it('createdAt formatter is robust against missing values', () => {
    const columns = getAuditLogsExportColumns(i18n.t.bind(i18n));
    const fmt = columns.find(c => c.key === 'createdAt')!.formatter!;
    const entry = buildEntry();
    expect(typeof fmt(entry.createdAt, entry)).toBe('string');
    expect(fmt(null, entry)).toBe('');
    expect(fmt(undefined, entry)).toBe('');
  });

  it('actorName formatter falls back through actorEmail to actorId', () => {
    const columns = getAuditLogsExportColumns(i18n.t.bind(i18n));
    const fmt = columns.find(c => c.key === 'actorName')!.formatter!;
    const full = buildEntry();
    expect(fmt(undefined, full)).toBe('Administrator');
    expect(
      fmt(undefined, {
        ...full,
        actorName: undefined,
      } as unknown as AuditLogEntry)
    ).toBe('admin@localhost');
    expect(
      fmt(undefined, {
        ...full,
        actorName: undefined,
        actorEmail: undefined,
      } as unknown as AuditLogEntry)
    ).toBe('user-1');
  });

  it('metadata formatter serializes objects to JSON, empty to "", and null/undefined to ""', () => {
    const columns = getAuditLogsExportColumns(i18n.t.bind(i18n));
    const fmt = columns.find(c => c.key === 'metadata')!.formatter!;
    const entry = buildEntry();
    expect(fmt({ foo: 'bar' }, entry)).toBe('{"foo":"bar"}');
    // The current contract treats `{}` as truthy and serializes it.
    expect(fmt({}, entry)).toBe('{}');
    expect(fmt(null, entry)).toBe('');
    expect(fmt(undefined, entry)).toBe('');
  });

  it('action / resourceType formatters fall back to the raw key when the i18n key is missing', () => {
    const columns = getAuditLogsExportColumns(i18n.t.bind(i18n));
    const action = columns.find(c => c.key === 'action')!.formatter!;
    const resource = columns.find(c => c.key === 'resourceType')!.formatter!;
    const entry = buildEntry();
    // An action that has no i18n key should pass through via defaultValue.
    expect(action('totally.unknown.action', entry)).toBe('totally.unknown.action');
    expect(resource('totally_unknown_resource', entry)).toBe(
      'totally_unknown_resource'
    );
    // null / undefined are normalized to empty strings.
    expect(action(null, entry)).toBe('');
    expect(resource(undefined, entry)).toBe('');
  });

  it('resourceId column has no formatter (raw passthrough)', () => {
    const columns = getAuditLogsExportColumns(i18n.t.bind(i18n));
    expect(columns.find(c => c.key === 'resourceId')?.formatter).toBeUndefined();
  });
});
