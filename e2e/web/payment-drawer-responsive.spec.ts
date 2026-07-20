import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { attachClientIssueTracker, expectNoClientIssues, login } from './support/app';
import { seedSaleScenario } from './support/db';
import { addProductToCartViaKeyboard, expectSearchInputFocused } from './support/sales-keyboard';

type Viewport = { width: number; height: number };

const DESKTOP_VIEWPORT: Viewport = { width: 1440, height: 900 };
const TABLET_VIEWPORT: Viewport = { width: 768, height: 1024 };
const MOBILE_VIEWPORT: Viewport = { width: 390, height: 844 };

async function openPaymentDrawer(
  page: Page,
  testInfo: TestInfo,
  viewport: Viewport,
  spanish = false
) {
  await page.setViewportSize(viewport);
  const scenario = seedSaleScenario(
    `payment-drawer-${viewport.width}-${testInfo.parallelIndex}-${Date.now()}`
  );
  await login(
    page,
    {
      email: scenario.cashier.email,
      password: scenario.cashier.password,
      defaultPath: '/sales',
    },
    { spanish }
  );
  await addProductToCartViaKeyboard(page, scenario.product.sku);
  await page.keyboard.press('F1');

  const dialog = page.getByRole('dialog', {
    name: spanish ? 'Cobrar venta' : 'Charge Sale',
  });
  await expect(dialog).toBeVisible();
  return {
    dialog,
    drawer: page.getByTestId('sale-payment-drawer'),
    summary: page.getByTestId('sale-payment-summary'),
    confirm: dialog.getByRole('button', {
      name: spanish ? 'Confirmar venta' : 'Confirm Sale',
    }),
  };
}

async function expectStableRegionsVisible(
  page: Page,
  drawer: Locator,
  summary: Locator,
  confirm: Locator
) {
  await expect(drawer).toBeVisible();
  await expect(summary).toBeVisible();
  await expect(confirm).toBeVisible();
  // Geometry during slide-in is intentionally fractional and changes each
  // frame. Await the panel's CSS animation before pinning its settled edge.
  await drawer.evaluate(async element => {
    await Promise.all(element.getAnimations().map(animation => animation.finished));
  });

  const geometry = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('[data-testid="sale-payment-drawer"]');
    const body = panel?.querySelector<HTMLElement>('.modal-body');
    const total = document.querySelector<HTMLElement>('[data-testid="sale-payment-summary"]');
    const confirmButton = document.querySelector<HTMLElement>('#sale-payment-confirm');
    if (!panel || !body || !total || !confirmButton) return null;
    const panelRect = panel.getBoundingClientRect();
    const totalRect = total.getBoundingClientRect();
    const confirmRect = confirmButton.getBoundingClientRect();
    return {
      panel: {
        x: panelRect.x,
        y: panelRect.y,
        width: panelRect.width,
        height: panelRect.height,
      },
      totalTop: totalRect.top,
      confirmBottom: confirmRect.bottom,
      bodyHasInternalScroll: body.scrollHeight > body.clientHeight,
      bodyOverflowsHorizontally: body.scrollWidth > body.clientWidth + 1,
    };
  });

  expect(geometry).not.toBeNull();
  expect(geometry?.bodyOverflowsHorizontally).toBe(false);
  expect(geometry?.totalTop).toBeGreaterThanOrEqual(0);
  expect(geometry?.confirmBottom).toBeLessThanOrEqual(
    (await page.viewportSize())?.height ?? Number.POSITIVE_INFINITY
  );
  return geometry!;
}

function expectPanelRect(
  actual: { x: number; y: number; width: number; height: number },
  expected: { x: number; y: number; width: number; height: number }
) {
  expect(actual.x).toBeCloseTo(expected.x, 0);
  expect(actual.y).toBeCloseTo(expected.y, 0);
  expect(actual.width).toBeCloseTo(expected.width, 0);
  expect(actual.height).toBeCloseTo(expected.height, 0);
}

async function captureAuditScreenshot(page: Page, name: string) {
  const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
  if (!auditDir) return;
  await mkdir(auditDir, { recursive: true });
  // Let Chromium commit two full frames after the last layout change. Without
  // this, local GPU compositing can leave transient black tiles in evidence
  // screenshots even though the DOM assertions and subsequent frame are sound.
  await page.evaluate(
    () =>
      new Promise<void>(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
  await page.screenshot({ path: path.join(auditDir, `${name}.png`) });
}

test.describe('responsive payment drawer', () => {
  test('desktop keeps a fixed right drawer through method and split changes', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const { dialog, drawer, summary, confirm } = await openPaymentDrawer(
      page,
      testInfo,
      DESKTOP_VIEWPORT
    );

    const initial = await expectStableRegionsVisible(page, drawer, summary, confirm);
    expectPanelRect(initial.panel, { x: 800, y: 0, width: 640, height: 900 });

    await dialog.getByRole('button', { name: 'Card', exact: true }).click();
    await expect(drawer).toHaveAttribute('data-testid', 'sale-payment-drawer');
    const card = await expectStableRegionsVisible(page, drawer, summary, confirm);
    expectPanelRect(card.panel, initial.panel);

    await dialog.getByRole('button', { name: 'Split payment across tenders' }).click();
    const split = await expectStableRegionsVisible(page, drawer, summary, confirm);
    expectPanelRect(split.panel, initial.panel);
    expect(split.bodyHasInternalScroll).toBe(true);

    await captureAuditScreenshot(page, 'desktop-1440-en-split');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expectSearchInputFocused(page);
    await expectNoClientIssues(tracker);
  });

  test('tablet uses the wide right rail without horizontal overflow', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const { dialog, drawer, summary, confirm } = await openPaymentDrawer(
      page,
      testInfo,
      TABLET_VIEWPORT
    );

    const geometry = await expectStableRegionsVisible(page, drawer, summary, confirm);
    expectPanelRect(geometry.panel, { x: 128, y: 0, width: 640, height: 1024 });
    await captureAuditScreenshot(page, 'tablet-768-en-cash');

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expectSearchInputFocused(page);
    await expectNoClientIssues(tracker);
  });

  test('mobile uses a bottom sheet with pinned Spanish total and actions', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    const { dialog, drawer, summary, confirm } = await openPaymentDrawer(
      page,
      testInfo,
      MOBILE_VIEWPORT,
      true
    );

    await expectStableRegionsVisible(page, drawer, summary, confirm);
    await captureAuditScreenshot(page, 'mobile-390-es-cash');

    await dialog.getByRole('button', { name: 'Dividir el pago en varios medios' }).click();
    const geometry = await expectStableRegionsVisible(page, drawer, summary, confirm);
    expect(geometry.panel.x).toBe(0);
    expect(geometry.panel.width).toBe(MOBILE_VIEWPORT.width);
    expect(geometry.panel.y + geometry.panel.height).toBe(MOBILE_VIEWPORT.height);
    expect(geometry.panel.height).toBeLessThanOrEqual(MOBILE_VIEWPORT.height * 0.85 + 1);
    expect(geometry.bodyHasInternalScroll).toBe(true);

    await dialog.getByText('Pago dividido', { exact: true }).evaluate(element => {
      element.scrollIntoView({ block: 'start' });
    });
    await captureAuditScreenshot(page, 'mobile-390-es-split');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expectSearchInputFocused(page);
    await expectNoClientIssues(tracker);
  });
});
