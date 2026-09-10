import { randomUUID } from 'node:crypto';
import { expect, type Page, type Request } from '@playwright/test';
import { E2E_PASSWORD, ensureLanguage } from '../web/support/app.js';
import {
  selectPharmacyOption,
  type PharmacyJourneyTarget,
  type PharmacyMedicine,
} from './pharmacy-operations-journey.js';

/** Auth changes use the real logout command, not client storage deletion. */
export interface PharmacyRoleTarget extends PharmacyJourneyTarget {
  signInAs: (email: string) => Promise<unknown>;
  /** Unlike ordinary navigation, the requested route must redirect a forbidden role. */
  requestRestrictedRoute: () => Promise<unknown>;
}

/** Non-clinical fixture identifiers already created through the prescription journey. */
interface PharmacyRoleContext {
  medicine: PharmacyMedicine;
  customerName: string;
  reference: string;
  credential: string;
}

async function signOut(page: Page) {
  const toasts = page.locator('[role="status"] button[aria-label]');
  while ((await toasts.count()) > 0) await toasts.first().click();
  await page
    .locator('header')
    .getByRole('button', { name: /^(?:open user menu for|abre el menú de usuario de) /i })
    .click();
  const response = page.waitForResponse(
    candidate =>
      candidate.request().method() === 'POST' &&
      candidate.url().includes('/api/trpc/auth.logout') &&
      candidate.status() !== 401
  );
  await page
    .locator('#header-user-menu')
    .getByRole('button', { name: /^(?:sign out|cerrar sesión)$/i })
    .click();
  expect((await response).status()).toBe(200);
  await expect(page.getByLabel(/email/i)).toBeVisible();
}

/** The recall read model is redacted at the authority; cashier cannot mount the workspace. */
export async function runPharmacyRolePrivacyJourney(
  page: Page,
  target: PharmacyRoleTarget,
  context: PharmacyRoleContext
) {
  await ensureLanguage(page, 'en');
  const originName = (await page.locator('header button[name="site"]').innerText()).trim();
  const suffix = randomUUID().slice(0, 8);
  const people = [
    { role: 'Manager', email: `pharmacy.manager.${suffix}@example.test` },
    { role: 'Cashier', email: `pharmacy.cashier.${suffix}@example.test` },
  ];
  await target.navigate('/users');
  for (const person of people) {
    await page.getByRole('button', { name: 'Add User', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create User', exact: true });
    await dialog.getByLabel('Name', { exact: true }).fill(`Pharmacy ${person.role} ${suffix}`);
    await dialog.getByLabel('Email', { exact: true }).fill(person.email);
    await dialog.getByLabel('Role', { exact: true }).selectOption({ label: person.role });
    await dialog.getByLabel('Initial Password').fill(E2E_PASSWORD);
    await dialog.getByRole('button', { name: 'Create User', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('tr').filter({ hasText: person.email })).toBeVisible();
  }

  const reason = `E2E identified-customer safety recall ${suffix}`;
  await target.navigate('/inventory?view=pharmacy');
  await page.getByRole('tab', { name: 'Recalls', exact: true }).click();
  await page.locator('#pharmacy-recall-scope').selectOption('product');
  await page.locator('#pharmacy-recall-product-search').fill(context.medicine.sku);
  await selectPharmacyOption(page.locator('#pharmacy-recall-product'), context.medicine.sku);
  await page.locator('#pharmacy-recall-reason').fill(reason);
  await page.getByRole('button', { name: 'Start recall and block lots', exact: true }).click();
  const detail = page.getByRole('region', { name: 'Recall detail', exact: true });
  await expect(detail).toContainText(context.customerName);
  await target.screenshot('pharmacy-administrator-affected-customer');

  await signOut(page);
  await target.signInAs(people[0]!.email);
  const site = page.locator('header button[name="site"]');
  if ((await site.innerText()).trim() !== originName) {
    await site.click();
    await page.getByRole('option', { name: originName, exact: true }).click();
  }
  await expect(site).toHaveText(originName);
  await target.navigate('/inventory?view=pharmacy');
  await page.getByRole('tab', { name: 'Recalls', exact: true }).click();
  const affected = page.waitForResponse(
    response =>
      response.ok() &&
      new URL(response.url()).pathname
        .replace('/api/trpc/', '')
        .split(',')
        .includes('pharmacy.affectedSales')
  );
  await page.getByRole('button').filter({ hasText: reason }).click();
  const serialized = JSON.stringify(await (await affected).json());
  expect(serialized).toContain('"customerIdentityRestricted":true');
  for (const secret of [context.customerName, context.reference, context.credential]) {
    expect(serialized).not.toContain(secret);
    await expect(page.getByText(secret, { exact: true })).toHaveCount(0);
  }
  await expect(detail).toContainText('Identity restricted');
  await expect(detail).toContainText('Customer identity is redacted for managers.');
  await target.screenshot('pharmacy-manager-authority-redacted-recall');
  await ensureLanguage(page, 'es');
  await expect(page.getByText('Identidad restringida', { exact: true })).toBeVisible();
  await expect(page.getByText(context.customerName, { exact: true })).toHaveCount(0);
  await target.screenshot('pharmacy-manager-redacted-recall-es');
  await ensureLanguage(page, 'en');
  await page.getByRole('tab', { name: 'Professional authorizations', exact: true }).click();
  await expect(
    page.getByText(
      'Managers can review authorization status. Only administrators can register or revoke professional credentials.',
      { exact: true }
    )
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Register authorization', exact: true })
  ).toHaveCount(0);
  await expect(page.getByLabel('Verified credential', { exact: true })).toHaveCount(0);
  await target.screenshot('pharmacy-manager-read-only-professional-status');

  await signOut(page);
  await target.signInAs(people[1]!.email);
  const forbiddenRequests: string[] = [];
  const collect = (request: Request) => {
    if (
      new URL(request.url()).pathname
        .replace('/api/trpc/', '')
        .split(',')
        .some(procedure =>
          /^pharmacy\.(affectedSales|getRecall|listRecalls|listEvidence|listAuthorizations)$/.test(
            procedure
          )
        )
    )
      forbiddenRequests.push(request.url());
  };
  page.on('request', collect);
  try {
    await target.requestRestrictedRoute();
    await expect(page).toHaveURL(/\/sales$/);
    await expect(
      page.getByRole('button', { name: 'Search products', exact: true }).first()
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Pharmacy safety operations', exact: true })
    ).toHaveCount(0);
    await expect(page.getByText(context.customerName, { exact: true })).toHaveCount(0);
    expect(forbiddenRequests).toEqual([]);
    await target.screenshot('pharmacy-cashier-route-redirected-to-pos');
  } finally {
    page.off('request', collect);
  }
}
