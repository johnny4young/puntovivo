import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { electronTest as test, expect, IS_PACKAGED_RUN } from './fixtures.js';
import { E2E_USERS } from '../shared/baseline.js';
import { attachClientIssueTracker, expectNoClientIssues } from '../web/support/app.js';
import {
  createProduct,
  dismissVisibleToasts,
  goToRoute,
  openCashSession,
  pinPrimarySite,
  signIn,
} from './support/journey.js';
import {
  prepareSandboxEnvelope,
  sendSandboxEnvelope,
} from '../../packages/server/src/services/external-orders/simulator.js';
// @ts-expect-error -- shared runtime constants are a pure .mjs module.
import { ELECTRON_E2E_API_URL } from '../../scripts/electron-e2e-runtime.mjs';

test('signed external order becomes one local sale and a durable delivery in Electron', async ({
  page,
}) => {
  const tracker = attachClientIssueTracker(page),
    admin = E2E_USERS.find(user => user.role === 'admin');
  if (!admin) throw new Error('E2E admin fixture is missing');
  await signIn(page, admin.email);
  await pinPrimarySite(page);
  await goToRoute(page, '/products');
  await createProduct(page, {
    name: 'E2E External Product',
    sku: 'E2E-EXTERNAL-DESKTOP',
    stock: '10',
    price: '12500',
  });
  await goToRoute(page, '/sales');
  await openCashSession(page, 'E2E External Register');
  await dismissVisibleToasts(page);
  await goToRoute(page, '/external-orders');
  await page.getByRole('button', { name: 'Connectors', exact: true }).click();
  await page.getByRole('button', { name: 'Create connector', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Create connector', exact: true });
  await create.getByLabel('Connector name').fill('E2E desktop sender');
  await create.getByRole('button', { name: 'Generate secure key' }).click();
  const secret = await create.getByLabel('Signing key', { exact: true }).inputValue();
  await create.getByRole('checkbox').check();
  await create.getByRole('button', { name: 'Create connector', exact: true }).click();
  await expect(create).toBeHidden();
  const connectorId = await page.getByLabel('Connector ID', { exact: true }).inputValue();
  const body = JSON.stringify({
    schemaVersion: 1,
    eventId: 'desktop-event',
    orderId: 'desktop-order',
    kind: 'order.created',
    order: {
      customerName: 'Desktop guest',
      address: 'Desktop address',
      currencyCode: 'COP',
      quotedTotal: 1,
      items: [{ productCode: 'E2E-EXTERNAL-DESKTOP', quantity: 1 }],
    },
  });
  const envelope = prepareSandboxEnvelope(connectorId, secret, body);
  const first = await sendSandboxEnvelope(ELECTRON_E2E_API_URL, envelope),
    repeat = await sendSandboxEnvelope(ELECTRON_E2E_API_URL, envelope);
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  expect(repeat).toEqual(first);
  await page.getByRole('button', { name: 'Orders', exact: true }).click();
  await page.getByRole('button', { name: /desktop-order/ }).click();
  const detail = page.getByTestId('external-order-detail');
  await detail.getByRole('button', { name: 'Review local prices' }).click();
  await expect(detail).toContainText('The local total differs');
  await expect(detail.getByRole('button', { name: 'Accept and create draft' })).toBeDisabled();
  await detail.getByRole('checkbox').check();
  await detail.getByRole('button', { name: 'Accept and create draft' }).click();
  await detail.getByRole('link', { name: 'Open suspended sales' }).click();
  const draft = page.getByTestId('suspended-draft-card').filter({ hasText: 'desktop-order' });
  await expect(draft).toHaveCount(1);
  await draft.getByTestId('suspended-draft-resume').click();
  await expect(page.getByTestId('sale-cart-item-E2E-EXTERNAL-DESKTOP')).toBeVisible();
  await page.keyboard.press('F2');
  const payment = page.getByRole('dialog', { name: 'Charge Sale' });
  await expect(payment).toBeVisible();
  await payment.locator('#sale-payment-confirm').click();
  await expect(payment).toBeHidden();
  await goToRoute(page, '/external-orders');
  await page.getByRole('combobox', { name: 'Order status' }).selectOption('accepted');
  await page.getByRole('button', { name: /desktop-order/ }).click();
  await detail.getByRole('link', { name: 'Create delivery from this sale' }).click();
  const delivery = page.getByRole('dialog', { name: 'Create delivery', exact: true });
  await delivery.getByLabel('Recipient name').fill('Desktop guest');
  await delivery.getByLabel('Delivery address').fill('Desktop address');
  await delivery.getByRole('button', { name: 'Create delivery', exact: true }).click();
  await expect(delivery).toBeHidden();
  await page.getByTestId('delivery-detail-advance').click();
  await expect(page.getByTestId('delivery-status-preparing')).toHaveAttribute(
    'data-active',
    'true'
  );
  // Status changes refresh the selected board; find the only newly-created recipient card.
  await page
    .locator('article[data-testid^="delivery-card-"]')
    .filter({ hasText: 'Desktop guest' })
    .getByRole('button', { name: 'Open details', exact: true })
    .click();
  await page.getByTestId('delivery-detail-courier').fill('Desktop courier');
  await page.getByTestId('delivery-detail-advance').click();
  await expect(page.getByTestId('delivery-status-dispatched')).toHaveAttribute(
    'data-active',
    'true'
  );
  await page.reload();
  await expect(page.getByTestId('delivery-page')).toBeVisible();
  await page.getByTestId('delivery-status-dispatched').click();
  await page
    .locator('article[data-testid^="delivery-card-"]')
    .filter({ hasText: 'Desktop guest' })
    .getByRole('button', { name: 'Open details', exact: true })
    .click();
  await expect(page.getByTestId('delivery-detail-courier')).toHaveValue('Desktop courier');
  await page.getByTestId('delivery-detail-advance').click();
  await expect(page.getByTestId('delivery-status-delivered')).toHaveAttribute(
    'data-active',
    'true'
  );
  await goToRoute(page, '/external-orders');
  await page.getByRole('combobox', { name: 'Order status' }).selectOption('accepted');
  await page.getByRole('button', { name: /desktop-order/ }).click();
  await expect(detail).toContainText('Linked sale');
  if (process.env.PUNTOVIVO_AUDIT_DIR) {
    await mkdir(process.env.PUNTOVIVO_AUDIT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(
        process.env.PUNTOVIVO_AUDIT_DIR,
        `external-order-electron-${IS_PACKAGED_RUN ? 'packaged' : 'dev'}.png`
      ),
      fullPage: true,
      animations: 'disabled',
    });
  }
  await expectNoClientIssues(tracker);
});
