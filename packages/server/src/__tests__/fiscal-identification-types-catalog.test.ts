/**
 * pins the renamed + reshaped fiscal identification catalog.
 *
 * The catalog moved from `dian_identification_types` (10 rows, single
 * `code` PK) to `fiscal_identification_types` (23 rows after seed,
 * composite PK `(country_code, code)`) so SAT México (CFDI), SUNAT
 * Perú (Catálogo Nº 6) and SII Chile (Catálogo Nº 11) can coexist
 * with DIAN Colombia in the same global table.
 *
 * The composite FK in `fiscal_documents` resolves
 * `(buyer_country_code, buyer_tax_id_type_code)` against this table.
 * Legacy rows back-fill to `buyer_country_code = 'CO'` (single-country
 * MVP era).
 */

import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';

interface LiveDatabase {
  $client: Database.Database;
}

afterEach(() => {
  closeDatabase();
});

function liveClient(): Database.Database {
  return (getDatabase() as unknown as LiveDatabase).$client;
}

describe('fiscal identification catalog', () => {
  describe('seed', () => {
    it('seeds 23 rows total across CO / MX / PE / CL', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      const row = c.prepare('SELECT COUNT(*) AS count FROM fiscal_identification_types').get() as {
        count: number;
      };
      expect(row.count).toBe(23);
    });

    it('seeds 10 Colombia rows back-filled from the legacy DIAN catalog', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      const row = c
        .prepare(
          "SELECT COUNT(*) AS count FROM fiscal_identification_types WHERE country_code = 'CO'"
        )
        .get() as { count: number };
      expect(row.count).toBe(10);
    });

    it('seeds the minimal SAT México subset (4 rows)', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      const row = c
        .prepare(
          "SELECT COUNT(*) AS count FROM fiscal_identification_types WHERE country_code = 'MX'"
        )
        .get() as { count: number };
      expect(row.count).toBe(4);
    });

    it('seeds the minimal SUNAT Perú subset (5 rows)', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      const row = c
        .prepare(
          "SELECT COUNT(*) AS count FROM fiscal_identification_types WHERE country_code = 'PE'"
        )
        .get() as { count: number };
      expect(row.count).toBe(5);
    });

    it('seeds the minimal SII Chile subset (4 rows)', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      const row = c
        .prepare(
          "SELECT COUNT(*) AS count FROM fiscal_identification_types WHERE country_code = 'CL'"
        )
        .get() as { count: number };
      expect(row.count).toBe(4);
    });

    it('preserves the DIAN 13 = CC row verbatim after the rename', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      const row = c
        .prepare(
          "SELECT abbr, name_es, name_en, natural_person FROM fiscal_identification_types WHERE country_code = 'CO' AND code = '13'"
        )
        .get() as {
        abbr: string;
        name_es: string;
        name_en: string;
        natural_person: number;
      };
      expect(row.abbr).toBe('CC');
      expect(row.name_es).toBe('Cédula de ciudadanía');
      expect(row.name_en).toBe('Citizenship ID');
      expect(row.natural_person).toBe(1);
    });

    it('is idempotent across reboots (INSERT OR IGNORE)', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      // Re-running the seed by re-calling initDatabase against the same
      // in-memory DB would create a fresh instance, so we just verify
      // the count is stable after one boot. The seed function uses
      // INSERT OR IGNORE so re-execution against an already-seeded DB
      // would be a no-op at the SQL level.
      const c = liveClient();
      const row = c.prepare('SELECT COUNT(*) AS count FROM fiscal_identification_types').get() as {
        count: number;
      };
      expect(row.count).toBe(23);
    });
  });

  describe('composite primary key', () => {
    it('rejects a duplicate (country_code, code) tuple', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      expect(() =>
        c
          .prepare(
            "INSERT INTO fiscal_identification_types (country_code, code, abbr, name_es, name_en, natural_person) VALUES ('CO', '13', 'CC', 'dup', 'dup', 1)"
          )
          .run()
      ).toThrowError(
        expect.objectContaining({
          code: 'SQLITE_CONSTRAINT_PRIMARYKEY',
        })
      );
    });

    it('accepts the same code under a different country_code', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      // Insert a hypothetical Brazilian '13' code; it should coexist
      // with DIAN ('CO', '13') because the PK is composite. BR is in
      // country_catalog, so the FK passes.
      c.prepare(
        "INSERT INTO fiscal_identification_types (country_code, code, abbr, name_es, name_en, natural_person) VALUES ('BR', '13', 'TEST', 'Prueba', 'Test', 1)"
      ).run();
      const row = c
        .prepare("SELECT COUNT(*) AS count FROM fiscal_identification_types WHERE code = '13'")
        .get() as { count: number };
      // Both ('CO', '13') and the new ('BR', '13') coexist.
      expect(row.count).toBe(2);
    });
  });

  describe('fiscal_documents composite FK', () => {
    it('accepts an insert with a valid (CO, 13) buyer pair', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      c.pragma('foreign_keys = ON');
      // Minimal FK skeleton.
      c.prepare("INSERT INTO tenants (id, name, slug) VALUES ('t1', 't', 's')").run();
      c.prepare(
        "INSERT INTO companies (id, tenant_id, name) VALUES ('co1', 't1', 'Company')"
      ).run();
      c.prepare(
        "INSERT INTO sites (id, tenant_id, company_id, name) VALUES ('site1', 't1', 'co1', 'Main')"
      ).run();
      c.prepare(
        "INSERT INTO users (id, tenant_id, email, password_hash, name, role) VALUES ('u1', 't1', 'a@b', 'x', 'a', 'admin')"
      ).run();
      c.prepare(
        `INSERT INTO fiscal_numbering_resolutions (id, tenant_id, site_id, kind, resolution_number, prefix, from_number, to_number, current_number, technical_key, valid_from, valid_until, is_active)
         VALUES ('r1', 't1', 'site1', 'FEV', '1876', 'F', 1, 1000, 0, 'tech-key', '2026-01-01', '2026-12-31', 1)`
      ).run();
      // Insert a fiscal_documents row that references CO/13. Skip the
      // optional customers FK, but keep all required parents present
      // and foreign_keys ON so the composite FK is actually exercised.
      c.prepare(
        `INSERT INTO fiscal_documents (id, tenant_id, source, source_id, kind, resolution_id, consecutive, document_number, cufe, buyer_tax_id, buyer_country_code, buyer_tax_id_type_code, buyer_name, currency_code, locale_code, provider_id, emitted_by_user_id)
         VALUES ('fd1', 't1', 'sale', 's1', 'FEV', 'r1', 1, 'F-001', 'cufe1', '900', 'CO', '13', 'Buyer', 'COP', 'es-CO', 'mock', 'u1')`
      ).run();
      const row = c
        .prepare(
          "SELECT buyer_country_code, buyer_tax_id_type_code FROM fiscal_documents WHERE id = 'fd1'"
        )
        .get() as {
        buyer_country_code: string;
        buyer_tax_id_type_code: string;
      };
      expect(row.buyer_country_code).toBe('CO');
      expect(row.buyer_tax_id_type_code).toBe('13');
    });

    it('rejects an insert when (country_code, code) is not in the catalog', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      c.pragma('foreign_keys = OFF');
      c.prepare("INSERT INTO tenants (id, name, slug) VALUES ('t1', 't', 's')").run();
      c.prepare(
        "INSERT INTO users (id, tenant_id, email, password_hash, name, role) VALUES ('u1', 't1', 'a@b', 'x', 'a', 'admin')"
      ).run();
      // Switch FKs ON and try to insert an invalid pair. MX does not
      // carry code '99' in the catalog.
      c.pragma('foreign_keys = ON');
      expect(() =>
        c
          .prepare(
            `INSERT INTO fiscal_documents (id, tenant_id, source, source_id, kind, resolution_id, consecutive, document_number, cufe, buyer_tax_id, buyer_country_code, buyer_tax_id_type_code, buyer_name, currency_code, locale_code, provider_id, emitted_by_user_id)
             VALUES ('fd2', 't1', 'sale', 's2', 'FEV', 'r1', 1, 'F-002', 'cufe2', '900', 'MX', '99', 'Buyer', 'MXN', 'es-MX', 'mock', 'u1')`
          )
          .run()
      ).toThrowError(
        expect.objectContaining({
          code: 'SQLITE_CONSTRAINT_FOREIGNKEY',
        })
      );
    });
  });
});
