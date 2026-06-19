import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  companies,
  receiptTemplates as receiptTemplatesTable,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import {
  APP_FOOTER_METADATA,
  buildPreviewData,
  renderReceipt,
} from '../services/receipt-renderer/index.js';
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

    it('keeps preview company.city empty to match the variable availability contract', () => {
      const data = buildPreviewData('sale');
      const layout = {
        paperWidth: '80mm' as const,
        blocks: [{ type: 'text' as const, value: '{{company.city}}' }],
      };
      expect(data.company.city).toBeNull();
      expect(renderReceipt(layout, data).html).not.toContain('Bogotá');
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

    // ENG-016 pass 1 (item #5) — Puntovivo-branded footer block.
    it('renders the appFooter block with Puntovivo metadata (HTML + ESC/POS)', () => {
      const data = buildPreviewData('sale');
      const layout = {
        paperWidth: '80mm' as const,
        blocks: [{ type: 'appFooter' as const, show: true, align: 'center' as const }],
      };
      const result = renderReceipt(layout, data);
      const { appName, appVersion, appUrl, appSupport } = APP_FOOTER_METADATA;
      expect(result.html).toContain(`${appName} ${appVersion}`);
      expect(result.html).toContain(appUrl);
      expect(result.html).toContain(appSupport);
      // ESC/POS byte stream carries the same three lines (ASCII).
      const escposText = Array.from(result.escpos)
        .map(b => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ''))
        .join('');
      expect(escposText).toContain(`${appName} ${appVersion}`);
      expect(escposText).toContain(appUrl);
      expect(escposText).toContain(appSupport);
    });

    // ENG-016 pass 1 (item #5) — toggle hides both HTML and ESC/POS output.
    it('renders an empty appFooter when show is false (soft-hide)', () => {
      const data = buildPreviewData('sale');
      const layout = {
        paperWidth: '80mm' as const,
        blocks: [{ type: 'appFooter' as const, show: false }],
      };
      const result = renderReceipt(layout, data);
      const { appName } = APP_FOOTER_METADATA;
      expect(result.html).not.toContain(appName);
      const escposText = Array.from(result.escpos)
        .map(b => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ''))
        .join('');
      expect(escposText).not.toContain(appName);
    });

    // ENG-016 pass 1 (item #5) — schema acceptance + rejection of unknown fields.
    it('Zod schema accepts appFooter and rejects unknown block fields', () => {
      const ok = receiptLayoutSchema.safeParse({
        paperWidth: '80mm',
        blocks: [{ type: 'appFooter', show: true, align: 'center' }],
      });
      expect(ok.success).toBe(true);

      const okDefault = receiptLayoutSchema.safeParse({
        paperWidth: '80mm',
        blocks: [{ type: 'appFooter' }],
      });
      expect(okDefault.success).toBe(true);

      const bad = receiptLayoutSchema.safeParse({
        paperWidth: '80mm',
        blocks: [{ type: 'appFooter', show: 'yes' }],
      });
      expect(bad.success).toBe(false);
    });

    // -------------------------------------------------------------------------
    // ENG-086 — thermal-handoff blocks: wordmark + metaTable + QR placeholder
    // -------------------------------------------------------------------------

    it('renders the wordmark block as the puntovivo lockup with a brand dot (HTML)', () => {
      const data = buildPreviewData('sale');
      const layout = {
        paperWidth: '80mm' as const,
        blocks: [{ type: 'wordmark' as const, show: true, align: 'center' as const }],
      };
      const result = renderReceipt(layout, data);
      // Sans-serif wordmark with bold `vivo` + an explicit dot span so the
      // ESC/POS strip silhouette matches the editor preview.
      expect(result.html).toContain('class="block block-wordmark align-center"');
      expect(result.html).toContain('<div class="wordmark">punto<b>vivo</b>');
      expect(result.html).toContain('class="wordmark-dot"');
      expect(result.html).toContain('<div class="wordmark-tagline">CONSOLA RETAIL</div>');
    });

    it('collapses the wordmark block to an empty string when show is false', () => {
      const data = buildPreviewData('sale');
      const layout = {
        paperWidth: '80mm' as const,
        blocks: [{ type: 'wordmark' as const, show: false }],
      };
      const result = renderReceipt(layout, data);
      expect(result.html).not.toContain('class="wordmark"');
      const escposText = Array.from(result.escpos)
        .map(b => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ''))
        .join('');
      // ESC/POS payload only carries the printer init + cut bytes when
      // every block hides — the wordmark text must NOT leak through.
      expect(escposText).not.toContain('puntovivo');
    });

    it('prints the wordmark as a bold centered puntovivo line in ESC/POS', () => {
      const data = buildPreviewData('sale');
      const layout = {
        paperWidth: '80mm' as const,
        blocks: [{ type: 'wordmark' as const, show: true, align: 'center' as const }],
      };
      const result = renderReceipt(layout, data);
      const escposText = Array.from(result.escpos)
        .map(b => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ''))
        .join('');
      expect(escposText).toContain('puntovivo');
      expect(escposText).toContain('CONSOLA RETAIL');
      // ESC a 1 == center align, ESC E 1 == bold on. Both must precede
      // the wordmark bytes; ESC E 0 must follow to reset.
      const bytes = Array.from(result.escpos);
      const centerIdx = bytes.findIndex(
        (b, i) => b === 0x1b && bytes[i + 1] === 0x61 && bytes[i + 2] === 1
      );
      const boldOnIdx = bytes.findIndex(
        (b, i) => b === 0x1b && bytes[i + 1] === 0x45 && bytes[i + 2] === 1
      );
      expect(centerIdx).toBeGreaterThanOrEqual(0);
      expect(boldOnIdx).toBeGreaterThan(centerIdx);
    });

    it('renders a metaTable block as a key/value dl grid', () => {
      const data = buildPreviewData('sale');
      const layout = {
        paperWidth: '80mm' as const,
        blocks: [
          {
            type: 'metaTable' as const,
            rows: [
              { key: 'Factura', value: '{{sale.saleNumber}}' },
              { key: 'Caja', value: '{{sale.cashier}}' },
            ],
          },
        ],
      };
      const result = renderReceipt(layout, data);
      expect(result.html).toContain('class="block block-meta"');
      expect(result.html).toContain('<dl class="meta-grid">');
      expect(result.html).toContain('<dt class="meta-key">Factura</dt>');
      expect(result.html).toContain('<dd class="meta-value">V-000123</dd>');
      expect(result.html).toContain('<dt class="meta-key">Caja</dt>');
      expect(result.html).toContain('<dd class="meta-value">Ana López</dd>');
    });

    it('drops metaTable rows whose value resolves to an empty string', () => {
      const data = buildPreviewData('sale');
      // Clear the customer so the row interpolation collapses to ''.
      data.sale.customer = null;
      const layout = {
        paperWidth: '80mm' as const,
        blocks: [
          {
            type: 'metaTable' as const,
            rows: [
              { key: 'Factura', value: '{{sale.saleNumber}}' },
              { key: 'Cliente', value: '{{sale.customer}}' },
            ],
          },
        ],
      };
      const result = renderReceipt(layout, data);
      expect(result.html).toContain('Factura');
      expect(result.html).not.toContain('Cliente');
      const escposText = Array.from(result.escpos)
        .map(b => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ''))
        .join('');
      expect(escposText).toContain('Factura');
      expect(escposText).not.toContain('Cliente');
    });

    it('pads metaTable rows to the paper char count in ESC/POS', () => {
      const data = buildPreviewData('sale');
      const layout = {
        paperWidth: '58mm' as const, // 32 chars
        blocks: [
          {
            type: 'metaTable' as const,
            rows: [{ key: 'A', value: 'B' }],
          },
        ],
      };
      const result = renderReceipt(layout, data);
      const escposText = Array.from(result.escpos)
        .map(b => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ''))
        .join('');
      // "A" + 30 spaces + "B" = 32 chars total
      expect(escposText).toContain(`A${' '.repeat(30)}B`);
    });

    it('renders a real inline SVG QR for a non-empty source (ENG-097)', () => {
      const data = buildPreviewData('sale');
      const layout = {
        paperWidth: '80mm' as const,
        blocks: [{ type: 'qr' as const, source: '{{fiscal.qrUrl}}', sizeMm: 25 }],
      };
      const result = renderReceipt(layout, data);
      const bodyHtml = result.html.replace(/<style>[\s\S]*?<\/style>/g, '');
      // The qrcode lib emits a single <svg> with a <path> covering every
      // dark module. The body must carry that markup AND retain the
      // data-qr-source attribute so the print handler / scanner can
      // observe the encoded URL.
      expect(bodyHtml).toContain('class="qr-svg"');
      expect(bodyHtml).toContain('<svg');
      expect(bodyHtml).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(bodyHtml).toContain('data-qr-source="');
      expect(bodyHtml).toContain('catalogo-vpfe.dian.gov.co');
      // The 1-bit rule still holds: no gradient, no opacity tweaks.
      expect(bodyHtml).not.toContain('gradient');
      expect(bodyHtml).not.toContain('opacity:');
      // ENG-086 placeholder finder-pattern markup is no longer emitted
      // on the happy path (it lives only in the encoder-fallback branch
      // and the empty-source branch).
      expect(bodyHtml).not.toContain('class="qr-finder qr-finder-tl"');
    });

    it('keeps the QR placeholder empty when the source resolves to empty', () => {
      const data = buildPreviewData('sale');
      const layout = {
        paperWidth: '80mm' as const,
        blocks: [{ type: 'qr' as const, source: '{{ default(fiscal.cufe, "") }}' }],
      };
      // Clear the cufe so the default substitution collapses to ''.
      data.fiscal = { ...data.fiscal, cufe: null };
      const result = renderReceipt(layout, data);
      expect(result.html).toContain('class="qr-placeholder qr-placeholder-empty"');
      // Body-only assertion: the empty placeholder must not emit any
      // finder-pattern span elements. The CSS rule `.qr-finder-tl`
      // still lives in the stylesheet, so we strip the <style> block
      // before asserting against the rendered body.
      const bodyHtml = result.html.replace(
        /<style>[\s\S]*?<\/style>/g,
        ''
      );
      expect(bodyHtml).not.toContain('qr-finder-tl');
      expect(bodyHtml).not.toContain('<svg');
    });

    it('emits the GS ( k QR opcode sequence in the ESC/POS payload (ENG-097)', () => {
      const data = buildPreviewData('sale');
      const layout = {
        paperWidth: '80mm' as const,
        blocks: [{ type: 'qr' as const, source: '{{fiscal.qrUrl}}', sizeMm: 25 }],
      };
      const result = renderReceipt(layout, data);
      const bytes = Array.from(result.escpos);
      // Helper: locate the first occurrence of an exact byte sequence.
      const indexOfSequence = (seq: number[]): number => {
        outer: for (let i = 0; i + seq.length <= bytes.length; i += 1) {
          for (let j = 0; j < seq.length; j += 1) {
            if (bytes[i + j] !== seq[j]) continue outer;
          }
          return i;
        }
        return -1;
      };
      // Model select: GS ( k 04 00 31 41 32 00.
      const modelIdx = indexOfSequence([
        0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00,
      ]);
      // Module size: GS ( k 03 00 31 43 06 (default moduleSize 6).
      const sizeIdx = indexOfSequence([
        0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06,
      ]);
      // Error correction level M: GS ( k 03 00 31 45 31.
      const ecIdx = indexOfSequence([
        0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31,
      ]);
      // Print: GS ( k 03 00 31 51 30.
      const printIdx = indexOfSequence([
        0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30,
      ]);
      expect(modelIdx).toBeGreaterThanOrEqual(0);
      expect(sizeIdx).toBeGreaterThan(modelIdx);
      expect(ecIdx).toBeGreaterThan(sizeIdx);
      expect(printIdx).toBeGreaterThan(ecIdx);
      // The legacy `[QR: ...]` text fallback must not leak when the
      // encoder succeeded.
      const escposText = bytes
        .map(b => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ''))
        .join('');
      expect(escposText).not.toContain('[QR:');
    });

    it('falls back to the placeholder text in ESC/POS when the source is empty', () => {
      const data = buildPreviewData('sale');
      data.fiscal = { ...data.fiscal, cufe: null };
      const layout = {
        paperWidth: '80mm' as const,
        blocks: [{ type: 'qr' as const, source: '{{ default(fiscal.cufe, "") }}' }],
      };
      const result = renderReceipt(layout, data);
      const bytes = Array.from(result.escpos);
      // Empty source must NOT emit the GS ( k model-select opcode.
      const hasModelOpcode = bytes.some(
        (_, i) =>
          bytes[i] === 0x1d &&
          bytes[i + 1] === 0x28 &&
          bytes[i + 2] === 0x6b &&
          bytes[i + 5] === 0x31 &&
          bytes[i + 6] === 0x41
      );
      expect(hasModelOpcode).toBe(false);
    });

    it('embeds the print tokens from PRINT_TOKENS in the document stylesheet', () => {
      const data = buildPreviewData('sale');
      const layout = {
        paperWidth: '80mm' as const,
        blocks: [{ type: 'text' as const, value: '{{sale.saleNumber}}' }],
      };
      const result = renderReceipt(layout, data);
      // Body font, grand-total size, ink, and paper must come from the
      // shared tokens — mirrors `apps/web/src/styles/theme.css` ENG-080
      // print-tokens block. Drift on either side fails this test.
      expect(result.html).toContain("'IBM Plex Mono'");
      expect(result.html).toContain('font-size:14pt');
      expect(result.html).toContain('color:#000');
      expect(result.html).toContain('background:#fff');
    });

    it('uses the real thermal dot widths from PRINT_TOKENS', () => {
      const data = buildPreviewData('sale');
      const baseBlocks = [{ type: 'text' as const, value: '{{sale.saleNumber}}' }];

      expect(
        renderReceipt({ paperWidth: '58mm' as const, blocks: baseBlocks }, data).html
      ).toContain('width:384px');
      expect(
        renderReceipt({ paperWidth: '80mm' as const, blocks: baseBlocks }, data).html
      ).toContain('width:576px');
    });

    it('Zod schema accepts wordmark + metaTable blocks; rejects empty rows + unknown keys', () => {
      const ok = receiptLayoutSchema.safeParse({
        paperWidth: '80mm',
        blocks: [
          { type: 'wordmark', show: true, align: 'center' },
          {
            type: 'metaTable',
            rows: [{ key: 'Factura', value: '{{sale.saleNumber}}' }],
          },
        ],
      });
      expect(ok.success).toBe(true);

      const emptyRows = receiptLayoutSchema.safeParse({
        paperWidth: '80mm',
        blocks: [{ type: 'metaTable', rows: [] }],
      });
      expect(emptyRows.success).toBe(false);

      const tooManyRows = receiptLayoutSchema.safeParse({
        paperWidth: '80mm',
        blocks: [
          {
            type: 'metaTable',
            rows: Array.from({ length: 13 }, (_, i) => ({
              key: `K${i}`,
              value: '{{sale.saleNumber}}',
            })),
          },
        ],
      });
      expect(tooManyRows.success).toBe(false);

      const unknownNs = receiptLayoutSchema.safeParse({
        paperWidth: '80mm',
        blocks: [
          { type: 'metaTable', rows: [{ key: 'X', value: '{{evil.path}}' }] },
        ],
      });
      expect(unknownNs.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Template functions (ENG-016 pass 3 — item #3)
  // -------------------------------------------------------------------------

  describe('Template functions (ENG-016 pass 3)', () => {
    const buildSampleData = () => ({
      ...buildPreviewData('sale'),
      locale: {
        locale: 'es-CO',
        currency: 'COP',
        legalDecimals: 2,
        displayDecimals: 0,
        dateFormat: 'dd/MM/yyyy',
      },
    });

    it('renders currency() with locale-aware formatting', () => {
      const layout = receiptLayoutSchema.parse({
        paperWidth: '80mm',
        blocks: [
          {
            type: 'text' as const,
            value: 'Total: {{ currency(sale.grandTotal) }}',
          },
        ],
      });
      const html = renderReceipt(layout, buildSampleData()).html;
      expect(html).toContain('Total: ');
      // es-CO + COP + 0 decimals → "$ 94.000" (non-breaking space between
      // symbol and digits). Match the digit grouping shape rather than the
      // raw NBSP since the codepoint is locale-implementation specific.
      expect(html).toMatch(/Total: [^<]*\$[^<]*\d{1,3}[.,]\d{3}/);
    });

    it('renders currency() with explicit decimals override', () => {
      const layout = receiptLayoutSchema.parse({
        paperWidth: '80mm',
        blocks: [
          {
            type: 'text' as const,
            value: '{{ currency(sale.grandTotal, 2) }}',
          },
        ],
      });
      const html = renderReceipt(layout, buildSampleData()).html;
      expect(html).toMatch(/[.,]\d{2}/);
    });

    it('renders date() with default tenant pattern and explicit pattern', () => {
      const layout = receiptLayoutSchema.parse({
        paperWidth: '80mm',
        blocks: [
          {
            type: 'text' as const,
            value:
              'Default: {{ date(sale.createdAt) }} | Explicit: {{ date(sale.createdAt, "yyyy/MM/dd") }}',
          },
        ],
      });
      const html = renderReceipt(layout, buildSampleData()).html;
      expect(html).toMatch(/Default: \d{2}\/\d{2}\/\d{4}/);
      expect(html).toMatch(/Explicit: \d{4}\/\d{2}\/\d{2}/);
    });

    it('renders limit() truncating long text with ellipsis', () => {
      const data = buildSampleData();
      data.sale = {
        ...data.sale,
        notes: 'a'.repeat(60),
      };
      const layout = receiptLayoutSchema.parse({
        paperWidth: '80mm',
        blocks: [
          {
            type: 'text' as const,
            value: '{{ limit(sale.notes, 20) }}',
          },
        ],
      });
      const html = renderReceipt(layout, data).html;
      expect(html).toContain('a'.repeat(17) + '...');
    });

    it('renders concat() with literal + path + nested call', () => {
      const layout = receiptLayoutSchema.parse({
        paperWidth: '80mm',
        blocks: [
          {
            type: 'text' as const,
            value:
              "{{ concat('Caja: ', sale.cashier, ' | Total: ', currency(sale.grandTotal)) }}",
          },
        ],
      });
      const html = renderReceipt(layout, buildSampleData()).html;
      expect(html).toMatch(/Caja: [^|]+ \| Total: /);
    });

    it('renders default() falling back when value is empty', () => {
      const data = buildSampleData();
      data.fiscal = { ...(data.fiscal ?? {}), cufe: '' };
      const layout = receiptLayoutSchema.parse({
        paperWidth: '80mm',
        blocks: [
          {
            type: 'text' as const,
            value: '{{ default(fiscal.cufe, "Sin CUFE") }}',
          },
        ],
      });
      const html = renderReceipt(layout, data).html;
      expect(html).toContain('Sin CUFE');
    });

    it('renders upper(), lower(), round(), abs(), max(), min(), sum()', () => {
      const layout = receiptLayoutSchema.parse({
        paperWidth: '80mm',
        blocks: [
          {
            type: 'text' as const,
            value:
              "{{upper('hola')}} {{lower('HOLA')}} {{round(1.456,2)}} {{abs(-7)}} {{max(1,5,3)}} {{min(1,5,3)}} {{sum(1,2,3)}}",
          },
        ],
      });
      const html = renderReceipt(layout, buildSampleData()).html;
      expect(html).toContain('HOLA');
      expect(html).toContain('hola');
      expect(html).toContain('1.46');
      expect(html).toContain('7');
      expect(html).toContain('5');
      expect(html).toContain('1');
      expect(html).toContain('6');
    });

    it('escapes HTML in fallback string literals at the emission boundary', () => {
      const data = buildSampleData();
      data.sale = { ...data.sale, notes: '' };
      const layout = receiptLayoutSchema.parse({
        paperWidth: '80mm',
        blocks: [
          {
            type: 'text' as const,
            value:
              '{{ default(sale.notes, "<script>alert(1)</script>") }}',
          },
        ],
      });
      const html = renderReceipt(layout, data).html;
      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<script>alert');
    });

    it('emits ESC/POS bytes for function-bearing templates without HTML entities', () => {
      const layout = receiptLayoutSchema.parse({
        paperWidth: '80mm',
        blocks: [
          {
            type: 'text' as const,
            value: "{{ concat('TOTAL: ', currency(sale.grandTotal)) }}",
          },
        ],
      });
      const result = renderReceipt(layout, buildSampleData());
      const bytes = Array.from(result.escpos);
      const text = new TextDecoder('utf-8').decode(new Uint8Array(bytes));
      expect(text).toContain('TOTAL: ');
      expect(text).not.toContain('&lt;');
      expect(text).not.toContain('&amp;');
    });

    it('Zod rejects unknown function names', () => {
      const result = receiptLayoutSchema.safeParse({
        paperWidth: '80mm',
        blocks: [
          { type: 'text', value: "{{ notAWhitelistedName('hi') }}" },
        ],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toMatch(/Unknown function/);
      }
    });

    it('Zod rejects wrong arity for whitelisted functions', () => {
      const cases = [
        '{{ upper() }}',
        "{{ limit('hola') }}",
        "{{ default('only one') }}",
      ];
      for (const value of cases) {
        const result = receiptLayoutSchema.safeParse({
          paperWidth: '80mm',
          blocks: [{ type: 'text', value }],
        });
        expect(result.success, `value: ${value}`).toBe(false);
      }
    });

    it('Zod rejects qr.source containing a string-literal javascript: scheme', () => {
      const result = receiptLayoutSchema.safeParse({
        paperWidth: '80mm',
        blocks: [
          {
            type: 'qr' as const,
            source: "{{ concat('javascript:', sale.saleNumber) }}",
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('keeps backward compatibility: default presets still render byte-identical to legacy regex output', () => {
      const layout = receiptLayoutSchema.parse(basicLayout());
      const data = buildSampleData();
      const result = renderReceipt(layout, data);
      expect(result.html).toContain('block-text');
      expect(result.html).toContain('block-items');
      expect(result.html).toContain('block-tenders');
      expect(result.escpos.length).toBeGreaterThan(0);
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
            serviceCharge: 'Servicio',
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

  // -------------------------------------------------------------------------
  // Variable availability (ENG-016 pass 5 — closes item #7)
  // -------------------------------------------------------------------------

  describe('variableAvailability', () => {
    it('returns sale + item + tender keys all true (per-tenant contract pins them as always populated)', async () => {
      const caller = appRouter.createCaller(createAdminContext());
      const map = await caller.receiptTemplates.variableAvailability();
      // Every documented per-row field comes back true regardless of
      // company / tenant settings — these reflect schema-guaranteed
      // values that the renderer always emits at print time.
      expect(map.sale.saleNumber).toBe(true);
      expect(map.sale.grandTotal).toBe(true);
      expect(map.sale.cashier).toBe(true);
      expect(Object.values(map.sale).every(v => v === true)).toBe(true);
      expect(Object.values(map.item).every(v => v === true)).toBe(true);
      expect(Object.values(map.tender).every(v => v === true)).toBe(true);
    });

    // Parity guard: the property keys per namespace MUST mirror
    // `NAMESPACE_PROPERTIES` in apps/web/src/features/receipt-templates/templateAutocomplete.ts.
    // Drift between the two breaks the editor's "dimmed for unset variables"
    // hint — the editor only checks paths it knows about, but a path the
    // server forgot to advertise renders silently as empty at print time.
    it('publishes the documented property keys per namespace (web parity)', async () => {
      const caller = appRouter.createCaller(createAdminContext());
      const map = await caller.receiptTemplates.variableAvailability();
      expect(Object.keys(map).sort()).toEqual([
        'company',
        'fiscal',
        'item',
        'sale',
        'tender',
      ]);
      expect(Object.keys(map.company).sort()).toEqual([
        'address',
        'city',
        'email',
        'name',
        'phone',
        'taxId',
      ]);
      expect(Object.keys(map.sale).sort()).toEqual([
        'cashier',
        'changeDue',
        'createdAt',
        'customer',
        'customerTaxId',
        'discount',
        'grandTotal',
        'notes',
        'saleNumber',
        // ENG-039d3 — service charge fields exposed to the editor's
        // variable autocomplete alongside the existing tip field.
        'serviceCharge',
        'serviceChargeRate',
        'site',
        'subtotal',
        'taxTotal',
        'tip',
      ]);
      expect(Object.keys(map.item).sort()).toEqual([
        'discount',
        'name',
        'qty',
        'sku',
        'taxPercent',
        'total',
        'unitPrice',
      ]);
      expect(Object.keys(map.fiscal).sort()).toEqual([
        'cufe',
        'documentNumber',
        'qrUrl',
        'resolution',
      ]);
      expect(Object.keys(map.tender).sort()).toEqual([
        'amount',
        'method',
        'reference',
      ]);
    });

    it('reflects fiscal_dian_enabled flag — disabled tenant gets fiscal.* false', async () => {
      const db = getDatabase();
      const previous = await db
        .select({ settings: tenants.settings })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .get();
      try {
        await db
          .update(tenants)
          .set({ settings: { ...(previous?.settings ?? {}), fiscal_dian_enabled: false } })
          .where(eq(tenants.id, tenantId));

        const caller = appRouter.createCaller(createAdminContext());
        const map = await caller.receiptTemplates.variableAvailability();
        expect(map.fiscal.cufe).toBe(false);
        expect(map.fiscal.qrUrl).toBe(false);
        expect(map.fiscal.resolution).toBe(false);
        expect(map.fiscal.documentNumber).toBe(false);
      } finally {
        await db
          .update(tenants)
          .set({ settings: previous?.settings ?? {} })
          .where(eq(tenants.id, tenantId));
      }
    });

    it('reflects fiscal_dian_enabled flag — enabled tenant gets fiscal.* true', async () => {
      const db = getDatabase();
      const previous = await db
        .select({ settings: tenants.settings })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .get();
      try {
        await db
          .update(tenants)
          .set({ settings: { ...(previous?.settings ?? {}), fiscal_dian_enabled: true } })
          .where(eq(tenants.id, tenantId));

        const caller = appRouter.createCaller(createAdminContext());
        const map = await caller.receiptTemplates.variableAvailability();
        expect(map.fiscal.cufe).toBe(true);
        expect(map.fiscal.documentNumber).toBe(true);
      } finally {
        await db
          .update(tenants)
          .set({ settings: previous?.settings ?? {} })
          .where(eq(tenants.id, tenantId));
      }
    });

    it.each([
      ['legacy camelCase boolean', { fiscalDianEnabled: true }],
      ['string true', { fiscal_dian_enabled: 'true' }],
      ['numeric true', { fiscal_dian_enabled: 1 }],
    ])('treats %s fiscal flag shape as enabled', async (_label, settings) => {
      const db = getDatabase();
      const previous = await db
        .select({ settings: tenants.settings })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .get();
      try {
        await db
          .update(tenants)
          .set({ settings })
          .where(eq(tenants.id, tenantId));

        const map = await appRouter
          .createCaller(createAdminContext())
          .receiptTemplates.variableAvailability();
        expect(map.fiscal.cufe).toBe(true);
        expect(map.fiscal.documentNumber).toBe(true);
      } finally {
        await db
          .update(tenants)
          .set({ settings: previous?.settings ?? {} })
          .where(eq(tenants.id, tenantId));
      }
    });

    it('reflects nullable company columns — populated row gets true, empty row gets false', async () => {
      const db = getDatabase();
      const before = await db
        .select({
          taxId: companies.taxId,
          address: companies.address,
          phone: companies.phone,
          email: companies.email,
        })
        .from(companies)
        .where(eq(companies.tenantId, tenantId))
        .get();

      try {
        // Force every optional column to null, then assert the map
        // reports them as false.
        await db
          .update(companies)
          .set({ taxId: null, address: null, phone: null, email: null })
          .where(eq(companies.tenantId, tenantId));
        let map = await appRouter
          .createCaller(createAdminContext())
          .receiptTemplates.variableAvailability();
        expect(map.company.name).toBe(true);
        expect(map.company.taxId).toBe(false);
        expect(map.company.address).toBe(false);
        expect(map.company.phone).toBe(false);
        expect(map.company.email).toBe(false);
        expect(map.company.city).toBe(false);

        // Re-populate them and assert they flip to true.
        await db
          .update(companies)
          .set({
            taxId: '900.123.456-7',
            address: 'Cra 7 # 12-34',
            phone: '+57 320 555 1234',
            email: 'contacto@example.co',
          })
          .where(eq(companies.tenantId, tenantId));
        map = await appRouter
          .createCaller(createAdminContext())
          .receiptTemplates.variableAvailability();
        expect(map.company.taxId).toBe(true);
        expect(map.company.address).toBe(true);
        expect(map.company.phone).toBe(true);
        expect(map.company.email).toBe(true);
        // city has no schema column — pinned to false until that ticket lands.
        expect(map.company.city).toBe(false);
      } finally {
        // Restore previous state regardless of intermediate assertion failure
        // so the next test inherits the seed-baseline row, not a half-mutated one.
        await db
          .update(companies)
          .set({
            taxId: before?.taxId ?? null,
            address: before?.address ?? null,
            phone: before?.phone ?? null,
            email: before?.email ?? null,
          })
          .where(eq(companies.tenantId, tenantId));
      }
    });

    it('treats whitespace-only values as unset (empty trim)', async () => {
      const db = getDatabase();
      const before = await db
        .select({ phone: companies.phone })
        .from(companies)
        .where(eq(companies.tenantId, tenantId))
        .get();
      try {
        await db
          .update(companies)
          .set({ phone: '   ' })
          .where(eq(companies.tenantId, tenantId));
        const map = await appRouter
          .createCaller(createAdminContext())
          .receiptTemplates.variableAvailability();
        expect(map.company.phone).toBe(false);
      } finally {
        await db
          .update(companies)
          .set({ phone: before?.phone ?? null })
          .where(eq(companies.tenantId, tenantId));
      }
    });

    it('rejects manager and cashier callers (admin-only)', async () => {
      const managerCaller = appRouter.createCaller(
        createAdminContext({ role: 'manager' })
      );
      await expect(
        managerCaller.receiptTemplates.variableAvailability()
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      const cashierCaller = appRouter.createCaller(
        createAdminContext({ role: 'cashier' })
      );
      await expect(
        cashierCaller.receiptTemplates.variableAvailability()
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });
});
