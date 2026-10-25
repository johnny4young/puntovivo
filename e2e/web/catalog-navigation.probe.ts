import { expect, test, type Page } from '@playwright/test';
import { appendFileSync } from 'node:fs';
import { loginAs } from './support/app';
type Metrics = {
  phase: string;
  formCalls: Array<{ open: boolean; phase: string }>;
  started: number | null;
  firstRow: number | null;
};
declare global {
  interface Window {
    __labCatalogNavigation: Metrics;
  }
}
const sku = 'LAB-FRESH-0';
const row = (page: Page) => page.getByRole('row').filter({ hasText: sku });
async function settled(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(
    () => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))
  );
}
async function phase(page: Page, tag: string) {
  await page.evaluate(tag => {
    const m = window.__labCatalogNavigation;
    m.phase = tag;
    m.started = null;
    m.firstRow = null;
    performance.clearResourceTimings();
    const click = (e: MouseEvent) => {
      if ((e.target as Element).closest('a[href="/products"]')) {
        m.started = performance.now();
        document.removeEventListener('click', click, true);
      }
    };
    document.addEventListener('click', click, true);
    const observer = new MutationObserver(() => {
      const r = Array.from(document.querySelectorAll('tbody tr')).find(n =>
        n.textContent?.includes('LAB-FRESH-0')
      );
      if (m.started !== null && r && r.getBoundingClientRect().height > 0) {
        requestAnimationFrame(() => {
          m.firstRow ??= performance.now();
        });
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }, tag);
}
for (let sample = 0; sample < 5; sample++)
  test(`catalog navigation closed form sample ${sample + 1}`, async ({ page, context }, info) => {
    const rpc: Array<{ phase: string; paths: string[] }> = [];
    const errors: string[] = [];
    let tag = 'login';
    await context.addInitScript(() => {
      localStorage.setItem('puntovivo-language-preference', 'en');
      window.__labCatalogNavigation = {
        phase: 'login',
        formCalls: [],
        started: null,
        firstRow: null,
      };
    });
    page.on('pageerror', e => errors.push(e.message));
    await context.route('**/*', route => {
      const u = new URL(route.request().url());
      if (
        !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) &&
        !['about:', 'blob:', 'data:'].includes(u.protocol)
      )
        return route.abort('blockedbyclient');
      if (u.pathname.startsWith('/api/trpc/'))
        rpc.push({
          phase: tag,
          paths: decodeURIComponent(u.pathname.slice('/api/trpc/'.length)).split(','),
        });
      return route.continue();
    });
    await loginAs(page, 'manager');
    await settled(page);
    const results: unknown[] = [];
    for (const stage of ['cold', 'warm']) {
      tag = stage;
      await phase(page, stage);
      await page.locator('a[href="/products"]').filter({ visible: true }).first().click();
      await expect(row(page)).toBeVisible();
      await expect(row(page)).toContainText('Lab Category 00');
      await settled(page);
      const m = await page.evaluate(stage => {
        const m = window.__labCatalogNavigation;
        return {
          phase: stage,
          closedFormCalls: m.formCalls.filter(x => x.phase === stage && !x.open).length,
          openFormCalls: m.formCalls.filter(x => x.phase === stage && x.open).length,
          timeToRowMs: m.firstRow !== null && m.started !== null ? m.firstRow - m.started : null,
          js: performance
            .getEntriesByType('resource')
            .filter(
              x =>
                new URL(x.name).origin === location.origin &&
                new URL(x.name).pathname.endsWith('.js')
            )
            .map(x => ({
              name: new URL(x.name).pathname,
              bytes: (x as PerformanceResourceTiming).encodedBodySize,
            })),
        };
      }, stage);
      expect(m.openFormCalls).toBe(0);
      expect(m.timeToRowMs).not.toBeNull();
      const paths = rpc.filter(x => x.phase === stage).flatMap(x => x.paths);
      expect(paths.filter(x => x === 'products.list')).toHaveLength(stage === 'cold' ? 1 : 0);
      if (process.env.LAB_NAV_EXPECT_CLOSED === 'zero') expect(m.closedFormCalls).toBe(0);
      results.push({
        ...m,
        productListProcedures: paths.filter(x => x === 'products.list').length,
      });
      await page.locator('a[href="/dashboard"]').filter({ visible: true }).first().click();
      await expect(page).toHaveURL(/\/dashboard$/);
      await settled(page);
    }
    // Preserve read-only detail, edit snapshot, unsaved cancellation, and clean create contracts.
    tag = 'oracle';
    await page.evaluate(() => (window.__labCatalogNavigation.phase = 'oracle'));
    await page.locator('a[href="/products"]').filter({ visible: true }).first().click();
    await expect(row(page)).toBeVisible();
    await row(page).getByRole('button', { name: 'View details', exact: true }).click();
    const fields = page.getByTestId('product-details-fields');
    await expect(fields).toContainText('Lab Provider 00');
    await page
      .getByTestId('product-details-drawer')
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await row(page).getByRole('button', { name: 'Edit', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit Product', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#product-category')).toHaveValue('lab-cat-00');
    await expect(dialog.locator('#product-provider')).toHaveValue('lab-provider-00');
    await dialog.locator('#product-name').fill('Unsaved navigation probe');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    const keep = page.getByRole('button', { name: 'Keep editing', exact: true });
    await expect(keep).toBeVisible();
    await keep.click();
    await expect(dialog.locator('#product-name')).toHaveValue('Unsaved navigation probe');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(row(page)).toContainText('Synthetic Freshness 0');
    await expect(row(page)).not.toContainText('Unsaved navigation probe');
    await page.getByRole('button', { name: 'Add Product', exact: true }).click();
    const create = page.getByRole('dialog', { name: 'Create Product', exact: true });
    await expect(create).toBeVisible();
    await expect(create.locator('#product-name')).toHaveValue('');
    await create.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(create).toBeHidden();
    expect(errors).toEqual([]);
    const all = await page.evaluate(() => window.__labCatalogNavigation.formCalls);
    expect(all.some(x => x.open && x.phase === 'oracle')).toBe(true);
    const oracleJs = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .filter(
          x =>
            new URL(x.name).origin === location.origin && new URL(x.name).pathname.endsWith('.js')
        )
        .map(x => new URL(x.name).pathname)
    );
    const summary = {
      sample: sample + 1,
      results,
      oracle: 'detail/edit/keep/discard/clean-create PASS',
      pageerrors: errors,
      formCalls: all,
      oracleJs,
    };
    await info.attach('catalog-navigation', {
      body: JSON.stringify(summary),
      contentType: 'application/json',
    });
    appendFileSync(process.env.LAB_NAV_RESULTS!, JSON.stringify(summary) + '\n');
  });
