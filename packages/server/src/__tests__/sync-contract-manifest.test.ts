/**
 * ENG-064 — Sync contract manifest exhaustiveness checks.
 *
 * Locks the per-entity conflict-policy mapping against ADR-0004's
 * lists and against the literal `entityType: '...'` strings every
 * router writer emits. New entity types added to a writer MUST
 * have an entry in `SYNC_CONFLICT_POLICY`; failing this test
 * prevents the writer rewrite from silently producing rows whose
 * conflict resolution is undefined.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SYNC_CONFLICT_POLICY,
  SYNC_ENTITY_TYPES,
  SYNC_PAYLOAD_VERSION,
  buildSyncContractManifest,
  resolveConflictPolicy,
  resolveDefaultPriority,
} from '../services/sync/contract.js';

describe('sync contract manifest', () => {
  it('exposes a positive payload version', () => {
    expect(SYNC_PAYLOAD_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('keys SYNC_CONFLICT_POLICY with the SYNC_ENTITY_TYPES literal list', () => {
    const declared = new Set<string>(SYNC_ENTITY_TYPES);
    const policyKeys = new Set(Object.keys(SYNC_CONFLICT_POLICY));
    expect(policyKeys).toEqual(declared);
  });

  it('classifies money / fiscal / cash / inventory / audit entities as manual', () => {
    const expectedManual = [
      'sales',
      'sale_items',
      'sale_payments',
      'sale_returns',
      'cash_sessions',
      'cash_movements',
      'fiscal_documents',
      'fiscal_document_items',
      'fiscal_numbering_resolutions',
      'fiscal_certificates',
      'inventory_movements',
      'inventory_balances',
      'transfer_orders',
      'transfer_order_items',
      'stock_adjustments',
      'audit_logs',
    ] as const;
    for (const entity of expectedManual) {
      expect(SYNC_CONFLICT_POLICY[entity]).toBe('manual');
    }
  });

  it('classifies catalog / preferences entities as auto_lww', () => {
    const expectedAutoLww = [
      'customers',
      'products',
      'categories',
      'units',
      'providers',
      'vat_rates',
      'identification_types',
      'client_types',
      'commercial_activities',
      'regime_types',
      'person_types',
      'sites',
      'locations',
      'site_peripherals',
      'receipt_templates',
    ] as const;
    for (const entity of expectedAutoLww) {
      expect(SYNC_CONFLICT_POLICY[entity]).toBe('auto_lww');
    }
  });

  it('returns the policy for known entities and throws for unknown', () => {
    expect(resolveConflictPolicy('sales')).toBe('manual');
    expect(resolveConflictPolicy('customers')).toBe('auto_lww');
    expect(() => resolveConflictPolicy('unknown_entity_type')).toThrow();
  });

  it('returns audit_logs with priority 10 and money entities with priority 5', () => {
    expect(resolveDefaultPriority('audit_logs')).toBe(10);
    expect(resolveDefaultPriority('sales')).toBe(5);
    expect(resolveDefaultPriority('cash_sessions')).toBe(5);
    expect(resolveDefaultPriority('customers')).toBe(0);
    expect(resolveDefaultPriority('products')).toBe(0);
  });

  it('builds a manifest with one entry per entity sorted in declaration order', () => {
    const manifest = buildSyncContractManifest();
    expect(manifest.payloadVersion).toBe(SYNC_PAYLOAD_VERSION);
    expect(manifest.entities).toHaveLength(SYNC_ENTITY_TYPES.length);
    expect(manifest.entities[0]?.entityType).toBe(SYNC_ENTITY_TYPES[0]);
    for (const entry of manifest.entities) {
      expect(SYNC_CONFLICT_POLICY[entry.entityType]).toBe(entry.conflictPolicy);
    }
  });

  it('covers every entityType literal emitted by any router writer', async () => {
    const routersDir = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      '../trpc/routers'
    );
    const files = await readdir(routersDir);
    const writerFiles = files.filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'));
    const used = new Set<string>();
    for (const name of writerFiles) {
      const source = await readFile(path.join(routersDir, name), 'utf-8');
      const matches = source.matchAll(/entityType:\s*['"]([a-z_]+)['"]/g);
      for (const match of matches) {
        used.add(match[1]!);
      }
    }
    const declared = new Set<string>(SYNC_ENTITY_TYPES);
    const missing: string[] = [];
    for (const entity of used) {
      if (!declared.has(entity)) {
        missing.push(entity);
      }
    }
    expect(missing, `entityType literals missing from SYNC_ENTITY_TYPES: ${missing.join(', ')}`).toEqual([]);
  });
});
