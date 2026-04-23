import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  receiptTemplates as receiptTemplatesTable,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import {
  buildPreviewData,
  renderReceipt,
} from '../services/receipt-renderer.js';
import { receiptLayoutSchema } from '../trpc/schemas/receiptTemplates.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let primarySiteId: string;

function createAdminContext(overrides?: Partial<Context['user']>): Context {
  const db = getDatabase();
  const baseUser = {
    id: userId,
    email: 'admin@localhost',
    role: 'admin' as const,
    tenantId,
    ...overrides,
  };
  return {
    req: {
      server: server.app,
      headers: {},
      user: {
        userId: baseUser.id,
        email: baseUser.email,
        role: baseUser.role,
        tenantId: baseUser.tenantId,
      },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: baseUser,
    tenantId: baseUser.tenantId,
    siteId: primarySiteId,
  };
}

function basicLayout() {
  return {
    paperWidth: '80mm' as const,
    blocks: [
      { type: 'text' as const, value: '{{company.name}}', style: 'title' as const, align: 'center' as const },
      { type: 'separator' as const },
      { type: 'text' as const, value: 'Sale {{sale.saleNumber}}' },
      {
        type: 'itemsTable' as const,
        columns: ['name' as const, 'qty' as const, 'unitPrice' as const, 'total' as const],
      },
      { type: 'totalsBlock' as const, show: ['subtotal' as const, 'taxTotal' as const, 'grandTotal' as const] },
      { type: 'tendersTable' as const, showChange: true },
    ],
  };
}

describe('Receipt Templates (Iter 2)', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const seededUser = await db
      .select()
      .from(users)
      .where(eq(users.email, 'admin@localhost'))
      .get();
    if (!seededUser) throw new Error('Expected seeded admin user');
    tenantId = seededUser.tenantId;
    userId = seededUser.id;

    const mainSite = await db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    if (!mainSite) throw new Error('Expected seeded main site');
    primarySiteId = mainSite.id;
  });

  afterAll(async () => {
    await server.close();
  });

  // -------------------------------------------------------------------------
  // Zod schema — variable whitelist + size limits
  // -------------------------------------------------------------------------

  describe('ReceiptLayout Zod schema', () => {
    it('rejects a layout with more than 50 blocks', () => {
      const blocks = Array.from({ length: 51 }, () => ({
        type: 'text' as const,
        value: 'Hello',
      }));
      const result = receiptLayoutSchema.safeParse({
        paperWidth: '80mm',
        blocks,
      });
      expect(result.success).toBe(false);
    });

    it('rejects a text block with more than 500 characters', () => {
      const result = receiptLayoutSchema.safeParse({
        paperWidth: '80mm',
        blocks: [{ type: 'text', value: 'x'.repeat(501) }],
      });
      expect(result.success).toBe(false);
    });

    it('rejects a variable referencing an unknown namespace', () => {
      const result = receiptLayoutSchema.safeParse({
        paperWidth: '80mm',
        blocks: [{ type: 'text', value: 'Hi {{secret.password}}' }],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(i => /secret/.test(i.message))).toBe(true);
      }
    });

    it('accepts variables in the whitelist (company, sale, item, fiscal, tender)', () => {
      const result = receiptLayoutSchema.safeParse({
        paperWidth: '80mm',
        blocks: [
          { type: 'text', value: '{{company.name}}' },
          { type: 'text', value: '{{sale.grandTotal}}' },
          { type: 'qr', source: '{{fiscal.qrUrl}}' },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('rejects a qr.source with a javascript: scheme', () => {
      const result = receiptLayoutSchema.safeParse({
        paperWidth: '80mm',
        blocks: [{ type: 'qr', source: 'javascript:alert(1)' }],
      });
      expect(result.success).toBe(false);
    });

    it('rejects an itemsTable with zero columns', () => {
      const result = receiptLayoutSchema.safeParse({
        paperWidth: '80mm',
        blocks: [{ type: 'itemsTable', columns: [] }],
      });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Renderer — pure function, HTML + ESC/POS
  // -------------------------------------------------------------------------

  describe('renderReceipt', () => {
    it('renders all atomic blocks for a 4-item sale with split tenders', () => {
      const data = buildPreviewData('sale');
      const layout = basicLayout();
      const result = renderReceipt(layout, data);
      // HTML contains the resolved company name (preview data) — already escaped.
      expect(result.html).toContain('Mi Tienda S.A.S.');
      expect(result.html).toContain('Sale V-000123');
      // Items rendered.
      expect(result.html).toContain('Café 250g');
      expect(result.html).toContain('Empanada de carne');
      // Tenders rendered with change row.
      expect(result.html).toContain('cash');
      expect(result.html).toContain('AUTH-887766');
      expect(result.html).toContain('Change');
      // ESC/POS bytes start with init (ESC @) and end with cut (GS V 0).
      expect(result.escpos[0]).toBe(0x1b);
      expect(result.escpos[1]).toBe(0x40);
      expect(result.escpos[result.escpos.length - 3]).toBe(0x1d);
      expect(result.escpos[result.escpos.length - 2]).toBe(0x56);
      expect(result.escpos[result.escpos.length - 1]).toBe(0x00);
      expect(result.escpos.length).toBeGreaterThan(50);
    });

    it('escapes HTML special characters injected via tenant data', () => {
      const data = buildPreviewData('sale');
      // Inject a script tag through the company name (simulating a
      // tenant who set their company name to a malicious string).
      data.company = { ...data.company, name: '<script>alert("xss")</script>' };
      const layout = {
        paperWidth: '80mm' as const,
        blocks: [{ type: 'text' as const, value: '{{company.name}}' }],
      };
      const result = renderReceipt(layout, data);
      expect(result.html).not.toContain('<script>alert');
      expect(result.html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    it('escapes HTML special characters in literal template text', () => {
      const data = buildPreviewData('sale');
      const layout = {
        paperWidth: '80mm' as const,
        blocks: [{ type: 'text' as const, value: 'Promo <b>50%</b>' }],
      };
      const result = renderReceipt(layout, data);
      // Even literal markup the admin typed into the layout is escaped —
      // the renderer is the single point of HTML emission.
      expect(result.html).toContain('Promo &lt;b&gt;50%&lt;/b&gt;');
      expect(result.html).not.toContain('<b>50%</b>');
    });

    it('renders an empty itemsTable without crashing', () => {
      const data = buildPreviewData('sale');
      data.sale = { ...data.sale, items: [] };
      const layout = {
        paperWidth: '80mm' as const,
        blocks: [{ type: 'itemsTable' as const, columns: ['name' as const, 'total' as const] }],
      };
      const result = renderReceipt(layout, data);
      expect(result.html).toContain('block-items');
      // No <tr> rows in tbody.
      expect(result.html).toMatch(/<tbody><\/tbody>/);
    });

    it('renders unknown variable references as empty strings (not undefined)', () => {
      const data = buildPreviewData('sale');
      const layout = {
        paperWidth: '80mm' as const,
        // {{sale.notARealField}} doesn't exist on the data shape; the
        // renderer must treat it as empty string, not literal "undefined".
        blocks: [{ type: 'text' as const, value: 'Note: {{sale.notARealField}}' }],
      };
      const result = renderReceipt(layout, data);
      expect(result.html).not.toContain('undefined');
      expect(result.html).toContain('Note: </div>');
    });

    it('strips disallowed URL schemes from a resolved QR source (defense in depth)', () => {
      // The Zod schema rejects literal `javascript:` text in qr.source,
      // but a layout that uses a variable like {{fiscal.qrUrl}} could
      // route a hostile URL through the resolver. The renderer's
      // second-line guard collapses it to empty before emission.
      const data = buildPreviewData('sale');
      data.fiscal = {
        ...data.fiscal,
        qrUrl: 'javascript:alert(1)',
      };
      const layout = {
        paperWidth: '80mm' as const,
        blocks: [{ type: 'qr' as const, source: '{{fiscal.qrUrl}}' }],
      };
      const result = renderReceipt(layout, data);
      expect(result.html).not.toContain('javascript:alert(1)');
      // Empty resolved source means the placeholder shows nothing.
      expect(result.html).toContain('data-qr-source=""');
    });

    it('strips disallowed URL schemes from a resolved barcode source', () => {
      const data = buildPreviewData('sale');
      data.fiscal = {
        ...data.fiscal,
        qrUrl: 'data:text/html,<script>alert(1)</script>',
      };
      const layout = {
        paperWidth: '80mm' as const,
        blocks: [{ type: 'barcode128' as const, source: '{{fiscal.qrUrl}}' }],
      };
      const result = renderReceipt(layout, data);
      expect(result.html).not.toContain('data:text/html');
      expect(result.html).not.toContain('<script>');
    });

    it('produces narrower ESC/POS lines for 58mm paper', () => {
      const data = buildPreviewData('sale');
      const layout58 = {
        paperWidth: '58mm' as const,
        blocks: [{ type: 'separator' as const, char: '-' }],
      };
      const layout80 = {
        paperWidth: '80mm' as const,
        blocks: [{ type: 'separator' as const, char: '-' }],
      };
      const r58 = renderReceipt(layout58, data);
      const r80 = renderReceipt(layout80, data);
      expect(r80.escpos.length).toBeGreaterThan(r58.escpos.length);
    });
  });

  // -------------------------------------------------------------------------
  // Router — CRUD + setDefault + duplicate + cross-tenant
  // -------------------------------------------------------------------------

  describe('CRUD via tRPC', () => {
    it('creates a template; the first one for a kind is auto-promoted to default', async () => {
      const caller = appRouter.createCaller(createAdminContext());
      const created = await caller.receiptTemplates.create({
        kind: 'sale',
        name: `Default sale ${nanoid(4)}`,
        layout: basicLayout(),
      });
      expect(created.isDefault).toBe(true);
      expect(created.kind).toBe('sale');
      expect(created.paperWidth).toBe('80mm');
    });

    it('creates a second template without isDefault; the first remains default', async () => {
      const caller = appRouter.createCaller(createAdminContext());
      const first = await caller.receiptTemplates.create({
        kind: 'quotation',
        name: `Quote A ${nanoid(4)}`,
        layout: basicLayout(),
      });
      const second = await caller.receiptTemplates.create({
        kind: 'quotation',
        name: `Quote B ${nanoid(4)}`,
        layout: basicLayout(),
      });
      expect(first.isDefault).toBe(true);
      expect(second.isDefault).toBe(false);

      const list = await caller.receiptTemplates.list({ kind: 'quotation' });
      const defaults = list.items.filter(t => t.isDefault);
      expect(defaults).toHaveLength(1);
      expect(defaults[0]?.id).toBe(first.id);
    });

    it('setDefault flips atomically — the prior default becomes false', async () => {
      const caller = appRouter.createCaller(createAdminContext());
      const a = await caller.receiptTemplates.create({
        kind: 'fiscal_dee',
        name: `Fiscal A ${nanoid(4)}`,
        layout: basicLayout(),
      });
      const b = await caller.receiptTemplates.create({
        kind: 'fiscal_dee',
        name: `Fiscal B ${nanoid(4)}`,
        layout: basicLayout(),
      });
      expect(a.isDefault).toBe(true);
      expect(b.isDefault).toBe(false);

      await caller.receiptTemplates.setDefault({ id: b.id });

      const refreshedA = await caller.receiptTemplates.getById({ id: a.id });
      const refreshedB = await caller.receiptTemplates.getById({ id: b.id });
      expect(refreshedA.isDefault).toBe(false);
      expect(refreshedB.isDefault).toBe(true);

      // Sanity: at most one default per (tenant, kind) — the partial
      // unique index would have rejected a violating insert.
      const list = await caller.receiptTemplates.list({ kind: 'fiscal_dee' });
      expect(list.items.filter(t => t.isDefault)).toHaveLength(1);
    });

    it('duplicate creates a non-default copy with " (copy)" suffix', async () => {
      const caller = appRouter.createCaller(createAdminContext());
      const original = await caller.receiptTemplates.create({
        kind: 'sale',
        name: `Original ${nanoid(4)}`,
        layout: basicLayout(),
      });
      const copy = await caller.receiptTemplates.duplicate({ id: original.id });
      expect(copy.name).toBe(`${original.name} (copy)`);
      expect(copy.isDefault).toBe(false);
      expect(copy.id).not.toBe(original.id);
      expect(copy.layout.blocks.length).toBe(original.layout.blocks.length);
    });

    it('cannot delete the only template for a kind', async () => {
      const caller = appRouter.createCaller(createAdminContext());
      // Use a distinct kind so unrelated tests don't collide.
      // We'll wipe the kind first to make this deterministic.
      const db = getDatabase();
      await db
        .delete(receiptTemplatesTable)
        .where(
          and(
            eq(receiptTemplatesTable.tenantId, tenantId),
            eq(receiptTemplatesTable.kind, 'fiscal_dee')
          )
        );

      const only = await caller.receiptTemplates.create({
        kind: 'fiscal_dee',
        name: `Solo ${nanoid(4)}`,
        layout: basicLayout(),
      });
      await expect(
        caller.receiptTemplates.delete({ id: only.id })
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    });

    it('refuses to delete the only ACTIVE template even when inactive siblings exist', async () => {
      const caller = appRouter.createCaller(createAdminContext());
      const db = getDatabase();
      // Reset the kind to a known state.
      await db
        .delete(receiptTemplatesTable)
        .where(
          and(
            eq(receiptTemplatesTable.tenantId, tenantId),
            eq(receiptTemplatesTable.kind, 'fiscal_dee')
          )
        );

      const active = await caller.receiptTemplates.create({
        kind: 'fiscal_dee',
        name: `Active ${nanoid(4)}`,
        layout: basicLayout(),
      });
      // Add an inactive sibling — counts toward total rows but cannot
      // become default because the partial unique index requires
      // is_default=1 on an active row, and the service filters fallback
      // promotion by is_active=true.
      const inactive = await caller.receiptTemplates.create({
        kind: 'fiscal_dee',
        name: `Inactive ${nanoid(4)}`,
        layout: basicLayout(),
        isActive: false,
      });

      await expect(
        caller.receiptTemplates.delete({ id: active.id })
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });

      // The inactive sibling is still deletable on its own.
      await caller.receiptTemplates.delete({ id: inactive.id });
    });

    it('after deleting the default, promotes a sibling to default', async () => {
      const caller = appRouter.createCaller(createAdminContext());
      const db = getDatabase();
      // Reset the kind to a known state.
      await db
        .delete(receiptTemplatesTable)
        .where(
          and(
            eq(receiptTemplatesTable.tenantId, tenantId),
            eq(receiptTemplatesTable.kind, 'quotation')
          )
        );

      const first = await caller.receiptTemplates.create({
        kind: 'quotation',
        name: `First ${nanoid(4)}`,
        layout: basicLayout(),
      });
      const second = await caller.receiptTemplates.create({
        kind: 'quotation',
        name: `Second ${nanoid(4)}`,
        layout: basicLayout(),
      });
      expect(first.isDefault).toBe(true);

      await caller.receiptTemplates.delete({ id: first.id });

      const refreshedSecond = await caller.receiptTemplates.getById({ id: second.id });
      expect(refreshedSecond.isDefault).toBe(true);
    });

    it('renderPreview returns HTML with a positive ESC/POS byte length', async () => {
      const caller = appRouter.createCaller(createAdminContext());
      const result = await caller.receiptTemplates.renderPreview({
        layout: basicLayout(),
        kind: 'sale',
      });
      expect(result.html).toContain('<!DOCTYPE html>');
      expect(result.escposByteLength).toBeGreaterThan(0);
    });

    it('renderPreview honors localized labels supplied by the client', async () => {
      const caller = appRouter.createCaller(createAdminContext());
      const result = await caller.receiptTemplates.renderPreview({
        layout: basicLayout(),
        kind: 'sale',
        labels: {
          documentTitle: 'Vista previa del recibo',
          itemColumns: {
            name: 'Ítem',
            qty: 'Cant.',
            unitPrice: 'Precio unit.',
            taxPercent: '% IVA',
            discount: 'Descuento',
            total: 'Total',
          },
          totalsLines: {
            subtotal: 'Subtotal',
            discount: 'Descuento',
            taxTotal: 'Impuesto',
            tip: 'Propina',
            grandTotal: 'Total',
          },
          tendersTable: {
            method: 'Método',
            reference: 'Referencia',
            amount: 'Monto',
            change: 'Cambio',
          },
        },
      });

      expect(result.html).toContain('Vista previa del recibo');
      expect(result.html).toContain('Ítem');
      expect(result.html).toContain('Método');
      expect(result.html).toContain('Cambio');
    });
  });

  // -------------------------------------------------------------------------
  // Cross-tenant isolation
  // -------------------------------------------------------------------------

  describe('cross-tenant isolation', () => {
    it("does not leak templates from a foreign tenant in list/getById", async () => {
      const db = getDatabase();
      const foreignTenantId = `foreign-${nanoid(6)}`;
      const foreignUserId = `foreign-${nanoid(6)}`;
      const now = new Date().toISOString();
      await db.insert(tenants).values({
        id: foreignTenantId,
        name: 'Foreign',
        slug: `foreign-${nanoid(6)}`,
        settings: {},
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(users).values({
        id: foreignUserId,
        tenantId: foreignTenantId,
        email: `foreign-${nanoid(6)}@example.com`,
        name: 'Foreign Admin',
        passwordHash: 'x',
        sessionVersion: 1,
        role: 'admin',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      const foreignTemplateId = `foreign-tpl-${nanoid(6)}`;
      await db.insert(receiptTemplatesTable).values({
        id: foreignTemplateId,
        tenantId: foreignTenantId,
        kind: 'sale',
        name: 'Foreign template',
        paperWidth: '80mm',
        layout: basicLayout() as unknown as Record<string, unknown>,
        isDefault: true,
        isActive: true,
        createdBy: foreignUserId,
        createdAt: now,
        updatedAt: now,
      });

      const caller = appRouter.createCaller(createAdminContext());
      const list = await caller.receiptTemplates.list();
      expect(list.items.find(t => t.id === foreignTemplateId)).toBeUndefined();

      await expect(
        caller.receiptTemplates.getById({ id: foreignTemplateId })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // -------------------------------------------------------------------------
  // Permissions
  // -------------------------------------------------------------------------

  describe('permissions', () => {
    it('rejects non-admin callers (manager) on create', async () => {
      const caller = appRouter.createCaller(
        createAdminContext({ role: 'manager' })
      );
      await expect(
        caller.receiptTemplates.create({
          kind: 'sale',
          name: 'Should fail',
          layout: basicLayout(),
        })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('rejects cashier callers on list', async () => {
      const caller = appRouter.createCaller(
        createAdminContext({ role: 'cashier' })
      );
      await expect(
        caller.receiptTemplates.list()
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });
});
