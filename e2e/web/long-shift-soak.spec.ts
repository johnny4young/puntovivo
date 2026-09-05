import { readFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, test, type Page } from '@playwright/test';
import {
  compareRendererMemoryGrowth,
  renderRendererMemoryReport,
  sampleRendererMemory,
  type RendererMemoryGrowthBudget,
  type RendererMemorySample,
} from './support/long-shift-memory.ts';
import { attachClientIssueTracker, expectNoClientIssues, login } from './support/app';
import { seedSaleScenario } from './support/db';

interface LongShiftSoakBudget {
  cycles: number;
  warmupCycles: number;
  checkpointEvery: number;
  settleMs: number;
  maxGrowth: RendererMemoryGrowthBudget;
}

const perfBudget = JSON.parse(readFileSync('perf-budget.json', 'utf8')) as {
  longShiftSoak: LongShiftSoakBudget;
};
const budget = perfBudget.longShiftSoak;
const DB_PATH = path.join(process.cwd(), 'packages/server/data/local.db');
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1pAAAAAASUVORK5CYII=',
  'base64'
);

interface TenantSettingsSnapshot {
  value: string;
  updatedAt: string;
}

interface BlobUrlAudit {
  created: string[];
  revoked: string[];
}

function enableInvoiceOcr(tenantId: string): TenantSettingsSnapshot {
  const db = new Database(DB_PATH);
  try {
    db.pragma('busy_timeout = 5000');
    const row = db
      .prepare('select settings, updated_at as updatedAt from tenants where id = ?')
      .get(tenantId) as { settings: string; updatedAt: string } | undefined;
    if (!row) throw new Error(`Tenant ${tenantId} not found`);

    const settings = JSON.parse(row.settings) as Record<string, unknown>;
    const ai =
      settings.ai && typeof settings.ai === 'object'
        ? (settings.ai as Record<string, unknown>)
        : {};
    const features =
      ai.features && typeof ai.features === 'object'
        ? (ai.features as Record<string, unknown>)
        : {};
    const invoiceOcr =
      features.invoiceOcr && typeof features.invoiceOcr === 'object'
        ? (features.invoiceOcr as Record<string, unknown>)
        : {};
    const nextSettings = {
      ...settings,
      ai: {
        ...ai,
        enabled: true,
        features: {
          ...features,
          invoiceOcr: { ...invoiceOcr, enabled: true, provider: 'textract' },
        },
      },
    };
    db.prepare('update tenants set settings = ?, updated_at = ? where id = ?').run(
      JSON.stringify(nextSettings),
      new Date().toISOString(),
      tenantId
    );
    return { value: row.settings, updatedAt: row.updatedAt };
  } finally {
    db.close();
  }
}

function restoreTenantSettings(tenantId: string, snapshot: TenantSettingsSnapshot) {
  const db = new Database(DB_PATH);
  try {
    db.pragma('busy_timeout = 5000');
    db.prepare('update tenants set settings = ?, updated_at = ? where id = ?').run(
      snapshot.value,
      snapshot.updatedAt,
      tenantId
    );
  } finally {
    db.close();
  }
}

async function navigateInApp(page: Page, route: '/products' | '/purchases' | '/sales') {
  await page.evaluate(target => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
  await expect(page).toHaveURL(new RegExp(`${route}$`));
  // History changes before the lazy React route commits. Purchases and products
  // both expose Add Product, so URL-only readiness can click the previous page.
  if (route === '/sales') {
    await expect(page.getByTestId('sales-operation-strip')).toBeVisible();
  } else {
    const name = route === '/products' ? /^(products|productos)$/i : /^(purchases|compras)$/i;
    await expect(page.getByRole('main').getByRole('heading', { level: 1, name })).toBeVisible();
  }
}

async function installBlobUrlAudit(page: Page) {
  await page.evaluate(() => {
    const audit: BlobUrlAudit = { created: [], revoked: [] };
    const createObjectURL = URL.createObjectURL.bind(URL);
    const revokeObjectURL = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = object => {
      const url = createObjectURL(object);
      audit.created.push(url);
      return url;
    };
    URL.revokeObjectURL = url => {
      audit.revoked.push(url);
      revokeObjectURL(url);
    };
    Reflect.set(window, '__puntovivoBlobUrlAudit', audit);
  });
}

async function readBlobUrlAudit(page: Page): Promise<BlobUrlAudit> {
  return page.evaluate(() => {
    const audit = Reflect.get(window, '__puntovivoBlobUrlAudit') as BlobUrlAudit | undefined;
    if (!audit) throw new Error('Blob URL audit was not installed');
    return { created: [...audit.created], revoked: [...audit.revoked] };
  });
}

async function exerciseInvoiceOcrPreviewLifecycle(page: Page) {
  await navigateInApp(page, '/purchases');
  const openOcr = page.getByTestId('purchases-open-ocr');
  await expect(openOcr).toBeVisible();
  await installBlobUrlAudit(page);

  let releaseUpload!: () => void;
  let markUploadReached!: () => void;
  let markUploadCompleted!: () => void;
  let uploadWasReached = false;
  const uploadRelease = new Promise<void>(resolve => {
    releaseUpload = resolve;
  });
  const uploadReached = new Promise<void>(resolve => {
    markUploadReached = resolve;
  });
  const uploadCompleted = new Promise<void>(resolve => {
    markUploadCompleted = resolve;
  });
  await page.route('**/api/trpc/upload.uploadInvoice*', async route => {
    markUploadReached();
    try {
      await uploadRelease;
      await route.continue();
    } finally {
      markUploadCompleted();
    }
  });

  try {
    await openOcr.click();
    const dialog = page.getByRole('dialog', {
      name: /upload a photo, ai reads the invoice|sube una foto, la ia lee la factura/i,
    });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/jpg.*png.*pdf/i);
    await dialog.locator('input[type="file"]').first().setInputFiles({
      name: 'long-shift-invoice.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });
    await uploadReached;
    uploadWasReached = true;

    await expect
      .poll(async () => (await readBlobUrlAudit(page)).created.at(-1) ?? null)
      .not.toBeNull();
    const previewUrl = (await readBlobUrlAudit(page)).created.at(-1)!;
    await dialog.getByRole('button', { name: /close modal|cerrar modal/i }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(async () => (await readBlobUrlAudit(page)).revoked.includes(previewUrl))
      .toBe(true);
  } finally {
    releaseUpload();
    if (uploadWasReached) await uploadCompleted;
    await page.unroute('**/api/trpc/upload.uploadInvoice*');
  }
}

async function exerciseShiftCycle(page: Page) {
  await navigateInApp(page, '/products');
  const addProduct = page.getByRole('button', { name: /^(add product|agregar producto)$/i });
  await expect(addProduct).toBeVisible();
  await addProduct.click();
  const createDialog = page.getByRole('dialog', {
    name: /create product|crear producto/i,
  });
  await expect(createDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(createDialog).toBeHidden();

  const viewDetails = page.getByRole('button', {
    name: /view details|ver detalle/i,
  });
  await expect(viewDetails.first()).toBeVisible();
  await viewDetails.first().click();
  const productDrawer = page.getByTestId('product-details-drawer');
  await expect(productDrawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(productDrawer).toBeHidden();

  await navigateInApp(page, '/sales');
  const openHistory = page.getByTestId('sales-open-history');
  await expect(openHistory).toBeVisible();
  await openHistory.click();
  const historyDrawer = page.getByTestId('sales-history-drawer');
  await expect(historyDrawer).toBeVisible();
  await expect(
    historyDrawer.getByRole('heading', {
      name: /sales history|historial de ventas/i,
    })
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(historyDrawer).toBeHidden();
}

test(
  'same renderer plateaus across a long shift of route, modal, drawer, and query lifecycles',
  { tag: '@long-shift-soak' },
  async ({ page }, testInfo) => {
    test.setTimeout(5 * 60_000);
    const tracker = attachClientIssueTracker(page);
    const scenario = seedSaleScenario(`long-shift-${testInfo.parallelIndex}-${Date.now()}`);
    const settingsSnapshot = enableInvoiceOcr(scenario.tenantId);
    try {
      await login(page, {
        email: scenario.admin.email,
        password: scenario.admin.password,
        defaultPath: '/dashboard',
      });
      await exerciseInvoiceOcrPreviewLifecycle(page);

      for (let cycle = 0; cycle < budget.warmupCycles; cycle += 1) {
        await exerciseShiftCycle(page);
      }

      const session = await page.context().newCDPSession(page);
      const samples: RendererMemorySample[] = [];
      try {
        samples.push(await sampleRendererMemory(page, session, 0, budget.settleMs));
        for (let cycle = 1; cycle <= budget.cycles; cycle += 1) {
          await exerciseShiftCycle(page);
          if (cycle % budget.checkpointEvery === 0 || cycle === budget.cycles) {
            samples.push(await sampleRendererMemory(page, session, cycle, budget.settleMs));
          }
        }
      } finally {
        await session.detach();
      }

      const result = compareRendererMemoryGrowth(samples, budget.maxGrowth);
      const report = renderRendererMemoryReport(samples, result, budget.maxGrowth);
      console.log(report);
      await testInfo.attach('long-shift-renderer-memory', {
        body: Buffer.from(`${JSON.stringify({ budget, samples, result }, null, 2)}\n`),
        contentType: 'application/json',
      });

      expect(result.regressions, report).toEqual([]);
      await expect(page).toHaveURL(/\/sales$/);
      await expect(page.locator('[role="dialog"]:visible')).toHaveCount(0);
      await expectNoClientIssues(tracker);
    } finally {
      restoreTenantSettings(scenario.tenantId, settingsSnapshot);
    }
  }
);
