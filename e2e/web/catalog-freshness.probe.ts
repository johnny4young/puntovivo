import { expect, test, type Page, type BrowserContext } from '@playwright/test';
import { appendFileSync } from 'node:fs';
import D from 'better-sqlite3';
import { loginAs } from './support/app';
const kinds = ['category', 'provider', 'unit'] as const;
type Kind = (typeof kinds)[number];
type Observation = {
  label?: string;
  at?: number;
  paths?: string[];
  pageerror?: string;
  stage?: string;
  kind?: Kind;
  text?: string;
  selected?: string;
  options?: string[];
};
const plural = { category: 'categories', provider: 'providers', unit: 'units' };
const original = (kind: Kind, n: number) =>
  `Lab ${kind[0].toUpperCase() + kind.slice(1)} ${String(n).padStart(2, '0')}`;
const id = (kind: Kind, n: number) =>
  `lab-${kind === 'category' ? 'cat' : kind}-${String(n).padStart(2, '0')}`;
const sku = (n: number) => `LAB-FRESH-${n}`;
const row = (p: Page, n: number) => p.getByRole('row').filter({ hasText: sku(n) });
async function nav(p: Page, path: string) {
  const link = p.locator(`a[href="${path}"]`).filter({ visible: true }).first();
  if (!(await link.count())) {
    const toggle = p.getByTestId('sidebar-more-tools-toggle');
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
    if (path !== '/products') {
      await p.locator('a[href="/catalog"]').filter({ visible: true }).first().click();
      await expect(p).toHaveURL(/\/catalog$/);
    }
  }
  await p.locator(`a[href="${path}"]`).filter({ visible: true }).first().click();
  await expect(p).toHaveURL(new RegExp(path + '$'));
}
async function settle(p: Page) {
  await p.waitForLoadState('networkidle');
  await p.evaluate(
    () => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))
  );
}
async function prepare(
  p: Page,
  c: BrowserContext,
  role: 'admin' | 'manager',
  records: Observation[],
  label: string
) {
  await c.addInitScript(() => localStorage.setItem('puntovivo-language-preference', 'en'));
  p.on('pageerror', e => records.push({ label, pageerror: e.message }));
  await c.route('**/*', route => {
    const u = new URL(route.request().url());
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) &&
      !['data:', 'blob:', 'about:'].includes(u.protocol)
    )
      return route.abort('blockedbyclient');
    if (u.pathname.startsWith('/api/trpc/'))
      records.push({
        label,
        at: Date.now(),
        paths: decodeURIComponent(u.pathname.slice('/api/trpc/'.length)).split(','),
      });
    return route.continue();
  });
  await loginAs(p, role);
  await p.goto('/products');
  await expect(row(p, 0)).toBeVisible();
  await settle(p);
}
async function editProduct(p: Page, n: number) {
  await row(p, n).getByRole('button', { name: 'Edit', exact: true }).click();
  const modal = p.getByRole('dialog', { name: 'Edit Product', exact: true });
  await expect(modal).toBeVisible();
  return modal;
}
async function snapshot(p: Page, kind: Kind, n: number) {
  const r = row(p, n);
  await expect(r).toBeVisible();
  // The Eye button is the documented read-only product details surface.
  const details = r.getByRole('button', { name: /details/i });
  await details.click();
  const fields = p.getByTestId('product-details-fields');
  await expect(fields).toBeVisible();
  const text = await fields.innerText();
  await p
    .getByTestId('product-details-drawer')
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  const modal = await editProduct(p, n);
  let options: string[];
  let selected: string;
  if (kind === 'unit') {
    await modal.locator('#product-tab-units').click();
    const sel = modal.locator('select[name="unitAssignments.0.unitId"]');
    selected = await sel.inputValue();
    options = await sel.locator('option').allTextContents();
  } else {
    const sel = modal.locator(`#product-${kind}`);
    selected = await sel.inputValue();
    options = await sel.locator('option').allTextContents();
  }
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  await settle(p);
  return { text, selected, options };
}
async function mutate(p: Page, kind: Kind, n: number, action: 'update' | 'delete', name: string) {
  await nav(p, '/' + plural[kind]);
  await settle(p);
  await p.getByRole('main').getByRole('textbox').first().fill(name);
  const r = p.getByRole('row').filter({ hasText: name });
  await expect(r).toBeVisible();
  if (action === 'update') {
    await r.getByRole('button', { name: 'Edit', exact: true }).click();
    const modal = p.getByRole('dialog').filter({ has: p.locator(`#${kind}-name`) });
    await modal.locator(`#${kind}-name`).fill(name + ' Updated');
    const response = p.waitForResponse(
      r => r.url().includes(plural[kind] + '.update') && r.status() === 200
    );
    await modal.getByRole('button', { name: /^Save( Changes)?$/, exact: true }).click();
    await response;
    await expect(modal).toBeHidden();
  } else {
    await r.getByRole('button', { name: 'Delete', exact: true }).click();
    const modal = p.getByRole('dialog');
    const response = p.waitForResponse(
      r => r.url().includes(plural[kind] + '.delete') && r.status() === 200
    );
    await modal.getByRole('button', { name: /^Delete(?: provider| unit)?$/i }).click();
    await response;
    await expect(modal).toBeHidden();
  }
  await settle(p);
  const db = new D('packages/server/data/local.db', { readonly: true });
  const found = db.prepare(`SELECT name FROM ${plural[kind]} WHERE id=?`).get(id(kind, n)) as
    { name: string } | undefined;
  db.close();
  expect(found?.name).toBe(action === 'update' ? name + ' Updated' : undefined);
}
for (const [index, kind] of kinds.entries()) {
  test(`same-session ${kind} projection after update and delete`, async ({
    page,
    context,
  }, info) => {
    const records: Observation[] = [];
    const n = index;
    const name = original(kind, n);
    try {
      await prepare(page, context, 'admin', records, 'same-' + kind);
      const cold = await snapshot(page, kind, n);
      expect(cold.options).toContain(name);
      await mutate(page, kind, n, 'update', name);
      await nav(page, '/products');
      await settle(page);
      const updated = await snapshot(page, kind, n);
      records.push({ stage: 'updated', kind, ...updated });
      expect.soft(updated.options).toContain(name + ' Updated');
      if (kind !== 'unit') expect.soft(updated.text).toContain(name + ' Updated');
      // Delete an unused unit; referenced units have a restrictive FK by contract.
      const deleteN = index + 10;
      const deleteName = original(kind, deleteN);
      await mutate(page, kind, deleteN, 'delete', deleteName);
      await nav(page, '/products');
      await settle(page);
      const deleted = await snapshot(page, kind, n);
      records.push({ stage: 'deleted', kind, ...deleted });
      expect.soft(deleted.options).not.toContain(deleteName);
      expect.soft(deleted.selected).toBe(id(kind, n));
    } finally {
      await info.attach('freshness', {
        body: JSON.stringify(records),
        contentType: 'application/json',
      });
      if (process.env.LAB_CATALOG_REQUEST_LOG)
        appendFileSync(
          process.env.LAB_CATALOG_REQUEST_LOG,
          JSON.stringify({ test: info.title, records }) + '\n'
        );
    }
  });
}
for (const [index, kind] of kinds.entries()) {
  test(`second-session ${kind}: TTL focus and reconnect`, async ({
    page,
    context,
    browser,
  }, info) => {
    const records: Observation[] = [];
    const n = index + 3;
    const name = original(kind, n);
    const start = Date.now();
    const writerContext = await browser.newContext({
      baseURL: new URL(info.project.use.baseURL!).origin,
    });
    const writer = await writerContext.newPage();
    try {
      await page.clock.setFixedTime(start);
      await prepare(page, context, 'manager', records, 'reader-' + kind);
      await snapshot(page, kind, n);
      await prepare(writer, writerContext, 'admin', records, 'writer-' + kind);
      await mutate(writer, kind, n, 'update', name);
      const beforeFresh = records.length;
      await page.clock.setFixedTime(start + 60000);
      await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
      await settle(page);
      const fresh = await snapshot(page, kind, n);
      records.push({ stage: 'fresh-focus', kind, ...fresh });
      expect(fresh.options).toContain(name);
      expect(fresh.options).not.toContain(name + ' Updated');
      const freshRequests = records
        .slice(beforeFresh)
        .filter(x => x.label === 'reader-' + kind && x.paths)
        .flatMap(x => x.paths ?? []);
      expect(
        freshRequests.filter((p: string) =>
          ['categories.tree', 'providers.list', 'units.list', 'products.list'].includes(p)
        )
      ).toEqual([]);
      await page.clock.setFixedTime(start + 301000);
      await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
      await settle(page);
      const stale = await snapshot(page, kind, n);
      records.push({ stage: 'expired-focus', kind, ...stale });
      expect(stale.options).toContain(name + ' Updated');
      if (kind !== 'unit') expect(stale.text).toContain(name + ' Updated');
      const deleteN = index + 13;
      const deletedName = original(kind, deleteN);
      await mutate(writer, kind, deleteN, 'delete', deletedName);
      await page.clock.setFixedTime(start + 330000);
      await page.evaluate(() => {
        window.dispatchEvent(new Event('offline'));
        window.dispatchEvent(new Event('online'));
      });
      await settle(page);
      const freshDelete = await snapshot(page, kind, n);
      records.push({ stage: 'fresh-reconnect', kind, ...freshDelete });
      expect(freshDelete.options).toContain(deletedName);
      await page.clock.setFixedTime(start + 602000);
      await page.evaluate(() => {
        window.dispatchEvent(new Event('offline'));
        window.dispatchEvent(new Event('online'));
      });
      await settle(page);
      const staleDelete = await snapshot(page, kind, n);
      records.push({ stage: 'expired-reconnect', kind, ...staleDelete });
      expect(staleDelete.options).not.toContain(deletedName);
      expect(staleDelete.selected).toBe(id(kind, n));
      expect(records.filter(x => x.pageerror)).toEqual([]);
    } finally {
      await info.attach('freshness', {
        body: JSON.stringify(records),
        contentType: 'application/json',
      });
      if (process.env.LAB_CATALOG_REQUEST_LOG)
        appendFileSync(
          process.env.LAB_CATALOG_REQUEST_LOG,
          JSON.stringify({ test: info.title, records }) + '\n'
        );
      await writerContext.close();
    }
  });
}
