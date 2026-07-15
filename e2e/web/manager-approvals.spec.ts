import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  attachClientIssueTracker,
  ensureLanguage,
  expectNoClientIssues,
  loginAs,
  openUserMenu,
} from './support/app';
import {
  E2E_MANAGER_APPROVAL_PIN,
  getManagerApprovalState,
  resetManagerApprovalScenario,
  seedManagerApprovalRequest,
} from './support/manager-approvals';

async function captureEvidence(page: Page, name: string) {
  const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
  if (!auditDir) return;
  await mkdir(auditDir, { recursive: true });
  await page.screenshot({
    animations: 'disabled',
    fullPage: false,
    path: path.join(auditDir, `${name}.png`),
  });
}

test.describe('manager approval queue (ENG-106c1)', () => {
  test('approves and rejects with a fresh manager PIN in both locales', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    try {
      const englishRequest = await seedManagerApprovalRequest({
        reason: 'Customer has a documented price match',
        label: 'Sale VTA-E2E-1042',
        amount: 125,
        currencyCode: 'USD',
      });
      await loginAs(page, 'manager');
      await expect(page.getByText("Today's sales").first()).toBeVisible();
      await openUserMenu(page);

      let queue = page.getByRole('region', { name: 'Approvals' });
      await expect(queue.getByText('Sale discount')).toBeVisible();
      await expect(queue.getByText('Customer has a documented price match')).toBeVisible();
      await expect(queue.getByText(/Requested by E2E Cashier/)).toBeVisible();
      await queue.scrollIntoViewIfNeeded();
      await captureEvidence(page, 'eng-106c1-approval-queue-en');

      await queue.getByRole('button', { name: 'Approve' }).click();
      await queue.getByLabel('Your staff PIN').fill(E2E_MANAGER_APPROVAL_PIN);
      await queue.getByRole('button', { name: 'Confirm approval' }).click();
      await expect(queue.getByText('No pending requests.')).toBeVisible();
      await expect
        .poll(() => getManagerApprovalState(englishRequest.requestId))
        .toMatchObject({ status: 'approved', decidedBy: englishRequest.managerId });

      const spanishRequest = await seedManagerApprovalRequest({
        reason: 'El descuento requiere una segunda revisión',
        label: 'Venta VTA-E2E-1043',
        amount: 80,
        currencyCode: 'USD',
      });
      await ensureLanguage(page, 'es');
      await openUserMenu(page);

      queue = page.getByRole('region', { name: 'Aprobaciones' });
      await expect(queue.getByText('Descuento de venta')).toBeVisible();
      await expect(queue.getByText('El descuento requiere una segunda revisión')).toBeVisible();
      await queue.getByRole('button', { name: 'Rechazar' }).click();
      await queue.getByLabel('Tu PIN de personal').fill(E2E_MANAGER_APPROVAL_PIN);
      await queue.getByLabel('Motivo del rechazo').fill('Falta validar el soporte');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.locator('#header-user-menu').evaluate(element => {
        element.scrollTop = element.scrollHeight;
      });
      const confirmRejection = queue.getByRole('button', { name: 'Confirmar rechazo' });
      await expect(confirmRejection).toBeVisible();
      await captureEvidence(page, 'eng-106c1-approval-rejection-es');
      await confirmRejection.click();
      await expect(queue.getByText('No hay solicitudes pendientes.')).toBeVisible();
      await expect
        .poll(() => getManagerApprovalState(spanishRequest.requestId))
        .toMatchObject({
          status: 'rejected',
          decidedBy: spanishRequest.managerId,
          decisionReason: 'Falta validar el soporte',
        });

      await expectNoClientIssues(tracker);
    } finally {
      resetManagerApprovalScenario();
    }
  });
});
